-- 036 — Clics en el enlace de Meta (actions_link_click) en las métricas por comunidad
--
-- Pedido (2026-11-11, PR #65): la tabla "Métricas por comunidad" tiene que mostrar los CLICS EN EL ENLACE del anuncio (lo que Ads Manager llama
-- "Clics en el enlace"), no solo "todos los clics" (que suman reacciones, perfil, etc. y dan un CTR inflado).
--
--   meta_ads_metrica.clics_enlace        nueva columna (por comunidad y día). NULL = ese día todavía no llegó con este dato: NO es lo mismo que 0.
--   meta_ads_metrica_global.clics_enlace igual, para las campañas globales del cliente.
--   ads_campana_dia.clics_enlace         igual, para el desglose por campaña y conjunto.
--   _windsor_normalizar                  lee la columna actions_link_click de windsor_raw.facebook_ads si existe (si todavía no está en la tarea de
--                                        Windsor, el dato queda en NULL y nada se rompe).
--   _windsor_normalizar_json             lee el campo `lc` de las filas que manda "Traer de Meta ahora" (db/027).
--   _windsor_aplicar                     (db/034) guarda clics_enlace en las tres tablas. Nada más cambia.
--   comunidad_performance_rango          devuelve además clics_enlace, ctr_enlace_pct, cpc_enlace, dias_sin_clics_enlace (los días del período
--                                        que todavía no traen el dato) y las impresiones / la inversión de los días que sí lo traen. El CTR y el
--                                        CPC del enlace usan solo esos días, para no dividir clics parciales por un gasto completo.
--   metricas_globales_cliente            devuelve además clics_enlace y las impresiones / la inversión de los días que lo traen.
--   desglose_campanas                    devuelve además clics_enlace.
--
-- Los días anteriores a que se agregue el campo en Windsor quedan en NULL ("Sin fuente" en el panel) hasta que se vuelvan a traer
-- ("Traer de Meta ahora" para el rango, o la próxima tarea diaria si Windsor reescribe esos días). Aplicar después de 035. Idempotente.

alter table crm_comunidades_v2.meta_ads_metrica        add column if not exists clics_enlace int;
alter table crm_comunidades_v2.meta_ads_metrica_global add column if not exists clics_enlace int;
alter table crm_comunidades_v2.ads_campana_dia         add column if not exists clics_enlace int;
comment on column crm_comunidades_v2.meta_ads_metrica.clics_enlace is
  'Clics en el enlace del anuncio (actions_link_click de Windsor). NULL = el día todavía no trae este dato; 0 es un dato real.';

-- ----------------------------------------------------------------------------
-- 1. Normalización de lo que llega de Windsor
-- ----------------------------------------------------------------------------
-- Misma normalización de db/018 (con el registro de entregas), más la columna actions_link_click si la tarea de Windsor ya la trae.
create or replace function crm_comunidades_v2._windsor_normalizar(p_tabla text)
returns void
language plpgsql
set search_path = crm_comunidades_v2, public
as $$
declare
  v_reg regclass := to_regclass(p_tabla);
  v_enlace text;
begin
  if v_reg is null then
    raise exception 'La tabla % no existe: ¿ya corrió la primera tarea de Windsor?', p_tabla;
  end if;
  perform crm_comunidades_v2._windsor_asegurar_registro(p_tabla);
  -- La columna existe recién cuando se agrega el campo a la tarea de Windsor; antes de eso el dato queda sin cargar (NULL), nunca en 0.
  if exists (select 1 from pg_attribute where attrelid = v_reg and attname = 'actions_link_click' and not attisdropped) then
    v_enlace := $e$round(nullif(t.actions_link_click::text, '')::numeric)::int$e$;
  else
    v_enlace := 'null::int';
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
           %s as clics_enlace,
           round(coalesce(nullif(t.actions_onsite_conversion_messaging_conversation_started_7d::text, ''), '0')::numeric)::int as conversaciones,
           round(coalesce(nullif(t.actions_onsite_conversion_lead_grouped::text, ''), '0')::numeric)::int as leads
      from %s t
     where t."date" is not null
  $f$, v_enlace, v_reg);
end;
$$;
revoke all on function crm_comunidades_v2._windsor_normalizar(text) from public, anon, authenticated;

-- Misma normalización de db/027, más el campo `lc` (link clicks). Una fila sin `lc` queda en NULL.
create or replace function crm_comunidades_v2._windsor_normalizar_json(p_filas jsonb)
returns void
language plpgsql
set search_path = crm_comunidades_v2, public
as $$
begin
  drop table if exists _windsor_norm;
  create temp table _windsor_norm on commit drop as
  select row_number() over () as rn,
         left(x.d, 10)::date as fecha,
         nullif(btrim(x.account_id), '') as cuenta_id,
         btrim(coalesce(x.campaign, '')) as campana,
         btrim(coalesce(x.adset_name, '')) as adset,
         coalesce(nullif(x.spend, ''), '0')::numeric as inversion,
         round(coalesce(nullif(x.impressions, ''), '0')::numeric)::int as impresiones,
         round(coalesce(nullif(x.clicks, ''), '0')::numeric)::int as clics,
         round(nullif(x.lc, '')::numeric)::int as clics_enlace,
         round(coalesce(nullif(x.conv, ''), '0')::numeric)::int as conversaciones,
         round(coalesce(nullif(x.leads, ''), '0')::numeric)::int as leads
    from jsonb_to_recordset(coalesce(p_filas, '[]'::jsonb))
         as x(d text, account_id text, campaign text, adset_name text, spend text, impressions text, clicks text, lc text, conv text, leads text)
   where x.d ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}';
end;
$$;
revoke all on function crm_comunidades_v2._windsor_normalizar_json(jsonb) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Asignación a comunidades: igual que db/034, guardando también clics_enlace
-- ----------------------------------------------------------------------------
create or replace function crm_comunidades_v2._windsor_aplicar(p_etiqueta text)
returns table (filas_origen int, filas_asignadas int, registros_escritos int, filas_sin_comunidad int, gasto_sin_comunidad numeric)
language plpgsql
set search_path = crm_comunidades_v2, public
as $$
declare
  v_origen int; v_asig int; v_escritos int; v_sin int; v_gasto numeric;
  v_excl int; v_gasto_excl numeric; v_borrados int := 0; v_globales int; v_n int;
begin
  -- Asignación con TODAS las reglas: la de conjunto gana sobre la de "toda la campaña". Después se separan las que cuentan de las que no.
  drop table if exists _windsor_asig_todas;
  create temp table _windsor_asig_todas on commit drop as
  select distinct on (n.rn)
         n.rn, n.fecha, n.inversion, n.impresiones, n.clics, n.clics_enlace, n.conversaciones, n.leads,
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

  -- sum() de clics_enlace da NULL si TODAS las filas del día vienen sin el dato: así "no llegó" no se confunde con 0.
  insert into crm_comunidades_v2.meta_ads_metrica
         (cliente_id, comunidad_id, fecha, inversion, conversaciones_meta, impresiones, clics, clics_enlace, leads_meta)
  select cliente_id, comunidad_id, fecha, round(sum(inversion), 2), sum(conversaciones), sum(impresiones), sum(clics), sum(clics_enlace), sum(leads)
    from _windsor_asig
   where comunidad_id is not null
   group by cliente_id, comunidad_id, fecha
  on conflict (comunidad_id, fecha) do update
     set inversion = excluded.inversion, conversaciones_meta = excluded.conversaciones_meta,
         impresiones = excluded.impresiones, clics = excluded.clics, clics_enlace = excluded.clics_enlace, leads_meta = excluded.leads_meta;
  get diagnostics v_escritos = row_count;

  -- Campañas globales del cliente (regla sin comunidad): el gasto queda a nivel cliente, no en ninguna comunidad.
  insert into crm_comunidades_v2.meta_ads_metrica_global (cliente_id, fecha, inversion, conversaciones_meta, impresiones, clics, clics_enlace, leads_meta)
  select cliente_id, fecha, round(sum(inversion), 2), sum(conversaciones), sum(impresiones), sum(clics), sum(clics_enlace), sum(leads)
    from _windsor_asig
   where comunidad_id is null
   group by cliente_id, fecha
  on conflict (cliente_id, fecha) do update
     set inversion = excluded.inversion, conversaciones_meta = excluded.conversaciones_meta,
         impresiones = excluded.impresiones, clics = excluded.clics, clics_enlace = excluded.clics_enlace, leads_meta = excluded.leads_meta;
  get diagnostics v_globales = row_count;
  v_escritos := v_escritos + v_globales;

  -- Detalle por campaña y conjunto de lo que cuenta (alimenta el desglose de Control_Comunidades). Mismos datos que meta_ads_metrica, con más granularidad.
  insert into crm_comunidades_v2.ads_campana_dia
         (medio, cliente_id, comunidad_id, fecha, campana, adset, inversion, conversaciones, impresiones, clics, clics_enlace, leads, actualizado_en)
  select 'Meta Ads', a.cliente_id, a.comunidad_id, a.fecha, n.campana, n.adset, round(sum(a.inversion), 2),
         sum(a.conversaciones), sum(a.impresiones), sum(a.clics), sum(a.clics_enlace), sum(a.leads), clock_timestamp()
    from _windsor_asig a join _windsor_norm n on n.rn = a.rn
   group by a.cliente_id, a.comunidad_id, a.fecha, n.campana, n.adset
  on conflict (medio, cliente_id, (coalesce(comunidad_id, '00000000-0000-0000-0000-000000000000'::uuid)), fecha, campana, adset) do update
     set inversion = excluded.inversion, conversaciones = excluded.conversaciones, impresiones = excluded.impresiones,
         clics = excluded.clics, clics_enlace = excluded.clics_enlace, leads = excluded.leads, actualizado_en = excluded.actualizado_en;

  select count(*) into v_origen from _windsor_norm;
  select count(*) into v_asig from _windsor_asig;

  -- Lo que ya estaba en la base para fechas que trae Windsor y que ninguna regla vigente respalda. Solo si alguna fila coincidió con ALGUNA regla (cuente o no):
  -- un mapeo vacío o roto no borra nada, pero un período donde todo el gasto es de campañas que no cuentan sí se limpia.
  if exists (select 1 from _windsor_asig_todas) then
    delete from crm_comunidades_v2.meta_ads_metrica m
     where m.comunidad_id in (select o.comunidad_id from crm_comunidades_v2.comunidad_meta_origen o join crm_comunidades_v2.cliente c on c.id = o.cliente_id and c.activo
                               where o.comunidad_id is not null)
       and m.fecha in (select distinct fecha from _windsor_norm)
       and not exists (select 1 from _windsor_asig a where a.comunidad_id = m.comunidad_id and a.fecha = m.fecha);
    get diagnostics v_borrados = row_count;
    delete from crm_comunidades_v2.meta_ads_metrica_global g
     where g.cliente_id in (select o.cliente_id from crm_comunidades_v2.comunidad_meta_origen o join crm_comunidades_v2.cliente c on c.id = o.cliente_id and c.activo)
       and g.fecha in (select distinct fecha from _windsor_norm)
       and not exists (select 1 from _windsor_asig a where a.comunidad_id is null and a.cliente_id = g.cliente_id and a.fecha = g.fecha);
    get diagnostics v_n = row_count;
    v_borrados := v_borrados + v_n;
    delete from crm_comunidades_v2.ads_campana_dia d
     where d.medio = 'Meta Ads'
       and d.cliente_id in (select o.cliente_id from crm_comunidades_v2.comunidad_meta_origen o join crm_comunidades_v2.cliente c on c.id = o.cliente_id and c.activo)
       and d.fecha in (select distinct fecha from _windsor_norm)
       and not exists (select 1 from _windsor_asig a join _windsor_norm n on n.rn = a.rn
                        where a.cliente_id = d.cliente_id and coalesce(a.comunidad_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(d.comunidad_id, '00000000-0000-0000-0000-000000000000'::uuid)
                          and a.fecha = d.fecha and n.campana = d.campana and n.adset = d.adset);
  end if;

  select count(*), coalesce(sum(n.inversion), 0) into v_sin, v_gasto
    from _windsor_norm n
   where exists (select 1 from crm_comunidades_v2.comunidad_meta_origen o
                  where crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(n.campana))
     and not exists (select 1 from _windsor_asig_todas a where a.rn = n.rn);

  insert into crm_comunidades_v2.windsor_sync_log
         (tabla, filas_origen, filas_asignadas, registros_escritos, filas_sin_comunidad, gasto_sin_comunidad, filas_excluidas, gasto_excluido, registros_borrados)
  values (p_etiqueta, v_origen, v_asig, v_escritos, v_sin, v_gasto, v_excl, round(v_gasto_excl, 2), v_borrados);

  return query select v_origen, v_asig, v_escritos, v_sin, round(v_gasto, 2);
end;
$$;
revoke all on function crm_comunidades_v2._windsor_aplicar(text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Lo que lee el panel
-- ----------------------------------------------------------------------------
-- Matriz de Control_Comunidades: las mismas columnas y cálculos de db/031, más las del enlace al final.
drop function if exists crm_comunidades_v2.comunidad_performance_rango(uuid, date, date, text);
create function crm_comunidades_v2.comunidad_performance_rango(
  p_cliente uuid,
  p_desde   date default null,
  p_hasta   date default null,
  p_canal   text default null
)
returns table (
  cliente_id           uuid,
  comunidad_id         uuid,
  nombre               text,
  miembros_iniciales   int,
  miembros_finales     int,
  inversion            numeric,
  conversaciones_meta  bigint,
  impresiones          bigint,
  clics                bigint,
  ctr_anuncio_pct      numeric,
  clics_unicos         bigint,
  cpl                  numeric,
  cpcu                 numeric,
  cpmn                 numeric,
  crecimiento_neto     int,
  bajas_estimadas      bigint,
  tasa_fuga_pct        numeric,
  triggers_entregados  bigint,
  leads_meta           bigint,
  costo_por_lead       numeric,
  clics_me_sumo        bigint,
  costo_por_clic_me_sumo numeric,
  clics_enlace         bigint,
  ctr_enlace_pct       numeric,
  cpc_enlace           numeric,
  dias_sin_clics_enlace int,
  impresiones_enlace   bigint,
  inversion_enlace     numeric
)
language sql stable security definer
set search_path = crm_comunidades_v2, public
as $$
  with acceso as (
    select crm_comunidades_v2.es_usuario_crm() as ok, crm_comunidades_v2.es_marketing() as mk
  ),
  m as (
    select comunidad_id,
           sum(inversion)           as inversion,
           sum(conversaciones_meta) as conversaciones_meta,
           sum(impresiones)         as impresiones,
           sum(clics)               as clics,
           sum(leads_meta)          as leads_meta,
           sum(clics_enlace)        as clics_enlace,
           -- CTR y CPC del enlace: solo con los días que traen el dato, para no dividir clics parciales por gasto completo.
           sum(impresiones) filter (where clics_enlace is not null) as impresiones_enlace,
           sum(inversion)   filter (where clics_enlace is not null) as inversion_enlace,
           (count(*) filter (where clics_enlace is null))::int      as dias_sin_enlace
      from crm_comunidades_v2.meta_ads_metrica
     where cliente_id = p_cliente
       and (p_desde is null or fecha >= p_desde)
       and (p_hasta is null or fecha <= p_hasta)
     group by comunidad_id
  ),
  u as (
    select comunidad_atribuida_id as comunidad_id, count(*) as clics_unicos
      from crm_comunidades_v2.evento_deduplicado
     where cliente_id = p_cliente
       and (p_canal is null or p_canal = 'todos'
            or (p_canal = 'instagram' and telefono_id like 'ig:%')
            or (p_canal = 'whatsapp' and telefono_id not like 'ig:%'))
       and (p_desde is null or (fecha_primer_contacto at time zone 'America/Argentina/Buenos_Aires')::date >= p_desde)
       and (p_hasta is null or (fecha_primer_contacto at time zone 'America/Argentina/Buenos_Aires')::date <= p_hasta)
     group by comunidad_atribuida_id
  ),
  k as (
    select comunidad_id, count(distinct telefono_id) as clics_me_sumo
      from crm_comunidades_v2.clic_me_sumo
     where cliente_id = p_cliente
       and (p_canal is null or p_canal = 'todos'
            or (p_canal = 'instagram' and telefono_id like 'ig:%')
            or (p_canal = 'whatsapp' and telefono_id not like 'ig:%'))
       and (p_desde is null or (recibido_en at time zone 'America/Argentina/Buenos_Aires')::date >= p_desde)
       and (p_hasta is null or (recibido_en at time zone 'America/Argentina/Buenos_Aires')::date <= p_hasta)
     group by comunidad_id
  ),
  t as (
    select comunidad_id, count(distinct telefono_id) as triggers_entregados
      from crm_comunidades_v2.trigger_entregado
     where cliente_id = p_cliente
       and (p_canal is null or p_canal = 'todos'
            or (p_canal = 'instagram' and telefono_id like 'ig:%')
            or (p_canal = 'whatsapp' and telefono_id not like 'ig:%'))
       and (p_desde is null or (recibido_en at time zone 'America/Argentina/Buenos_Aires')::date >= p_desde)
       and (p_hasta is null or (recibido_en at time zone 'America/Argentina/Buenos_Aires')::date <= p_hasta)
     group by comunidad_id
  )
  select
    c.cliente_id,
    c.id,
    c.nombre,
    c.miembros_iniciales,
    c.miembros_finales,
    case when a.mk then coalesce(m.inversion, 0) end,
    coalesce(m.conversaciones_meta, 0)::bigint,
    coalesce(m.impresiones, 0)::bigint,
    coalesce(m.clics, 0)::bigint,
    round(coalesce(m.clics, 0)::numeric / nullif(coalesce(m.impresiones, 0), 0) * 100, 2),
    coalesce(u.clics_unicos, 0)::bigint,
    case when a.mk then round(coalesce(m.inversion, 0) / nullif(coalesce(m.conversaciones_meta, 0), 0), 2) end,
    case when a.mk then round(coalesce(m.inversion, 0) / nullif(coalesce(u.clics_unicos, 0), 0), 2) end,
    case when a.mk then round(coalesce(m.inversion, 0) / nullif(c.miembros_finales - c.miembros_iniciales, 0), 2) end,
    (c.miembros_finales - c.miembros_iniciales),
    crm_comunidades_v2.bajas_reales_comunidad(c.id, p_desde, p_hasta),
    round(crm_comunidades_v2.bajas_reales_comunidad(c.id, p_desde, p_hasta)::numeric
          / nullif(crm_comunidades_v2.bajas_reales_comunidad(c.id, p_desde, p_hasta) + c.miembros_finales, 0) * 100, 2),
    coalesce(t.triggers_entregados, 0)::bigint,
    coalesce(m.leads_meta, 0)::bigint,
    case when a.mk then round(coalesce(m.inversion, 0) / nullif(coalesce(m.leads_meta, 0), 0), 2) end,
    coalesce(k.clics_me_sumo, 0)::bigint,
    case when a.mk then round(coalesce(m.inversion, 0) / nullif(coalesce(k.clics_me_sumo, 0), 0), 2) end,
    m.clics_enlace::bigint,
    round(m.clics_enlace::numeric / nullif(m.impresiones_enlace, 0) * 100, 2),
    case when a.mk then round(m.inversion_enlace / nullif(m.clics_enlace, 0), 2) end,
    coalesce(m.dias_sin_enlace, 0),
    m.impresiones_enlace::bigint,
    case when a.mk then m.inversion_enlace end
  from acceso a
  cross join crm_comunidades_v2.comunidad c
  left join m on m.comunidad_id = c.id
  left join u on u.comunidad_id = c.id
  left join t on t.comunidad_id = c.id
  left join k on k.comunidad_id = c.id
  where c.cliente_id = p_cliente
    and a.ok
  order by c.nombre;
$$;
revoke all on function crm_comunidades_v2.comunidad_performance_rango(uuid, date, date, text) from public, anon;
grant execute on function crm_comunidades_v2.comunidad_performance_rango(uuid, date, date, text) to authenticated, service_role;

-- Lo global de un cliente en un período (db/034), más los clics del enlace. Las impresiones y la inversión "con enlace" son las de los días que traen el dato.
drop function if exists crm_comunidades_v2.metricas_globales_cliente(uuid, date, date);
create function crm_comunidades_v2.metricas_globales_cliente(p_cliente uuid, p_desde date default null, p_hasta date default null)
returns table (inversion numeric, conversaciones_meta bigint, impresiones bigint, clics bigint, leads_meta bigint,
               clics_enlace bigint, impresiones_enlace bigint, inversion_enlace numeric)
language plpgsql
stable
security definer
set search_path = crm_comunidades_v2, public
as $f$
begin
  return query
  with a as (select crm_comunidades_v2.es_usuario_crm() as ok, crm_comunidades_v2.es_marketing() as mk)
  select case when a.mk then coalesce(sum(g.inversion), 0) end,
         coalesce(sum(g.conversaciones_meta), 0)::bigint, coalesce(sum(g.impresiones), 0)::bigint, coalesce(sum(g.clics), 0)::bigint, coalesce(sum(g.leads_meta), 0)::bigint,
         sum(g.clics_enlace)::bigint,
         (sum(g.impresiones) filter (where g.clics_enlace is not null))::bigint,
         case when a.mk then sum(g.inversion) filter (where g.clics_enlace is not null) end
    from a
    left join crm_comunidades_v2.meta_ads_metrica_global g
      on g.cliente_id = p_cliente and (p_desde is null or g.fecha >= p_desde) and (p_hasta is null or g.fecha <= p_hasta)
   where a.ok
   group by a.mk;
end;
$f$;
revoke all on function crm_comunidades_v2.metricas_globales_cliente(uuid, date, date) from public, anon;
grant execute on function crm_comunidades_v2.metricas_globales_cliente(uuid, date, date) to authenticated, service_role;
comment on function crm_comunidades_v2.metricas_globales_cliente(uuid, date, date) is
  'Gasto y resultados de las campañas globales de un cliente en un período. Solo conteos para el rol General; la inversión solo para Marketing.';

-- Desglose por campaña (db/034), más los clics del enlace al final. Solo Marketing.
drop function if exists crm_comunidades_v2.desglose_campanas(uuid, date, date, uuid);
create function crm_comunidades_v2.desglose_campanas(p_cliente uuid, p_desde date default null, p_hasta date default null, p_comunidad uuid default null)
returns table (medio text, campana text, adset text, comunidad_id uuid, comunidad_nombre text,
               inversion numeric, conversaciones bigint, impresiones bigint, clics bigint, leads bigint, dias int, clics_enlace bigint)
language sql
stable
set search_path = crm_comunidades_v2, public
as $f$
  select crm_comunidades_v2._exigir_marketing();
  select d.medio, d.campana, d.adset, d.comunidad_id, coalesce(co.nombre, 'Campañas globales (sin comunidad)'),
         round(sum(d.inversion), 2), sum(d.conversaciones)::bigint, sum(d.impresiones)::bigint, sum(d.clics)::bigint, sum(d.leads)::bigint,
         count(distinct d.fecha)::int, sum(d.clics_enlace)::bigint
    from crm_comunidades_v2.ads_campana_dia d
    left join crm_comunidades_v2.comunidad co on co.id = d.comunidad_id
   where d.cliente_id = p_cliente
     and (p_desde is null or d.fecha >= p_desde)
     and (p_hasta is null or d.fecha <= p_hasta)
     and (p_comunidad is null or d.comunidad_id = p_comunidad)
   group by d.medio, d.campana, d.adset, d.comunidad_id, co.nombre
   order by 6 desc, 1, 2, 3;
$f$;
revoke all on function crm_comunidades_v2.desglose_campanas(uuid, date, date, uuid) from public, anon;
grant execute on function crm_comunidades_v2.desglose_campanas(uuid, date, date, uuid) to authenticated, service_role;
