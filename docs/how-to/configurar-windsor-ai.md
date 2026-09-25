# Cómo: configurar Windsor.ai

1. En Windsor.ai, generar una API key con acceso al conector de Meta Ads.
2. Cargarla como secret de Supabase: `supabase secrets set WINDSOR_API_KEY=...`.
3. En el panel, tab **Overview**, cargar cada `comunidad` con su `adset_name` **exacto** (case-sensitive) tal como aparece en Meta Ads Manager — es la única forma en que `windsor-sync` sabe a qué comunidad pertenece cada fila.
4. Desde la tab **Control_Comunidades**, botón "Sincronizar Windsor.ai" — trae los últimos 7 días por default (`spend`, `impressions`, `messaging_conversation_started_7d`, agrupado por `adset_name`).
5. Adset sin comunidad con ese `adset_name` exacto → se reporta en el aviso de la sincronización, nunca se inserta a ciegas.

Para automatizarlo (en vez de correrlo a mano), programar la Edge Function `windsor-sync` con Supabase Scheduled Functions o `pg_cron` — no viene configurado por default en este repo.
