-- ============================================================================
-- CRM de Comunidades V2 — los rechazos guardan el JSON completo (PR #7)
--
-- Hasta ahora webhook_intento (db/007) guardaba solo el motivo, la comunidad y el
-- identificador. Cuando un flow se configuró mal (por ejemplo, con el cliente o el
-- secreto de otro cliente) las personas que entraron mientras tanto se rechazaban
-- y sus datos (nombre, usuario, mensaje) no se podían recuperar.
--
-- Desde ahora cada rechazo guarda el contenido completo del POST:
--   * webhook_intento.payload          — rechazos de un cliente identificado.
--   * webhook_intento_sin_cliente      — rechazos donde no se puede identificar al
--     cliente (headers ausentes o x-cliente inexistente). El panel NO la lee: se
--     consulta por SQL con service_role.
--
-- Nunca se guarda el secreto (viaja en un header). El payload tiene tope de 64 KB
-- (por encima se guarda el comienzo con una marca) y la función limita cuántos
-- rechazos anota por cliente y por hora. Aplicar después de 008. Idempotente.
-- ============================================================================
alter table crm_comunidades_v2.webhook_intento add column if not exists payload jsonb;
comment on column crm_comunidades_v2.webhook_intento.payload is
  'Contenido completo del POST rechazado (JSON de ManyChat). Si no era JSON o superaba 64 KB: {_no_es_json|_truncado, ...}. Incluye _ig_id_exacto si había ig_id.';

create table if not exists crm_comunidades_v2.webhook_intento_sin_cliente (
  id            uuid primary key default gen_random_uuid(),
  slug_recibido text,
  estado        int  not null check (estado between 400 and 599),
  motivo        text not null,
  payload       jsonb,
  creado_en     timestamptz not null default now()
);

create index if not exists idx_webhook_intento_sin_cliente_fecha
  on crm_comunidades_v2.webhook_intento_sin_cliente (creado_en desc);

-- Sin políticas y sin permisos para el panel: solo service_role (la función y el SQL Editor).
alter table crm_comunidades_v2.webhook_intento_sin_cliente enable row level security;
revoke all on crm_comunidades_v2.webhook_intento_sin_cliente from anon, authenticated;
grant select, insert, delete on crm_comunidades_v2.webhook_intento_sin_cliente to service_role;

comment on table crm_comunidades_v2.webhook_intento_sin_cliente is
  'Rechazos del webhook sin cliente identificable (headers ausentes o x-cliente inexistente), con el contenido completo. No la lee el panel.';
