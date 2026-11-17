-- ============================================================================
-- CRM de Comunidades V2 — Centro de acciones: "Para completar" (PR #77)
--
-- Principio rector (plan global, sección 2 bis): el CRM te pide lo que le falta para sus propias métricas, de forma directa y con el
-- botón que lo resuelve. Esta función calcula esa lista; el panel solo la muestra (y n8n puede usarla igual).
--
--   acciones_pendientes(cliente)   una fila por ACCIÓN (no por comunidad: si Palermo y Devoto llevan días sin carga es una sola acción,
--                                  "Cargá la lista de Palermo y Villa Devoto"), ordenadas por prioridad. Cada fila trae el mensaje ya
--                                  escrito, el texto del botón, a dónde lleva y qué comunidades involucra.
--   posponer_accion(...)           deja una acción en silencio de 1 a 30 días (por defecto 7), con un motivo.
--
-- Acciones (código → qué pide):
--   miembros_sin_carga     prioridad 1  más de 8 días sin carga de lista completa (el CRR queda viejo)
--   carga_no_cuadra        prioridad 1  la última carga no cuadra: inicio + nuevos − bajas no da el final
--   meta_sin_sincronizar   prioridad 1  la sincronización con Meta no corre hace más de 48 h
--   miembros_sin_cargas    prioridad 2  la comunidad no tiene ninguna carga de lista completa
--   miembros_una_carga     prioridad 2  una sola carga de lista completa: falta otra para calcular el CRR
--   gasto_sin_comunidad    prioridad 2  hay gasto de un conjunto de anuncios nuevo sin comunidad asignada
--   sin_clasificar         prioridad 3  3 o más personas escribieron en 7 días y no eligieron comunidad
--
-- No se queja por campañas apagadas a propósito: "Meta sin sincronizar" mira CUÁNDO CORRIÓ la sincronización (windsor_sync_log), no cuál
-- es el último día con gasto (sin campañas activas no hay gasto nuevo y eso no es un problema).
--
-- Solo Marketing: las acciones llevan plata y piden cargas que solo Marketing puede hacer. Las fechas son de Buenos Aires.
-- Aplicar después de 044. Idempotente.
-- ============================================================================
set search_path = crm_comunidades_v2, public;

-- "A", "A y B", "A, B y C".
create or replace function crm_comunidades_v2.lista_en_texto(p_items text[])
returns text language sql immutable parallel safe as $$
  select case coalesce(cardinality(p_items), 0)
           when 0 then ''
           when 1 then p_items[1]
           else array_to_string(p_items[1:cardinality(p_items) - 1], ', ') || ' y ' || p_items[cardinality(p_items)]
         end
$$;

create table if not exists crm_comunidades_v2.accion_pospuesta (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references crm_comunidades_v2.cliente (id) on delete cascade,
  codigo      text not null check (codigo ~ '^[a-z_]{3,40}$'),
  hasta       date not null,
  motivo      text,
  por         text,
  creada_en   timestamptz not null default now()
);
create index if not exists idx_accion_pospuesta_cliente on crm_comunidades_v2.accion_pospuesta (cliente_id, codigo, hasta);
alter table crm_comunidades_v2.accion_pospuesta enable row level security;
revoke all on crm_comunidades_v2.accion_pospuesta from anon, authenticated;
grant select, insert on crm_comunidades_v2.accion_pospuesta to service_role;
comment on table crm_comunidades_v2.accion_pospuesta is
  'Acciones del centro de acciones puestas en silencio hasta una fecha, con el motivo. Solo se escribe con posponer_accion().';

create or replace function crm_comunidades_v2.acciones_pendientes(p_cliente uuid)
returns table (codigo text, prioridad integer, mensaje text, boton text, destino text,
               comunidad_ids uuid[], comunidades text[], dato numeric)
language sql
stable
security definer
set search_path = crm_comunidades_v2, public
as $f$
  with acceso as (
    select (nullif(current_setting('request.jwt.claims', true), '') is null
            or auth.role() = 'service_role'
            or crm_comunidades_v2.es_marketing()) as ok
  ),
  hoy as (select (now() at time zone 'America/Argentina/Buenos_Aires')::date as d),
  cargas as (
    select c.comunidad_id, count(*) as n,
           max((c.cargada_en at time zone 'America/Argentina/Buenos_Aires')::date) as ultima
      from crm_comunidades_v2.carga_miembros c
     where c.cliente_id = p_cliente and c.lista_completa
     group by c.comunidad_id
  ),
  estado as (
    select co.id, co.nombre, coalesce(ca.n, 0) as n, ca.ultima, (select h.d from hoy h) - ca.ultima as dias
      from crm_comunidades_v2.comunidad co
      left join cargas ca on ca.comunidad_id = co.id
     where co.cliente_id = p_cliente
  ),
  ultimo_intervalo as (
    select distinct on (r.comunidad_id) r.comunidad_id, r.cuadra
      from crm_comunidades_v2.crr_por_carga(p_cliente) r
     order by r.comunidad_id, r.hasta desc
  ),
  sync_meta as (
    select max(l.corrida_en) as ultima
      from crm_comunidades_v2.windsor_sync_log l
     where l.tabla like 'windsor_raw.facebook_ads%' or l.tabla like 'windsor_raw.en_vivo%'
  ),
  ultima_corrida as (
    select l.gasto_sin_comunidad as gasto
      from crm_comunidades_v2.windsor_sync_log l
     where l.tabla like 'windsor_raw.facebook_ads%' or l.tabla like 'windsor_raw.en_vivo%'
     order by l.corrida_en desc limit 1
  ),
  sin_clasificar as (
    select count(distinct s.telefono_id) as n
      from crm_comunidades_v2.ingreso_sin_clasificar s
     where s.cliente_id = p_cliente and s.recibido_en > now() - interval '7 days'
       and not exists (select 1 from crm_comunidades_v2.evento_crudo e where e.cliente_id = s.cliente_id and e.telefono_id = s.telefono_id)
  ),
  acciones as (
    -- 1) Más de 8 días sin carga de lista completa.
    select 'miembros_sin_carga'::text as codigo, 1 as prioridad,
           (case when count(*) = 1
                 then 'Cargá la lista de ' || min(e.nombre) || ': hace ' || min(e.dias) || ' días que no se actualiza. Sin eso el CRR queda viejo.'
                 else 'Cargá la lista de miembros de ' || crm_comunidades_v2.lista_en_texto(array_agg(e.nombre order by e.nombre))
                      || (case when min(e.dias) = max(e.dias) then ': llevan ' || min(e.dias) || ' días sin actualizarse.' else ': llevan entre ' || min(e.dias) || ' y ' || max(e.dias) || ' días sin actualizarse.' end)
                      || ' Sin eso el CRR queda viejo.' end) as mensaje,
           'Cargar miembros'::text as boton, 'cargar_miembros'::text as destino,
           array_agg(e.id order by e.nombre) as comunidad_ids, array_agg(e.nombre order by e.nombre) as comunidades, max(e.dias)::numeric as dato
      from estado e where e.n >= 1 and e.dias > 8
    having count(*) > 0
    union all
    -- 2) La última carga no cuadra.
    select 'carga_no_cuadra', 1,
           (case when count(*) = 1
                 then min(co.nombre) || ': la última carga no cuadra (miembros al inicio + nuevos − bajas no da los miembros al final). Revisala antes de confiar en su CRR.'
                 else 'Las últimas cargas de ' || crm_comunidades_v2.lista_en_texto(array_agg(co.nombre order by co.nombre))
                      || ' no cuadran (inicio + nuevos − bajas no da el final). Revisalas antes de confiar en su CRR.' end),
           'Ver las cargas', 'consultas', array_agg(co.id order by co.nombre), array_agg(co.nombre order by co.nombre), count(*)::numeric
      from ultimo_intervalo u join crm_comunidades_v2.comunidad co on co.id = u.comunidad_id
     where u.cuadra is false
    having count(*) > 0
    union all
    -- 3) La sincronización con Meta no corre hace más de 48 h.
    select 'meta_sin_sincronizar', 1,
           'La sincronización con Meta no corre desde el ' || to_char(m.ultima at time zone 'America/Argentina/Buenos_Aires', 'DD/MM') || '. Traé los datos a mano.',
           'Traer de Meta ahora', 'traer_meta', null::uuid[], null::text[],
           extract(day from now() - m.ultima)::numeric
      from sync_meta m where m.ultima is not null and m.ultima < now() - interval '48 hours'
    union all
    -- 4) Comunidades sin ninguna carga de lista completa.
    select 'miembros_sin_cargas', 2,
           (case when count(*) = 1
                 then min(e.nombre) || ' no tiene ninguna carga de lista completa de miembros: cargala para empezar a medir su CRR.'
                 else crm_comunidades_v2.lista_en_texto(array_agg(e.nombre order by e.nombre))
                      || ' no tienen ninguna carga de lista completa de miembros: cargalas para empezar a medir su CRR.' end),
           'Cargar miembros', 'cargar_miembros', array_agg(e.id order by e.nombre), array_agg(e.nombre order by e.nombre), count(*)::numeric
      from estado e where e.n = 0
    having count(*) > 0
    union all
    -- 5) Una sola carga (reciente): falta otra para calcular el CRR.
    select 'miembros_una_carga', 2,
           (case when count(*) = 1
                 then min(e.nombre) || ' tiene una sola carga de lista completa: cargá otra para calcular su CRR.'
                 else crm_comunidades_v2.lista_en_texto(array_agg(e.nombre order by e.nombre))
                      || ' tienen una sola carga de lista completa: cargá otra para calcular su CRR.' end),
           'Cargar miembros', 'cargar_miembros', array_agg(e.id order by e.nombre), array_agg(e.nombre order by e.nombre), count(*)::numeric
      from estado e where e.n = 1 and e.dias <= 8
    having count(*) > 0
    union all
    -- 6) Gasto sin comunidad en la última sincronización.
    select 'gasto_sin_comunidad', 2,
           'Hay $' || replace(to_char(round(u.gasto), 'FM999,999,999,999'), ',', '.') || ' de gasto sin comunidad: un conjunto de anuncios nuevo no está asignado.',
           'Campañas', 'campanas', null::uuid[], null::text[], u.gasto::numeric
      from ultima_corrida u where coalesce(u.gasto, 0) > 0
    union all
    -- 7) Personas que escribieron y no eligieron comunidad.
    select 'sin_clasificar', 3,
           s.n || ' personas escribieron en los últimos 7 días y no eligieron comunidad.',
           'Ver en Data_Cruda', 'data_cruda', null::uuid[], null::text[], s.n::numeric
      from sin_clasificar s where s.n >= 3
  )
  select a.codigo, a.prioridad, a.mensaje, a.boton, a.destino, a.comunidad_ids, a.comunidades, a.dato
    from acceso ac
    join acciones a on ac.ok
   where not exists (select 1 from crm_comunidades_v2.accion_pospuesta p
                      where p.cliente_id = p_cliente and p.codigo = a.codigo and p.hasta >= (select h.d from hoy h))
   order by a.prioridad, a.dato desc nulls last, a.codigo;
$f$;

revoke all on function crm_comunidades_v2.acciones_pendientes(uuid) from public, anon;
grant execute on function crm_comunidades_v2.acciones_pendientes(uuid) to authenticated, service_role;
comment on function crm_comunidades_v2.acciones_pendientes(uuid) is
  'Centro de acciones: lo que el CRM necesita que completes para sus propias métricas, con el mensaje ya escrito y a dónde lleva. Una fila por acción, por prioridad. Solo Marketing.';

create or replace function crm_comunidades_v2.posponer_accion(p_cliente uuid, p_codigo text, p_dias integer default 7, p_motivo text default null)
returns date
language plpgsql
security definer
set search_path = crm_comunidades_v2, public
as $f$
declare
  v_hasta date;
begin
  if not (nullif(current_setting('request.jwt.claims', true), '') is null
          or auth.role() = 'service_role'
          or crm_comunidades_v2.es_marketing()) then
    raise exception 'Solo el rol Marketing puede posponer acciones';
  end if;
  if p_codigo is null or p_codigo <> all (array['miembros_sin_carga', 'carga_no_cuadra', 'meta_sin_sincronizar', 'miembros_sin_cargas',
                                               'miembros_una_carga', 'gasto_sin_comunidad', 'sin_clasificar']) then
    raise exception 'La acción % no existe', coalesce(p_codigo, '(vacía)');
  end if;
  if p_dias is null or p_dias < 1 or p_dias > 30 then raise exception 'Se puede posponer entre 1 y 30 días'; end if;
  v_hasta := (now() at time zone 'America/Argentina/Buenos_Aires')::date + p_dias;
  insert into crm_comunidades_v2.accion_pospuesta (cliente_id, codigo, hasta, motivo, por)
  values (p_cliente, p_codigo, v_hasta, left(nullif(btrim(coalesce(p_motivo, '')), ''), 200), coalesce(auth.jwt() ->> 'email', 'sin usuario'));
  return v_hasta;
end;
$f$;

revoke all on function crm_comunidades_v2.posponer_accion(uuid, text, integer, text) from public, anon;
grant execute on function crm_comunidades_v2.posponer_accion(uuid, text, integer, text) to authenticated, service_role;
comment on function crm_comunidades_v2.posponer_accion(uuid, text, integer, text) is
  'Pone una acción del centro de acciones en silencio de 1 a 30 días, con un motivo. Solo Marketing.';
