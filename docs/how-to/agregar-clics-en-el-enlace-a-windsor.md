# Cómo: agregar "Clics en el enlace" (`actions_link_click`) a la tarea de Windsor

**Para qué:** que Control_Comunidades muestre los clics en el enlace del anuncio (los mismos que Ads Manager). Hoy solo llegan los clics totales (`clicks`), que suman reacciones, toques al perfil, etc., y inflan el CTR.

**Quién lo hace:** vos, en Windsor (es la única parte que no se puede hacer desde el código). Tiempo: 10 a 15 minutos, más lo que tarde Windsor en traer los datos.

**Qué se toca:** solo la lista de campos de la tarea que ya existe. No se cambia la cuenta, el destino ni la frecuencia.

> Los nombres de los botones de Windsor pueden variar un poco según cuándo lo mires. Si algo no se parece a lo que dice acá, no cambies nada y mandame una captura.

## Antes de empezar (1 minuto)
- La migración `db/036` ya tiene que estar aplicada en Supabase (la PR #65 trae el archivo para correrla). Si Windsor trae el campo antes, no pasa nada: el CRM lo ignora hasta que se aplique.
- Anotá hoy el valor de control de Ads Manager: **Clics en el enlace** de la campaña de WhatsApp de Cortado, del 02/11 al 10/11 = **11.615** (se usa en el paso 8).

## Paso a paso

1. Entrá a Windsor.ai e iniciá sesión.
2. En el menú de la izquierda abrí **Data destinations** y elegí **PostgreSQL** (el destino de `windsor_escritor`, el mismo del [paso 3 de conectar Windsor](conectar-windsor-a-supabase.md)).
3. Buscá la tarea que trae **Facebook Ads** de la cuenta **`TQN - Growing 2 - LC`** (tabla `facebook_ads`) y abrí **Edit** (el lápiz o "Editar" de esa tarea).
4. Bajá hasta la lista de campos (**Fields**) de la tarea. Vas a ver los que ya están: `date`, `account_id`, `account_name`, `campaign`, `adset_name`, `spend`, `impressions`, `clicks`, `actions_onsite_conversion_messaging_conversation_started_7d` y `actions_onsite_conversion_lead_grouped`.
5. En el buscador de campos escribí **`link click`** (o `actions_link_click`). Elegí el campo de clics en el enlace dentro de las "Actions" (debería llamarse parecido a "Actions Link Click"; el nombre exacto en pantalla no lo pude comprobar). Lo que importa es que el identificador sea exactamente **`actions_link_click`**:
   - Si ves varios parecidos (`link_clicks`, `inline_link_clicks`, `cost_per_action_type_link_click`), **no los uses**. Este último es el *costo* por clic, no la cantidad. Hace falta el que cuenta clics.
   - Si no encontrás el identificador exacto, frená y mandame una captura de lo que aparece.
6. Marcalo para que quede agregado a la lista y **no saques ningún campo de los que ya estaban** (en especial `date`: es el que usa Windsor para reemplazar las filas de cada día).
7. Verificá que sigan igual el **rango de fechas** (últimos 30 días), la **frecuencia** (diaria, 09:00 UTC) y **Columns to Match: `date`**. Guardá (**Save**).
8. Tocá **Run now** (o ejecutar ahora) para que Windsor traiga los últimos 30 días con el campo nuevo. Como la tarea reemplaza por fecha, los días anteriores también quedan con el dato. Esperá a que el estado diga que terminó.
   - Si querés los meses anteriores, usá **Backfill** (3 meses), como en el paso 4 de la guía de conexión.

## Si la tabla no tiene la columna nueva
Es posible que Windsor agregue la columna sola; si no, la corrida puede dar error por una columna que no existe. En ese caso en Supabase → **SQL Editor** corré esto (una sola vez) y repetí el paso 8:

```sql
alter table windsor_raw.facebook_ads add column if not exists actions_link_click numeric;
```

## Comprobar que llegó (en Supabase → SQL Editor)

```sql
select min("date") as desde, max("date") as hasta, count(*) as filas,
       count(actions_link_click) as filas_con_clics_enlace,
       sum(actions_link_click) filter (where "date" between '2026-11-02' and '2026-11-10'
         and campaign = 'TQN_AON_META_CON_TRAFICO_MANUAL_CORTADO_EN_JARRITO_WHATSAPP') as clics_enlace_cortado_02_al_10_11
from windsor_raw.facebook_ads;
```

- `filas_con_clics_enlace` tiene que ser casi igual a `filas`.
- `clics_enlace_cortado_02_al_10_11` tiene que dar **11.615** (el valor de control de Ads Manager). Si da distinto por poco, mirá que la cuenta y el rango sean los mismos.

## Pasarlo al CRM
Lo hace solo: el trabajo programado convierte lo que llegó todos los días a las **09:30 UTC**. Para verlo ya:
- En el panel, Control_Comunidades → **Traer de Meta ahora** con el rango que quieras (hasta 31 días), o
- en SQL Editor: `select * from crm_comunidades_v2.sincronizar_meta_desde_windsor('windsor_raw.facebook_ads');`

Después, en Control_Comunidades tienen que aparecer con número las columnas **Clics en el enlace**, **CTR del enlace**, **Costo por clic en el enlace** y **Clic → conversación**. La suma de Clics en el enlace de las tres comunidades de Cortado (02 al 10/11) tiene que coincidir con la de Ads Manager (11.615).

## Si algo sale mal
| Qué ves | Qué significa | Qué hacer |
|---|---|---|
| Las columnas dicen **Sin fuente** | Todavía no llegó el campo, o no se volvió a traer ese período | Revisá el paso 8 y corré "Traer de Meta ahora" para el rango |
| Aparece un aviso amarillo: "faltan N días" | Hay días anteriores sin el dato | Traé esos días de nuevo (Backfill o "Traer de Meta ahora") |
| "Traer de Meta ahora" avisa que Windsor no devolvió los clics en el enlace | Windsor no reconoce el nombre del campo | No rompe nada: el resto se guarda. Mandame el nombre exacto que muestra Windsor y lo corrijo |
| La suma no coincide con Ads Manager | Distinta cuenta, rango o campaña | Compará campaña por campaña en **Consultas** y en el desglose |

## Volver atrás
Sacá el campo de la tarea de Windsor y guardá. El CRM conserva lo ya traído; los días nuevos quedan "Sin fuente". No hace falta tocar la base.
