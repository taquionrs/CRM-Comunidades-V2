# Referencia: esquema de base de datos

Todo vive en el schema Postgres `crm_comunidades_v2`, en el mismo proyecto de Supabase que V1 y `pulso-ignite`, pero sin ninguna tabla/vista/FK compartida con esos dos. Fuente completa: [`db/001_init.sql`](../../db/001_init.sql), [`db/002_vistas_panel.sql`](../../db/002_vistas_panel.sql).

## Tablas

### `comunidad`
| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid, PK | |
| `nombre` | text, not null | |
| `adset_name` | text | Para el mapeo automático de `windsor-sync` |
| `miembros_iniciales` | int, default 0 | Snapshot manual (Mi del documento) |
| `miembros_finales` | int, default 0 | Snapshot manual (Mf del documento) — se recarga a mano |
| `created_at` / `updated_at` | timestamptz | |

### `evento_crudo`
| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid, PK | |
| `comunidad_id` | uuid, FK → `comunidad.id` | |
| `telefono_id` | text, not null | |
| `tipo` | text, default `webhook_manychat` | |
| `payload` | jsonb | El body completo que mandó ManyChat |
| `recibido_en` | timestamptz, default now() | |

Solo INSERT — nunca se edita ni se borra una fila.

### `usuario_curado`
| Columna | Tipo | Notas |
|---|---|---|
| `telefono_id` | text, PK | |
| `nombre` | text, nullable | Null hasta que `nominacion-sync` lo complete |
| `email` | text, nullable | |
| `etiquetas` | text[], default `{}` | |
| `estado` | text, default `clic_en_grupo` | |
| `created_at` / `updated_at` | timestamptz | |

No guarda comunidad atribuida ni fecha de primer contacto — eso vive en `evento_deduplicado`. Un trigger sobre `evento_crudo` (`asegurar_usuario_curado`) garantiza que exista una fila acá por cada teléfono visto.

### `meta_ads_metrica`
| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid, PK | |
| `comunidad_id` | uuid, FK → `comunidad.id` | |
| `fecha` | date, not null | |
| `inversion` | numeric(12,2) | |
| `conversaciones_meta` | int | |
| `impresiones` | int | |
| `ctr_anuncio` | numeric(6,4), nullable | No poblado por `windsor-sync` en esta versión (ver docs/explanation/arquitectura.md) |

Constraint: `(comunidad_id, fecha)` único.

## Vistas

### `evento_deduplicado`
Primer evento por `telefono_id` (`distinct on` + `order by recibido_en asc`) — la implementación de First-Contact Attribution. `security_invoker = true`.

### `base_limpia`
Join de `evento_deduplicado` (atribución) + `usuario_curado` (enriquecimiento) + `comunidad` (nombre). Nombre/email caen a `'Usuario WA'`/`'Sin email'` si todavía no se sincronizaron — son los defaults literales que describe la Sección 3, TAB 3 del documento. `security_invoker = true`.

### `comunidad_performance`
Una fila por comunidad, con las fórmulas de las Secciones 3.A/3.B del documento (CPL, CPCU, CPMN, crecimiento neto, bajas estimadas, tasa de fuga). `security_invoker = true`.

### `kpis_macro`
Una sola fila — el roll-up global de Overview. `security_invoker = true`.

## RLS y permisos

Las 4 tablas tienen RLS habilitado con una sola policy, `usuario_autenticado` (`using (auth.role() = 'authenticated')`) — sin distinción de roles, a diferencia de V1. Cualquier usuario de `auth.users` con sesión válida (incluido el admin de V1) tiene acceso completo.

GRANTs explícitos sobre el schema — Supabase no los aplica automático para un schema propio (mismo hallazgo que V1).
