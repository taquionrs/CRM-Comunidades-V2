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
- **Rango de fechas:** últimos 90 días (Windsor corrige cifras de días anteriores, por eso conviene que vuelva a traer los últimos días en cada corrida).
- **Frecuencia:** una vez al día como mínimo.
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

**Programarla para que corra sola** (con `pg_cron`) se hace después de verificar la primera corrida contra Ads Manager, cuando ya se conoce el nombre real de la tabla de Windsor.

**Prueba sin rastros:** `node scripts/probar-sincronizacion-windsor.mjs <csv de Windsor>` corre la función dentro de una transacción que se anula y muestra el resultado.
