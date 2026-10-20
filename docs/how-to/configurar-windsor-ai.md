# Cómo: configurar Windsor.ai

> **Decisión asentada (2026-10-08): la fuente de los datos de Meta Ads del CRM es la cuenta publicitaria `TQN - Growing 2 - LC`** (ID `1669338306456901`, conector Facebook de Windsor). Cortado en Jarrito y Todo un País **no tienen cuenta publicitaria propia en uso**: sus campañas corren en esa cuenta compartida. En Windsor existe también una cuenta llamada `Cuenta Todo un País`, pero **no se usa** y se ignora a propósito. Consecuencia para el diseño: el cliente no se distingue por la cuenta sino por el **nombre de la campaña**, y la comunidad por el **conjunto de anuncios** (`adset_name`). Detalle y pendientes en el spec, sección 3 septendecies.

1. En Windsor.ai, generar una API key con acceso al conector de Meta Ads.
2. Cargarla como secret de Supabase: `supabase secrets set WINDSOR_API_KEY=...`.
3. En el panel, tab **Overview**, cargar cada `comunidad` con su `adset_name` **exacto** (case-sensitive) tal como aparece en Meta Ads Manager — es la única forma en que `windsor-sync` sabe a qué comunidad pertenece cada fila.
4. Desde la tab **Control_Comunidades**, botón "Sincronizar Windsor.ai" — trae los últimos 7 días por default (o el rango de fechas elegido en los filtros de esa tab), solo para el cliente elegido en el selector. Pide `spend`, `impressions`, `clicks` y el campo de conversaciones iniciadas, agrupado por `adset_name`. Si Windsor devuelve varias filas por adset y día, se suman antes de guardar.
5. Adset sin comunidad con ese `adset_name` exacto → se reporta en el aviso de la sincronización, nunca se inserta a ciegas.

Para automatizarlo (en vez de correrlo a mano), programar la Edge Function `windsor-sync` con Supabase Scheduled Functions o `pg_cron` — no viene configurado por default en este repo.

## Campo de conversaciones iniciadas

El documento de Jaz lo llama `messaging_conversation_started_7d`, pero **según la documentación pública de Windsor.ai (conector Facebook, revisada el 2026-10-08) el campo se llama `actions_onsite_conversion_messaging_conversation_started_7d`** ("Messaging conversation started"). Ese es el nombre que hay que configurar; con el del documento de Jaz las conversaciones quedarían siempre en 0. Falta confirmar con una consulta real que devuelva números para las campañas de Cortado y Todo un País. El campo `adset_name` sí existe en el conector. Si la sincronización avisa que "Windsor.ai no devolvió el campo…" y las conversaciones quedan en 0, corregirlo sin tocar el código:

```bash
supabase secrets set WINDSOR_CONVERSATIONS_FIELD=<nombre exacto del campo en Windsor.ai>
```

El CTR de anuncio sale de `clicks / impressions`: ya no figura "sin fuente".

## Importar la inversión por comunidad desde tu computadora (PR #10)

Mientras `windsor-sync` no tenga la clave cargada en Supabase, la inversión de Meta Ads se importa con un script local. No deja ninguna clave en la nube.

1. En Windsor (conector Facebook) exportá un CSV con las columnas `date, account_id, account_name, campaign, adset_name, spend, impressions, clicks, actions_onsite_conversion_messaging_conversation_started_7d`, por día, del período que quieras.
2. **Ensayo** (no guarda nada, solo muestra qué haría):
   ```bash
   node scripts/windsor-importar.mjs --csv "C:/ruta/data.csv" --cuenta "TQN - Growing 2 - LC"
   ```
3. Si el resumen por comunidad es el esperado, repetí el comando agregando `--aplicar`. Se puede repetir sobre el mismo período: reemplaza los valores de cada comunidad y día, no duplica.

Qué hace con el CSV:
- **Campaña → cliente, conjunto de anuncios → comunidad**, según la tabla `comunidad_meta_origen` (reglas con `adset_nombre` vacío = toda la campaña a una comunidad "general"). Los nombres se comparan sin tildes, sin mayúsculas y con espacios colapsados.
- Las campañas que no están en el mapeo (otros clientes de la misma cuenta) se ignoran y se informa cuántas filas.
- Si una campaña mapeada trae un conjunto que no figura, avisa con el gasto y **no lo asigna**: hay que agregar la regla a `comunidad_meta_origen`.
- Con `--windsor --desde AAAA-MM-DD --hasta AAAA-MM-DD` consulta la API directamente (requiere la variable de entorno `WINDSOR_API_KEY`; la clave nunca se imprime).
- Las pruebas del importador: `npm test`.

**Alta de una comunidad nueva en Meta:** insertar una fila en `comunidad_meta_origen` (ver `db/mantenimiento/2026-10-08_cargar_mapeo_meta.sql` como modelo) con el nombre exacto de la campaña y del conjunto.

## Qué campañas cuentan para las métricas (desde db/025)
Cada regla de `comunidad_meta_origen` tiene una marca **`cuenta`**:
- `true` (por defecto): el gasto y las conversaciones de esa campaña o conjunto suman en las métricas y en los costos.
- `false`: el gasto **no suma**, pero queda registrado en **Consultas** ("no cuenta por regla: N filas, $X"). La columna `motivo_exclusion` dice por qué.

**Criterio (decisión del 20/10/2026):** solo cuentan las campañas de **conversión o tráfico a WhatsApp**. Las de interacción o visitas al perfil no, porque distorsionan el costo por conversación y por miembro.

| Cliente | Campaña | Cuenta |
|---|---|---|
| Cortado en Jarrito | `TQN_AON_META_CON_TRAFICO_MANUAL_CORTADO_EN_JARRITO_WHATSAPP` (conjuntos `_BOEDO`, `_DEVOTO` y `_PALERMO`) | **Sí**: cada conjunto va a su comunidad; cualquier otro conjunto de la campaña va a la comunidad general |
| Cortado en Jarrito | `TQN_AON_META_CON_LEADS_MANUAL_CORTADO_EN_JARRITO_WHATSAPP` (Boedo, Palermo, Devoto) | No (decisión del usuario) |
| Cortado en Jarrito | `TQN_AON_META_CON_INTE_MANUAL_CORTADO_EN_JARRITO` (POST y DARK) | No: su resultado en Meta son visitas al perfil y a la página |
| Todo un País | `TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS` (La Toma, Quines, San Luis) | Sí |

**Cómo se ve en la práctica:** al sincronizar con Windsor, la función quita de `meta_ads_metrica` lo que ya no corresponde (las filas de las fechas que trae Windsor que ninguna regla vigente respalda), así el gasto excluido no queda en la base. Si el mapeo no asigna ninguna fila, no borra nada.

**Agregar un conjunto nuevo (por ejemplo, otro barrio):** insertar una regla en `comunidad_meta_origen` con `campana_nombre`, `adset_nombre` y la comunidad. La regla por conjunto gana sobre la de "toda la campaña". Mientras no esté, el gasto de ese conjunto va a la comunidad general y se ve en Consultas.

**Revertir una exclusión:**
```sql
update crm_comunidades_v2.comunidad_meta_origen set cuenta = true, motivo_exclusion = null where id = 'ID_DE_LA_REGLA';
select * from crm_comunidades_v2.sincronizar_meta_desde_windsor();
```

**Límite:** el importador por CSV (`scripts/windsor-importar.mjs`) respeta la marca, pero no borra lo que ya estaba cargado; para corregir el pasado se usa la sincronización con Windsor.
