-- ============================================================================
-- CRM de Comunidades V2 — Métricas de Meta por ANUNCIO (PR #71, etapa 2 de specs/2026-11-13-centro-de-rendimiento-por-anuncio.md)
--
-- Hasta hoy Windsor llegaba por conjunto de anuncios y meta_ads_metrica guarda un registro por comunidad y día. Para ver
-- el rendimiento de cada anuncio hace falta el mismo dato un nivel más abajo. Esta migración agrega:
--
--   meta_ads_anuncio_metrica        un registro por día y anuncio (ad_id): gasto, impresiones, clics, clics en el enlace y
--                                   conversaciones iniciadas. NO reemplaza ni toca meta_ads_metrica.
--   meta_anuncios_aplicar(filas…)   la usa solo la Edge Function meta-anuncios (service_role). Asigna cada fila a una
--                                   comunidad con LAS MISMAS reglas de siempre (comunidad_meta_origen: campaña + conjunto,
--                                   cuenta publicitaria, campañas que no cuentan) y reemplaza los días del rango.
--   meta_anuncios_cuadre(…)         compara, por comunidad, la suma de los anuncios contra meta_ads_metrica: tienen que dar
--                                   lo mismo (es la prueba de que no se perdió ni se duplicó nada).
--
-- Reglas de seguridad de los datos:
--   * Un anuncio sin ad_id no se puede guardar (no hay cómo identificarlo): se cuenta y se informa, nunca se inventa.
--   * Si ninguna fila se asigna a una comunidad, no se borra nada (un mapeo vacío o una caída de Windsor no vacía la tabla).
--   * Los días del rango se reemplazan por completo para los clientes que sí llegaron: un anuncio que Meta ya no devuelve
--     deja de figurar, igual que en meta_ads_metrica (db/027).
--   * El gasto es plata: solo lo lee Marketing (como meta_ads_metrica, db/031). Escribe solo el servidor.
--
-- Aplicar después de 039. Idempotente.
-- ============================================================================
set search_path = crm_comunidades_v2, public;

create table if not exists crm_comunidades_v2.meta_ads_anuncio_metrica (
  cliente_id           uuid not null,
  comunidad_id         uuid not null,
  fecha                date not null,
  ad_id                text not null check (btrim(ad_id) <> ''),
  ad_nombre            text not null default '',
  campana_nombre       text not null default '',
  adset_nombre         text not null default '',
  inversion            numeric(14,2) not null default 0 check (inversion >= 0),
  impresiones          integer not null default 0 check (impresiones >= 0),
  clics                integer not null default 0 check (clics >= 0),
  clics_enlace         integer check (clics_enlace is null or clics_enlace >= 0),   -- null = el dato no llegó (no es 0)
  conversaciones_meta  integer not null default 0 check (conversaciones_meta >= 0),
  actualizado_en       timestamptz not null default now(),
  primary key (cliente_id, fecha, ad_id),
  foreign key (comunidad_id, cliente_id)
    references crm_comunidades_v2.comunidad (id, cliente_id) on delete cascade
);

create index if not exists idx_meta_ads_anuncio_comunidad_fecha
  on crm_comunidades_v2.meta_ads_anuncio_metrica (comunidad_id, fecha);
create index if not exists idx_meta_ads_anuncio_nombre
  on crm_comunidades_v2.meta_ads_anuncio_metrica (cliente_id, crm_comunidades_v2.normalizar_nombre(ad_nombre));

alter table crm_comunidades_v2.meta_ads_anuncio_metrica enable row level security;

drop policy if exists marketing_select on crm_comunidades_v2.meta_ads_anuncio_metrica;
create policy marketing_select on crm_comunidades_v2.meta_ads_anuncio_metrica for select to authenticated
  using ((select crm_comunidades_v2.es_marketing()));

revoke all on crm_comunidades_v2.meta_ads_anuncio_metrica from anon, authenticated;
grant select on crm_comunidades_v2.meta_ads_anuncio_metrica to authenticated;
grant select, insert, update, delete on crm_comunidades_v2.meta_ads_anuncio_metrica to service_role;

comment on table crm_comunidades_v2.meta_ads_anuncio_metrica is
  'Métricas de Meta (Windsor) por día y anuncio. El detalle por anuncio de meta_ads_metrica; la suma de los anuncios de una comunidad y un día tiene que dar lo mismo (meta_anuncios_cuadre).';

-- Filas de Windsor (JSON) → métricas por anuncio. Las filas tienen: d, account_id, campaign, adset_name, ad_id, ad_name,
-- spend, impressions, clicks, lc (clics en el enlace, "" si no llegó), conv.
create or replace function crm_comunidades_v2.meta_anuncios_aplicar(p_filas jsonb, p_desde date, p_hasta date)
returns table (filas_origen int, filas_asignadas int, registros_escritos int, filas_sin_comunidad int,
               gasto_sin_comunidad numeric, filas_sin_anuncio int)
language plpgsql
security definer
set search_path = crm_comunidades_v2, public
as $$
declare
  v_origen int; v_asig int; v_escritos int := 0; v_sin int; v_gasto numeric; v_sin_ad int; v_excl int; v_gasto_excl numeric;
begin
  if p_desde is null or p_hasta is null or p_desde > p_hasta then raise exception 'El rango de fechas no es válido'; end if;
  if p_hasta - p_desde > 30 then raise exception 'El rango máximo es de 31 días'; end if;
  if p_hasta > current_date then raise exception 'No se pueden pedir fechas futuras'; end if;
  if jsonb_typeof(p_filas) is distinct from 'array' then raise exception 'Las filas de Windsor tienen que ser una lista'; end if;
  if jsonb_array_length(p_filas) > 100000 then raise exception 'Demasiadas filas (máximo 100.000)'; end if;
  if exists (select 1 from crm_comunidades_v2.windsor_sync_log l
              where l.tabla like 'windsor_raw.anuncios%' and l.corrida_en > clock_timestamp() - interval '45 seconds') then
    raise exception 'Esperá un momento: ya se consultó Windsor hace instantes';
  end if;

  drop table if exists _anu_norm;
  create temp table _anu_norm on commit drop as
  select row_number() over () as rn,
         left(x.d, 10)::date as fecha,
         nullif(btrim(x.account_id), '') as cuenta_id,
         btrim(coalesce(x.campaign, '')) as campana,
         btrim(coalesce(x.adset_name, '')) as adset,
         nullif(btrim(coalesce(x.ad_id, '')), '') as ad_id,
         btrim(coalesce(x.ad_name, '')) as ad_nombre,
         coalesce(nullif(x.spend, ''), '0')::numeric as inversion,
         round(coalesce(nullif(x.impressions, ''), '0')::numeric)::int as impresiones,
         round(coalesce(nullif(x.clicks, ''), '0')::numeric)::int as clics,
         case when nullif(x.lc, '') is null then null else round(x.lc::numeric)::int end as clics_enlace,
         round(coalesce(nullif(x.conv, ''), '0')::numeric)::int as conversaciones
    from jsonb_to_recordset(p_filas)
         as x(d text, account_id text, campaign text, adset_name text, ad_id text, ad_name text,
              spend text, impressions text, clicks text, lc text, conv text)
   where x.d ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}';
  delete from _anu_norm n where n.fecha < p_desde or n.fecha > p_hasta;   -- nada fuera del rango pedido

  -- Asignación con TODAS las reglas (la de conjunto gana sobre la de "toda la campaña"), igual que _windsor_aplicar (db/027).
  drop table if exists _anu_asig_todas;
  create temp table _anu_asig_todas on commit drop as
  select distinct on (n.rn)
         n.*, o.cliente_id, o.comunidad_id, o.cuenta
    from _anu_norm n
    join crm_comunidades_v2.comunidad_meta_origen o
      on crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(n.campana)
     and (o.adset_nombre is null
          or crm_comunidades_v2.normalizar_nombre(o.adset_nombre) = crm_comunidades_v2.normalizar_nombre(n.adset))
    join crm_comunidades_v2.cliente c on c.id = o.cliente_id and c.activo
   where c.meta_cuenta_id is null or n.cuenta_id is null or c.meta_cuenta_id = n.cuenta_id
   order by n.rn, (o.adset_nombre is null);

  select count(*), coalesce(sum(inversion), 0) into v_excl, v_gasto_excl from _anu_asig_todas where not cuenta;
  select count(*) into v_sin_ad from _anu_asig_todas where cuenta and ad_id is null;

  drop table if exists _anu_asig;
  create temp table _anu_asig on commit drop as
  select * from _anu_asig_todas where cuenta and ad_id is not null;

  select count(*) into v_origen from _anu_norm;
  select count(*) into v_asig from _anu_asig;

  -- Solo si se asignó algo: un mapeo vacío o una respuesta vacía de Windsor no borra nada.
  if v_asig > 0 then
    delete from crm_comunidades_v2.meta_ads_anuncio_metrica m
     where m.fecha between p_desde and p_hasta
       and m.cliente_id in (select distinct cliente_id from _anu_asig);

    insert into crm_comunidades_v2.meta_ads_anuncio_metrica
           (cliente_id, comunidad_id, fecha, ad_id, ad_nombre, campana_nombre, adset_nombre,
            inversion, impresiones, clics, clics_enlace, conversaciones_meta)
    select cliente_id, comunidad_id, fecha, ad_id,
           max(ad_nombre), max(campana), max(adset),
           round(sum(inversion), 2), sum(impresiones), sum(clics),
           case when count(clics_enlace) = 0 then null else sum(clics_enlace)::int end,
           sum(conversaciones)
      from _anu_asig
     group by cliente_id, comunidad_id, fecha, ad_id;
    get diagnostics v_escritos = row_count;
  end if;

  select count(*), coalesce(sum(n.inversion), 0) into v_sin, v_gasto
    from _anu_norm n
   where exists (select 1 from crm_comunidades_v2.comunidad_meta_origen o
                  where crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(n.campana))
     and not exists (select 1 from _anu_asig_todas a where a.rn = n.rn);

  insert into crm_comunidades_v2.windsor_sync_log
         (tabla, filas_origen, filas_asignadas, registros_escritos, filas_sin_comunidad, gasto_sin_comunidad, filas_excluidas, gasto_excluido, registros_borrados)
  values ('windsor_raw.anuncios ' || p_desde || ' a ' || p_hasta, v_origen, v_asig, v_escritos, v_sin, v_gasto, v_excl, round(v_gasto_excl, 2), 0);

  return query select v_origen, v_asig, v_escritos, v_sin, round(v_gasto, 2), v_sin_ad;
end;
$$;
revoke all on function crm_comunidades_v2.meta_anuncios_aplicar(jsonb, date, date) from public, anon, authenticated;
grant execute on function crm_comunidades_v2.meta_anuncios_aplicar(jsonb, date, date) to service_role;
comment on function crm_comunidades_v2.meta_anuncios_aplicar(jsonb, date, date) is
  'Guarda en meta_ads_anuncio_metrica las filas por anuncio que la función meta-anuncios trajo de Windsor, con las reglas de comunidad_meta_origen. Reemplaza los días del rango. Solo service_role.';

-- Cuadre contra meta_ads_metrica: por comunidad, lo gastado y las conversaciones sumando los anuncios contra el registro por
-- comunidad. Diferencias de gasto de centavos son redondeo; cualquier otra diferencia hay que mirarla. Solo Marketing.
create or replace function crm_comunidades_v2.meta_anuncios_cuadre(p_cliente uuid, p_desde date, p_hasta date)
returns table (comunidad text, dias_con_anuncios bigint, inversion_anuncios numeric, inversion_comunidad numeric,
               conversaciones_anuncios bigint, conversaciones_comunidad bigint, clics_enlace_anuncios bigint, clics_enlace_comunidad bigint)
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
  anu as (
    select a.comunidad_id, count(distinct a.fecha) as dias, sum(a.inversion) as inv, sum(a.conversaciones_meta) as conv,
           sum(a.clics_enlace) as lc
      from crm_comunidades_v2.meta_ads_anuncio_metrica a
     where a.cliente_id = p_cliente and a.fecha between p_desde and p_hasta
     group by 1
  ),
  com as (
    select m.comunidad_id, sum(m.inversion) as inv, sum(m.conversaciones_meta) as conv, sum(m.clics_enlace) as lc
      from crm_comunidades_v2.meta_ads_metrica m
     where m.cliente_id = p_cliente and m.fecha between p_desde and p_hasta
       and m.fecha in (select distinct fecha from crm_comunidades_v2.meta_ads_anuncio_metrica where cliente_id = p_cliente)
     group by 1
  )
  select c.nombre, coalesce(anu.dias, 0), round(coalesce(anu.inv, 0), 2), round(coalesce(com.inv, 0), 2),
         coalesce(anu.conv, 0)::bigint, coalesce(com.conv, 0)::bigint, coalesce(anu.lc, 0)::bigint, coalesce(com.lc, 0)::bigint
    from acceso ac
    join crm_comunidades_v2.comunidad c on ac.ok and c.cliente_id = p_cliente
    left join anu on anu.comunidad_id = c.id
    left join com on com.comunidad_id = c.id
   where anu.comunidad_id is not null or com.comunidad_id is not null
   order by c.nombre;
$f$;
revoke all on function crm_comunidades_v2.meta_anuncios_cuadre(uuid, date, date) from public, anon;
grant execute on function crm_comunidades_v2.meta_anuncios_cuadre(uuid, date, date) to authenticated, service_role;
comment on function crm_comunidades_v2.meta_anuncios_cuadre(uuid, date, date) is
  'Suma de los anuncios contra meta_ads_metrica por comunidad (gasto, conversaciones y clics en el enlace). Debe coincidir salvo redondeo. Solo Marketing.';
