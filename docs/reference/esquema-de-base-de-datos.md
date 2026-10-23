# Referencia: esquema de base de datos

Todo vive en el schema Postgres `crm_comunidades_v2`, en el mismo proyecto de Supabase que V1 y `pulso-ignite`, pero sin ninguna tabla/vista/FK compartida con esos dos. Fuentes: [`db/001_init.sql`](../../db/001_init.sql), [`002`](../../db/002_vistas_panel.sql), [`003`](../../db/003_lectura_abierta_temporal.sql), [`004`](../../db/004_cliente.sql), [`005`](../../db/005_rls_por_cliente.sql), [`006`](../../db/006_rango_fechas_y_clics.sql), [`007`](../../db/007_webhook_intento.sql), [`008`](../../db/008_identificador_instagram.sql) y [`009`](../../db/009_rechazos_guardan_json.sql).

> Estado: `004` (clientes) y `006` (fechas, clics y teléfono) están **aplicadas** desde el 2026-09-30. El login y los roles son `030` y `031` (ver [configurar el login](../how-to/configurar-sso-cloudflare.md)). La vieja `005` (asignación por cliente) se borró sin haberse aplicado.

## Modelo de cliente

Un **cliente** es una cuenta de ManyChat con sus propias comunidades. La persona se identifica por su teléfono (WhatsApp) o por su ID de Instagram (`ig:<id>`), pero la atribución First-Contact, las métricas y las vistas se calculan **dentro de cada cliente**: la misma persona en dos clientes son dos filas independientes. Los hijos de `comunidad` guardan también `cliente_id`, con una FK compuesta `(comunidad_id, cliente_id)` que impide apuntar a una comunidad de otro cliente.

## Tablas

### `cliente` (004)
| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid, PK | |
| `nombre` | text, único | |
| `slug` | text, único | Minúsculas, números y guiones. Va en el header `x-cliente` del webhook |
| `manychat_account_id` | text, único | ID de la cuenta de ManyChat (ej. `fb5616672`) |
| `webhook_secret_hash` | text | sha256 (hex) del secreto. El secreto en claro no se guarda. El panel no puede leer esta columna |
| `activo` | boolean, default true | |
| `created_at` / `updated_at` | timestamptz | |

### `comunidad`
| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid, PK | |
| `cliente_id` | uuid, FK → `cliente.id`, not null | (004) |
| `nombre` | text, not null | Único dentro del cliente |
| `adset_name` | text | Para el mapeo automático de `windsor-sync`. Único dentro del cliente |
| `miembros_iniciales` | int, default 0 | Snapshot manual (Mi del documento) |
| `miembros_finales` | int, default 0 | Snapshot manual (Mf del documento) — se recarga a mano |
| `created_at` / `updated_at` | timestamptz | |

### `evento_crudo`
| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid, PK | |
| `cliente_id` | uuid, not null | (004) Denormalizado a propósito |
| `comunidad_id` | uuid | FK compuesta con `cliente_id` |
| `telefono_id` | text, not null | Identificador de la persona: teléfono (solo dígitos, mínimo 8) o `ig:<id numérico>` si es de Instagram (008) |
| `tipo` | text, default `webhook_manychat` | |
| `payload` | jsonb | El body completo que mandó ManyChat |
| `recibido_en` | timestamptz, default now() | Hora del servidor. No depende del emisor |

Solo INSERT — nunca se edita ni se borra una fila.

### `usuario_curado`
PK `(cliente_id, telefono_id)` desde 004.

| Columna | Tipo | Notas |
|---|---|---|
| `cliente_id` | uuid | |
| `telefono_id` | text | Igual que en `evento_crudo`: teléfono o `ig:<id>` (008) |
| `nombre` | text, nullable | Lo completa el webhook con el nombre de ManyChat si no es solo dígitos; o `nominacion-sync` |
| `email` | text, nullable | ManyChat no lo entrega en WhatsApp |
| `etiquetas` | text[], default `{}` | |
| `estado` | text, default `clic_en_grupo` | Estadio actual. Los siguientes estadios están por definir |
| `created_at` / `updated_at` | timestamptz | |

No guarda comunidad atribuida ni fecha de primer contacto — eso vive en `evento_deduplicado`. Un trigger sobre `evento_crudo` (`asegurar_usuario_curado`) garantiza que exista una fila acá por cada persona vista en cada cliente.

### `usuario_estado_historial` (004)
Una fila por cada cambio de estadio de una persona: `cliente_id`, `telefono_id`, `estado_anterior`, `estado_nuevo`, `origen` (`sistema` / `webhook` / `manual`), `creado_en`. Lo escribe un trigger de `usuario_curado` (función `security definer`).

### `webhook_intento` (007)
Intentos que el webhook de ManyChat **rechazó**, de un cliente identificado. Se muestran en Data_Cruda con el filtro "Rechazados".

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid, PK | |
| `cliente_id` | uuid, FK → `cliente.id` | `on delete cascade` |
| `estado` | int | Código HTTP de la respuesta: 400, 401, 404, 500 o 501 |
| `motivo` | text | Causa en palabras ("Secreto incorrecto", "Comunidad no encontrada…") |
| `comunidad_recibida` | text, nullable | Lo que llegó en `community_id`, si llegó |
| `telefono_id` | text, nullable | Solo si se llegó a leer un teléfono |
| `payload` | jsonb, nullable | (009) **Contenido completo del POST rechazado** (el JSON de ManyChat). Si no era JSON: `{_no_es_json, _texto}`; si pesaba más de 64 KB: `{_truncado, _bytes, _inicio}`. Incluye `_ig_id_exacto` cuando había `ig_id` (el JSON redondea los ids de 17 dígitos). Es `null` en los rechazos anteriores a 009 |
| `creado_en` | timestamptz | Hora del servidor |

Nunca guarda el secreto: viaja en un header, no en el body. Solo lo escribe la función `manychat-webhook`. Con secreto incorrecto la función anota como máximo 200 intentos cada 10 minutos por cliente, para que quien conozca el slug no pueda llenar la tabla. No tiene política de retención todavía.

### `webhook_intento_sin_cliente` (009)
Rechazos donde **no se puede identificar al cliente** (encabezados ausentes, o `x-cliente` que no existe, por ejemplo un slug mal escrito en el flow). Guardan el contenido completo para poder recuperarlo por SQL. **El panel no la lee** (sin políticas ni permisos para `anon` / `authenticated`): se consulta con el SQL Editor.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid, PK | |
| `slug_recibido` | text, nullable | Lo que llegó en `x-cliente` (recortado a 80 caracteres) |
| `estado` | int | Código HTTP (siempre 401 por ahora) |
| `motivo` | text | "Faltan los encabezados…" o "El cliente indicado en x-cliente no existe" |
| `payload` | jsonb, nullable | Igual que en `webhook_intento` |
| `creado_en` | timestamptz | Hora del servidor |

Tope: 300 filas por hora, para que el ruido de internet no llene la base.

### `meta_ads_metrica`
| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid, PK | |
| `cliente_id` | uuid, not null | (004) FK compuesta con `comunidad_id` |
| `comunidad_id` | uuid | |
| `fecha` | date, not null | |
| `inversion` | numeric(12,2) | |
| `conversaciones_meta` | int | |
| `impresiones` | int | |
| `clics` | int, default 0 | (006) Clics del anuncio, de Windsor.ai |
| `ctr_anuncio` | numeric(6,4) | Sin uso: el CTR se calcula al consultar |

Constraint: `(comunidad_id, fecha)` único.

### `comunidad_meta_origen` (010)
Qué campaña / conjunto de anuncios de Meta pertenece a cada comunidad. Lo lee `scripts/windsor-importar.mjs`.
| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid, PK | |
| `cliente_id`, `comunidad_id` | uuid, not null | FK compuesta `(comunidad_id, cliente_id)` |
| `campana_nombre` | text, not null | Nombre de la campaña en Meta |
| `adset_nombre` | text, nullable | Conjunto de anuncios. NULL = toda la campaña va a esa comunidad |
| `creado_en` | timestamptz | |

Único por `(cliente_id, campaña normalizada, conjunto normalizado)`. Función `normalizar_nombre(text)`: recorta, quita tildes, colapsa espacios, minúsculas. `cliente.meta_cuenta_id` guarda el ID de la cuenta publicitaria de Meta del cliente. Lectura abierta temporal (como el resto); `005` la restringe por cliente.

### `trigger_entregado` (011)
Avisos "se entregó el primer mensaje del flow" que manda ManyChat al empezar (`"evento": "trigger"`). No son contactos: no entran a `evento_crudo` ni a la atribución. Una fila por aviso (con duplicados); el panel cuenta personas distintas.
| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid, PK | |
| `cliente_id`, `comunidad_id` | uuid, not null | FK compuesta `(comunidad_id, cliente_id)` |
| `telefono_id` | text, not null | Dígitos o `ig:<id>`, igual que `evento_crudo` |
| `recibido_en` | timestamptz | Hora del servidor |

Lectura abierta temporal; solo el webhook (service_role) escribe. `comunidad_performance_rango` devuelve además `triggers_entregados` (011).

### `clic_me_sumo` (013)
Avisos "la persona tocó el botón Me sumo" que manda ManyChat desde la salida propia del botón (`"evento": "clic_me_sumo"`). No son contactos: no entran a `evento_crudo` ni a la atribución. Una fila por aviso; el panel cuenta personas distintas. Misma forma que `trigger_entregado` (`cliente_id`, `comunidad_id`, `telefono_id`, `recibido_en`). `comunidad_performance_rango` devuelve además `clics_me_sumo` y `costo_por_clic_me_sumo`.

### `usuario_crm` y `usuario_crm_auditoria` (030)
`usuario_crm`: quién entra al CRM (`email` en minúsculas, cuenta @taquion.com.ar), con qué `rol` (`marketing` o `general`), si es `admin` (gestiona usuarios) y si es `fijo` (no se cambia desde el panel). `usuario_crm_auditoria`: cada alta, cambio y baja, con quién la hizo. Las dos se leen y escriben solo con las funciones de 030 (pestaña Usuarios). Detalle en [`specs/2026-10-21-sso-cloudflare-y-roles.md`](../../specs/2026-10-21-sso-cloudflare-y-roles.md).

## Vistas

Todas con `cliente_id`. `evento_deduplicado` y `base_limpia` tienen `security_invoker = true` (datos personales: con la RLS de 031, solo Marketing). `comunidad_performance` y `kpis_macro` leen con los permisos del dueño (desde 031) para que el rol General vea los conteos: devuelven filas solo a usuarios del CRM y la plata (inversión, CPMI, CPME, costos) en NULL si no es Marketing.

- **`evento_deduplicado`**: primer evento por `(cliente_id, telefono_id)` (`distinct on` + `order by recibido_en asc`) — First-Contact Attribution dentro de cada cliente.
- **`base_limpia`**: `evento_deduplicado` + `usuario_curado` + `comunidad`. Nombre/email caen a `'Usuario WA'`/`'Sin email'` si todavía no hay datos.
- **`comunidad_performance`**: una fila por comunidad con las fórmulas de las Secciones 3.A/3.B del documento (CPL, CPCU, CPMN, crecimiento neto, bajas estimadas, tasa de fuga). Todo el histórico.
- **`kpis_macro`**: una fila **por cliente** — el roll-up de Overview.

## Funciones

- **`comunidad_performance_rango(p_cliente, p_desde, p_hasta)`** (006): la misma matriz que `comunidad_performance`, más `clics`, `impresiones` y `ctr_anuncio_pct`, filtrada por fechas. Las métricas de Meta se filtran por `meta_ads_metrica.fecha`; los clics únicos, por la fecha del primer contacto en hora de Buenos Aires. Mi y Mf son snapshots sin fecha y se devuelven tal cual. Fechas nulas = todo el histórico.
- **`mi_acceso()`** (030): email, rol y permiso de administrador del usuario de la sesión. Vacío si no tiene acceso o la sesión tiene más de 24 h o se cerró (se mira `auth.sessions`). La usan las políticas (`es_usuario_crm()`, `es_marketing()`), el panel y `_shared/acceso.mjs`.
- **`usuarios_crm()`, `guardar_usuario_crm()`, `quitar_usuario_crm()`** (030): la pestaña Usuarios. Solo administradores; nadie se cambia a sí mismo y los fijos no se tocan.
- **`datos_comunidad_planilla(p_comunidad)`** (030): para n8n, con el mismo secreto que `registrar_envio_planilla`.

## RLS y permisos

- **Hasta 031 (001 + 003):** SELECT abierto a cualquiera con la anon key; escritura solo para usuarios autenticados. Deja teléfonos, nombres y emails legibles públicamente.
- **Desde 031 (login con SSO):**
  - `anon` no lee nada del esquema; solo conserva las dos funciones de n8n, que exigen su secreto.
  - Cualquier usuario del CRM lee `cliente` y `comunidad`. El resto de lo que usa el panel (datos personales, plata, registros) es solo para Marketing, y solo Marketing edita comunidades.
  - Las funciones del panel que leen plata o datos personales, o que escriben, exigen Marketing (`_exigir_marketing()`).
  - EXECUTE de funciones: nada por defecto, cada una se habilita explícitamente.
  - Las Edge Functions usan `service_role` y no pasan por RLS.
  - Pruebas: `npm run test:db`.

GRANTs explícitos sobre el schema — Supabase no los aplica automático para un schema propio (mismo hallazgo que V1).
