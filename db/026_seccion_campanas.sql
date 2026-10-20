-- 026 — Sección "Campañas": elegir desde el panel qué campañas de Meta cuentan, y para qué comunidad
--
-- Hasta ahora el mapeo campaña / conjunto → comunidad se cargaba con SQL. Esta migración lo expone al panel (botón "Campañas" de
-- Control_Comunidades, en pantalla completa):
--   campanas_windsor(dias)          todas las campañas y conjuntos que llegan de Windsor (de cualquier cliente de la cuenta publicitaria) con su
--                                   gasto y el estado de cada uno: cuenta, no cuenta o sin asignar. Una campaña nueva aparece "sin asignar": NO suma.
--   guardar_regla_campana(...)      'cuenta' (en una comunidad), 'no_cuenta' o 'sin_asignar'. Para toda la campaña (conjunto vacío) o para un conjunto.
--   recalcular_meta_windsor(por)    corre la sincronización con Windsor ya mismo (si no, se recalcula sola con la corrida diaria).
--   campania_regla_historial        cada cambio queda registrado: quién (el nombre que se escribe en el panel), qué, antes y después. Se ve en Consultas.
--
-- EXCEPCIÓN DE SEGURIDAD (decisión del usuario, 2026-10-20): esto se hace SIN clave y antes del SSO. Por eso cualquiera con el enlace del panel podría
-- ver el gasto de todas las campañas de la cuenta (incluidas las de otros clientes) y cambiar qué cuenta. Compensación: todo cambio queda en el historial
-- y se puede deshacer. Con el SSO esto pasa a exigir usuario.
--
-- Requiere db/025 (marca cuenta en comunidad_meta_origen).

create table if not exists crm_comunidades_v2.campania_regla_historial (
  id            uuid primary key default gen_random_uuid(),
  cambiado_en   timestamptz not null default clock_timestamp(),
  cambiado_por  text,
  campana       text,
  adset         text,
  accion        text not null check (accion in ('cuenta', 'no_cuenta', 'sin_asignar', 'recalcular')),
  destino       text,
  antes         jsonb,
  despues       jsonb
);
create index if not exists idx_campania_regla_historial_fecha on crm_comunidades_v2.campania_regla_historial (cambiado_en desc);
alter table crm_comunidades_v2.campania_regla_historial enable row level security;
drop policy if exists lectura_abierta on crm_comunidades_v2.campania_regla_historial;
create policy lectura_abierta on crm_comunidades_v2.campania_regla_historial for select using (true);
revoke all on crm_comunidades_v2.campania_regla_historial from anon, authenticated;
grant select on crm_comunidades_v2.campania_regla_historial to anon, authenticated;
grant select, insert on crm_comunidades_v2.campania_regla_historial to service_role;
comment on table crm_comunidades_v2.campania_regla_historial is
  'Cambios hechos desde el panel al mapeo de campañas de Meta: quién, cuándo, qué y el estado de las reglas antes y después. Sin datos personales.';

-- Todas las campañas y conjuntos de la tabla cruda de Windsor, con el estado de cada uno.
create or replace function crm_comunidades_v2.campanas_windsor(p_dias int default 90, p_tabla text default 'windsor_raw.facebook_ads')
returns table (
  campana text, adset text, cuenta_id text,
  gasto numeric, conversaciones bigint, clics bigint, impresiones bigint,
  desde date, hasta date, dias int,
  regla_id uuid, alcance text, cliente_id uuid, cliente_nombre text, comunidad_id uuid, comunidad_nombre text,
  cuenta boolean, motivo text
)
language plpgsql
security definer
set search_path = crm_comunidades_v2, public
as $$
begin
  perform crm_comunidades_v2._windsor_normalizar(p_tabla);
  return query
  select n.campana, n.adset, max(n.cuenta_id),
         round(sum(n.inversion), 2), sum(n.conversaciones)::bigint, sum(n.clics)::bigint, sum(n.impresiones)::bigint,
         min(n.fecha), max(n.fecha), count(distinct n.fecha)::int,
         r.id,
         case when r.id is null then null when r.adset_nombre is null then 'campana' else 'conjunto' end,
         r.cliente_id, cl.nombre, r.comunidad_id, co.nombre, r.cuenta, r.motivo_exclusion
    from _windsor_norm n
    left join lateral (
      select o.* from crm_comunidades_v2.comunidad_meta_origen o
       where crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(n.campana)
         and (o.adset_nombre is null or crm_comunidades_v2.normalizar_nombre(o.adset_nombre) = crm_comunidades_v2.normalizar_nombre(n.adset))
       order by (o.adset_nombre is null)
       limit 1) r on true
    left join crm_comunidades_v2.cliente cl on cl.id = r.cliente_id
    left join crm_comunidades_v2.comunidad co on co.id = r.comunidad_id
   where n.fecha >= current_date - greatest(coalesce(p_dias, 90), 1)
   group by n.campana, n.adset, r.id, r.adset_nombre, r.cliente_id, cl.nombre, r.comunidad_id, co.nombre, r.cuenta, r.motivo_exclusion
   order by 4 desc, 1, 2;
end;
$$;
revoke all on function crm_comunidades_v2.campanas_windsor(int, text) from public;
grant execute on function crm_comunidades_v2.campanas_windsor(int, text) to anon, authenticated, service_role;
comment on function crm_comunidades_v2.campanas_windsor(int, text) is
  'Campañas y conjuntos de anuncios que llegan de Windsor (últimos N días) con su gasto y estado (cuenta / no cuenta / sin asignar). Una campaña sin regla NO suma.';

-- Cambia el estado de una campaña (conjunto vacío = toda la campaña) o de un conjunto.
--   'cuenta'       suma en la comunidad indicada (reemplaza la regla anterior de ese mismo alcance, aunque fuera de otro cliente).
--   'no_cuenta'    deja de sumar pero conserva la regla (queda "no cuenta" y su gasto se registra en Consultas). Si se excluye un conjunto cuya
--                  campaña cuenta entera, se crea una regla del conjunto con cuenta = false en la misma comunidad. Si no había regla, ya no sumaba.
--   'sin_asignar'  borra la regla de ese alcance.
create or replace function crm_comunidades_v2.guardar_regla_campana(
  p_campana text, p_adset text, p_accion text, p_comunidad uuid default null, p_motivo text default null, p_por text default null)
returns void
language plpgsql
security definer
set search_path = crm_comunidades_v2, public
as $$
declare
  v_camp text := btrim(coalesce(p_campana, ''));
  v_adset text := nullif(btrim(coalesce(p_adset, '')), '');
  v_cli uuid; v_dest text; v_antes jsonb; v_despues jsonb := '[]'::jsonb; v_amplia record; v_n int;
  v_motivo text := coalesce(nullif(btrim(p_motivo), ''), 'Marcada como "no cuenta" desde el panel');
begin
  if v_camp = '' then raise exception 'Falta el nombre de la campaña'; end if;
  if p_accion not in ('cuenta', 'no_cuenta', 'sin_asignar') then raise exception 'Acción inválida (cuenta, no_cuenta o sin_asignar)'; end if;

  -- Solo se puede clasificar algo que realmente llega de Windsor.
  perform crm_comunidades_v2._windsor_normalizar('windsor_raw.facebook_ads');
  if not exists (select 1 from _windsor_norm n
                  where crm_comunidades_v2.normalizar_nombre(n.campana) = crm_comunidades_v2.normalizar_nombre(v_camp)
                    and (v_adset is null or crm_comunidades_v2.normalizar_nombre(n.adset) = crm_comunidades_v2.normalizar_nombre(v_adset))) then
    raise exception 'Esa campaña o conjunto no existe en los datos de Windsor';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('comunidad_id', o.comunidad_id, 'cuenta', o.cuenta)), '[]'::jsonb) into v_antes
    from crm_comunidades_v2.comunidad_meta_origen o
   where crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(v_camp)
     and coalesce(crm_comunidades_v2.normalizar_nombre(o.adset_nombre), '') = coalesce(crm_comunidades_v2.normalizar_nombre(v_adset), '');

  if p_accion = 'cuenta' then
    if p_comunidad is null then raise exception 'Elegí la comunidad en la que cuenta'; end if;
    select co.cliente_id, cl.nombre || ' / ' || co.nombre into v_cli, v_dest
      from crm_comunidades_v2.comunidad co join crm_comunidades_v2.cliente cl on cl.id = co.cliente_id where co.id = p_comunidad;
    if v_cli is null then raise exception 'La comunidad no existe'; end if;
    delete from crm_comunidades_v2.comunidad_meta_origen o
     where crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(v_camp)
       and coalesce(crm_comunidades_v2.normalizar_nombre(o.adset_nombre), '') = coalesce(crm_comunidades_v2.normalizar_nombre(v_adset), '');
    insert into crm_comunidades_v2.comunidad_meta_origen (cliente_id, comunidad_id, campana_nombre, adset_nombre, cuenta, motivo_exclusion)
    values (v_cli, p_comunidad, v_camp, v_adset, true, null);
    v_despues := jsonb_build_array(jsonb_build_object('comunidad_id', p_comunidad, 'cuenta', true));

  elsif p_accion = 'no_cuenta' then
    update crm_comunidades_v2.comunidad_meta_origen o
       set cuenta = false, motivo_exclusion = v_motivo
     where crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(v_camp)
       and coalesce(crm_comunidades_v2.normalizar_nombre(o.adset_nombre), '') = coalesce(crm_comunidades_v2.normalizar_nombre(v_adset), '');
    get diagnostics v_n = row_count;
    if v_n = 0 and v_adset is not null then
      select o.* into v_amplia from crm_comunidades_v2.comunidad_meta_origen o
       where crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(v_camp) and o.adset_nombre is null limit 1;
      if found and v_amplia.cuenta then
        insert into crm_comunidades_v2.comunidad_meta_origen (cliente_id, comunidad_id, campana_nombre, adset_nombre, cuenta, motivo_exclusion)
        values (v_amplia.cliente_id, v_amplia.comunidad_id, v_camp, v_adset, false, v_motivo);
        v_n := 1;
      end if;
    end if;
    if v_n > 0 then v_despues := jsonb_build_array(jsonb_build_object('cuenta', false)); end if;

  else
    delete from crm_comunidades_v2.comunidad_meta_origen o
     where crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(v_camp)
       and coalesce(crm_comunidades_v2.normalizar_nombre(o.adset_nombre), '') = coalesce(crm_comunidades_v2.normalizar_nombre(v_adset), '');
  end if;

  insert into crm_comunidades_v2.campania_regla_historial (cambiado_por, campana, adset, accion, destino, antes, despues)
  values (left(nullif(btrim(p_por), ''), 80), v_camp, v_adset, p_accion, v_dest, v_antes, v_despues);
end;
$$;
revoke all on function crm_comunidades_v2.guardar_regla_campana(text, text, text, uuid, text, text) from public;
grant execute on function crm_comunidades_v2.guardar_regla_campana(text, text, text, uuid, text, text) to anon, authenticated, service_role;
comment on function crm_comunidades_v2.guardar_regla_campana(text, text, text, uuid, text, text) is
  'Cambia desde el panel si una campaña (o un conjunto) cuenta, en qué comunidad, o queda sin asignar. Deja el cambio en campania_regla_historial.';

-- Recalcula ya mismo las métricas de Meta con las reglas vigentes (la corrida diaria lo hace igual). Máximo una vez cada 10 segundos.
create or replace function crm_comunidades_v2.recalcular_meta_windsor(p_por text default null)
returns table (filas_origen int, filas_asignadas int, registros_escritos int, filas_sin_comunidad int, gasto_sin_comunidad numeric)
language plpgsql
security definer
set search_path = crm_comunidades_v2, public
as $$
begin
  if exists (select 1 from crm_comunidades_v2.campania_regla_historial h where h.accion = 'recalcular' and h.cambiado_en > clock_timestamp() - interval '10 seconds') then
    raise exception 'Esperá unos segundos: ya se recalculó hace instantes';
  end if;
  insert into crm_comunidades_v2.campania_regla_historial (cambiado_por, accion) values (left(nullif(btrim(p_por), ''), 80), 'recalcular');
  return query select * from crm_comunidades_v2.sincronizar_meta_desde_windsor('windsor_raw.facebook_ads');
end;
$$;
revoke all on function crm_comunidades_v2.recalcular_meta_windsor(text) from public;
grant execute on function crm_comunidades_v2.recalcular_meta_windsor(text) to anon, authenticated, service_role;
comment on function crm_comunidades_v2.recalcular_meta_windsor(text) is
  'Corre la sincronización de Meta con Windsor ya mismo, con las reglas vigentes. Deja constancia en el historial. Máximo una vez cada 10 segundos.';

-- Línea de tiempo de "Consultas": suma los cambios del mapeo de campañas (resto igual que en db/025).
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
    union all
    select h.cambiado_en, 'campanas', 'ok',
           case h.accion when 'cuenta' then 'Campaña: pasó a contar' when 'no_cuenta' then 'Campaña: pasó a no contar'
                         when 'sin_asignar' then 'Campaña: quedó sin asignar' else 'Recalculo manual de las métricas de Meta' end,
           null::int, null::int, null::int, null::int, null::numeric,
           coalesce(h.campana, '') || coalesce(' [' || h.adset || ']', '')
             || coalesce(' · ' || h.destino, '')
             || coalesce(' · por ' || h.cambiado_por, '')
      from crm_comunidades_v2.campania_regla_historial h
  ) t
  order by 1 desc
  limit greatest(1, least(coalesce(p_limite, 300), 2000));
$$;
revoke all on function crm_comunidades_v2.consultas_windsor(int) from public;
grant execute on function crm_comunidades_v2.consultas_windsor(int) to anon, authenticated, service_role;
