-- 021 — Bajas reales (en lugar de estimadas) y tasa de fuga
--
-- Antes: bajas_estimadas = Mi + entradas al flow − Mf. Esa cuenta supone que TODOS los miembros del grupo pasaron por el flow, así que con grupos
-- que tienen gente de otras fuentes daba negativo (por ejemplo −9 con 11 miembros y 2 entradas).
-- Ahora: las bajas son las personas que quedaron como salidas al cargar la lista completa del grupo (db/019 y db/020).
--   - "Se puede calcular" recién desde la SEGUNDA carga de lista completa de la comunidad. Antes de eso devuelve NULL (el panel dice "No calculable").
--   - bajas_estimadas (el nombre de la columna no cambia) = salidas con fecha de salida dentro del período pedido.
--   - tasa_fuga_pct = bajas ÷ (bajas + miembros finales) × 100: de todas las personas que estuvieron en el grupo, cuántas se fueron.
-- Se cambian: la función comunidad_performance_rango (Control_Comunidades) y las vistas comunidad_performance y kpis_macro (Overview).
-- Las columnas y sus tipos no cambian. Solo se leen conteos (nunca teléfonos): la función auxiliar es security definer.

create or replace function crm_comunidades_v2.bajas_reales_comunidad(p_comunidad uuid, p_desde date default null, p_hasta date default null)
returns bigint
language sql
stable
security definer
set search_path = crm_comunidades_v2, public
as $f$
  select case
    when (select count(*) from crm_comunidades_v2.carga_miembros m where m.comunidad_id = p_comunidad and m.lista_completa) >= 2
    then (select count(*) from crm_comunidades_v2.miembro_comunidad mc
           where mc.comunidad_id = p_comunidad and mc.salio_en is not null
             and (p_desde is null or mc.salio_en >= p_desde) and (p_hasta is null or mc.salio_en <= p_hasta))
  end;
$f$;
revoke all on function crm_comunidades_v2.bajas_reales_comunidad(uuid, date, date) from public;
grant execute on function crm_comunidades_v2.bajas_reales_comunidad(uuid, date, date) to anon, authenticated, service_role;
comment on function crm_comunidades_v2.bajas_reales_comunidad(uuid, date, date) is
  'Cantidad de salidas registradas al cargar la lista completa del grupo. NULL hasta la segunda carga de lista completa. Solo devuelve un número.';


-- Vista de Overview: mismas columnas y tipos que en db/004, con bajas y fuga reales.
create or replace view crm_comunidades_v2.comunidad_performance as
select
  c.cliente_id,
  c.id as comunidad_id,
  c.nombre,
  c.miembros_iniciales,
  c.miembros_finales,
  coalesce(m.inversion, 0) as inversion,
  coalesce(m.conversaciones_meta, 0) as conversaciones_meta,
  coalesce(m.impresiones, 0) as impresiones,
  coalesce(u.clics_unicos, 0) as clics_unicos,
  round(coalesce(m.inversion, 0) / nullif(coalesce(m.conversaciones_meta, 0), 0), 2) as cpl,
  round(coalesce(m.inversion, 0) / nullif(coalesce(u.clics_unicos, 0), 0), 2) as cpcu,
  round(coalesce(m.inversion, 0) / nullif(c.miembros_finales - c.miembros_iniciales, 0), 2) as cpmn,
  (c.miembros_finales - c.miembros_iniciales) as crecimiento_neto,
  crm_comunidades_v2.bajas_reales_comunidad(c.id, null, null) as bajas_estimadas,
  round(crm_comunidades_v2.bajas_reales_comunidad(c.id, null, null)::numeric
        / nullif(crm_comunidades_v2.bajas_reales_comunidad(c.id, null, null) + c.miembros_finales, 0) * 100, 2) as tasa_fuga_pct
from crm_comunidades_v2.comunidad c
left join (
  select comunidad_id, sum(inversion) as inversion, sum(conversaciones_meta) as conversaciones_meta, sum(impresiones) as impresiones
  from crm_comunidades_v2.meta_ads_metrica
  group by comunidad_id
) m on m.comunidad_id = c.id
left join (
  select comunidad_atribuida_id, count(*) as clics_unicos
  from crm_comunidades_v2.evento_deduplicado
  group by comunidad_atribuida_id
) u on u.comunidad_atribuida_id = c.id;

-- KPIs de Overview: la fuga global usa solo las comunidades donde las bajas se pueden calcular (NULL si ninguna).
create or replace view crm_comunidades_v2.kpis_macro as
select
  cliente_id,
  coalesce(sum(inversion), 0) as inversion_total,
  coalesce(sum(conversaciones_meta), 0) as conversaciones_totales,
  round(coalesce(sum(inversion), 0) / nullif(coalesce(sum(conversaciones_meta), 0), 0), 2) as cpl_global,
  coalesce(sum(clics_unicos), 0) as clics_unicos_totales,
  coalesce(sum(miembros_finales), 0) as miembros_efectivos_totales,
  round(coalesce(sum(inversion), 0) / nullif(sum(miembros_finales) - sum(miembros_iniciales), 0), 2) as cpme_global,
  round(
    sum(bajas_estimadas)::numeric
    / nullif(sum(bajas_estimadas) + sum(miembros_finales) filter (where bajas_estimadas is not null), 0) * 100, 2
  ) as tasa_fuga_global_pct
from crm_comunidades_v2.comunidad_performance
group by cliente_id;

-- Función de Control_Comunidades: misma firma y columnas que en db/013, con bajas y fuga reales.
create or replace function crm_comunidades_v2.comunidad_performance_rango(
  p_cliente uuid,
  p_desde   date default null,
  p_hasta   date default null
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
  costo_por_clic_me_sumo numeric
)
language sql stable
set search_path = crm_comunidades_v2, public
as $$
  with m as (
    select comunidad_id,
           sum(inversion)           as inversion,
           sum(conversaciones_meta) as conversaciones_meta,
           sum(impresiones)         as impresiones,
           sum(clics)               as clics,
           sum(leads_meta)          as leads_meta
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
       and (p_desde is null or (fecha_primer_contacto at time zone 'America/Argentina/Buenos_Aires')::date >= p_desde)
       and (p_hasta is null or (fecha_primer_contacto at time zone 'America/Argentina/Buenos_Aires')::date <= p_hasta)
     group by comunidad_atribuida_id
  ),
  k as (
    select comunidad_id, count(distinct telefono_id) as clics_me_sumo
      from crm_comunidades_v2.clic_me_sumo
     where cliente_id = p_cliente
       and (p_desde is null or (recibido_en at time zone 'America/Argentina/Buenos_Aires')::date >= p_desde)
       and (p_hasta is null or (recibido_en at time zone 'America/Argentina/Buenos_Aires')::date <= p_hasta)
     group by comunidad_id
  ),
  t as (
    select comunidad_id, count(distinct telefono_id) as triggers_entregados
      from crm_comunidades_v2.trigger_entregado
     where cliente_id = p_cliente
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
    coalesce(m.inversion, 0),
    coalesce(m.conversaciones_meta, 0)::bigint,
    coalesce(m.impresiones, 0)::bigint,
    coalesce(m.clics, 0)::bigint,
    round(coalesce(m.clics, 0)::numeric / nullif(coalesce(m.impresiones, 0), 0) * 100, 2),
    coalesce(u.clics_unicos, 0)::bigint,
    round(coalesce(m.inversion, 0) / nullif(coalesce(m.conversaciones_meta, 0), 0), 2),
    round(coalesce(m.inversion, 0) / nullif(coalesce(u.clics_unicos, 0), 0), 2),
    round(coalesce(m.inversion, 0) / nullif(c.miembros_finales - c.miembros_iniciales, 0), 2),
    (c.miembros_finales - c.miembros_iniciales),
    crm_comunidades_v2.bajas_reales_comunidad(c.id, p_desde, p_hasta),
    round(crm_comunidades_v2.bajas_reales_comunidad(c.id, p_desde, p_hasta)::numeric
          / nullif(crm_comunidades_v2.bajas_reales_comunidad(c.id, p_desde, p_hasta) + c.miembros_finales, 0) * 100, 2),
    coalesce(t.triggers_entregados, 0)::bigint,
    coalesce(m.leads_meta, 0)::bigint,
    round(coalesce(m.inversion, 0) / nullif(coalesce(m.leads_meta, 0), 0), 2),
    coalesce(k.clics_me_sumo, 0)::bigint,
    round(coalesce(m.inversion, 0) / nullif(coalesce(k.clics_me_sumo, 0), 0), 2)
  from crm_comunidades_v2.comunidad c
  left join m on m.comunidad_id = c.id
  left join u on u.comunidad_id = c.id
  left join t on t.comunidad_id = c.id
  left join k on k.comunidad_id = c.id
  where c.cliente_id = p_cliente
  order by c.nombre;
$$;

comment on function crm_comunidades_v2.comunidad_performance_rango(uuid, date, date) is
  'Matriz de Control_Comunidades filtrable por fechas. Desde 021 las bajas son las salidas registradas al cargar la lista completa del grupo (NULL hasta la segunda carga) y la fuga es bajas ÷ (bajas + miembros finales).';
grant execute on function crm_comunidades_v2.comunidad_performance_rango(uuid, date, date) to anon, authenticated, service_role;
