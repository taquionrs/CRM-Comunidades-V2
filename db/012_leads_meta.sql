-- ============================================================================
-- CRM de Comunidades V2 — "Clientes potenciales (Meta)" por comunidad (PR #19)
--
-- Ads Manager muestra, en las campañas de objetivo "clientes potenciales", la columna "Resultados" =
-- "Cliente potencial de Meta". Es DISTINTA de las conversaciones de mensajes iniciadas (que ya importamos).
-- Verificado el 2026-10-08 contra el CSV de Windsor del 6 al 7 de octubre: el campo
-- actions_onsite_conversion_lead_grouped suma 158 en Todo un País y 0 en Cortado WhatsApp, igual que Ads Manager.
--
--   meta_ads_metrica.leads_meta   clientes potenciales de Meta por comunidad y día.
--   comunidad_performance_rango   devuelve además leads_meta y costo_por_lead (inversión ÷ leads_meta).
--
-- Aplicar después de 011. Idempotente.
-- ============================================================================
alter table crm_comunidades_v2.meta_ads_metrica add column if not exists leads_meta int not null default 0;
comment on column crm_comunidades_v2.meta_ads_metrica.leads_meta is
  'Clientes potenciales de Meta (Windsor: actions_onsite_conversion_lead_grouped). No es lo mismo que conversaciones_meta.';

-- La función cambia de columnas: hay que borrarla y crearla de nuevo (misma lógica que 011 + leads_meta y costo_por_lead).
drop function if exists crm_comunidades_v2.comunidad_performance_rango(uuid, date, date);

create function crm_comunidades_v2.comunidad_performance_rango(
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
  costo_por_lead       numeric
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
    (c.miembros_iniciales + coalesce(u.clics_unicos, 0) - c.miembros_finales)::bigint,
    round(
      (c.miembros_iniciales + coalesce(u.clics_unicos, 0) - c.miembros_finales)::numeric
      / nullif(coalesce(u.clics_unicos, 0), 0) * 100, 2
    ),
    coalesce(t.triggers_entregados, 0)::bigint,
    coalesce(m.leads_meta, 0)::bigint,
    round(coalesce(m.inversion, 0) / nullif(coalesce(m.leads_meta, 0), 0), 2)
  from crm_comunidades_v2.comunidad c
  left join m on m.comunidad_id = c.id
  left join u on u.comunidad_id = c.id
  left join t on t.comunidad_id = c.id
  where c.cliente_id = p_cliente
  order by c.nombre;
$$;

comment on function crm_comunidades_v2.comunidad_performance_rango(uuid, date, date) is
  'Matriz de Control_Comunidades filtrable por fechas (006) + triggers_entregados (011) + leads_meta y costo_por_lead (012). security invoker: respeta la RLS de quien consulta.';

grant execute on function crm_comunidades_v2.comunidad_performance_rango(uuid, date, date)
  to anon, authenticated, service_role;
