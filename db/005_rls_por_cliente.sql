-- ============================================================================
-- CRM de Comunidades V2 — acceso por cliente (RLS)
-- Ref: specs/2026-09-29-estado-hacia-spec-final.md, hallazgo 3.1 y decisión 9.
--
-- Reemplaza la "lectura abierta temporal" de 003: ya no hay SELECT para anon.
-- Cada usuario autenticado ve SOLO los clientes que tiene asignados en
-- usuario_cliente — esa lista es la que alimenta el selector de cliente del
-- panel ("cuando se quiera y pueda": solo aparecen los clientes habilitados).
--
-- ⚠️ Requiere que el panel tenga login: sin sesión, todas las consultas
-- devuelven vacío. No aplicar hasta restaurar el login en index.html.
-- ⚠️ Después de aplicarla hay que asignar al menos un usuario a un cliente
-- (ver el ejemplo al final), o nadie verá nada.
--
-- Las Edge Functions usan service_role, que ignora RLS: por eso panel-data
-- tiene que validar el usuario y filtrar por cliente por su cuenta (pendiente).
--
-- Aplicar después de 004_cliente.sql. Idempotente.
-- ============================================================================
set search_path = crm_comunidades_v2, public;

-- ----------------------------------------------------------------------------
-- usuario_cliente: qué usuario puede ver qué cliente. Un solo rol, sin niveles.
-- ----------------------------------------------------------------------------
create table if not exists crm_comunidades_v2.usuario_cliente (
  user_id     uuid not null references auth.users(id) on delete cascade,
  cliente_id  uuid not null references crm_comunidades_v2.cliente(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, cliente_id)
);

comment on table crm_comunidades_v2.usuario_cliente is
  'Clientes habilitados por usuario. Define qué aparece en el selector de cliente del panel. Se escribe solo con service_role / SQL Editor.';

-- security definer para no recursar sobre la RLS de usuario_cliente.
create or replace function crm_comunidades_v2.mis_clientes()
returns setof uuid
language sql stable security definer
set search_path = crm_comunidades_v2, public
as $$
  select cliente_id from crm_comunidades_v2.usuario_cliente where user_id = auth.uid();
$$;

revoke all on function crm_comunidades_v2.mis_clientes() from public, anon;
grant execute on function crm_comunidades_v2.mis_clientes() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Cierre de anon: sin lectura abierta.
-- ----------------------------------------------------------------------------
revoke all on all tables in schema crm_comunidades_v2 from anon;
alter default privileges in schema crm_comunidades_v2 revoke select on tables from anon;

-- ----------------------------------------------------------------------------
-- Políticas
-- ----------------------------------------------------------------------------
alter table crm_comunidades_v2.cliente enable row level security;
alter table crm_comunidades_v2.usuario_cliente enable row level security;
alter table crm_comunidades_v2.usuario_estado_historial enable row level security;
alter table crm_comunidades_v2.webhook_intento enable row level security; -- 007
alter table crm_comunidades_v2.comunidad_meta_origen enable row level security; -- 010
alter table crm_comunidades_v2.trigger_entregado enable row level security; -- 011

do $$
declare
  t text;
  p record;
begin
  -- Limpia TODAS las políticas anteriores (001, 003) de las tablas afectadas.
  for p in
    select policyname, tablename from pg_policies
     where schemaname = 'crm_comunidades_v2'
       and tablename in ('cliente','comunidad','evento_crudo','usuario_curado',
                         'meta_ads_metrica','usuario_estado_historial','usuario_cliente','webhook_intento','comunidad_meta_origen','trigger_entregado')
  loop
    execute format('drop policy if exists %I on crm_comunidades_v2.%I', p.policyname, p.tablename);
  end loop;

  -- Tablas editables desde el panel: lectura y escritura acotadas al cliente.
  foreach t in array array['comunidad','usuario_curado','meta_ads_metrica']
  loop
    execute format(
      'create policy cliente_select on crm_comunidades_v2.%I for select to authenticated '
      'using (cliente_id in (select crm_comunidades_v2.mis_clientes()))', t);
    execute format(
      'create policy cliente_insert on crm_comunidades_v2.%I for insert to authenticated '
      'with check (cliente_id in (select crm_comunidades_v2.mis_clientes()))', t);
    execute format(
      'create policy cliente_update on crm_comunidades_v2.%I for update to authenticated '
      'using (cliente_id in (select crm_comunidades_v2.mis_clientes())) '
      'with check (cliente_id in (select crm_comunidades_v2.mis_clientes()))', t);
    execute format(
      'create policy cliente_delete on crm_comunidades_v2.%I for delete to authenticated '
      'using (cliente_id in (select crm_comunidades_v2.mis_clientes()))', t);
  end loop;

  -- Solo lectura desde el panel: el log crudo nunca se edita ni se borra
  -- (entra por el webhook con service_role) y el historial lo escribe un trigger.
  foreach t in array array['evento_crudo','usuario_estado_historial','webhook_intento','comunidad_meta_origen','trigger_entregado']
  loop
    execute format(
      'create policy cliente_select on crm_comunidades_v2.%I for select to authenticated '
      'using (cliente_id in (select crm_comunidades_v2.mis_clientes()))', t);
  end loop;
end $$;

create policy cliente_select on crm_comunidades_v2.cliente
  for select to authenticated
  using (id in (select crm_comunidades_v2.mis_clientes()));

create policy propio_select on crm_comunidades_v2.usuario_cliente
  for select to authenticated
  using (user_id = auth.uid());

-- Las escrituras sobre cliente y usuario_cliente no tienen política a propósito:
-- solo service_role (SQL Editor / Edge Functions) puede darlas de alta.
revoke insert, update, delete on crm_comunidades_v2.cliente from authenticated;
revoke insert, update, delete on crm_comunidades_v2.usuario_cliente from authenticated;
revoke insert, update, delete on crm_comunidades_v2.usuario_estado_historial from authenticated;
revoke insert, update, delete on crm_comunidades_v2.evento_crudo from authenticated;
revoke insert, update, delete on crm_comunidades_v2.webhook_intento from authenticated;
revoke insert, update, delete on crm_comunidades_v2.comunidad_meta_origen from authenticated;

-- 018: la línea de tiempo de Windsor (consultas_windsor) queda solo para usuarios con sesión.
revoke execute on function crm_comunidades_v2.consultas_windsor(int) from anon;
revoke insert, update, delete on crm_comunidades_v2.trigger_entregado from authenticated;

-- ----------------------------------------------------------------------------
-- Ejemplo: habilitar a un usuario en todos los clientes (correr a mano).
--   insert into crm_comunidades_v2.usuario_cliente (user_id, cliente_id)
--   select u.id, c.id
--     from auth.users u cross join crm_comunidades_v2.cliente c
--    where u.email = 'marketing@taquion.com.ar'
--   on conflict do nothing;
-- ----------------------------------------------------------------------------
