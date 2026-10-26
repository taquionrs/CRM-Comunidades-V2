-- 033 — Objetivos del puesto: los números del primer ciclo, chequeos de integridad de las métricas y registro de horas manuales
--
-- Alimenta la sección "Objetivos" del panel (solo Marketing). Lo que hace:
--   registro_horas_manuales   cada tarea manual que se hace a mano (fecha, tarea, minutos, nota, quién). Es la línea de base de "horas de carga manual eliminadas":
--                             sin registro no hay línea de base. Solo Marketing lee, agrega y borra; nada se edita.
--   objetivos_puesto(cliente, desde, hasta)   un JSON con:
--     sin_toque_humano   personas cuyo primer evento llegó solo por el webhook (sin la marca _recuperado), sobre las personas cuyo primer contacto cae en el período.
--     triaje             por comunidad, nunca promediado: conversaciones iniciadas en Meta (denominador) y tres numeradores,
--                        I1 entradas al flow, I2 clics en "Me sumo", I3 ingresos al grupo según las listas cargadas (sin contar la lista de partida usada como MI).
--                        La fila "total" suma numeradores y denominadores; no promedia tasas.
--     horas_manuales     minutos registrados, días con registro y detalle por tarea en el período.
--     chequeos           controles de integridad que dicen si las métricas se pueden creer (ok / aviso, con el detalle).
-- Las fechas se toman en hora de Buenos Aires. Solo devuelve conteos y nombres de comunidades: nunca teléfonos. Solo Marketing. Aplicar después de 032.

create table if not exists crm_comunidades_v2.registro_horas_manuales (
  id         uuid primary key default gen_random_uuid(),
  fecha      date not null,
  tarea      text not null check (length(btrim(tarea)) between 3 and 200),
  minutos    int  not null check (minutos between 1 and 720),
  nota       text check (nota is null or length(nota) <= 500),
  por        text not null default coalesce(crm_comunidades_v2._email_sesion(), 'sistema'),
  creado_en  timestamptz not null default now()
);
create index if not exists idx_registro_horas_fecha on crm_comunidades_v2.registro_horas_manuales (fecha);
alter table crm_comunidades_v2.registro_horas_manuales enable row level security;
revoke all on crm_comunidades_v2.registro_horas_manuales from public, anon, authenticated;
grant select, insert, delete on crm_comunidades_v2.registro_horas_manuales to authenticated;
grant all on crm_comunidades_v2.registro_horas_manuales to service_role;
drop policy if exists marketing_select on crm_comunidades_v2.registro_horas_manuales;
drop policy if exists marketing_insert on crm_comunidades_v2.registro_horas_manuales;
drop policy if exists marketing_delete on crm_comunidades_v2.registro_horas_manuales;
create policy marketing_select on crm_comunidades_v2.registro_horas_manuales for select to authenticated
  using ((select crm_comunidades_v2.es_marketing()));
create policy marketing_insert on crm_comunidades_v2.registro_horas_manuales for insert to authenticated
  with check ((select crm_comunidades_v2.es_marketing()));
create policy marketing_delete on crm_comunidades_v2.registro_horas_manuales for delete to authenticated
  using ((select crm_comunidades_v2.es_marketing()));
comment on table crm_comunidades_v2.registro_horas_manuales is
  'Minutos de trabajo manual (carga de tableros, conteos, limpieza) para levantar la línea de base de "horas de carga manual eliminadas". Sin datos personales.';

create or replace function crm_comunidades_v2.objetivos_puesto(p_cliente uuid, p_desde date default null, p_hasta date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = crm_comunidades_v2, public
as $f$
declare
  v_zona constant text := 'America/Argentina/Buenos_Aires';
  v_sin jsonb; v_triaje jsonb; v_horas jsonb; v_chequeos jsonb := '[]'::jsonb;
  v_ultima_sync timestamptz; v_ultimo_evento timestamptz; v_gasto_sin numeric; v_lista text; v_n int; v_dif numeric; v_det numeric; v_tabla numeric;
begin
  perform crm_comunidades_v2._exigir_marketing();

  -- 1) % de ingresos sin toque humano: el primer evento de cada persona llegó solo por el webhook.
  select jsonb_build_object(
           'personas', count(*),
           'automaticas', count(*) filter (where d.payload -> '_recuperado' is null),
           'pct', round(count(*) filter (where d.payload -> '_recuperado' is null)::numeric / nullif(count(*), 0) * 100, 1))
    into v_sin
    from crm_comunidades_v2.evento_deduplicado d
   where d.cliente_id = p_cliente
     and (p_desde is null or (d.fecha_primer_contacto at time zone v_zona)::date >= p_desde)
     and (p_hasta is null or (d.fecha_primer_contacto at time zone v_zona)::date <= p_hasta);

  -- 2) Tasa de triaje por comunidad: denominador = conversaciones de Meta; numeradores = I1 entradas, I2 clics en "Me sumo", I3 ingresos al grupo.
  with com as (
    select c.id, c.nombre from crm_comunidades_v2.comunidad c where c.cliente_id = p_cliente
  ), conv as (
    select m.comunidad_id, sum(m.conversaciones_meta)::bigint as n from crm_comunidades_v2.meta_ads_metrica m
     where m.cliente_id = p_cliente and (p_desde is null or m.fecha >= p_desde) and (p_hasta is null or m.fecha <= p_hasta) group by m.comunidad_id
  ), i1 as (
    select d.comunidad_atribuida_id as comunidad_id, count(*)::bigint as n from crm_comunidades_v2.evento_deduplicado d
     where d.cliente_id = p_cliente
       and (p_desde is null or (d.fecha_primer_contacto at time zone v_zona)::date >= p_desde)
       and (p_hasta is null or (d.fecha_primer_contacto at time zone v_zona)::date <= p_hasta) group by d.comunidad_atribuida_id
  ), i2 as (
    select k.comunidad_id, count(distinct k.telefono_id)::bigint as n from crm_comunidades_v2.clic_me_sumo k
     where k.cliente_id = p_cliente
       and (p_desde is null or (k.recibido_en at time zone v_zona)::date >= p_desde)
       and (p_hasta is null or (k.recibido_en at time zone v_zona)::date <= p_hasta) group by k.comunidad_id
  ), i3 as (
    select mc.comunidad_id, count(*)::bigint as n from crm_comunidades_v2.miembro_comunidad mc
     where mc.cliente_id = p_cliente
       and (p_desde is null or mc.fecha >= p_desde) and (p_hasta is null or mc.fecha <= p_hasta)
       and (mc.carga_id is null or not exists (select 1 from crm_comunidades_v2.carga_miembros cm where cm.id = mc.carga_id and cm.uso_como_mi))
     group by mc.comunidad_id
  ), fila as (
    select com.id as comunidad_id, com.nombre,
           coalesce(conv.n, 0) as conversaciones, coalesce(i1.n, 0) as entradas, coalesce(i2.n, 0) as clics_me_sumo, coalesce(i3.n, 0) as ingresos_grupo
      from com left join conv on conv.comunidad_id = com.id left join i1 on i1.comunidad_id = com.id
               left join i2 on i2.comunidad_id = com.id left join i3 on i3.comunidad_id = com.id
  )
  select jsonb_build_object(
    'comunidades', coalesce((select jsonb_agg(jsonb_build_object(
        'comunidad_id', f.comunidad_id, 'nombre', f.nombre, 'conversaciones', f.conversaciones, 'entradas', f.entradas,
        'clics_me_sumo', f.clics_me_sumo, 'ingresos_grupo', f.ingresos_grupo,
        'tasa_entradas', round(f.entradas::numeric / nullif(f.conversaciones, 0) * 100, 1),
        'tasa_clics', round(f.clics_me_sumo::numeric / nullif(f.conversaciones, 0) * 100, 1),
        'tasa_ingresos', round(f.ingresos_grupo::numeric / nullif(f.conversaciones, 0) * 100, 1)) order by f.nombre) from fila f), '[]'::jsonb),
    'total', (select jsonb_build_object(
        'conversaciones', coalesce(sum(f.conversaciones), 0), 'entradas', coalesce(sum(f.entradas), 0),
        'clics_me_sumo', coalesce(sum(f.clics_me_sumo), 0), 'ingresos_grupo', coalesce(sum(f.ingresos_grupo), 0),
        'tasa_entradas', round(sum(f.entradas)::numeric / nullif(sum(f.conversaciones), 0) * 100, 1),
        'tasa_clics', round(sum(f.clics_me_sumo)::numeric / nullif(sum(f.conversaciones), 0) * 100, 1),
        'tasa_ingresos', round(sum(f.ingresos_grupo)::numeric / nullif(sum(f.conversaciones), 0) * 100, 1)) from fila f))
    into v_triaje;

  -- 3) Horas manuales registradas en el período
  select jsonb_build_object(
           'registros', count(*), 'minutos', coalesce(sum(h.minutos), 0), 'dias_con_registro', count(distinct h.fecha),
           'por_tarea', coalesce((select jsonb_agg(jsonb_build_object('tarea', t.tarea, 'minutos', t.minutos) order by t.minutos desc)
                                    from (select h2.tarea, sum(h2.minutos)::int as minutos from crm_comunidades_v2.registro_horas_manuales h2
                                           where (p_desde is null or h2.fecha >= p_desde) and (p_hasta is null or h2.fecha <= p_hasta) group by h2.tarea) t), '[]'::jsonb))
    into v_horas
    from crm_comunidades_v2.registro_horas_manuales h
   where (p_desde is null or h.fecha >= p_desde) and (p_hasta is null or h.fecha <= p_hasta);

  -- 4) Chequeos de integridad
  -- a) el desglose por campaña explica la inversión de la tabla
  select coalesce(sum(d.inversion), 0) into v_det from crm_comunidades_v2.ads_campana_dia d
   where d.cliente_id = p_cliente and (p_desde is null or d.fecha >= p_desde) and (p_hasta is null or d.fecha <= p_hasta);
  select coalesce(sum(m.inversion), 0) into v_tabla from crm_comunidades_v2.meta_ads_metrica m
   where m.cliente_id = p_cliente and (p_desde is null or m.fecha >= p_desde) and (p_hasta is null or m.fecha <= p_hasta);
  v_dif := round(v_tabla - v_det, 2);
  v_chequeos := v_chequeos || jsonb_build_object('id', 'desglose_vs_tabla', 'titulo', 'El desglose por campaña suma lo mismo que la tabla',
    'estado', case when abs(v_dif) <= 1 then 'ok' else 'aviso' end,
    'detalle', case when abs(v_dif) <= 1 then 'Coinciden.' else 'Faltan ' || v_dif || ' de inversión en el detalle por campaña (días sin volver a traer de Windsor).' end);

  -- b) la sincronización con Windsor está al día
  select max(l.corrida_en) into v_ultima_sync from crm_comunidades_v2.windsor_sync_log l;
  v_chequeos := v_chequeos || jsonb_build_object('id', 'windsor_al_dia', 'titulo', 'La sincronización con Windsor está al día',
    'estado', case when v_ultima_sync is not null and v_ultima_sync > now() - interval '36 hours' then 'ok' else 'aviso' end,
    'detalle', case when v_ultima_sync is null then 'Nunca se sincronizó.'
                    else 'Última corrida hace ' || round(extract(epoch from now() - v_ultima_sync) / 3600) || ' h.' end);

  -- c) el webhook recibió eventos hace poco
  select max(e.recibido_en) into v_ultimo_evento from crm_comunidades_v2.evento_crudo e where e.cliente_id = p_cliente;
  v_chequeos := v_chequeos || jsonb_build_object('id', 'eventos_recientes', 'titulo', 'Llegaron eventos de ManyChat en las últimas 48 h',
    'estado', case when v_ultimo_evento is not null and v_ultimo_evento > now() - interval '48 hours' then 'ok' else 'aviso' end,
    'detalle', case when v_ultimo_evento is null then 'No hay eventos.'
                    else 'Último evento hace ' || round(extract(epoch from now() - v_ultimo_evento) / 3600) || ' h.' end);

  -- d) la planilla no tiene errores recientes
  select count(*) into v_n from crm_comunidades_v2.envio_planilla ep
   where ep.cliente_id = p_cliente and ep.estado = 'error' and ep.actualizado_en > now() - interval '7 days';
  v_chequeos := v_chequeos || jsonb_build_object('id', 'planilla_sin_errores', 'titulo', 'La planilla de Google no tuvo errores en 7 días',
    'estado', case when v_n = 0 then 'ok' else 'aviso' end,
    'detalle', case when v_n = 0 then 'Sin errores.' else v_n || ' envíos con error: revisar Data_Cruda → "Error en planilla".' end);

  -- e) la última sincronización no dejó gasto sin comunidad
  select l.gasto_sin_comunidad into v_gasto_sin from crm_comunidades_v2.windsor_sync_log l order by l.corrida_en desc limit 1;
  v_chequeos := v_chequeos || jsonb_build_object('id', 'gasto_con_comunidad', 'titulo', 'Todo el gasto de campañas mapeadas tiene comunidad',
    'estado', case when coalesce(v_gasto_sin, 0) = 0 then 'ok' else 'aviso' end,
    'detalle', case when coalesce(v_gasto_sin, 0) = 0 then 'Sin gasto huérfano.' else 'Quedaron ' || v_gasto_sin || ' sin comunidad en la última corrida.' end);

  -- f) MI y MF cargados
  select string_agg(c.nombre, ', ' order by c.nombre), count(*) into v_lista, v_n from crm_comunidades_v2.comunidad c
   where c.cliente_id = p_cliente and c.miembros_iniciales = 0 and c.miembros_finales = 0;
  v_chequeos := v_chequeos || jsonb_build_object('id', 'mi_mf_cargados', 'titulo', 'Todas las comunidades tienen miembros iniciales y finales',
    'estado', case when v_n = 0 then 'ok' else 'aviso' end,
    'detalle', case when v_n = 0 then 'Todas cargadas.' else 'Faltan MI y MF en: ' || v_lista || '.' end);

  -- g) bajas y fuga calculables (desde la segunda carga de lista completa)
  select string_agg(c.nombre, ', ' order by c.nombre), count(*) into v_lista, v_n from crm_comunidades_v2.comunidad c
   where c.cliente_id = p_cliente
     and (select count(*) from crm_comunidades_v2.carga_miembros cm where cm.comunidad_id = c.id and cm.lista_completa) < 2;
  v_chequeos := v_chequeos || jsonb_build_object('id', 'bajas_calculables', 'titulo', 'Las bajas y la fuga se pueden calcular en todas las comunidades',
    'estado', case when v_n = 0 then 'ok' else 'aviso' end,
    'detalle', case when v_n = 0 then 'Todas con dos cargas completas.' else 'Falta la segunda carga de lista completa en: ' || v_lista || '.' end);

  -- h) MF coincide con las personas que siguen en la última lista
  select string_agg(c.nombre || ' (MF ' || c.miembros_finales || ' contra ' || x.activos || ' en la lista)', ', ' order by c.nombre), count(*) into v_lista, v_n
    from crm_comunidades_v2.comunidad c
    join lateral (select count(*) as activos from crm_comunidades_v2.miembro_comunidad mc where mc.comunidad_id = c.id and mc.salio_en is null) x on true
   where c.cliente_id = p_cliente
     and exists (select 1 from crm_comunidades_v2.carga_miembros cm where cm.comunidad_id = c.id and cm.lista_completa)
     and c.miembros_finales <> x.activos;
  v_chequeos := v_chequeos || jsonb_build_object('id', 'mf_vs_listas', 'titulo', 'Los miembros finales coinciden con la última lista cargada',
    'estado', case when v_n = 0 then 'ok' else 'aviso' end,
    'detalle', case when v_n = 0 then 'Coinciden.' else 'No coinciden: ' || v_lista || '. Puede ser una edición manual de MF.' end);

  return jsonb_build_object('sin_toque_humano', v_sin, 'triaje', v_triaje, 'horas_manuales', v_horas, 'chequeos', v_chequeos);
end;
$f$;

revoke all on function crm_comunidades_v2.objetivos_puesto(uuid, date, date) from public, anon;
grant execute on function crm_comunidades_v2.objetivos_puesto(uuid, date, date) to authenticated, service_role;
comment on function crm_comunidades_v2.objetivos_puesto(uuid, date, date) is
  'Números del primer ciclo (ingresos sin toque humano, tasa de triaje por comunidad, horas manuales) y chequeos de integridad de las métricas. Solo conteos. Solo Marketing.';
