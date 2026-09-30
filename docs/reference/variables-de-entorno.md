# Referencia: variables de entorno

## Frontend (Vercel, build time)

| Variable | Para qué |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase compartido con V1 |
| `SUPABASE_ANON_KEY` | Anon key del mismo proyecto — `scripts/generate-config.js` las vuelca en `config.js` en build time |

## Edge Functions (Supabase secrets)

| Variable | Función que la usa | Sin ella |
|---|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Todas | Las inyecta el runtime de Edge Functions automáticamente, no hace falta configurarlas a mano |
| ~~`MANYCHAT_WEBHOOK_SECRET`~~ | — | Reemplazado por un secreto por cliente: se guarda su hash en `cliente.webhook_secret_hash` (ver [agregar un cliente](../how-to/agregar-un-cliente.md)). Si falta, `manychat-webhook` responde 501 |
| `WINDSOR_API_KEY` | `windsor-sync` | 501 explícito |
| `WINDSOR_CONVERSATIONS_FIELD` | `windsor-sync` | Opcional. Nombre del campo de Windsor.ai para "conversaciones iniciadas". Default: `messaging_conversation_started_7d` (sin confirmar) |
| `MANYCHAT_API_KEY` | `nominacion-sync` | 501 explícito |

Cargar con `supabase secrets set NOMBRE=valor` (CLI logueada y proyecto linkeado).
