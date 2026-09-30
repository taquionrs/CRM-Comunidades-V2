# Referencia: esquema de base de datos

Todo vive en el schema Postgres `crm_comunidades_v2`, en el mismo proyecto de Supabase que V1 y `pulso-ignite`, pero sin ninguna tabla/vista/FK compartida con esos dos. Fuentes: [`db/001_init.sql`](../../db/001_init.sql), [`002`](../../db/002_vistas_panel.sql), [`003`](../../db/003_lectura_abierta_temporal.sql), [`004`](../../db/004_cliente.sql), [`005`](../../db/005_rls_por_cliente.sql) y [`006`](../../db/006_rango_fechas_y_clics.sql).

> Estado: `004` (clientes) y `006` (fechas, clics y teléfono) están **aplicadas** desde el 2026-09-30. `005` (acceso por usuario) está escrita y **sin aplicar**; se aplica al final, junto con el login.

## Modelo de cliente

Un **cliente** es una cuenta de ManyChat con sus propias comunidades. El teléfono identifica a la persona, pero la atribución First-Contact, las métricas y las vistas se calculan **dentro de cada cliente**: la misma persona en dos clientes son dos filas independientes. Los hijos de `comunidad` guardan también `cliente_id`, con una FK compuesta `(comunidad_id, cliente_id)` que impide apuntar a una comunidad de otro cliente.

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
| `telefono_id` | text, not null | Solo dígitos, mínimo 8 (006) |
| `tipo` | text, default `webhook_manychat` | |
| `payload` | jsonb | El body completo que mandó ManyChat |
| `recibido_en` | timestamptz, default now() | Hora del servidor. No depende del emisor |

Solo INSERT — nunca se edita ni se borra una fila.

### `usuario_curado`
PK `(cliente_id, telefono_id)` desde 004.

| Columna | Tipo | Notas |
|---|---|---|
| `cliente_id` | uuid | |
| `telefono_id` | text | Solo dígitos, mínimo 8 (006) |
| `nombre` | text, nullable | Lo completa el webhook con el nombre de ManyChat si no es solo dígitos; o `nominacion-sync` |
| `email` | text, nullable | ManyChat no lo entrega en WhatsApp |
| `etiquetas` | text[], default `{}` | |
| `estado` | text, default `clic_en_grupo` | Estadio actual. Los siguientes estadios están por definir |
| `created_at` / `updated_at` | timestamptz | |

No guarda comunidad atribuida ni fecha de primer contacto — eso vive en `evento_deduplicado`. Un trigger sobre `evento_crudo` (`asegurar_usuario_curado`) garantiza que exista una fila acá por cada persona vista en cada cliente.

### `usuario_estado_historial` (004)
Una fila por cada cambio de estadio de una persona: `cliente_id`, `telefono_id`, `estado_anterior`, `estado_nuevo`, `origen` (`sistema` / `webhook` / `manual`), `creado_en`. Lo escribe un trigger de `usuario_curado` (función `security definer`).

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

### `usuario_cliente` (005)
`(user_id, cliente_id)`: qué usuario ve qué cliente. Alimenta el selector de cliente cuando haya login.

## Vistas

Todas con `security_invoker = true`, todas con `cliente_id`.

- **`evento_deduplicado`**: primer evento por `(cliente_id, telefono_id)` (`distinct on` + `order by recibido_en asc`) — First-Contact Attribution dentro de cada cliente.
- **`base_limpia`**: `evento_deduplicado` + `usuario_curado` + `comunidad`. Nombre/email caen a `'Usuario WA'`/`'Sin email'` si todavía no hay datos.
- **`comunidad_performance`**: una fila por comunidad con las fórmulas de las Secciones 3.A/3.B del documento (CPL, CPCU, CPMN, crecimiento neto, bajas estimadas, tasa de fuga). Todo el histórico.
- **`kpis_macro`**: una fila **por cliente** — el roll-up de Overview.

## Funciones

- **`comunidad_performance_rango(p_cliente, p_desde, p_hasta)`** (006): la misma matriz que `comunidad_performance`, más `clics`, `impresiones` y `ctr_anuncio_pct`, filtrada por fechas. Las métricas de Meta se filtran por `meta_ads_metrica.fecha`; los clics únicos, por la fecha del primer contacto en hora de Buenos Aires. Mi y Mf son snapshots sin fecha y se devuelven tal cual. Fechas nulas = todo el histórico.
- **`mis_clientes()`** (005): los clientes habilitados para el usuario de la sesión.

## RLS y permisos

- **Hoy (001 + 003):** SELECT abierto a cualquiera con la anon key; escritura solo para usuarios autenticados. Es temporal: deja teléfonos, nombres y emails legibles públicamente.
- **Con 005:** sin acceso para `anon`; cada usuario ve solo los clientes de `usuario_cliente`. `evento_crudo` y `usuario_estado_historial` quedan de solo lectura desde el panel. Las Edge Functions usan `service_role` y no pasan por RLS.

GRANTs explícitos sobre el schema — Supabase no los aplica automático para un schema propio (mismo hallazgo que V1).
