# Referencia: variables de entorno

## Frontend (Vercel, build time)

| Variable | Para qué |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase compartido con V1 |
| `SUPABASE_ANON_KEY` | Anon key del mismo proyecto — `scripts/generate-config.js` las vuelca en `config.js` en build time |

## Edge Functions (Supabase secrets)

| Variable | Función que la usa | Sin ella |
|---|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Todas | Las inyecta el runtime de Edge Functions automáticamente, no hace falta configurarlas a mano |
| ~~`MANYCHAT_WEBHOOK_SECRET`~~ | — | Reemplazado por un secreto por cliente: se guarda su hash en `cliente.webhook_secret_hash` (ver [agregar un cliente](../how-to/agregar-un-cliente.md)). Si falta, `manychat-webhook` responde 501 |
| `WINDSOR_API_KEY` | `windsor-sync` | 501 explícito |
| `WINDSOR_CONVERSATIONS_FIELD` | `windsor-sync` | Opcional. Nombre del campo de Windsor.ai para "conversaciones iniciadas". Default: `messaging_conversation_started_7d` (sin confirmar) |
| `MANYCHAT_API_KEY` | `nominacion-sync` | 501 explícito |

Cargar con `supabase secrets set NOMBRE=valor` (CLI logueada y proyecto linkeado).

## Login con SSO (`auth-cloudflare`)

Paso a paso en [configurar el login con SSO](../how-to/configurar-sso-cloudflare.md). Sin estos secretos, la función vuelve al panel con "el login todavía no está configurado" y no abre nada.

| Secreto | Qué es |
|---|---|
| `OIDC_ISSUER` | Emisor de la aplicación SaaS "CRM Comunidades" de Cloudflare Zero Trust: `https://quiet-lab-fdf2.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client-id>` |
| `OIDC_CLIENT_ID` | ID de cliente de esa aplicación |
| `OIDC_CLIENT_SECRET` | Secreto de cliente. **Es una credencial**: solo como secreto de Supabase |
| `SESSION_SECRET` | Clave al azar de 32+ caracteres. Firma la cookie del login en curso (10 minutos). **Es una credencial** |
| `PANEL_URL` | URL del panel: `https://crm-comunidades-v2.vercel.app` |
| `ALLOWED_EMAIL_DOMAINS` | Opcional. Dominios que pueden entrar, separados por coma. Por omisión `taquion.com.ar` |

Quién entra y con qué rol no es una variable: está en la tabla `crm_comunidades_v2.usuario_crm` y se administra en la pestaña **Usuarios** del panel.
