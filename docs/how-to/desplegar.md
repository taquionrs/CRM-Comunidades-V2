# Cómo: desplegar

## Base de datos (una sola vez)

1. Abrir el SQL Editor del proyecto Supabase compartido con V1.
2. Correr [`db/001_init.sql`](../../db/001_init.sql) y después [`db/002_vistas_panel.sql`](../../db/002_vistas_panel.sql), en ese orden.
3. En **Project Settings → Data API**, agregar `crm_comunidades_v2` a la lista de schemas expuestos (no es automático — mismo paso que V1).

## Edge Functions

Con la CLI de Supabase logueada y el proyecto linkeado:

```bash
supabase functions deploy manychat-webhook
supabase functions deploy windsor-sync
supabase functions deploy nominacion-sync
supabase functions deploy panel-data
```

## Frontend (Vercel)

1. Crear un proyecto Vercel nuevo apuntando a este repo.
2. Cargar las env vars `SUPABASE_URL` / `SUPABASE_ANON_KEY` (mismo proyecto Supabase que V1) en el dashboard de Vercel.
3. Build Command: `npm run build` — Output Directory: `.` (ya está en [`vercel.json`](../../vercel.json)).
4. Deploy.

Sin las 3 credenciales externas (Windsor.ai/ManyChat, ver [variables de entorno](../reference/variables-de-entorno.md)) el panel funciona igual — vacío, no fabrica datos.
