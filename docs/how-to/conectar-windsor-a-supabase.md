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

## 3. Crear el destino en Windsor
1. Windsor → **Data destinations** → agregar **Supabase** (o PostgreSQL) con los datos de arriba.
2. Probá la conexión. Si falla, revisá primero el usuario (lleva el `.` y el identificador del proyecto).

## 4. Crear la tarea de datos
- **Fuente:** Facebook Ads.
- **Cuenta:** **solo `TQN - Growing 2 - LC`** (ID `1669338306456901`). Si Windsor trae las otras cuentas, aterrizan en tu base datos de otros clientes.
- **Campos:**
  `date`, `account_id`, `account_name`, `campaign`, `adset_name`, `spend`, `impressions`, `clicks`, `actions_onsite_conversion_messaging_conversation_started_7d`, `actions_onsite_conversion_lead_grouped`
- **Rango de fechas:** últimos 90 días (Windsor corrige cifras de días anteriores, por eso conviene que vuelva a traer los últimos días en cada corrida).
- **Frecuencia:** una vez al día como mínimo.
- **Destino:** el de arriba, tabla `facebook_ads`, esquema `windsor_raw`. Si Windsor da a elegir el modo de escritura, elegí **actualizar/reemplazar por fecha** y no "agregar siempre", para no duplicar filas.

## 5. Primera corrida
Ejecutá la tarea una vez a mano y avisame. Con la tabla ya creada reviso sus columnas (cada destino nombra los campos a su manera) y escribo la función de db/015 que la convierte a `meta_ads_metrica`.

## Mantenimiento
- Si dejás de usar Windsor, desactivá el usuario: `alter role windsor_escritor nologin;`.
- Si se filtra la contraseña, cambiala con el mismo `alter role` del paso 1.
- `windsor_raw` no está expuesto por la API del panel: solo se lee desde la base.
