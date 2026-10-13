-- ============================================================================
-- CRM de Comunidades V2 — trazabilidad de Windsor: botón "Consultas" del panel (PR #28)
--
-- Todo lo que pasa entre Windsor y el CRM tiene que quedar a la vista. Hay cuatro momentos, y cada uno deja huella:
--
--   entrega       Windsor escribió (o reemplazó) filas en windsor_raw.facebook_ads.   -> windsor_entrega_log (esta migración)
--   conversión    sincronizar_meta_desde_windsor pasó lo aterrizado a meta_ads_metrica. -> windsor_sync_log (db/015)
--   programada    el trabajo de pg_cron que dispara la conversión (éxito o error).      -> cron.job_run_details
--   csv           una importación manual con scripts/windsor-importar.mjs.              -> windsor_sync_log (tabla = "CSV: …")
--
--   consultas_windsor(limite)  junta los cuatro en una sola línea de tiempo para el panel. No devuelve datos
--                              personales: solo fechas, cantidades de filas, estados y nombres de archivo/tabla.
--
-- Lo que NO se ve desde acá: las llamadas internas de Windsor a Meta ni los intentos de Windsor que no llegan a escribir
-- en la base (esos se ven en el panel de Windsor). Aplicar después de 017. Idempotente.
-- ============================================================================
create table if not exists crm_comunidades_v2.windsor_entrega_log (
  id           uuid primary key default gen_random_uuid(),
  ocurrio_en   timestamptz not null default now(),
  tabla        text not null,
  operacion    text not null,          -- INSERT | DELETE | ESTADO (foto al activar el registro)
  filas        int  not null,
  fecha_desde  date,
  fecha_hasta  date
);
create index if not exists idx_windsor_entrega_log_fecha on crm_comunidades_v2.windsor_entrega_log (ocurrio_en desc);
alter table crm_comunidades_v2.windsor_entrega_log enable row level security;
revoke all on crm_comunidades_v2.windsor_entrega_log from anon, authenticated;
grant select, insert on crm_comunidades_v2.windsor_entrega_log to service_role;
comment on table crm_comunidades_v2.windsor_entrega_log is
  'Una fila por cada INSERT o DELETE que Windsor hace sobre su tabla cruda: cuántas filas y de qué fechas. Lo escribe un trigger.';

-- Trigger por sentencia: cuenta las filas que Windsor inserta o borra en una sola operación.
create or replace function crm_comunidades_v2._windsor_registrar_entrega()
returns trigger
language plpgsql
security definer
set search_path = crm_comunidades_v2, public
as $$
begin
  if tg_op = 'INSERT' then
    insert into crm_comunidades_v2.windsor_entrega_log (tabla, operacion, filas, fecha_desde, fecha_hasta)
    select tg_table_schema || '.' || tg_table_name, 'INSERT', count(*), min("date"), max("date") from nuevas having count(*) > 0;
  elsif tg_op = 'DELETE' then
    insert into crm_comunidades_v2.windsor_entrega_log (tabla, operacion, filas, fecha_desde, fecha_hasta)
    select tg_table_schema || '.' || tg_table_name, 'DELETE', count(*), min("date"), max("date") from viejas having count(*) > 0;
  end if;
  return null;
end;
$$;

-- Instala los triggers sobre la tabla de Windsor. Si Windsor la vuelve a crear, la próxima conversión los reinstala.
create or replace function crm_comunidades_v2._windsor_asegurar_registro(p_tabla text default 'windsor_raw.facebook_ads')
returns void
language plpgsql
security definer
set search_path = crm_comunidades_v2, public
as $$
declare
  v_reg regclass := to_regclass(p_tabla);
begin
  if v_reg is null then return; end if;
  if not exists (select 1 from pg_trigger where tgrelid = v_reg and tgname = 'trg_windsor_entrega_insert') then
    execute format('create trigger trg_windsor_entrega_insert after insert on %s referencing new table as nuevas for each statement execute function crm_comunidades_v2._windsor_registrar_entrega()', v_reg);
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = v_reg and tgname = 'trg_windsor_entrega_delete') then
    execute format('create trigger trg_windsor_entrega_delete after delete on %s referencing old table as viejas for each statement execute function crm_comunidades_v2._windsor_registrar_entrega()', v_reg);
  end if;
end;
$$;
revoke all on function crm_comunidades_v2._windsor_registrar_entrega() from public, anon, authenticated;
revoke all on function crm_comunidades_v2._windsor_asegurar_registro(text) from public, anon, authenticated;

-- Misma normalización de db/015, más: se reinstala el registro de entregas en cada conversión.
create or replace function crm_comunidades_v2._windsor_normalizar(p_tabla text)
returns void
language plpgsql
set search_path = crm_comunidades_v2, public
as $$
declare
  v_reg regclass := to_regclass(p_tabla);
begin
  if v_reg is null then
    raise exception 'La tabla % no existe: ¿ya corrió la primera tarea de Windsor?', p_tabla;
  end if;
  perform crm_comunidades_v2._windsor_asegurar_registro(p_tabla);
  drop table if exists _windsor_norm;
  execute format($f$
    create temp table _windsor_norm on commit drop as
    select row_number() over () as rn,
           (t."date")::date as fecha,
           nullif(btrim(t.account_id::text), '') as cuenta_id,
           btrim(coalesce(t.campaign::text, '')) as campana,
           btrim(coalesce(t.adset_name::text, '')) as adset,
           coalesce(nullif(t.spend::text, ''), '0')::numeric as inversion,
           round(coalesce(nullif(t.impressions::text, ''), '0')::numeric)::int as impresiones,
           round(coalesce(nullif(t.clicks::text, ''), '0')::numeric)::int as clics,
           round(coalesce(nullif(t.actions_onsite_conversion_messaging_conversation_started_7d::text, ''), '0')::numeric)::int as conversaciones,
           round(coalesce(nullif(t.actions_onsite_conversion_lead_grouped::text, ''), '0')::numeric)::int as leads
      from %s t
     where t."date" is not null
  $f$, v_reg);
end;
$$;
revoke all on function crm_comunidades_v2._windsor_normalizar(text) from public, anon, authenticated;

-- Línea de tiempo unificada para el botón "Consultas" del panel.
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
           coalesce(s.error, s.tabla)
      from crm_comunidades_v2.windsor_sync_log s
    union all
    select d.start_time, 'programada', coalesce(d.status, 'running'), 'Trabajo programado (pg_cron)',
           null::int, null::int, null::int, null::int, null::numeric,
           coalesce(d.return_message, '') || ' · ' || coalesce(to_char(d.end_time - d.start_time, 'SS.MS') || ' s', '')
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid
     where j.jobname = 'sincronizar-meta-windsor'
  ) t
  order by 1 desc
  limit greatest(1, least(coalesce(p_limite, 300), 2000));
$$;

-- Lectura abierta temporal, igual que el resto del panel (db/003). db/005 la retira junto con las demás.
revoke all on function crm_comunidades_v2.consultas_windsor(int) from public;
grant execute on function crm_comunidades_v2.consultas_windsor(int) to anon, authenticated, service_role;
comment on function crm_comunidades_v2.consultas_windsor(int) is
  'Línea de tiempo de todo lo que pasa entre Windsor y el CRM (entregas, conversiones, corridas programadas, importaciones por CSV). Sin datos personales.';

-- Activa el registro ahora: instala los triggers y deja una foto del estado actual de la tabla.
select crm_comunidades_v2._windsor_asegurar_registro('windsor_raw.facebook_ads');
do $$
begin
  if to_regclass('windsor_raw.facebook_ads') is not null
     and not exists (select 1 from crm_comunidades_v2.windsor_entrega_log where operacion = 'ESTADO') then
    execute $q$
      insert into crm_comunidades_v2.windsor_entrega_log (tabla, operacion, filas, fecha_desde, fecha_hasta)
      select 'windsor_raw.facebook_ads', 'ESTADO', count(*), min("date"), max("date") from windsor_raw.facebook_ads
    $q$;
  end if;
end $$;
