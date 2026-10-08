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
