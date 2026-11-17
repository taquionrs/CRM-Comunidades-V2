-- ============================================================================
-- PR #89 — Frescura de la lista de miembros (semáforo en columna)
-- ============================================================================
-- frescura_miembros(cliente): de cada comunidad (visible), la fecha de su última carga de lista completa y cuántos días pasaron.
-- Una comunidad sin ninguna carga de lista completa trae ultima_carga y dias en null. Solo conteos y fechas (nunca teléfonos): lo ve
-- cualquier usuario del CRM. Fechas en hora de Buenos Aires. Las comunidades ocultas (db/047) no figuran.
-- Aplicar después de 047. Idempotente.
-- ============================================================================
set search_path = crm_comunidades_v2, public;

create or replace function crm_comunidades_v2.frescura_miembros(p_cliente uuid)
returns table (comunidad_id uuid, ultima_carga date, dias integer)
language sql
stable
security definer
set search_path = crm_comunidades_v2, public
as $f$
  with acceso as (
    select (nullif(current_setting('request.jwt.claims', true), '') is null
            or auth.role() = 'service_role'
            or crm_comunidades_v2.es_usuario_crm()) as ok
  ),
  hoy as (select (now() at time zone 'America/Argentina/Buenos_Aires')::date as d),
  cargas as (
    select c.comunidad_id, max((c.cargada_en at time zone 'America/Argentina/Buenos_Aires')::date) as ultima
      from crm_comunidades_v2.carga_miembros c
     where c.cliente_id = p_cliente and c.lista_completa
     group by c.comunidad_id
  )
  select co.id, ca.ultima, ((select h.d from hoy h) - ca.ultima)::int
    from acceso ac
    join crm_comunidades_v2.comunidad co on ac.ok and co.cliente_id = p_cliente and not co.oculta
    left join cargas ca on ca.comunidad_id = co.id
   order by co.nombre;
$f$;

revoke all on function crm_comunidades_v2.frescura_miembros(uuid) from public, anon;
grant execute on function crm_comunidades_v2.frescura_miembros(uuid) to authenticated, service_role;
comment on function crm_comunidades_v2.frescura_miembros(uuid) is
  'Última carga de lista completa de cada comunidad visible y días transcurridos (null si nunca se cargó). Solo conteos y fechas.';
