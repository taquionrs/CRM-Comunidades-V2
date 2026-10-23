# Cómo: configurar el login con SSO (Cloudflare) y los usuarios

Al terminar, para entrar al CRM hay que iniciar sesión con una cuenta **@taquion.com.ar** a través de Cloudflare Zero Trust, y cada persona ve lo que corresponde a su rol (**Marketing** o **General**) según lo que le haya asignado un administrador en la pestaña **Usuarios**. Decisiones y qué ve cada rol: [`specs/2026-10-21-sso-cloudflare-y-roles.md`](../../specs/2026-10-21-sso-cloudflare-y-roles.md).

## Cómo funciona

```
Navegador ──► panel (Vercel)
               │ sin sesión
               ▼
             Edge Function auth-cloudflare/login ──► Cloudflare Zero Trust (app "CRM Comunidades")
                                                     política "CRM Comunidades - Acceso": emails @taquion.com.ar
             auth-cloudflare/callback ◄─────────────┘ (OIDC + PKCE)
               1. valida el ID token (firma, emisor, audiencia, vencimiento, nonce)
               2. ¿está en crm_comunidades_v2.usuario_crm?  no ──► vuelve al panel con "sin alta"
               3. crea la sesión de Supabase y vuelve al panel (#access_token=…)
             panel ──► Supabase con el token del usuario ──► RLS por rol (db/031)
```

- **Cloudflare** decide quién puede iniciar sesión: cualquier cuenta `@taquion.com.ar`.
- **La base** decide qué ve cada uno (db/030 y db/031). La clave anon deja de leer el esquema y la pantalla solo oculta lo que de todos modos vendría vacío.
- **La sesión dura 24 h desde el login**. "Salir" la corta en la base al instante, y una baja rige desde el pedido siguiente.

## Orden de despliegue

> Seguir el orden. `031` cierra el acceso anónimo: si se aplica antes de que el panel tenga login o antes de cambiar n8n, el panel se ve vacío y la planilla deja de recibir contactos.

### 1. Cloudflare Zero Trust (equipo `quiet-lab-fdf2`)

> ✅ **Ya está creado** (22/10/2026): política **CRM Comunidades - Acceso** y aplicación SaaS OIDC **CRM Comunidades**, con la configuración de abajo. ID de cliente `956a9d0a21578f9c1d040f7dc48b27e965a30a63115d3907d6ef3af53bafba84`. Emisor `https://quiet-lab-fdf2.cloudflareaccess.com/cdn-cgi/access/sso/oidc/956a9d0a21578f9c1d040f7dc48b27e965a30a63115d3907d6ef3af53bafba84`. Los pasos quedan como referencia por si hay que rehacerlo.

1. **Política reutilizable** (*Controles de Access → Políticas → Agregar una política*):
   - Nombre: `CRM Comunidades - Acceso`
   - Acción: **Permitir**
   - Incluir: **Correos electrónicos que terminan en** → `@taquion.com.ar`
   - Duración de la sesión: 24 hours
2. **Aplicación** (*Controles de Access → Aplicaciones → Crear nueva aplicación → Aplicaciones SaaS → OpenID Connect*):
   - Aplicación: `CRM Comunidades` (es el nombre que se ve en la pantalla de login)
   - Alcances: `openid`, `correo electrónico`, `perfil` (sacar `grupos`)
   - Dirección URL de redirección: `https://zyyxsammrryhfrgfwlxr.supabase.co/functions/v1/auth-cloudflare/callback`
   - **PKCE**: activado. "Permita PKCE sin secreto de cliente" queda desactivado.
   - Políticas: `CRM Comunidades - Acceso`
   - Métodos de inicio de sesión: los disponibles (Google Workspace y One-time PIN)
3. Copiá el **ID de cliente** y el **Emisor**. El **Secreto de cliente** se ve una sola vez: si no lo copiaste al crearla, usá *Restablecer secreto* justo antes del paso 2 y pegalo directo en Supabase.

### 2. Secretos de la función `auth-cloudflare`

Supabase → *Edge Functions → Secrets* (o `supabase secrets set NOMBRE=valor`). Detalle en [variables de entorno](../reference/variables-de-entorno.md#login-con-sso-auth-cloudflare).

| Secreto | Valor |
|---|---|
| `OIDC_ISSUER` | El Emisor del paso 1 |
| `OIDC_CLIENT_ID` | El ID de cliente del paso 1 |
| `OIDC_CLIENT_SECRET` | El Secreto de cliente del paso 1 |
| `SESSION_SECRET` | Clave al azar de 32+ caracteres (ver abajo). Firma la cookie del login en curso |
| `PANEL_URL` | `https://crm-comunidades-v2.vercel.app` |

Para generar `SESSION_SECRET` en Windows (PowerShell): `$b = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)`. En Mac o Linux: `openssl rand -base64 48`.

### 3. Base: `030` (solo agrega, no rompe nada)

Con el procedimiento de siempre: primero el ensayo con rollback (ver [abajo](#ensayo-con-rollback-de-030-y-031)) y después la aplicación en una transacción: `supabase db query --linked -f db/030_usuarios_y_sso.sql`.

Crea el registro de usuarios con los tres administradores fijos (`felipe.pampin@`, `nicolas.piantanida@` y `marketing@taquion.com.ar`), las funciones de acceso y `datos_comunidad_planilla` para n8n. El panel actual sigue funcionando igual. La migración empieza comprobando que se puede leer `auth.sessions`: si falla ahí, aplicarla como `postgres`.

### 4. Edge Functions

```bash
supabase functions deploy auth-cloudflare --use-api --no-verify-jwt
```

`auth-cloudflare` va sin verificar JWT porque la abre el navegador antes de tener sesión. `meta-en-vivo`, `nominacion-sync`, `windsor-sync` y `panel-data` se redeployan en el paso 6, junto con el cierre, porque ahora exigen un usuario Marketing.

### 5. n8n (antes de cerrar)

En el flujo "Contactos WhatsApp → Sheet", el nodo **Buscar comunidad y cliente (Supabase)** pasa a llamar a `datos_comunidad_planilla` con la misma credencial con secreto que los nodos "Avisar al CRM". Hay dos formas:
- reimportar [`docs/n8n/contactos-wsp-a-sheet.workflow.json`](../n8n/contactos-wsp-a-sheet.workflow.json);
- cambiar el nodo a mano, como explica [configurar n8n](configurar-n8n-contactos-wsp.md#cambio-por-el-login-del-crm-2026-10).

Probalo con un contacto de prueba antes de seguir: la fila tiene que caer en la pestaña correcta, no en `SIN-HOJA`.

### 6. Panel con login + cierre (`031`), todo junto

1. Fusionar la PR del login en `master`: Vercel deploya el panel nuevo. Con `030` aplicada ya se puede entrar con la cuenta de Taquion.
2. Ensayo con rollback de `031` (ver [abajo](#ensayo-con-rollback-de-030-y-031)) y después `supabase db query --linked -f db/031_cerrar_acceso_por_rol.sql`.
3. Redeployar las funciones con control de rol:

   ```bash
   supabase functions deploy meta-en-vivo --use-api --no-verify-jwt
   supabase functions deploy nominacion-sync --use-api
   supabase functions deploy windsor-sync --use-api
   ```

   `panel-data` sigue sin deployar, igual que antes.

### 7. Verificar

1. **Admin fijo:** entrar con un administrador fijo. Tiene que ver las 6 pestañas, más **Usuarios**.
2. **Rol General:** en Usuarios, dar de alta a alguien como **General** y que entre. Tiene que ver Overview, Control_Comunidades y Atribución, sin inversión ni costos y sin Base_Limpia, Data_Deduplicada ni Data_Cruda.
3. **Sin alta:** una cuenta `@taquion.com.ar` sin alta ve "todavía no está dada de alta".
4. **Clave anon:** sin login, el esquema queda cerrado. Este pedido tiene que responder 401 o `permission denied`:
   `curl "https://zyyxsammrryhfrgfwlxr.supabase.co/rest/v1/evento_crudo?select=*" -H "apikey: <anon>" -H "Accept-Profile: crm_comunidades_v2"`.
5. **n8n:** un contacto nuevo sigue llegando a la planilla, y en Data_Cruda aparece como "registrado".

## Ensayo con rollback de 030 y 031

Se arma un archivo con la migración entre `begin` y `rollback`, más unas consultas de verificación, y se corre contra el proyecto: aplica todo, muestra el resultado y lo deshace. Desde la raíz del repo, en Git Bash (en PowerShell, el mismo contenido armado con `Get-Content`):

```bash
( echo "begin;"; cat db/030_usuarios_y_sso.sql
  echo "select (select count(*) from crm_comunidades_v2.usuario_crm where fijo)::int as admins_fijos,
    (select count(*) from pg_proc where pronamespace = 'crm_comunidades_v2'::regnamespace and proname in ('mi_acceso','es_usuario_crm','es_marketing','es_admin_crm','usuarios_crm','guardar_usuario_crm','quitar_usuario_crm','datos_comunidad_planilla'))::int as funciones_nuevas,
    has_table_privilege('anon', 'crm_comunidades_v2.evento_crudo', 'select') as anon_lee_evento_crudo;"
  echo "rollback;" ) > ensayo_030.sql
supabase db query --linked -f ensayo_030.sql
```

Esperado: `admins_fijos = 3`, `funciones_nuevas = 8` y `anon_lee_evento_crudo = true` (030 no cierra nada).

Para `031` (con `030` ya aplicada), lo mismo con `db/031_cerrar_acceso_por_rol.sql` y esta verificación:

```sql
select has_table_privilege('anon', 'crm_comunidades_v2.evento_crudo', 'select') as anon_lee_evento_crudo,
  (select count(*) from pg_policies where schemaname = 'crm_comunidades_v2' and policyname = 'lectura_abierta')::int as lecturas_abiertas,
  (select count(*) from pg_policies where schemaname = 'crm_comunidades_v2')::int as politicas,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'crm_comunidades_v2' and c.relkind = 'r' and not c.relrowsecurity)::int as tablas_sin_rls;
```

Esperado: `anon_lee_evento_crudo = false`, `lecturas_abiertas = 0`, `politicas = 22` y `tablas_sin_rls = 0`.

Los valores esperados salen de correr lo mismo sobre el Postgres local de `npm run test:db`. Borrar el archivo `ensayo_*.sql` después: no se sube al repo.

## Usuarios: altas, bajas y administradores

Todo se hace en la pestaña **Usuarios**, que solo ven los administradores:

- **Alta:** email `@taquion.com.ar`, rol (Marketing o General) y, si corresponde, Administrador. No hace falta tocar Cloudflare.
- **Cambios y bajas:** se aplican en el siguiente pedido, sin que la persona tenga que volver a entrar.
- **Administradores fijos** (`fijo = true` en `usuario_crm`): no se pueden cambiar desde la pantalla, así nunca se pierde el acceso de administración. Para cambiarlos hay que usar SQL.
- **Nadie puede cambiar ni quitar su propio acceso.**
- **Auditoría:** cada alta, cambio y baja queda en `usuario_crm_auditoria`, y se ve al pie de la pestaña.

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| "El login todavía no está configurado" | Faltan secretos de `auth-cloudflare` (paso 2) |
| "Cloudflare no autorizó el ingreso" | La cuenta no pasa la política, o la app no tiene la política asignada |
| "El intento de ingreso venció" | Pasaron más de 10 minutos entre el login y la vuelta, o el navegador bloqueó la cookie |
| "Tu sesión venció o tu usuario no tiene acceso" | Pasaron 24 h desde el login, o la persona fue dada de baja |
| El panel entra pero no muestra nada | Se aplicó `031` sin `030`, o la persona no está en `usuario_crm` |
| La planilla deja de recibir contactos | Se aplicó `031` antes de cambiar el nodo de n8n (paso 5) |

## Probar en local

- `npm test`: el flujo de login (Cloudflare simulado, tokens firmados de verdad) y lo que muestra el panel por rol.
- `npm run test:db`: todas las migraciones sobre un Postgres local (PGlite). Prueba la RLS con cada rol: anon, sin alta, General, Marketing, administrador, sesión vencida o cerrada, clave de servicio y n8n. Necesita `npm install`.
