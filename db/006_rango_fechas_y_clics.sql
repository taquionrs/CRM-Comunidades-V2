-- ============================================================================
-- CRM de Comunidades V2 — filtro por rango de fechas, clics de anuncio y
-- formato de teléfono
-- Ref: specs/2026-09-29-estado-hacia-spec-final.md, hallazgos 3.5, 3.6 y 3.9.
--
--   1. meta_ads_metrica.clics: los clics de anuncio que trae Windsor.ai. Con
--      impresiones alcanza para calcular el CTR de anuncio (antes figuraba
--      "sin fuente").
--   2. comunidad_performance_rango(cliente, desde, hasta): la misma matriz de
--      comunidad_performance pero filtrable por fechas, como pide Jaz en
--      Control_Comunidades. Las métricas de Meta se suman por día
--      (meta_ads_metrica.fecha) y los clics únicos se cuentan por la fecha del
--      primer contacto. Mi/Mf son snapshots sin fecha: se devuelven tal cual (ver
--      decisión 6 del spec).
--   3. Formato de teléfono: solo dígitos, mínimo 8. El webhook ya normaliza; esta
--      restricción impide que entre "+549…" y "549…" como dos personas distintas.
--      Se agrega NOT VALID: no revisa filas viejas, pero sí toda fila nueva.
--
-- Aplicar después de 004_cliente.sql. Idempotente.
-- ============================================================================
set search_path = crm_comunidades_v2, public;

-- ----------------------------------------------------------------------------
-- 1. clics de anuncio
-- ----------------------------------------------------------------------------
alter table crm_comunidades_v2.meta_ads_metrica
  add column if not exists clics int not null default 0;

comment on column crm_comunidades_v2.meta_ads_metrica.clics is
  'Clics del anuncio (Windsor.ai, campo clicks). CTR de anuncio = clics / impresiones.';
comment on column crm_comunidades_v2.meta_ads_metrica.ctr_anuncio is
  'Sin uso: el CTR se calcula al consultar (clics / impresiones × 100) en comunidad_performance_rango.';

-- ----------------------------------------------------------------------------
-- 2. matriz por comunidad con filtro de fechas
-- p_desde / p_hasta nulos = todo el histórico. Las fechas se interpretan en
-- hora de Buenos Aires, la misma zona de las cuentas de ManyChat.
-- ----------------------------------------------------------------------------
create or replace function crm_comunidades_v2.comunidad_performance_rango(
  p_cliente uuid,
  p_desde   date default null,
  p_hasta   date default null
)
returns table (
  cliente_id          uuid,
  comunidad_id        uuid,
  nombre              text,
  miembros_iniciales  int,
  miembros_finales    int,
  inversion           numeric,
  conversaciones_meta bigint,
  impresiones         bigint,
  clics               bigint,
  ctr_anuncio_pct     numeric,
  clics_unicos        bigint,
  cpl                 numeric,
  cpcu                numeric,
  cpmn                numeric,
  crecimiento_neto    int,
  bajas_estimadas     bigint,
  tasa_fuga_pct       numeric
)
language sql stable
set search_path = crm_comunidades_v2, public
as $$
  with m as (
    select comunidad_id,
           sum(inversion)           as inversion,
           sum(conversaciones_meta) as conversaciones_meta,
           sum(impresiones)         as impresiones,
           sum(clics)               as clics
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
    )
  from crm_comunidades_v2.comunidad c
  left join m on m.comunidad_id = c.id
  left join u on u.comunidad_id = c.id
  where c.cliente_id = p_cliente
  order by c.nombre;
$$;

comment on function crm_comunidades_v2.comunidad_performance_rango(uuid, date, date) is
  'Matriz de Control_Comunidades filtrable por fechas. security invoker: respeta la RLS de quien consulta.';

grant execute on function crm_comunidades_v2.comunidad_performance_rango(uuid, date, date)
  to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. formato de teléfono
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'evento_crudo_telefono_digitos') then
    alter table crm_comunidades_v2.evento_crudo
      add constraint evento_crudo_telefono_digitos check (telefono_id ~ '^[0-9]{8,}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'usuario_curado_telefono_digitos') then
    alter table crm_comunidades_v2.usuario_curado
      add constraint usuario_curado_telefono_digitos check (telefono_id ~ '^[0-9]{8,}$') not valid;
  end if;
end $$;
