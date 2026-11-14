-- ============================================================================
-- CRM de Comunidades V2 — Rendimiento por anuncio (PR #72, etapa 3 de specs/2026-11-13-centro-de-rendimiento-por-anuncio.md)
--
-- Une los dos lados que ya existen: lo que Meta informa por anuncio (meta_ads_anuncio_metrica, db/040) y lo que el CRM registra por
-- código de anuncio (evento_crudo.anuncio_codigo e ingreso_sin_clasificar.anuncio_codigo, db/039). Alimenta el bloque "Rendimiento"
-- al final de Control_Comunidades.
--
--   rendimiento_por_anuncio(cliente, desde, hasta, comunidad)
--       Una fila por anuncio de Meta con datos en el período (y por cada código del catálogo, aunque Meta no tenga datos):
--         · gasto, impresiones, clics en el enlace, conversaciones (Meta)
--         · entradas y sin clasificar (CRM, por código). Un anuncio SIN código en el catálogo muestra null: "todavía no se puede
--           atribuir" no es lo mismo que 0.
--       Más, por comunidad, una fila "sin código": las entradas de personas cuyo primer contacto no traía código. Así la suma
--       de las entradas de una zona coincide con la columna "Entradas únicas" de Control_Comunidades (mismo criterio de primer contacto).
--   El anuncio de Meta se vincula con el catálogo por nombre normalizado (anuncio_codigo.anuncio_nombre = ad_name).
--   Es plata: solo Marketing (como meta_ads_metrica, db/031).
--
-- También corrige los nombres del catálogo de Palermo: en Meta los anuncios se llaman TQN_..._WHATSAPP_PALERMO_01, no PALERMO_01
-- (en producción ya estaba corregido a mano el 13/11; acá queda para las bases nuevas). Idempotente.
--
-- Aplicar después de 040. Idempotente.
-- ============================================================================
set search_path = crm_comunidades_v2, public;

update crm_comunidades_v2.anuncio_codigo
   set anuncio_nombre = campana_nombre || '_' || anuncio_nombre
 where campana_nombre is not null and anuncio_nombre ~ '^PALERMO_0[0-9]$';

create or replace function crm_comunidades_v2.rendimiento_por_anuncio(
  p_cliente   uuid,
  p_desde     date default null,
  p_hasta     date default null,
  p_comunidad uuid default null
)
returns table (comunidad_id uuid, comunidad text, codigo text, ad_nombre text, campana_nombre text, instrumentado boolean,
               dias integer, ultimo_dia date, inversion numeric, impresiones bigint, clics_enlace bigint, impresiones_enlace bigint,
               conversaciones bigint, entradas bigint, sin_clasificar bigint)
language sql
stable
security definer
set search_path = crm_comunidades_v2, public
as $f$
  with acceso as (
    select (nullif(current_setting('request.jwt.claims', true), '') is null
            or auth.role() = 'service_role'
            or crm_comunidades_v2.es_marketing()) as ok
  ),
  meta as (
    select m.comunidad_id, m.ad_id,
           max(m.ad_nombre) as ad_nombre, max(m.campana_nombre) as campana,
           count(distinct m.fecha)::int as dias, max(m.fecha) as ultimo,
           sum(m.inversion) as inv, sum(m.impresiones) as imp,
           case when count(m.clics_enlace) = 0 then null else sum(m.clics_enlace) end as lc,
           coalesce(sum(m.impresiones) filter (where m.clics_enlace is not null), 0) as imp_lc,
           sum(m.conversaciones_meta) as conv
      from crm_comunidades_v2.meta_ads_anuncio_metrica m
     where m.cliente_id = p_cliente
       and (p_desde is null or m.fecha >= p_desde)
       and (p_hasta is null or m.fecha <= p_hasta)
       and (p_comunidad is null or m.comunidad_id = p_comunidad)
     group by m.comunidad_id, m.ad_id
  ),
  cat as (
    select a.comunidad_id, a.codigo, a.anuncio_nombre, a.campana_nombre
      from crm_comunidades_v2.anuncio_codigo a
     where a.cliente_id = p_cliente and (p_comunidad is null or a.comunidad_id = p_comunidad)
  ),
  primeros as (
    select distinct on (e.telefono_id) e.telefono_id, e.comunidad_id, e.anuncio_codigo, e.recibido_en
      from crm_comunidades_v2.evento_crudo e
     where e.cliente_id = p_cliente
     order by e.telefono_id, e.recibido_en asc
  ),
  ent as (
    select p.comunidad_id, p.anuncio_codigo as codigo, count(*) as n
      from primeros p
     where (p_comunidad is null or p.comunidad_id = p_comunidad)
       and (p_desde is null or (p.recibido_en at time zone 'America/Argentina/Buenos_Aires')::date >= p_desde)
       and (p_hasta is null or (p.recibido_en at time zone 'America/Argentina/Buenos_Aires')::date <= p_hasta)
     group by p.comunidad_id, p.anuncio_codigo
  ),
  sin as (
    select s.anuncio_codigo as codigo, count(distinct s.telefono_id) as n
      from crm_comunidades_v2.ingreso_sin_clasificar s
     where s.cliente_id = p_cliente and s.anuncio_codigo is not null
       and (p_desde is null or (s.recibido_en at time zone 'America/Argentina/Buenos_Aires')::date >= p_desde)
       and (p_hasta is null or (s.recibido_en at time zone 'America/Argentina/Buenos_Aires')::date <= p_hasta)
       and not exists (select 1 from crm_comunidades_v2.evento_crudo e
                        where e.cliente_id = s.cliente_id and e.telefono_id = s.telefono_id)
     group by s.anuncio_codigo
  ),
  anuncios as (
    select coalesce(m.comunidad_id, c.comunidad_id) as comunidad_id, c.codigo,
           coalesce(m.ad_nombre, c.anuncio_nombre) as ad_nombre, coalesce(m.campana, c.campana_nombre) as campana,
           m.dias, m.ultimo, m.inv, m.imp, m.lc, m.imp_lc, m.conv
      from meta m
      full join cat c
        on c.comunidad_id = m.comunidad_id
       and crm_comunidades_v2.normalizar_nombre(c.anuncio_nombre) = crm_comunidades_v2.normalizar_nombre(m.ad_nombre)
  )
  select a.comunidad_id, co.nombre, a.codigo, a.ad_nombre, a.campana, (a.codigo is not null),
         coalesce(a.dias, 0), a.ultimo, round(coalesce(a.inv, 0), 2), coalesce(a.imp, 0)::bigint, a.lc::bigint, a.imp_lc::bigint,
         coalesce(a.conv, 0)::bigint,
         (case when a.codigo is null then null else coalesce(ent.n, 0) end)::bigint,
         (case when a.codigo is null then null else coalesce(sin.n, 0) end)::bigint
    from acceso ac
    join anuncios a on ac.ok
    join crm_comunidades_v2.comunidad co on co.id = a.comunidad_id and co.cliente_id = p_cliente
    left join ent on a.codigo is not null and ent.comunidad_id = a.comunidad_id and ent.codigo = a.codigo
    left join sin on a.codigo is not null and sin.codigo = a.codigo
  union all
  -- Por comunidad: entradas de personas cuyo primer contacto no traía código de anuncio.
  select ent.comunidad_id, co.nombre, null::text, null::text, null::text, false,
         0, null::date, 0::numeric, 0::bigint, null::bigint, null::bigint, 0::bigint, ent.n::bigint, 0::bigint
    from acceso ac
    join ent on ac.ok and ent.codigo is null
    join crm_comunidades_v2.comunidad co on co.id = ent.comunidad_id and co.cliente_id = p_cliente
   order by 2, 3 nulls last, 4 nulls last;
$f$;

revoke all on function crm_comunidades_v2.rendimiento_por_anuncio(uuid, date, date, uuid) from public, anon;
grant execute on function crm_comunidades_v2.rendimiento_por_anuncio(uuid, date, date, uuid) to authenticated, service_role;
comment on function crm_comunidades_v2.rendimiento_por_anuncio(uuid, date, date, uuid) is
  'Rendimiento por anuncio: lo que informa Meta (gasto, clics en el enlace, conversaciones) y lo que registra el CRM por código de anuncio (entradas, sin clasificar), más las entradas sin código por comunidad. Solo Marketing.';
