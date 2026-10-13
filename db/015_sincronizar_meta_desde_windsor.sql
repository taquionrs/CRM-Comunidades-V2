-- ============================================================================
-- CRM de Comunidades V2 — convertir lo que Windsor aterriza en meta_ads_metrica (PR #25)
--
-- Windsor escribe, por su cuenta, una tabla cruda en windsor_raw (db/014): una fila por día, campaña y
-- conjunto de anuncios. Esta función la convierte en meta_ads_metrica POR COMUNIDAD, con la misma regla que
-- el importador por CSV (scripts/lib/windsor-mapeo.mjs, probada con 18 tests):
--
--   * El cliente se distingue por la CAMPAÑA y la comunidad por el CONJUNTO DE ANUNCIOS, según
--     comunidad_meta_origen. Una regla con conjunto vacío asigna toda la campaña a una comunidad.
--   * Los nombres se comparan normalizados (normalizar_nombre): sin tildes, espacios ni mayúsculas.
--   * Si el cliente tiene meta_cuenta_id y la fila trae account_id, tienen que coincidir.
--   * Las campañas que no están en el mapeo se ignoran (son de otro cliente).
--   * Upsert por (comunidad, fecha): se puede correr todas las veces que haga falta.
--
--   sincronizar_meta_desde_windsor(tabla)  hace la conversión y deja el resultado en windsor_sync_log.
--   meta_sin_comunidad(tabla)              lista los conjuntos de una campaña mapeada que no tienen comunidad
--                                          (su gasto NO se asignó): hay que agregarlos a comunidad_meta_origen.
--
-- Columnas esperadas en la tabla cruda: date, account_id, campaign, adset_name, spend, impressions, clicks,
-- actions_onsite_conversion_messaging_conversation_started_7d, actions_onsite_conversion_lead_grouped.
-- Aplicar después de 014. Idempotente.
-- ============================================================================
create table if not exists crm_comunidades_v2.windsor_sync_log (
  id                     uuid primary key default gen_random_uuid(),
  corrida_en             timestamptz not null default now(),
  tabla                  text not null,
  filas_origen           int,
  filas_asignadas        int,
  registros_escritos     int,
  filas_sin_comunidad    int,
  gasto_sin_comunidad    numeric(14,2),
  error                  text   -- reservado: los errores de una corrida programada quedan en cron.job_run_details
);
alter table crm_comunidades_v2.windsor_sync_log enable row level security;
revoke all on crm_comunidades_v2.windsor_sync_log from anon, authenticated;
grant select, insert on crm_comunidades_v2.windsor_sync_log to service_role;
comment on table crm_comunidades_v2.windsor_sync_log is
  'Una fila por corrida de sincronizar_meta_desde_windsor: cuántas filas llegaron de Windsor, cuántas se asignaron a una comunidad y cuánto gasto quedó sin comunidad.';

-- Normaliza la tabla cruda de Windsor a columnas propias (nombres, tipos y redondeos), en una tabla temporal.
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

create or replace function crm_comunidades_v2.sincronizar_meta_desde_windsor(p_tabla text default 'windsor_raw.facebook_ads')
returns table (filas_origen int, filas_asignadas int, registros_escritos int, filas_sin_comunidad int, gasto_sin_comunidad numeric)
language plpgsql
set search_path = crm_comunidades_v2, public
as $$
declare
  v_origen int; v_asig int; v_escritos int; v_sin int; v_gasto numeric;
begin
  perform crm_comunidades_v2._windsor_normalizar(p_tabla);

  -- Asignación: la regla por conjunto gana sobre la de "toda la campaña".
  drop table if exists _windsor_asig;
  create temp table _windsor_asig on commit drop as
  select distinct on (n.rn)
         n.rn, n.fecha, n.inversion, n.impresiones, n.clics, n.conversaciones, n.leads,
         o.cliente_id, o.comunidad_id
    from _windsor_norm n
    join crm_comunidades_v2.comunidad_meta_origen o
      on crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(n.campana)
     and (o.adset_nombre is null
          or crm_comunidades_v2.normalizar_nombre(o.adset_nombre) = crm_comunidades_v2.normalizar_nombre(n.adset))
    join crm_comunidades_v2.cliente c on c.id = o.cliente_id and c.activo
   where c.meta_cuenta_id is null or n.cuenta_id is null or c.meta_cuenta_id = n.cuenta_id
   order by n.rn, (o.adset_nombre is null);

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
  -- Filas de una campaña que SÍ está en el mapeo pero cuyo conjunto no tiene comunidad (o es de otra cuenta).
  select count(*), coalesce(sum(n.inversion), 0) into v_sin, v_gasto
    from _windsor_norm n
   where exists (select 1 from crm_comunidades_v2.comunidad_meta_origen o
                  where crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(n.campana))
     and not exists (select 1 from _windsor_asig a where a.rn = n.rn);

  insert into crm_comunidades_v2.windsor_sync_log (tabla, filas_origen, filas_asignadas, registros_escritos, filas_sin_comunidad, gasto_sin_comunidad)
  values (p_tabla, v_origen, v_asig, v_escritos, v_sin, v_gasto);

  return query select v_origen, v_asig, v_escritos, v_sin, round(v_gasto, 2);
end;
$$;

create or replace function crm_comunidades_v2.meta_sin_comunidad(p_tabla text default 'windsor_raw.facebook_ads')
returns table (campana text, conjunto text, filas bigint, gasto numeric, desde date, hasta date)
language plpgsql
set search_path = crm_comunidades_v2, public
as $$
begin
  perform crm_comunidades_v2._windsor_normalizar(p_tabla);
  return query
  select n.campana, n.adset, count(*), round(sum(n.inversion), 2), min(n.fecha), max(n.fecha)
    from _windsor_norm n
   where exists (select 1 from crm_comunidades_v2.comunidad_meta_origen o
                  where crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(n.campana))
     and not exists (
       select 1 from crm_comunidades_v2.comunidad_meta_origen o
        where crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(n.campana)
          and (o.adset_nombre is null or crm_comunidades_v2.normalizar_nombre(o.adset_nombre) = crm_comunidades_v2.normalizar_nombre(n.adset)))
   group by n.campana, n.adset
   order by 4 desc;
end;
$$;

-- Solo el servidor las corre (la tarea programada y quien administra la base): nunca la API pública.
revoke all on function crm_comunidades_v2._windsor_normalizar(text) from public, anon, authenticated;
revoke all on function crm_comunidades_v2.sincronizar_meta_desde_windsor(text) from public, anon, authenticated;
revoke all on function crm_comunidades_v2.meta_sin_comunidad(text) from public, anon, authenticated;
grant execute on function crm_comunidades_v2.sincronizar_meta_desde_windsor(text) to service_role;
grant execute on function crm_comunidades_v2.meta_sin_comunidad(text) to service_role;

comment on function crm_comunidades_v2.sincronizar_meta_desde_windsor(text) is
  'Convierte la tabla cruda que aterriza Windsor (windsor_raw) en meta_ads_metrica por comunidad, con comunidad_meta_origen. Idempotente. Deja el resultado en windsor_sync_log.';
comment on function crm_comunidades_v2.meta_sin_comunidad(text) is
  'Conjuntos de anuncios de una campaña mapeada que no tienen comunidad: su gasto no se asigna hasta que se agreguen a comunidad_meta_origen.';
