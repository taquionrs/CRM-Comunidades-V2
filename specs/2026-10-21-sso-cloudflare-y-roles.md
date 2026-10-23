# SSO con Cloudflare y roles del CRM (2026-10-21)

> **Estado: implementado en la rama `sso-cloudflare` y validado por Juan (22/10/2026).** Las decisiones de este documento las tomó Feli (Tecnología) el 21/10/2026; las respuestas de Juan están en [Validación](#validación-de-juan-22102026). Falta el despliegue, en el orden de [configurar el login](../docs/how-to/configurar-sso-cloudflare.md#orden-de-despliegue).

## Contexto

Hasta ahora el CRM no tiene login: el panel le habla directo a Supabase con la clave anon, que es pública (va en `config.js`), y la lectura abierta de `db/003` deja leer teléfonos, nombres y gasto a cualquiera que tenga esa clave (hallazgo 3.1 de [`2026-09-29-estado-hacia-spec-final.md`](2026-09-29-estado-hacia-spec-final.md)).

Pedido: SSO con Cloudflare igual que Pulso, acceso para cuentas `@taquion.com.ar` (Marketing + Admin), un rol general sin la información sensible o financiera, y políticas alineadas con las de Taquion. Listo = SSO en producción con usuarios.

## Decisiones

| # | Decisión | Por qué | Alternativa descartada |
|---|---|---|---|
| 1 | **Login con Cloudflare Zero Trust**: aplicación *Access for SaaS* (OIDC + PKCE) **"CRM Comunidades"** con la política **"CRM Comunidades - Acceso"** (emails que terminan en `@taquion.com.ar`, sesión de 24 h, Google Workspace o código por email). | Mismo esquema que Pulso y el Tablero de Seguimiento Táctico. El DNS de `taquion.com.ar` está en Netlify, así que Cloudflare no puede ponerse delante del sitio. | Access "autoalojado" (necesita el DNS en Cloudflare). |
| 2 | **El puente entre Cloudflare y Supabase es una Edge Function** (`auth-cloudflare`). Valida el login (firma, emisor, audiencia, vencimiento y nonce) y crea la sesión de Supabase del usuario. | La clave de servicio de Supabase no sale de Supabase y no hay que cargar nada nuevo en Vercel. Se deploya con la CLI, igual que las demás funciones. | Una función en Vercel, que obligaría a guardar la clave de servicio (acceso total a la base) en Vercel. |
| 3 | **Quien decide es la base (RLS), no la pantalla.** La clave anon deja de leer el esquema `crm_comunidades_v2`. | Si solo se ocultan pestañas, los datos se siguen pudiendo leer con un request REST y la clave pública. | — |
| 4 | **La sesión vale 24 h desde el login** y después hay que volver a pasar por Cloudflare. Cerrar sesión la corta en la base al instante. | Misma duración que la política de Cloudflare. Una baja de un usuario rige desde el pedido siguiente. | Dejar que Supabase renueve la sesión indefinidamente. |
| 5 | **Dos roles + administrador** (detalle en [Qué ve cada rol](#qué-ve-cada-rol)): **Marketing** ve y edita todo; **General** ve conteos, sin plata ni datos personales, y solo lee. **Administrador** se suma a cualquiera de los dos y gestiona usuarios desde la pestaña **Usuarios**. | Es lo que pide la tarea: Marketing + Admin, y un rol general sin la información sensible o financiera. | — |
| 6 | **Administradores fijos**: `felipe.pampin@taquion.com.ar`, `nicolas.piantanida@taquion.com.ar` y `marketing@taquion.com.ar`, todos con rol Marketing. No se pueden quitar ni cambiar desde la pantalla. | Así nunca se pierde el acceso de administración. | — |
| 7 | **Nadie puede cambiar ni quitar su propio acceso**, y cada alta, cambio o baja queda en una auditoría (quién, cuándo, qué). | Igual que Pulso. | — |
| 8 | **Todos los usuarios ven todos los clientes.** La asignación por cliente de la vieja `db/005` no se usa, y esa migración se borró sin haberse aplicado. | Son usuarios internos de Taquion: es más simple de administrar. Se puede agregar la asignación por cliente más adelante. | Asignar clientes a cada usuario (vieja `db/005`). |
| 9 | **A quien pasa Cloudflare pero no está dado de alta no se le crea usuario en Supabase**, y ve "sin acceso". | El proyecto Supabase es el mismo que el del CRM V1: no se crean usuarios de más. | — |
| 10 | **n8n deja de usar la clave anon para leer `comunidad`**: el nombre de la comunidad para la planilla sale de una función nueva protegida con el mismo secreto que `registrar_envio_planilla`. | Al cerrar la lectura anónima, el nodo actual de n8n dejaría de funcionar. | Dejar la tabla `comunidad` legible con la clave pública. |
| 11 | **Las Edge Functions que llama el panel exigen un usuario Marketing**: `meta-en-vivo` y `nominacion-sync`. `windsor-sync` y `panel-data` aceptan además la clave de servicio. | Hoy cualquiera con la clave anon puede dispararlas. | — |
| 12 | **La "clave de carga" de Cargar miembros se mantiene**, además de exigir el rol Marketing. | Cambia lo mínimo en la pantalla. Se puede sacar en otra PR ahora que hay usuarios. | Sacarla en este mismo cambio. |
| 13 | **Dos migraciones**: `030` solo agrega (usuarios, roles, funciones), no rompe nada y se aplica primero. `031` cierra el acceso anónimo y se aplica junto con el deploy del panel con login. | Permite desplegar sin cortar el panel ni los envíos a la planilla. | Una sola migración que cierre todo de golpe. |

## Qué ve cada rol

| | Marketing | General |
|---|:-:|:-:|
| **Overview**: miembros, entradas al flow, bajas, tasa de fuga | ✅ | ✅ |
| **Overview**: inversión total, CPMI global, CPME global | ✅ | — |
| **Control_Comunidades**: conteos de ManyChat, CRM, WhatsApp y Meta (conversaciones, impresiones, clics, CTR, clientes potenciales) | ✅ | ✅ |
| **Control_Comunidades**: inversión, CPMI, costo por cliente potencial, costo por entrada, costo por clic, costo por miembro neto, desglose de campañas | ✅ | — |
| **Atribución** (en construcción) | ✅ | ✅ |
| **Base_Limpia, Data_Deduplicada, Data_Cruda** (teléfonos y nombres) y exportar CSV | ✅ | — |
| Editar comunidades y Mi/Mf, Cargar miembros, Campañas, Consultas de Windsor, Traer de Meta ahora, nominación | ✅ | — |
| **Usuarios** (gestión de accesos) | solo si es administrador | solo si es administrador |

Para el rol General la plata no se oculta solo en la pantalla: la base la devuelve vacía, y las tablas con datos personales o con plata no le devuelven filas.

## Cómo quedó implementado

| Pieza | Qué hace |
|---|---|
| [`db/030_usuarios_y_sso.sql`](../db/030_usuarios_y_sso.sql) | Registro de usuarios y auditoría, administradores fijos, `mi_acceso()` (sesión de menos de 24 h y no cerrada, mirando `auth.sessions`), funciones de la pestaña Usuarios y `datos_comunidad_planilla()` para n8n. **Solo agrega.** |
| [`db/031_cerrar_acceso_por_rol.sql`](../db/031_cerrar_acceso_por_rol.sql) | Cierra la clave anon, RLS por rol en todas las tablas, `comunidad_performance` / `kpis_macro` / `comunidad_performance_rango` con conteos para todos y plata solo para Marketing, control "solo Marketing" al principio de las 8 funciones del panel que leen plata o datos personales o que escriben, y EXECUTE explícito por función. |
| [`supabase/functions/auth-cloudflare/`](../supabase/functions/auth-cloudflare/) | El login: OIDC + PKCE con Cloudflare, validación del ID token y sesión de Supabase (sin mandar mails). Los errores vuelven al panel como `#sso_error=…`, porque Supabase no deja mostrar HTML desde `*.supabase.co`. |
| [`supabase/functions/_shared/acceso.mjs`](../supabase/functions/_shared/acceso.mjs) | Control de las Edge Functions: `meta-en-vivo` y `nominacion-sync` exigen Marketing; `windsor-sync` y `panel-data`, Marketing o la clave de servicio. |
| [`public/index.html`](../public/index.html) | Login automático y pantalla de "sin acceso"; cuenta, rol y "Salir" en el menú; pestañas, columnas de plata, KPIs y botones según el rol (bloque `ROLES`); pestaña **Usuarios**. |
| [`docs/n8n/contactos-wsp-a-sheet.workflow.json`](../docs/n8n/contactos-wsp-a-sheet.workflow.json) | El nodo "Buscar comunidad y cliente" usa `datos_comunidad_planilla` con el secreto. |

El orden de despliegue está en [configurar el login](../docs/how-to/configurar-sso-cloudflare.md#orden-de-despliegue).

## Cómo se probó

- `npm run test:db`: **todas** las migraciones del repo sobre un Postgres local (PGlite) con los roles de Supabase. Prueba lo que ve y lo que no puede hacer cada caso (anon, logueado sin alta, General, Marketing, administrador, sesión vencida o cerrada o de otra persona, clave de servicio, n8n con y sin secreto) y el estado intermedio con solo `030` aplicada (el panel actual sigue igual).
- `npm test`: el login completo con Cloudflare y Supabase simulados (tokens RS256 firmados de verdad, PKCE, state, nonce, audiencia, vencimiento, otro dominio, sin alta), el control de acceso de las Edge Functions y lo que muestra el panel por rol, más las pruebas que ya existían.
- **En el navegador**, con el panel real contra un Supabase local con estas migraciones:
  - login, alta y cambio de rol desde Usuarios, y "Salir";
  - la vista de General en Overview y en Control_Comunidades;
  - pedidos directos a la API con el token de General: devuelven 0 filas o 403.
- **Una lección que quedó en `031`:** una vista con `security_invoker` usada adentro de otra con permisos del dueño sigue leyendo con los permisos de quien consulta. Por eso `comunidad_performance` calcula el primer contacto adentro, en lugar de usar `evento_deduplicado`.
- **Lo que no se pudo probar:** el Cloudflare y el Supabase reales (hacen falta los secretos y el despliegue).

## Validación de Juan (22/10/2026)

- [x] **Rol General**: está bien. Ve conversaciones, impresiones, CTR y clientes potenciales, sin inversión, costos ni datos personales, y solo lee.
- [x] **Administradores fijos**: `marketing@taquion.com.ar` es la cuenta correcta, junto con Felipe y Nicolás P.
- [x] **Clientes**: que todos vean todos sirve por ahora. **A futuro**, si hace falta asignar clientes por persona (por ejemplo, Todo un País), tiene que poder hacerlo un administrador con rol Marketing desde la pestaña **Usuarios**, como en Pulso, sin SQL.
- [x] **Clave de carga**: se mantiene por ahora. Se saca en una PR aparte cuando el SSO esté estable.
- [x] **`db/005`**: borrada del repo.
- [x] **Orden de despliegue**: secretos, `030`, `auth-cloudflare`, cambio del nodo de n8n y recién después fusionar, aplicar `031` y redeployar `meta-en-vivo`, `nominacion-sync` y `windsor-sync`. Juan carga los secretos directo en Supabase. `030` y `031` se aplican con el procedimiento de siempre: primero un ensayo con rollback (ver la guía).
- [x] **Consulta de Juan: ¿las tablas que `031` no nombra quedan cerradas?** Sí. Son `miembro_grupo`, `miembro_comunidad`, `carga_miembros`, `webhook_intento_sin_cliente`, `config_n8n` (en el listado figuraba cortado como `config_n`), `config_carga_miembros`, `windsor_entrega_log`, `windsor_sync_log`, `usuario_crm` y `usuario_crm_auditoria`.
  - `031` activa RLS en **todas** las tablas del esquema y no les crea política, así que solo se llega a ellas con funciones `security definer` o con la clave de servicio.
  - La clave anon no tiene ningún permiso; para un usuario con sesión, devuelven 0 filas o `permission denied` (`config_*`, `usuario_crm*`).
  - Lo verifica `npm run test:db` con una prueba que arma la lista desde la base (no fija). Cualquier tabla nueva sin política queda cubierta.
