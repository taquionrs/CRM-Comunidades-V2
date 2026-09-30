-- ============================================================================
-- CRM de Comunidades V2 — modelo de cliente (multi-cliente)
-- Ref: specs/2026-09-29-estado-hacia-spec-final.md, sección 3 bis y decisión 9.
--
-- Por qué existe: hay tres cuentas de ManyChat (Cortado en Jarrito, Todo un
-- País, Growing Ideas) y al menos dos clientes distintos. Con el teléfono como
-- llave global, un mismo CRM cruzaría personas entre clientes. Acá el teléfono
-- sigue siendo la llave de identidad, pero la atribución First-Contact y todo
-- el resto se calculan DENTRO de un cliente: la misma persona en dos clientes
-- son dos filas independientes, cada una con su propia comunidad de origen.
--
-- Qué hace:
--   1. Tabla `cliente` (una fila por cliente / cuenta de ManyChat).
--   2. `cliente_id` en comunidad, evento_crudo, meta_ads_metrica y
--      usuario_curado, con FK compuesta para que una fila nunca pueda apuntar a
--      una comunidad de OTRO cliente.
--   3. usuario_curado pasa a PK (cliente_id, telefono_id).
--   4. Historial de cambios de estadio de la persona.
--   5. Vistas recalculadas por cliente.
--
-- NO cambia políticas RLS ni GRANTs — eso es 005_rls_por_cliente.sql. Si ya hay
-- datos, se asignan a un cliente "Sin asignar (migrado)" para no perderlos.
--
-- ⚠️ Orden de aplicación: primero deployar las Edge Functions y el frontend
-- nuevos (manychat-webhook, windsor-sync, panel-data, index.html) y recién
-- después correr esta migración, o al revés con una ventana corta: evento_crudo
-- y meta_ads_metrica pasan a exigir cliente_id. Ya está adaptado el código;
-- nominacion-sync no necesita cambios (ver spec, sección 3 ter).
--
-- Aplicar después de 003. Idempotente.
-- ============================================================================
set search_path = crm_comunidades_v2, public;

-- ----------------------------------------------------------------------------
-- TABLA: cliente
-- manychat_account_id: id de la cuenta de ManyChat (ej. fb5616672). Sirve para
-- validar que el webhook llegó de la cuenta que dice ser.
-- webhook_secret_hash: sha256 (hex) del secreto que ManyChat manda en el header
-- x-webhook-secret. El secreto en claro NO se guarda acá.
-- ----------------------------------------------------------------------------
create table if not exists crm_comunidades_v2.cliente (
  id                   uuid primary key default gen_random_uuid(),
  nombre               text not null unique,
  slug                 text not null unique check (slug ~ '^[a-z0-9-]+$'),
  manychat_account_id  text unique,
  webhook_secret_hash  text,
  activo               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

drop trigger if exists trg_cliente_updated_at on crm_comunidades_v2.cliente;
create trigger trg_cliente_updated_at
  before update on crm_comunidades_v2.cliente
  for each row execute function crm_comunidades_v2.set_updated_at();

-- El panel lee la lista de clientes para el selector, pero NUNCA el hash del
-- secreto: se revoca el SELECT de tabla y se concede solo por columna.
-- (Mientras siga vigente la lectura abierta de 003, se replica esa política
-- para cliente; 005 la reemplaza por acceso por usuario.)
alter table crm_comunidades_v2.cliente enable row level security;

drop policy if exists lectura_abierta on crm_comunidades_v2.cliente;
create policy lectura_abierta on crm_comunidades_v2.cliente for select using (true);

revoke select on crm_comunidades_v2.cliente from anon, authenticated;
grant select (id, nombre, slug, manychat_account_id, activo, created_at, updated_at)
  on crm_comunidades_v2.cliente to anon, authenticated;

comment on table crm_comunidades_v2.cliente is
  'Un cliente de Taquion = una cuenta de ManyChat = un universo aislado de comunidades, personas y métricas. Es la base del selector de cliente del panel.';

-- Ejemplo de alta (correr a mano, no forma parte de la migración):
--   insert into crm_comunidades_v2.cliente (nombre, slug, manychat_account_id)
--   values ('Todo un País', 'todo-un-pais', 'fb5616672'),
--          ('Cortado en Jarrito', 'cortado-en-jarrito', 'fb5616665');
--   -- webhook_secret_hash = encode(sha256('el-secreto'::bytea), 'hex')

-- ----------------------------------------------------------------------------
-- comunidad.cliente_id
-- ----------------------------------------------------------------------------
alter table crm_comunidades_v2.comunidad
  add column if not exists cliente_id uuid references crm_comunidades_v2.cliente(id) on delete restrict;

do $$
begin
  if exists (select 1 from crm_comunidades_v2.comunidad where cliente_id is null) then
    insert into crm_comunidades_v2.cliente (nombre, slug)
    values ('Sin asignar (migrado)', 'sin-asignar')
    on conflict (slug) do nothing;

    update crm_comunidades_v2.comunidad
       set cliente_id = (select id from crm_comunidades_v2.cliente where slug = 'sin-asignar')
     where cliente_id is null;
  end if;
end $$;

alter table crm_comunidades_v2.comunidad alter column cliente_id set not null;

-- Necesario para la FK compuesta de las tablas hijas.
create unique index if not exists uq_comunidad_id_cliente
  on crm_comunidades_v2.comunidad (id, cliente_id);
create unique index if not exists uq_comunidad_cliente_nombre
  on crm_comunidades_v2.comunidad (cliente_id, nombre);
create unique index if not exists uq_comunidad_cliente_adset
  on crm_comunidades_v2.comunidad (cliente_id, adset_name) where adset_name is not null;
create index if not exists idx_comunidad_cliente
  on crm_comunidades_v2.comunidad (cliente_id);

-- ----------------------------------------------------------------------------
-- evento_crudo.cliente_id (denormalizado a propósito: permite RLS y el índice
-- de deduplicación por cliente sin un join)
-- ----------------------------------------------------------------------------
alter table crm_comunidades_v2.evento_crudo add column if not exists cliente_id uuid;

update crm_comunidades_v2.evento_crudo e
   set cliente_id = c.cliente_id
  from crm_comunidades_v2.comunidad c
 where c.id = e.comunidad_id and e.cliente_id is null;

alter table crm_comunidades_v2.evento_crudo alter column cliente_id set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'evento_crudo_comunidad_cliente_fk') then
    alter table crm_comunidades_v2.evento_crudo
      add constraint evento_crudo_comunidad_cliente_fk
      foreign key (comunidad_id, cliente_id)
      references crm_comunidades_v2.comunidad (id, cliente_id) on delete cascade;
  end if;
end $$;

create index if not exists idx_evento_crudo_cliente_telefono_recibido
  on crm_comunidades_v2.evento_crudo (cliente_id, telefono_id, recibido_en);

-- ----------------------------------------------------------------------------
-- meta_ads_metrica.cliente_id
-- ----------------------------------------------------------------------------
alter table crm_comunidades_v2.meta_ads_metrica add column if not exists cliente_id uuid;

update crm_comunidades_v2.meta_ads_metrica m
   set cliente_id = c.cliente_id
  from crm_comunidades_v2.comunidad c
 where c.id = m.comunidad_id and m.cliente_id is null;

alter table crm_comunidades_v2.meta_ads_metrica alter column cliente_id set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'meta_ads_metrica_comunidad_cliente_fk') then
    alter table crm_comunidades_v2.meta_ads_metrica
      add constraint meta_ads_metrica_comunidad_cliente_fk
      foreign key (comunidad_id, cliente_id)
      references crm_comunidades_v2.comunidad (id, cliente_id) on delete cascade;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- usuario_curado: PK (cliente_id, telefono_id)
-- ----------------------------------------------------------------------------
alter table crm_comunidades_v2.usuario_curado
  add column if not exists cliente_id uuid references crm_comunidades_v2.cliente(id) on delete cascade;

update crm_comunidades_v2.usuario_curado u
   set cliente_id = (
     select e.cliente_id from crm_comunidades_v2.evento_crudo e
      where e.telefono_id = u.telefono_id
      order by e.recibido_en asc limit 1
   )
 where u.cliente_id is null;

do $$
begin
  if exists (select 1 from crm_comunidades_v2.usuario_curado where cliente_id is null) then
    insert into crm_comunidades_v2.cliente (nombre, slug)
    values ('Sin asignar (migrado)', 'sin-asignar')
    on conflict (slug) do nothing;

    update crm_comunidades_v2.usuario_curado
       set cliente_id = (select id from crm_comunidades_v2.cliente where slug = 'sin-asignar')
     where cliente_id is null;
  end if;

  -- Solo si todavía es la PK vieja (una sola columna).
  if exists (
    select 1 from pg_constraint
     where conname = 'usuario_curado_pkey'
       and conrelid = 'crm_comunidades_v2.usuario_curado'::regclass
       and array_length(conkey, 1) = 1
  ) then
    alter table crm_comunidades_v2.usuario_curado drop constraint usuario_curado_pkey;
    alter table crm_comunidades_v2.usuario_curado alter column cliente_id set not null;
    alter table crm_comunidades_v2.usuario_curado add primary key (cliente_id, telefono_id);
  end if;
end $$;

comment on table crm_comunidades_v2.usuario_curado is
  'Mitad "enriquecimiento" del Nivel Curado, una fila por (cliente, teléfono). La misma persona en dos clientes son dos filas. La atribución de comunidad vive en la vista evento_deduplicado, nunca acá.';
comment on column crm_comunidades_v2.usuario_curado.estado is
  'Estadio actual de la persona dentro de ese cliente. Valor inicial y único confirmado: clic_en_grupo (documento de Jaz). Los estadios siguientes están por definir; cada cambio queda en usuario_estado_historial.';

-- El trigger que asegura la fila de enriquecimiento ahora la crea por cliente.
create or replace function crm_comunidades_v2.asegurar_usuario_curado()
returns trigger language plpgsql as $$
begin
  insert into crm_comunidades_v2.usuario_curado (cliente_id, telefono_id)
  values (new.cliente_id, new.telefono_id)
  on conflict (cliente_id, telefono_id) do nothing;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- TABLA: usuario_estado_historial — cada cambio de estadio de una persona
-- ----------------------------------------------------------------------------
create table if not exists crm_comunidades_v2.usuario_estado_historial (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid not null,
  telefono_id      text not null,
  estado_anterior  text,
  estado_nuevo     text not null,
  origen           text not null default 'sistema' check (origen in ('sistema','webhook','manual')),
  creado_en        timestamptz not null default now(),
  foreign key (cliente_id, telefono_id)
    references crm_comunidades_v2.usuario_curado (cliente_id, telefono_id) on delete cascade
);

create index if not exists idx_estado_historial_persona
  on crm_comunidades_v2.usuario_estado_historial (cliente_id, telefono_id, creado_en desc);

-- security definer: el historial lo escribe el trigger aunque quien cambia el
-- estado (ej. una sesión del panel) no tenga permiso de INSERT sobre la tabla.
create or replace function crm_comunidades_v2.registrar_cambio_estado()
returns trigger language plpgsql
security definer set search_path = crm_comunidades_v2, public
as $$
begin
  if tg_op = 'INSERT' then
    insert into crm_comunidades_v2.usuario_estado_historial (cliente_id, telefono_id, estado_anterior, estado_nuevo)
    values (new.cliente_id, new.telefono_id, null, new.estado);
  elsif new.estado is distinct from old.estado then
    insert into crm_comunidades_v2.usuario_estado_historial (cliente_id, telefono_id, estado_anterior, estado_nuevo)
    values (new.cliente_id, new.telefono_id, old.estado, new.estado);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_usuario_curado_estado on crm_comunidades_v2.usuario_curado;
create trigger trg_usuario_curado_estado
  after insert or update of estado on crm_comunidades_v2.usuario_curado
  for each row execute function crm_comunidades_v2.registrar_cambio_estado();

alter table crm_comunidades_v2.usuario_estado_historial enable row level security;
-- Sin política = nadie lo lee desde el panel hasta 005 (el panel V2 todavía no lo muestra).

comment on table crm_comunidades_v2.usuario_estado_historial is
  'Log de transiciones de estadio por persona y cliente. Solo se inserta desde el trigger de usuario_curado.';

-- ----------------------------------------------------------------------------
-- VISTAS recalculadas por cliente. Se dropean en orden de dependencia porque
-- cambia el conjunto de columnas.
-- ----------------------------------------------------------------------------
drop view if exists crm_comunidades_v2.kpis_macro;
drop view if exists crm_comunidades_v2.comunidad_performance;
drop view if exists crm_comunidades_v2.base_limpia;
drop view if exists crm_comunidades_v2.evento_deduplicado;

-- First-Contact Attribution DENTRO de cada cliente.
create view crm_comunidades_v2.evento_deduplicado as
select distinct on (cliente_id, telefono_id)
  cliente_id,
  telefono_id,
  comunidad_id as comunidad_atribuida_id,
  recibido_en as fecha_primer_contacto,
  payload
from crm_comunidades_v2.evento_crudo
order by cliente_id, telefono_id, recibido_en asc;

alter view crm_comunidades_v2.evento_deduplicado set (security_invoker = true);
comment on view crm_comunidades_v2.evento_deduplicado is
  'Primer evento por (cliente, teléfono). La comunidad de esa fila gana el 100% de la atribución de esa persona dentro de ese cliente; otro cliente no la afecta.';

create view crm_comunidades_v2.comunidad_performance as
select
  c.cliente_id,
  c.id as comunidad_id,
  c.nombre,
  c.miembros_iniciales,
  c.miembros_finales,
  coalesce(m.inversion, 0) as inversion,
  coalesce(m.conversaciones_meta, 0) as conversaciones_meta,
  coalesce(m.impresiones, 0) as impresiones,
  coalesce(u.clics_unicos, 0) as clics_unicos,
  round(coalesce(m.inversion, 0) / nullif(coalesce(m.conversaciones_meta, 0), 0), 2) as cpl,
  round(coalesce(m.inversion, 0) / nullif(coalesce(u.clics_unicos, 0), 0), 2) as cpcu,
  round(coalesce(m.inversion, 0) / nullif(c.miembros_finales - c.miembros_iniciales, 0), 2) as cpmn,
  (c.miembros_finales - c.miembros_iniciales) as crecimiento_neto,
  (c.miembros_iniciales + coalesce(u.clics_unicos, 0) - c.miembros_finales) as bajas_estimadas,
  round(
    (c.miembros_iniciales + coalesce(u.clics_unicos, 0) - c.miembros_finales)::numeric
    / nullif(coalesce(u.clics_unicos, 0), 0) * 100, 2
  ) as tasa_fuga_pct
from crm_comunidades_v2.comunidad c
left join (
  select comunidad_id, sum(inversion) as inversion, sum(conversaciones_meta) as conversaciones_meta, sum(impresiones) as impresiones
  from crm_comunidades_v2.meta_ads_metrica
  group by comunidad_id
) m on m.comunidad_id = c.id
left join (
  select comunidad_atribuida_id, count(*) as clics_unicos
  from crm_comunidades_v2.evento_deduplicado
  group by comunidad_atribuida_id
) u on u.comunidad_atribuida_id = c.id;

alter view crm_comunidades_v2.comunidad_performance set (security_invoker = true);

create view crm_comunidades_v2.base_limpia as
select
  d.cliente_id,
  d.telefono_id as phone_id,
  coalesce(u.nombre, 'Usuario WA') as nombre,
  coalesce(u.email, 'Sin email') as email,
  c.nombre as comunidad_atribuida,
  d.comunidad_atribuida_id,
  d.fecha_primer_contacto,
  coalesce(u.etiquetas, '{}') as etiquetas,
  coalesce(u.estado, 'clic_en_grupo') as estado
from crm_comunidades_v2.evento_deduplicado d
left join crm_comunidades_v2.usuario_curado u
  on u.cliente_id = d.cliente_id and u.telefono_id = d.telefono_id
left join crm_comunidades_v2.comunidad c on c.id = d.comunidad_atribuida_id;

alter view crm_comunidades_v2.base_limpia set (security_invoker = true);

-- Una fila POR CLIENTE (antes era una sola fila global).
create view crm_comunidades_v2.kpis_macro as
select
  cliente_id,
  coalesce(sum(inversion), 0) as inversion_total,
  coalesce(sum(conversaciones_meta), 0) as conversaciones_totales,
  round(coalesce(sum(inversion), 0) / nullif(coalesce(sum(conversaciones_meta), 0), 0), 2) as cpl_global,
  coalesce(sum(clics_unicos), 0) as clics_unicos_totales,
  coalesce(sum(miembros_finales), 0) as miembros_efectivos_totales,
  round(coalesce(sum(inversion), 0) / nullif(sum(miembros_finales) - sum(miembros_iniciales), 0), 2) as cpme_global,
  round(
    coalesce(sum(bajas_estimadas), 0)::numeric / nullif(coalesce(sum(clics_unicos), 0), 0) * 100, 2
  ) as tasa_fuga_global_pct
from crm_comunidades_v2.comunidad_performance
group by cliente_id;

alter view crm_comunidades_v2.kpis_macro set (security_invoker = true);
comment on view crm_comunidades_v2.kpis_macro is
  'Roll-up por cliente sobre comunidad_performance — una fila por cliente. El panel filtra por el cliente elegido en el selector.';

grant select on crm_comunidades_v2.evento_deduplicado to anon, authenticated, service_role;
grant select on crm_comunidades_v2.comunidad_performance to anon, authenticated, service_role;
grant select on crm_comunidades_v2.base_limpia to anon, authenticated, service_role;
grant select on crm_comunidades_v2.kpis_macro to anon, authenticated, service_role;
