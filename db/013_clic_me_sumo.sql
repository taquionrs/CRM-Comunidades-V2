-- ============================================================================
-- CRM de Comunidades V2 — "Clics en Me sumo" (PR #21)
--
-- El botón "Me sumo" del flow es un botón de enlace. ManyChat permite conectar una salida propia del botón
-- que se activa SOLO cuando la persona lo toca. Esa salida manda un aviso al webhook con
-- "evento": "clic_me_sumo". Igual que el trigger (db/011), el aviso NO es un contacto: no entra a
-- evento_crudo ni toca clics únicos, atribución o Base_Limpia.
--
--   clic_me_sumo                  una fila por aviso (con duplicados). El panel cuenta personas distintas.
--   comunidad_performance_rango   devuelve además clics_me_sumo y costo_por_clic_me_sumo (inversión ÷ clics).
--
-- Lo escribe solo la Edge Function manychat-webhook (service_role). Aplicar después de 012. Idempotente.
-- ============================================================================
create table if not exists crm_comunidades_v2.clic_me_sumo (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null,
  comunidad_id  uuid not null,
  telefono_id   text not null,   -- dígitos (WhatsApp) o ig:<id> (Instagram), igual que evento_crudo
  recibido_en   timestamptz not null default now(),
  foreign key (comunidad_id, cliente_id)
    references crm_comunidades_v2.comunidad (id, cliente_id) on delete cascade
);

create index if not exists idx_clic_me_sumo_cliente_fecha
  on crm_comunidades_v2.clic_me_sumo (cliente_id, recibido_en);

alter table crm_comunidades_v2.clic_me_sumo enable row level security;

-- Igual que el resto de las tablas hoy (db/003): lectura abierta temporal. db/005 la restringe por cliente.
drop policy if exists lectura_abierta on crm_comunidades_v2.clic_me_sumo;
create policy lectura_abierta on crm_comunidades_v2.clic_me_sumo for select using (true);

grant select on crm_comunidades_v2.clic_me_sumo to anon, authenticated;
grant select, insert on crm_comunidades_v2.clic_me_sumo to service_role;

comment on table crm_comunidades_v2.clic_me_sumo is
  'Avisos "la persona tocó el botón Me sumo" que manda ManyChat desde la salida propia del botón. No son contactos: no entran a evento_crudo ni a la atribución.';

-- La función cambia de columnas: hay que borrarla y crearla de nuevo (misma lógica que 012 + clics_me_sumo y costo_por_clic_me_sumo).
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
    (c.miembros_iniciales + coalesce(u.clics_unicos, 0) - c.miembros_finales)::bigint,
    round(
      (c.miembros_iniciales + coalesce(u.clics_unicos, 0) - c.miembros_finales)::numeric
      / nullif(coalesce(u.clics_unicos, 0), 0) * 100, 2
    ),
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
  'Matriz de Control_Comunidades filtrable por fechas (006) + triggers_entregados (011) + leads_meta y costo_por_lead (012) + clics_me_sumo y costo_por_clic_me_sumo (013). security invoker: respeta la RLS de quien consulta.';

grant execute on function crm_comunidades_v2.comunidad_performance_rango(uuid, date, date)
  to anon, authenticated, service_role;
