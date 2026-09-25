-- ============================================================================
-- CRM de Comunidades V2 — esquema inicial
-- Ref: specs/2026-09-25-v2-desde-cero.md, documento de Jaz
-- ("DOCUMENTO COMPLETO DE ESPECIFICACIONES TÉCNICAS Y DISEÑO", 2026-09-24).
--
-- Vive en el MISMO proyecto de Supabase que crm-comunidades V1 y pulso-ignite
-- (decisión confirmada 2026-09-25), pero en su propio schema —
-- `crm_comunidades_v2` — hermano de `crm_comunidades` (V1) y de `public`
-- (pulso-ignite). Cero tablas/vistas/RLS/GRANTs compartidos con V1; lo único
-- que de hecho comparten es la instancia de Postgres y `auth.users` (Supabase
-- Auth es global al proyecto, no por schema) — el mismo usuario admin de V1
-- (marketing@taquion.com.ar) puede loguearse acá también, sin invitación
-- nueva.
--
-- A propósito NO tiene: roles (admin_taquion/am_estratega/cliente),
-- estado_identificacion, arquetipos, activaciones, tratos, temporada — nada
-- de eso está en el documento de Jaz. Un solo tipo de usuario autenticado,
-- acceso completo (ver sección RLS al final).
--
-- Cómo aplicar: pegar en el SQL Editor de Supabase del proyecto compartido.
-- Idempotente (create if not exists) para poder re-correrlo sin romper nada.
-- ============================================================================

create schema if not exists crm_comunidades_v2;
set search_path = crm_comunidades_v2, public;

create extension if not exists pgcrypto; -- gen_random_uuid(), ya la creó V1 pero es idempotente

-- ----------------------------------------------------------------------------
-- TABLA: comunidad
-- Mínima a propósito: solo lo que pide el documento de Jaz para el mapeo de
-- Windsor.ai (adset_name) y las fórmulas de miembros (Mi/Mf, Sección 3.A-B).
-- miembros_iniciales/miembros_finales son snapshots cargados a mano (el
-- documento no describe un mecanismo automático para ninguno de los dos) —
-- clics_unicos y bajas_estimadas se CALCULAN, nunca se cargan (ver vista
-- comunidad_performance en 002_vistas_panel.sql).
-- ----------------------------------------------------------------------------
create table if not exists crm_comunidades_v2.comunidad (
  id                  uuid primary key default gen_random_uuid(),
  nombre              text not null,
  adset_name          text,   -- para el mapeo automático de Windsor.ai (Sección 4.A del documento)
  miembros_iniciales  int not null default 0,
  miembros_finales    int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create or replace function crm_comunidades_v2.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_comunidad_updated_at on crm_comunidades_v2.comunidad;
create trigger trg_comunidad_updated_at
  before update on crm_comunidades_v2.comunidad
  for each row execute function crm_comunidades_v2.set_updated_at();

comment on table crm_comunidades_v2.comunidad is
  'Entidad mínima — solo lo que pide el documento de Jaz. Sin etapa/temporada/arquetipos (eso es de V1, no de este documento).';
comment on column crm_comunidades_v2.comunidad.miembros_iniciales is
  'Snapshot manual (Mi del documento) — no hay fuente automática descripta para este dato.';
comment on column crm_comunidades_v2.comunidad.miembros_finales is
  'Snapshot manual (Mf del documento, "stock actual de miembros reales") — se recarga a mano cuando alguien vuelve a contar el grupo de WhatsApp.';

-- ----------------------------------------------------------------------------
-- TABLA: evento_crudo  →  Nivel Crudo (tab Data_Cruda, Sección 3, TAB 5)
-- Todo INSERT, nunca UPDATE ni DELETE — incluye duplicados y reintentos tal
-- cual llegan del webhook de ManyChat (Sección 4.B: "Webhook en Vivo").
-- ----------------------------------------------------------------------------
create table if not exists crm_comunidades_v2.evento_crudo (
  id            uuid primary key default gen_random_uuid(),
  comunidad_id  uuid not null references crm_comunidades_v2.comunidad(id) on delete cascade,
  telefono_id   text not null,
  tipo          text not null default 'webhook_manychat' check (tipo in ('webhook_manychat')),
  payload       jsonb not null default '{}',
  recibido_en   timestamptz not null default now()
);

create index if not exists idx_evento_crudo_telefono_recibido
  on crm_comunidades_v2.evento_crudo (telefono_id, recibido_en);
create index if not exists idx_evento_crudo_comunidad
  on crm_comunidades_v2.evento_crudo (comunidad_id);

comment on table crm_comunidades_v2.evento_crudo is
  'Nivel Crudo del documento de Jaz (Sección 2): "registro cronológico de todos los eventos/clics, incluye duplicados y reintentos". Nunca se edita ni se borra una fila.';

-- ----------------------------------------------------------------------------
-- VISTA: evento_deduplicado  →  Nivel Deduplicado (tab Data_Deduplicada)
-- "Un registro único por Telefono_ID con su timestamp de origen" (Sección 2).
-- Es una VISTA, no una tabla: siempre se recalcula sobre evento_crudo, así
-- nunca puede desincronizarse. `distinct on` + `order by ... recibido_en asc`
-- es la implementación literal de "Atribución por Primer Contacto": el
-- primer evento de un teléfono es el que gana la comunidad de origen, sin
-- importar a cuántas comunidades más se sume después.
-- ----------------------------------------------------------------------------
create or replace view crm_comunidades_v2.evento_deduplicado as
select distinct on (telefono_id)
  telefono_id,
  comunidad_id as comunidad_atribuida_id,
  recibido_en as fecha_primer_contacto,
  payload
from crm_comunidades_v2.evento_crudo
order by telefono_id, recibido_en asc;

alter view crm_comunidades_v2.evento_deduplicado set (security_invoker = true);
comment on view crm_comunidades_v2.evento_deduplicado is
  'Nivel Deduplicado del documento de Jaz. Primer evento por telefono_id — la comunidad de esa fila es la que "gana" el 100% de la atribución (First-Contact Attribution, Sección 2).';

-- ----------------------------------------------------------------------------
-- TABLA: usuario_curado  →  la mitad "enriquecimiento" del Nivel Curado
-- (tab Base_Limpia, Sección 3, TAB 3).
--
-- Ojo: esta tabla NO guarda a qué comunidad quedó atribuido un teléfono ni
-- cuándo fue su primer contacto — eso es exactamente lo que ya resuelve la
-- vista evento_deduplicado (First-Contact Attribution), y duplicarlo acá
-- abriría la puerta a que se desincronicen. usuario_curado guarda solo lo
-- que evento_deduplicado no puede saber: nombre/email reales (vía
-- nominacion-sync) y etiquetado/estado editable a mano. La vista
-- `base_limpia` (002_vistas_panel.sql) es la que junta las dos mitades.
-- ----------------------------------------------------------------------------
create table if not exists crm_comunidades_v2.usuario_curado (
  telefono_id  text primary key,
  nombre       text,   -- null hasta que nominacion-sync lo complete — se muestra "Usuario WA" en el panel
  email        text,
  etiquetas    text[] not null default '{}',
  estado       text not null default 'clic_en_grupo',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists trg_usuario_curado_updated_at on crm_comunidades_v2.usuario_curado;
create trigger trg_usuario_curado_updated_at
  before update on crm_comunidades_v2.usuario_curado
  for each row execute function crm_comunidades_v2.set_updated_at();

comment on table crm_comunidades_v2.usuario_curado is
  'Mitad "enriquecimiento" del Nivel Curado — nombre/email/etiquetas/estado. La atribución de comunidad y la fecha de primer contacto viven en la vista evento_deduplicado, nunca acá (evita que se desincronicen).';
comment on column crm_comunidades_v2.usuario_curado.nombre is
  'Null = todavía no sincronizado con ManyChat. El panel lo muestra como "Usuario WA" (Sección 3, TAB 3, nota de enriquecimiento) hasta que nominacion-sync lo complete.';

-- Garantiza que exista una fila de enriquecimiento por cada teléfono visto,
-- sin importar el orden de llegada de los eventos (a diferencia de la
-- atribución, "¿existe una fila?" no depende de CUÁL evento llegó primero).
create or replace function crm_comunidades_v2.asegurar_usuario_curado()
returns trigger language plpgsql as $$
begin
  insert into crm_comunidades_v2.usuario_curado (telefono_id)
  values (new.telefono_id)
  on conflict (telefono_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_asegurar_usuario_curado on crm_comunidades_v2.evento_crudo;
create trigger trg_asegurar_usuario_curado
  after insert on crm_comunidades_v2.evento_crudo
  for each row execute function crm_comunidades_v2.asegurar_usuario_curado();

-- ----------------------------------------------------------------------------
-- TABLA: meta_ads_metrica
-- La puebla windsor-sync (Sección 4.A). Snapshot diario por comunidad —
-- permite tanto el total "todo el tiempo" (Overview/panel-data) como el
-- filtro por rango de fechas que pide Control_Comunidades (Sección 3, TAB 2).
-- ----------------------------------------------------------------------------
create table if not exists crm_comunidades_v2.meta_ads_metrica (
  id                    uuid primary key default gen_random_uuid(),
  comunidad_id          uuid not null references crm_comunidades_v2.comunidad(id) on delete cascade,
  fecha                 date not null,
  inversion             numeric(12,2) not null default 0,
  conversaciones_meta   int not null default 0,
  impresiones           int not null default 0,
  ctr_anuncio           numeric(6,4),
  creado_en             timestamptz not null default now(),
  unique (comunidad_id, fecha)
);

comment on table crm_comunidades_v2.meta_ads_metrica is
  'Poblada por la función windsor-sync (Sección 4.A del documento) — spend/impresiones/conversaciones de Meta Ads por adset, mapeado a comunidad.adset_name. Sin WINDSOR_API_KEY configurada, esta tabla se mantiene vacía a propósito.';

-- ----------------------------------------------------------------------------
-- RLS — un solo tipo de usuario autenticado, acceso completo. El documento
-- de Jaz no pide gobernanza de roles (a diferencia de V1) — no hay tabla
-- usuario_comunidad ni función es_admin() acá; cualquier sesión válida de
-- Supabase Auth (incluida la misma marketing@taquion.com.ar de V1, que es
-- una fila de auth.users compartida a nivel de PROYECTO) queda autorizada.
-- ----------------------------------------------------------------------------
alter table crm_comunidades_v2.comunidad enable row level security;
alter table crm_comunidades_v2.evento_crudo enable row level security;
alter table crm_comunidades_v2.usuario_curado enable row level security;
alter table crm_comunidades_v2.meta_ads_metrica enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['comunidad','evento_crudo','usuario_curado','meta_ads_metrica']
  loop
    execute format(
      'drop policy if exists usuario_autenticado on crm_comunidades_v2.%I; ' ||
      'create policy usuario_autenticado on crm_comunidades_v2.%I for all ' ||
      'using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'');',
      t, t
    );
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- GRANTs de schema/tabla — Supabase no los aplica automático para un schema
-- propio (mismo hallazgo que V1, ver docs/explanation/seguridad-...md de V1).
-- El webhook de ManyChat entra vía service_role (no anon), así que anon solo
-- necesita lectura para el panel funcionando con RLS.
-- ----------------------------------------------------------------------------
grant usage on schema crm_comunidades_v2 to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema crm_comunidades_v2 to authenticated, service_role;
grant select on all tables in schema crm_comunidades_v2 to anon;
grant usage, select on all sequences in schema crm_comunidades_v2 to authenticated, service_role;
grant execute on all functions in schema crm_comunidades_v2 to anon, authenticated, service_role;
alter default privileges in schema crm_comunidades_v2 grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema crm_comunidades_v2 grant select on tables to anon;
alter default privileges in schema crm_comunidades_v2 grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema crm_comunidades_v2 grant execute on functions to anon, authenticated, service_role;
