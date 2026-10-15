-- 022 — Filtro de Canal en Control_Comunidades (Todos / Instagram / WhatsApp)
--
-- comunidad_performance_rango recibe un cuarto parámetro p_canal ('todos' o null, 'instagram', 'whatsapp'). El canal de cada persona se deduce del
-- identificador (db/008): "ig:<id>" es Instagram y solo dígitos es WhatsApp. El filtro se aplica a lo que viene del flow de ManyChat: entradas al
-- flow (clics_unicos), triggers entregados y clics en "Me sumo". Las columnas de Meta, de miembros y las financieras NO se dividen por canal:
-- la función las devuelve iguales y el panel las marca como "No se divide por canal".
-- Un valor de p_canal que no sea ninguno de los tres devuelve todo en cero (no cae en "todos").
-- La función cambia de firma: se borra la anterior (uuid, date, date) y se crea la nueva. Las columnas devueltas no cambian.

drop function if exists crm_comunidades_v2.comunidad_performance_rango(uuid, date, date);

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

comment on function crm_comunidades_v2.comunidad_performance_rango(uuid, date, date, text) is
  'Matriz de Control_Comunidades filtrable por fechas y canal (022). El canal divide solo las entradas, triggers y clics en Me sumo del flow de ManyChat; lo demás no se divide.';
grant execute on function crm_comunidades_v2.comunidad_performance_rango(uuid, date, date, text) to anon, authenticated, service_role;
