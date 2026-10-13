# Conectar Windsor.ai a la base del CRM (destino Supabase)

Windsor escribe por su cuenta los datos de Meta Ads en una tabla de la base, sin CSV ni scripts. Aterrizan **crudos** en el esquema `windsor_raw`; una función posterior (db/015) los convierte en `meta_ads_metrica` por comunidad.

**Seguridad:** Windsor usa un usuario propio, `windsor_escritor` (db/014), que **solo puede crear y escribir tablas en `windsor_raw`**. No tiene acceso a nada del CRM. **Nunca** le des a Windsor la contraseña de `postgres` ni la clave `service_role`.

## 1. Ponerle contraseña al usuario (una vez)
El usuario se creó sin contraseña y sin poder iniciar sesión. En Supabase → SQL Editor, corré esto con una contraseña larga y propia (no la compartas por chat ni la guardes en el repo):
```sql
alter role windsor_escritor with login password 'PONER_UNA_CONTRASEÑA_LARGA_Y_UNICA';
```

## 2. Datos de conexión
En Supabase → **Connect** → pestaña **Session pooler** (usá el pooler: acepta conexiones IPv4, que son las que suelen necesitar los servicios externos). Anotá:
| Dato en Windsor | Valor |
|---|---|
| Host | el que muestra Session pooler (`aws-0-<región>.pooler.supabase.com`) |
| Puerto | `5432` |
| Base de datos | `postgres` |
| Usuario | `windsor_escritor.zyyxsammrryhfrgfwlxr` (el usuario, un punto y el identificador del proyecto) |
| Contraseña | la del paso 1 |
| Esquema | `windsor_raw` |
| SSL | activado |

## 3. Crear el destino en Windsor: usar el destino **PostgreSQL**, no "Supabase"
Windsor ofrece dos destinos y **no son equivalentes**:
| Destino | Cómo se conecta | Qué le das a Windsor |
|---|---|---|
| **Supabase** | Botón "Connect Supabase": autorizás a Windsor con tu cuenta de Supabase (OAuth) y elegís cuenta y proyecto | Acceso a **tu cuenta de Supabase**, que es mucho más amplio que una sola tabla. Según su guía, además pide la contraseña de PostgreSQL |
| **PostgreSQL** (recomendado) | Usuario, contraseña, host, puerto y base de datos | **Solo** lo que le damos al usuario aislado `windsor_escritor` (db/014): crear y escribir tablas en `windsor_raw` |

Por eso se usa el **destino PostgreSQL** con el usuario aislado. Con el destino Supabase el aislamiento de la db/014 no serviría de nada.

1. Windsor → **Data destinations** → **PostgreSQL** → agregar tarea.
2. Completar: **User name** `windsor_escritor.zyyxsammrryhfrgfwlxr`, **Host** `aws-0-us-east-2.pooler.supabase.com`, **Port** `5432`, **Password** la del paso 1, **Database name** `postgres`, **Table name** `facebook_ads` (sin esquema: el usuario tiene `windsor_raw` como esquema por defecto, db/016).
3. Probá la conexión. Si falla, revisá primero el usuario (lleva el punto y el identificador del proyecto).
4. Si dejaste autorizado a Windsor con el botón "Connect Supabase" (OAuth) en algún momento, **revocá esa autorización** desde tu cuenta de Supabase si no la vas a usar.

## 4. Crear la tarea de datos
- **Fuente:** Facebook Ads.
- **Cuenta:** **solo `TQN - Growing 2 - LC`** (ID `1669338306456901`). Si Windsor trae las otras cuentas, aterrizan en tu base datos de otros clientes.
- **Campos:**
  `date`, `account_id`, `account_name`, `campaign`, `adset_name`, `spend`, `impressions`, `clicks`, `actions_onsite_conversion_messaging_conversation_started_7d`, `actions_onsite_conversion_lead_grouped`
- **Rango de fechas:** **últimos 30 días**. Windsor no permite más de 30 días por corrida en una tarea programada (con 90 muestra el error "Max date range is 30 days"); el historial más viejo se trae con **Backfill: 3 meses**. Cada día se vuelven a traer los últimos 30, así se corrigen las cifras que Meta ajusta después.
- **Frecuencia:** diaria, a las **09:00 UTC** (06:00 de Argentina). **Columns to Match: `date`**, para que cada corrida reemplace las filas de esos días en lugar de agregarlas.
- **Destino:** el de PostgreSQL de arriba, tabla `facebook_ads` (queda en el esquema `windsor_raw`). Si Windsor da a elegir el modo de escritura, elegí **actualizar/reemplazar por fecha** y no "agregar siempre", para no duplicar filas.

## 5. Primera corrida
Ejecutá la tarea una vez a mano y avisame. Con la tabla ya creada reviso sus columnas (cada destino nombra los campos a su manera) y escribo la función de db/015 que la convierte a `meta_ads_metrica`.

## Mantenimiento
- Si dejás de usar Windsor, desactivá el usuario: `alter role windsor_escritor nologin;`.
- Si se filtra la contraseña, cambiala con el mismo `alter role` del paso 1.
- `windsor_raw` no está expuesto por la API del panel: solo se lee desde la base.

## 6. Convertir lo aterrizado en las columnas del CRM (db/015)
La función `sincronizar_meta_desde_windsor` convierte la tabla cruda en `meta_ads_metrica` por comunidad, con la misma regla que el importador por CSV: la campaña define el cliente, el conjunto de anuncios define la comunidad, los nombres se comparan sin tildes ni mayúsculas, y si el cliente tiene cuenta publicitaria definida, la fila tiene que ser de esa cuenta. Se puede correr todas las veces que haga falta (guarda por comunidad y día).

Con la primera tabla ya aterrizada (se asume `windsor_raw.facebook_ads`; si Windsor usa otro nombre, se pasa como parámetro):
```sql
-- Convertir:
select * from crm_comunidades_v2.sincronizar_meta_desde_windsor('windsor_raw.facebook_ads');
-- Ver qué conjuntos de anuncios no tienen comunidad (su gasto NO se asignó):
select * from crm_comunidades_v2.meta_sin_comunidad('windsor_raw.facebook_ads');
```
Si aparece un conjunto sin comunidad, se agrega una fila a `comunidad_meta_origen` (modelo: `db/mantenimiento/2026-10-08_cargar_mapeo_meta.sql`) y se vuelve a correr. Cada corrida deja una fila en `crm_comunidades_v2.windsor_sync_log`.

**Programada (db/017):** `pg_cron` corre la conversión todos los días a las **09:30 UTC**, media hora después de Windsor. Ver el trabajo: `select * from cron.job where jobname = 'sincronizar-meta-windsor';`. El resultado de cada corrida queda en `crm_comunidades_v2.windsor_sync_log`; si falla, el error queda en `cron.job_run_details`.

**Prueba sin rastros:** `node scripts/probar-sincronizacion-windsor.mjs <csv de Windsor>` corre la función dentro de una transacción que se anula y muestra el resultado.

## Seguridad de la clave de Windsor
La dirección de consulta que Windsor muestra al configurar la tarea incluye la **clave de API** (`api_key=…`). No la compartas en capturas ni en chats; si se expuso, regenerala desde tu cuenta de Windsor.

## 7. Trazabilidad: el botón "Consultas" del panel
En Control_Comunidades, el botón **Consultas** abre (a pantalla completa) la línea de tiempo de todo lo que pasa entre Windsor y el CRM. Reemplaza al antiguo botón "Sincronizar Windsor.ai".

| Tipo | Qué es | De dónde sale |
|---|---|---|
| **Entrega de Windsor** | Windsor escribió o reemplazó filas en `windsor_raw.facebook_ads` (cuántas filas y de qué fechas) | `windsor_entrega_log`, que llena un trigger sobre la tabla de Windsor |
| **Conversión** | Se pasó lo recibido a `meta_ads_metrica` por comunidad: filas recibidas, asignadas, registros escritos y gasto sin comunidad | `windsor_sync_log` |
| **Programada** | El trabajo diario de `pg_cron`, con su estado y duración | `cron.job_run_details` |
| **CSV manual** | Una importación con `scripts/windsor-importar.mjs`, con el nombre del archivo | `windsor_sync_log` |

Se puede filtrar por tipo y actualizar. No muestra datos personales: solo fechas, cantidades y estados.

**Qué no muestra:** las llamadas internas de Windsor a Meta ni los intentos de Windsor que no llegan a escribir en la base (esos se ven en el panel de Windsor). Si Windsor vuelve a crear la tabla, la próxima conversión reinstala el registro de entregas.

Para consultarlo desde SQL: `select * from crm_comunidades_v2.consultas_windsor(100);`
