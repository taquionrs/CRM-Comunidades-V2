-- ============================================================================
-- PR #100 — Aviso "Toca cargar": lunes y jueves, hasta que cargues
-- ============================================================================
-- Hasta ahora el centro de acciones solo avisaba tras más de 8 días sin cargar la lista completa de miembros. El conteo se hace dos veces por
-- semana (lunes y jueves, el mismo calendario que el recordatorio por correo de n8n), así que ahora el aviso aparece cuando llega ese plazo:
-- si la última lista completa de una comunidad es anterior al último lunes o jueves (hoy incluido), "Para completar" pide cargarla, y se
-- va solo cuando cargás. Vale para todos los clientes. Las comunidades ocultas siguen afuera. Es idempotente (create or replace) y mantiene
-- todas las reglas de db/047; lo único nuevo es la regla "miembros_toca_carga". No toca datos.

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
  plazo as (
    -- Plazo de carga: lunes y jueves. Es el último de esos dos días hasta hoy (hoy incluido).
    select ((select h.d from hoy h) - (case extract(isodow from (select h.d from hoy h))::int
             when 1 then 0 when 2 then 1 when 3 then 2 when 4 then 0 when 5 then 1 when 6 then 2 else 3 end))::date as d
  ),
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
     where co.cliente_id = p_cliente and not co.oculta
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
    -- 1b) Toca cargar: llegó el plazo (lunes o jueves) y la lista completa es anterior. Las de más de 8 días ya las cubre la regla 1,
    --     y las de una sola carga la regla 5.
    select 'miembros_toca_carga'::text, 1,
           (case when count(*) = 1
                 then 'Hoy toca cargar la lista de ' || min(e.nombre) || ': la última carga fue ' || (case when min(e.dias) = 1 then 'ayer' else 'hace ' || min(e.dias) || ' días' end) || '.'
                 else 'Toca cargar la lista de miembros de ' || crm_comunidades_v2.lista_en_texto(array_agg(e.nombre order by e.nombre)) || ': la última carga fue ' || (case when min(e.dias) = max(e.dias) then 'hace ' || min(e.dias) || ' días' else 'hace entre ' || min(e.dias) || ' y ' || max(e.dias) || ' días' end) || '.' end),
           'Cargar miembros'::text, 'cargar_miembros'::text,
           array_agg(e.id order by e.nombre), array_agg(e.nombre order by e.nombre), max(e.dias)::numeric
      from estado e
     where e.n >= 2 and e.dias <= 8 and e.ultima < (select p.d from plazo p)
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

-- Posponer: la lista de códigos válidos suma el aviso nuevo (el resto de la función queda igual que en db/045).
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
                                               'miembros_una_carga', 'gasto_sin_comunidad', 'sin_clasificar', 'miembros_toca_carga']) then
    raise exception 'La acción % no existe', coalesce(p_codigo, '(vacía)');
  end if;
  if p_dias is null or p_dias < 1 or p_dias > 30 then raise exception 'Se puede posponer entre 1 y 30 días'; end if;
  v_hasta := (now() at time zone 'America/Argentina/Buenos_Aires')::date + p_dias;
  insert into crm_comunidades_v2.accion_pospuesta (cliente_id, codigo, hasta, motivo, por)
  values (p_cliente, p_codigo, v_hasta, left(nullif(btrim(coalesce(p_motivo, '')), ''), 200), coalesce(auth.jwt() ->> 'email', 'sin usuario'));
  return v_hasta;
end;
$f$;
