-- 025 — Qué campañas de Meta cuentan para las métricas
--
-- Problema (2026-10-20): la campaña general de Cortado en Jarrito (TQN_AON_META_CON_INTE_MANUAL_CORTADO_EN_JARRITO: conjuntos POST y DARK) es de
-- interacción — su resultado en Meta es "Visitas al perfil y a la página" — y aportaba ~96 % del gasto de Cortado, con casi ninguna conversación.
-- Eso inflaba la inversión de Overview y distorsionaba el costo por conversación y por miembro.
--
-- Decisión: solo cuentan las campañas de conversión o tráfico a WhatsApp.
--   * Cortado en Jarrito: solo TQN_AON_META_CON_TRAFICO_MANUAL_CORTADO_EN_JARRITO_WHATSAPP. Sus tres conjuntos (_BOEDO, _DEVOTO, _PALERMO) van a
--     su comunidad; cualquier otro conjunto de esa campaña va a la comunidad general (la regla por conjunto gana sobre la de "toda la campaña").
--     La campaña de leads de Cortado (CON_LEADS_..._WHATSAPP) y la INTE quedan fuera por decisión del usuario.
--   * Todo un País: sin cambios (campaña de leads por comunidad).
--
-- Cambios:
--   comunidad_meta_origen.cuenta           true = el gasto de esa regla cuenta; false = se registra pero no se suma a las métricas.
--   comunidad_meta_origen.motivo_exclusion por qué no cuenta.
--   windsor_sync_log                       suma filas_excluidas, gasto_excluido y registros_borrados (se ven en "Consultas").
--   sincronizar_meta_desde_windsor         respeta la marca y, además, quita de meta_ads_metrica lo que ya no corresponde: las filas de las
--                                          fechas que trae Windsor que ninguna regla vigente respalda (si no, el gasto excluido seguiría en la base).
--                                          No borra nada si no se asignó ninguna fila (protección contra un mapeo vacío).
--   consultas_windsor                      muestra el gasto que no cuenta y los registros quitados.
--
-- Revertir una exclusión: update crm_comunidades_v2.comunidad_meta_origen set cuenta = true, motivo_exclusion = null where id = '...';
-- y volver a correr select * from crm_comunidades_v2.sincronizar_meta_desde_windsor();

alter table crm_comunidades_v2.comunidad_meta_origen
  add column if not exists cuenta boolean not null default true,
  add column if not exists motivo_exclusion text;
comment on column crm_comunidades_v2.comunidad_meta_origen.cuenta is
  'true = el gasto de esta regla cuenta para las métricas; false = se registra en Consultas pero no se suma (por ejemplo, campañas de interacción).';
comment on column crm_comunidades_v2.comunidad_meta_origen.motivo_exclusion is 'Por qué una regla no cuenta (solo si cuenta = false).';

alter table crm_comunidades_v2.windsor_sync_log
  add column if not exists filas_excluidas int not null default 0,
  add column if not exists gasto_excluido numeric(14,2) not null default 0,
  add column if not exists registros_borrados int not null default 0;

-- Reglas de Cortado en Jarrito (la comparación usa los nombres normalizados, como el resto del mapeo).
update crm_comunidades_v2.comunidad_meta_origen o
   set cuenta = false,
       motivo_exclusion = 'Campaña de interacción: su resultado en Meta es visitas al perfil y a la página. No es conversión ni tráfico a WhatsApp.'
  from crm_comunidades_v2.cliente c
 where c.id = o.cliente_id and c.slug = 'cortado-en-jarrito'
   and crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre('TQN_AON_META_CON_INTE_MANUAL_CORTADO_EN_JARRITO');

update crm_comunidades_v2.comunidad_meta_origen o
   set cuenta = false,
       motivo_exclusion = 'Decisión del 20/10/2026: para Cortado en Jarrito cuenta solo la campaña de tráfico a WhatsApp.'
  from crm_comunidades_v2.cliente c
 where c.id = o.cliente_id and c.slug = 'cortado-en-jarrito'
   and crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre('TQN_AON_META_CON_LEADS_MANUAL_CORTADO_EN_JARRITO_WHATSAPP');

insert into crm_comunidades_v2.comunidad_meta_origen (cliente_id, comunidad_id, campana_nombre, adset_nombre, cuenta)
select c.id, co.id, 'TQN_AON_META_CON_TRAFICO_MANUAL_CORTADO_EN_JARRITO_WHATSAPP', null, true
  from crm_comunidades_v2.cliente c
  join crm_comunidades_v2.comunidad co on co.cliente_id = c.id and co.nombre = 'Cortado en Jarrito (general)'
 where c.slug = 'cortado-en-jarrito'
   and not exists (
     select 1 from crm_comunidades_v2.comunidad_meta_origen o
      where o.cliente_id = c.id and o.adset_nombre is null
        and crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre('TQN_AON_META_CON_TRAFICO_MANUAL_CORTADO_EN_JARRITO_WHATSAPP'));

-- Los tres conjuntos de la campaña de tráfico, cada uno a su comunidad (nombres tomados del Administrador de anuncios el 20/10/2026).
insert into crm_comunidades_v2.comunidad_meta_origen (cliente_id, comunidad_id, campana_nombre, adset_nombre, cuenta)
select c.id, co.id, 'TQN_AON_META_CON_TRAFICO_MANUAL_CORTADO_EN_JARRITO_WHATSAPP', v.adset, true
  from crm_comunidades_v2.cliente c
  join (values
         ('Boedo',        'TQN_AON_META_CON_TRAFICO_MANUAL_CORTADO_EN_JARRITO_WHATSAPP_BOEDO'),
         ('Villa Devoto', 'TQN_AON_META_CON_TRAFICO_MANUAL_CORTADO_EN_JARRITO_WHATSAPP_DEVOTO'),
         ('Palermo',      'TQN_AON_META_CON_TRAFICO_MANUAL_CORTADO_EN_JARRITO_WHATSAPP_PALERMO')
       ) v(comunidad, adset) on true
  join crm_comunidades_v2.comunidad co on co.cliente_id = c.id and co.nombre = v.comunidad
 where c.slug = 'cortado-en-jarrito'
   and not exists (
     select 1 from crm_comunidades_v2.comunidad_meta_origen o
      where o.cliente_id = c.id
        and crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre('TQN_AON_META_CON_TRAFICO_MANUAL_CORTADO_EN_JARRITO_WHATSAPP')
        and crm_comunidades_v2.normalizar_nombre(o.adset_nombre) = crm_comunidades_v2.normalizar_nombre(v.adset));

-- Conversión de la tabla cruda de Windsor a meta_ads_metrica (misma firma que en db/015).
create or replace function crm_comunidades_v2.sincronizar_meta_desde_windsor(p_tabla text default 'windsor_raw.facebook_ads')
returns table (filas_origen int, filas_asignadas int, registros_escritos int, filas_sin_comunidad int, gasto_sin_comunidad numeric)
language plpgsql
set search_path = crm_comunidades_v2, public
as $$
declare
  v_origen int; v_asig int; v_escritos int; v_sin int; v_gasto numeric;
  v_excl int; v_gasto_excl numeric; v_borrados int := 0;
begin
  perform crm_comunidades_v2._windsor_normalizar(p_tabla);

  -- Asignación con TODAS las reglas: la de conjunto gana sobre la de "toda la campaña". Después se separan las que cuentan de las que no.
  drop table if exists _windsor_asig_todas;
  create temp table _windsor_asig_todas on commit drop as
  select distinct on (n.rn)
         n.rn, n.fecha, n.inversion, n.impresiones, n.clics, n.conversaciones, n.leads,
         o.cliente_id, o.comunidad_id, o.cuenta
    from _windsor_norm n
    join crm_comunidades_v2.comunidad_meta_origen o
      on crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(n.campana)
     and (o.adset_nombre is null
          or crm_comunidades_v2.normalizar_nombre(o.adset_nombre) = crm_comunidades_v2.normalizar_nombre(n.adset))
    join crm_comunidades_v2.cliente c on c.id = o.cliente_id and c.activo
   where c.meta_cuenta_id is null or n.cuenta_id is null or c.meta_cuenta_id = n.cuenta_id
   order by n.rn, (o.adset_nombre is null);

  drop table if exists _windsor_asig;
  create temp table _windsor_asig on commit drop as select * from _windsor_asig_todas where cuenta;

  select count(*), coalesce(sum(inversion), 0) into v_excl, v_gasto_excl from _windsor_asig_todas where not cuenta;

  insert into crm_comunidades_v2.meta_ads_metrica
         (cliente_id, comunidad_id, fecha, inversion, conversaciones_meta, impresiones, clics, leads_meta)
  select cliente_id, comunidad_id, fecha, round(sum(inversion), 2), sum(conversaciones), sum(impresiones), sum(clics), sum(leads)
    from _windsor_asig
   group by cliente_id, comunidad_id, fecha
  on conflict (comunidad_id, fecha) do update
     set inversion = excluded.inversion, conversaciones_meta = excluded.conversaciones_meta,
         impresiones = excluded.impresiones, clics = excluded.clics, leads_meta = excluded.leads_meta;
  get diagnostics v_escritos = row_count;

  select count(*) into v_origen from _windsor_norm;
  select count(*) into v_asig from _windsor_asig;

  -- Lo que ya estaba en la base para fechas que trae Windsor y que ninguna regla vigente respalda (por ejemplo, gasto de una campaña que ahora no cuenta).
  -- Solo si se asignó algo: un mapeo vacío no borra nada.
  if v_asig > 0 then
    delete from crm_comunidades_v2.meta_ads_metrica m
     where m.comunidad_id in (select o.comunidad_id from crm_comunidades_v2.comunidad_meta_origen o join crm_comunidades_v2.cliente c on c.id = o.cliente_id and c.activo)
       and m.fecha in (select distinct fecha from _windsor_norm)
       and not exists (select 1 from _windsor_asig a where a.comunidad_id = m.comunidad_id and a.fecha = m.fecha);
    get diagnostics v_borrados = row_count;
  end if;

  -- Filas de una campaña que SÍ está en el mapeo pero cuyo conjunto no tiene comunidad (o es de otra cuenta).
  select count(*), coalesce(sum(n.inversion), 0) into v_sin, v_gasto
    from _windsor_norm n
   where exists (select 1 from crm_comunidades_v2.comunidad_meta_origen o
                  where crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(n.campana))
     and not exists (select 1 from _windsor_asig_todas a where a.rn = n.rn);

  insert into crm_comunidades_v2.windsor_sync_log
         (tabla, filas_origen, filas_asignadas, registros_escritos, filas_sin_comunidad, gasto_sin_comunidad, filas_excluidas, gasto_excluido, registros_borrados)
  values (p_tabla, v_origen, v_asig, v_escritos, v_sin, v_gasto, v_excl, round(v_gasto_excl, 2), v_borrados);

  return query select v_origen, v_asig, v_escritos, v_sin, round(v_gasto, 2);
end;
$$;
revoke all on function crm_comunidades_v2.sincronizar_meta_desde_windsor(text) from public, anon, authenticated;
grant execute on function crm_comunidades_v2.sincronizar_meta_desde_windsor(text) to service_role;

-- Línea de tiempo de "Consultas": ahora muestra también el gasto que no cuenta y los registros quitados (resto igual que en db/020).
create or replace function crm_comunidades_v2.consultas_windsor(p_limite int default 300)
returns table (
  ocurrio_en timestamptz, tipo text, estado text, titulo text,
  filas_origen int, filas_asignadas int, registros_escritos int, filas_sin_comunidad int, gasto_sin_comunidad numeric,
  detalle text
)
language sql
stable
security definer
set search_path = crm_comunidades_v2, public, cron
as $$
  select * from (
    select e.ocurrio_en, 'entrega'::text, 'ok'::text,
           case e.operacion when 'INSERT' then 'Windsor escribió filas' when 'DELETE' then 'Windsor reemplazó filas (borró las anteriores)' else 'Estado de la tabla de Windsor' end,
           e.filas, null::int, null::int, null::int, null::numeric,
           e.tabla || coalesce(' · fechas ' || e.fecha_desde || ' a ' || e.fecha_hasta, '')
      from crm_comunidades_v2.windsor_entrega_log e
    union all
    select s.corrida_en,
           case when s.tabla like 'windsor_raw.%' then 'conversion' else 'csv' end,
           case when s.error is not null then 'error' else 'ok' end,
           case when s.tabla like 'windsor_raw.%' then 'Conversión a métricas por comunidad' else 'Importación manual por CSV' end,
           s.filas_origen, s.filas_asignadas, s.registros_escritos, s.filas_sin_comunidad, s.gasto_sin_comunidad,
           coalesce(s.error, s.tabla
             || case when coalesce(s.filas_excluidas, 0) > 0 then ' · no cuenta por regla: ' || s.filas_excluidas || ' filas, $' || round(s.gasto_excluido)::text else '' end
             || case when coalesce(s.registros_borrados, 0) > 0 then ' · se quitaron ' || s.registros_borrados || ' registros que ya no corresponden' else '' end)
      from crm_comunidades_v2.windsor_sync_log s
    union all
    select d.start_time, 'programada', coalesce(d.status, 'running'), 'Trabajo programado (pg_cron)',
           null::int, null::int, null::int, null::int, null::numeric,
           coalesce(d.return_message, '') || ' · ' || coalesce(to_char(d.end_time - d.start_time, 'SS.MS') || ' s', '')
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid
     where j.jobname = 'sincronizar-meta-windsor'
    union all
    select m.cargada_en, 'carga_miembros', 'ok',
           'Carga de miembros · ' || cm.nombre,
           m.filas_leidas, m.numeros_validos, m.numeros_validos, null::int, null::numeric,
           coalesce(m.archivo, 'sin nombre de archivo')
             || ' · ' || case when m.lista_completa then 'lista completa' else 'solo personas nuevas' end
             || ' · ' || m.numeros_validos || ' números'
             || case when m.invalidos > 0 then ', ' || m.invalidos || ' inválidos' else '' end
             || case when m.repetidos > 0 then ', ' || m.repetidos || ' repetidos en el archivo' else '' end
             || case when m.sin_fecha > 0 then ', ' || m.sin_fecha || ' sin fecha (se usó la de hoy)' else '' end
             || ' · +' || coalesce(m.nuevos, 0) || ' nuevos'
             || case when m.duplicados > 0 then ' · ' || m.duplicados || ' ya cargados (' ||
                  case m.duplicados_accion when 'actualizar_fecha' then m.fechas_actualizadas || ' con la fecha actualizada' else 'ignorados' end || ')' else '' end
             || case when coalesce(m.salieron, 0) > 0 then ' · −' || m.salieron || ' salidas' else '' end
             || ' · coincide con ' || m.coincidencias_crm || ' contactos del CRM'
             || case when m.uso_como_mi then ' · usada como miembros iniciales' else '' end
             || coalesce(' · cargada por ' || m.cargada_por, '')
      from crm_comunidades_v2.carga_miembros m
      join crm_comunidades_v2.comunidad cm on cm.id = m.comunidad_id
  ) t
  order by 1 desc
  limit greatest(1, least(coalesce(p_limite, 300), 2000));
$$;
revoke all on function crm_comunidades_v2.consultas_windsor(int) from public;
grant execute on function crm_comunidades_v2.consultas_windsor(int) to anon, authenticated, service_role;
