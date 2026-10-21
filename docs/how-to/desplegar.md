# Cómo: desplegar

## Base de datos (una sola vez)

1. Abrir el SQL Editor del proyecto Supabase compartido con V1.
2. Correr en este orden: `db/001_init.sql`, `002`, `003`, `004` y `006` (ya aplicadas en producción al 2026-09-30). **No correr `005_rls_por_cliente.sql`**: quedó reemplazada por `030` y `031` (login con SSO y roles), que tienen su propio orden en [configurar el login](configurar-sso-cloudflare.md#orden-de-despliegue). Forma rápida con la CLI, dentro de una transacción: `supabase db query --linked -f archivo.sql`.
3. Dar de alta al menos un cliente: [agregar un cliente](agregar-un-cliente.md).
4. En **Project Settings → Data API**, agregar `crm_comunidades_v2` a la lista de schemas expuestos (no es automático — mismo paso que V1).

## Edge Functions

Con la CLI de Supabase logueada y el proyecto linkeado:

```bash
supabase functions deploy manychat-webhook
supabase functions deploy windsor-sync
supabase functions deploy nominacion-sync
supabase functions deploy panel-data
supabase functions deploy auth-cloudflare --no-verify-jwt   # login con SSO: ver configurar-sso-cloudflare.md
```

## Frontend (Vercel)

1. Crear un proyecto Vercel nuevo apuntando a este repo.
2. Cargar las env vars `SUPABASE_URL` / `SUPABASE_ANON_KEY` (mismo proyecto Supabase que V1) en el dashboard de Vercel.
3. Build Command: `npm run build` — Output Directory: `public` (ya está en [`vercel.json`](../../vercel.json)). Solo se publica la carpeta `public/`: el SQL, las specs y el código de las funciones ya no quedan accesibles desde la web.
4. Deploy.

Sin las 3 credenciales externas (Windsor.ai/ManyChat, ver [variables de entorno](../reference/variables-de-entorno.md)) el panel funciona igual — vacío, no fabrica datos.

## Usar la CLI de Supabase (Windows)

La CLI se instala como binario en `%LOCALAPPDATA%\supabase-cli` (versión 2.118.0, descargada del release oficial de `supabase/cli` y verificada con su checksum). No hace falta Docker si se deploya con `--use-api`.

1. Iniciar sesión (una sola vez, abre el navegador): `supabase login`. En CMD, si la terminal no encuentra el comando, usar la ruta completa: `"%LOCALAPPDATA%\supabase-cli\supabase.exe" login`.
2. Vincular el repo al proyecto (una sola vez, escribe archivos locales en `supabase/.temp/`, que está en `.gitignore`): `supabase link --project-ref zyyxsammrryhfrgfwlxr`.
3. Deployar cada función sin Docker. El webhook lleva `--no-verify-jwt` porque ManyChat no manda un token de Supabase; su seguridad es el secreto por cliente que valida el propio código:

   ```bash
   supabase functions deploy manychat-webhook --use-api --no-verify-jwt
   supabase functions deploy windsor-sync --use-api
   supabase functions deploy nominacion-sync --use-api
   supabase functions deploy meta-en-vivo --use-api --no-verify-jwt   # lleva el secreto WINDSOR_API_KEY (ver meta-en-vivo.md)
   supabase functions deploy panel-data --use-api
   ```

4. Cargar los secretos que corresponda con `supabase secrets set NOMBRE=valor` (ver [variables de entorno](../reference/variables-de-entorno.md)).
