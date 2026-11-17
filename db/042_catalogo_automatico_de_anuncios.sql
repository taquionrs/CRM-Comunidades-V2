-- ============================================================================
-- CRM de Comunidades V2 — Catálogo automático de anuncios (PR #73)
--
-- Hasta hoy el catálogo de códigos (anuncio_codigo, db/039) se cargaba a mano. Ahora cada anuncio que llega de Windsor
-- (meta_ads_anuncio_metrica, db/040) se registra SOLO en el catálogo, con su ID de Meta, su campaña, su conjunto de anuncios y un
-- código propio del CRM con la forma  ZONA-NN  (por ejemplo PAL-01, BOE-04, DEV-02):
--
--   ZONA   las 3 primeras letras de la comunidad ("Palermo" → PAL, "Villa Devoto" → DEV; se ignora "Villa"/"Barrio").
--   NN     el número que ya trae el nombre del anuncio en Meta ("..._PALERMO_01" → 01). Si el nombre no trae número, o ese código
--          ya está tomado por otro anuncio, se usa el primer número libre de esa zona.
--
-- El código es estable: una vez asignado a un anuncio (por su ad_id) no cambia aunque Meta le cambie el nombre. El código tiene que
-- viajar en el mensaje de la persona (al final, por ejemplo "(PAL-01)"): es lo único que hoy llega hasta el CRM.
--
--   anuncio_codigo.ad_id / adset_nombre / automatico   de qué anuncio de Meta es cada código y si lo creó el CRM solo.
--   prefijo_zona(), numero_anuncio()                    reglas de generación (funciones puras).
--   registrar_anuncios_en_catalogo(cliente)             alta de los anuncios nuevos y actualización de nombres. Idempotente.
--                                                       La corre meta_anuncios_aplicar en cada consulta a Windsor.
--   rendimiento_por_anuncio()                           ahora vincula por ad_id y distingue "tiene código" de "ya se vio en una
--                                                       entrada" (columna instrumentado).
--
-- Los códigos de prueba P1 a P4 de Palermo (db/039) pasan a PAL-01 a PAL-04 si todavía no los usó ninguna entrada.
-- El formato anterior (P1, B2) sigue aceptándose en el catálogo y en el webhook.
--
-- Aplicar después de 041. Idempotente.
-- ============================================================================
set search_path = crm_comunidades_v2, public;

alter table crm_comunidades_v2.anuncio_codigo add column if not exists ad_id text;
alter table crm_comunidades_v2.anuncio_codigo add column if not exists adset_nombre text;
alter table crm_comunidades_v2.anuncio_codigo add column if not exists automatico boolean not null default false;

create unique index if not exists uq_anuncio_codigo_ad
  on crm_comunidades_v2.anuncio_codigo (cliente_id, ad_id) where ad_id is not null;

-- Formato del código: el de antes (1 a 3 letras y 1 a 3 números) o el nuevo ZONA-NN (2 a 4 letras, guion, 1 a 3 números).
alter table crm_comunidades_v2.anuncio_codigo drop constraint if exists anuncio_codigo_codigo_check;
alter table crm_comunidades_v2.anuncio_codigo drop constraint if exists anuncio_codigo_formato_check;
alter table crm_comunidades_v2.anuncio_codigo add constraint anuncio_codigo_formato_check
  check (codigo = upper(btrim(codigo)) and (codigo ~ '^[A-Z]{1,3}[0-9]{1,3}$' or codigo ~ '^[A-Z]{2,4}-[0-9]{1,3}$'));

comment on column crm_comunidades_v2.anuncio_codigo.ad_id is 'ID del anuncio en Meta (Windsor). Con él se vincula el código con las métricas por anuncio.';
comment on column crm_comunidades_v2.anuncio_codigo.automatico is 'true = el código lo generó el CRM al ver el anuncio en Windsor; false = se cargó a mano.';

-- "Palermo" → PAL, "Villa Devoto" → DEV, "Cortado en Jarrito (general)" → COR. Sin letras usables: AD.
create or replace function crm_comunidades_v2.prefijo_zona(p_nombre text)
returns text language sql immutable parallel safe as $$
  select case when length(w) >= 2 then upper(left(w, 3)) else 'AD' end
    from (select split_part(btrim(regexp_replace(regexp_replace(crm_comunidades_v2.normalizar_nombre(p_nombre), '^(villa|barrio)\s+', ''), '[^a-z ]', '', 'g')), ' ', 1) as w) x
$$;

-- "..._WHATSAPP_PALERMO_01" → 1. Sin número al final: null.
create or replace function crm_comunidades_v2.numero_anuncio(p_nombre text)
returns integer language sql immutable parallel safe as $$
  select nullif(substring(btrim(coalesce(p_nombre, '')) from '_([0-9]{1,3})$'), '')::int
$$;

-- Pasa los códigos de prueba de db/039 (P1..P9) al formato nuevo, solo si ninguna entrada los usó todavía.
update crm_comunidades_v2.anuncio_codigo a
   set codigo = crm_comunidades_v2.prefijo_zona(c.nombre) || '-0' || substr(a.codigo, 2)
  from crm_comunidades_v2.comunidad c
 where c.id = a.comunidad_id and c.cliente_id = a.cliente_id
   and a.codigo ~ '^P[1-9]$' and not a.automatico
   and not exists (select 1 from crm_comunidades_v2.evento_crudo e where e.cliente_id = a.cliente_id and e.anuncio_codigo = a.codigo)
   and not exists (select 1 from crm_comunidades_v2.ingreso_sin_clasificar s where s.cliente_id = a.cliente_id and s.anuncio_codigo = a.codigo)
   and not exists (select 1 from crm_comunidades_v2.anuncio_codigo b
                    where b.cliente_id = a.cliente_id and b.codigo = crm_comunidades_v2.prefijo_zona(c.nombre) || '-0' || substr(a.codigo, 2));

-- Alta de los anuncios nuevos (y actualización de los nombres) a partir de las métricas por anuncio. p_cliente null = todos.
create or replace function crm_comunidades_v2.registrar_anuncios_en_catalogo(p_cliente uuid default null)
returns integer
language plpgsql
set search_path = crm_comunidades_v2, public
as $$
declare
  r record;
  v_pref text; v_n int; v_cod text; v_nuevos int := 0; v_max int; v_pasada int;
begin
  -- Un registro por anuncio de Meta, con el último nombre, campaña y conjunto que se vieron.
  create temp table if not exists _anu_ult (cliente_id uuid, comunidad_id uuid, ad_id text, ad_nombre text, campana text, adset text, primero date) on commit drop;
  delete from _anu_ult;
  insert into _anu_ult
  select distinct on (m.cliente_id, m.ad_id) m.cliente_id, m.comunidad_id, m.ad_id, m.ad_nombre, m.campana_nombre, m.adset_nombre,
         (select min(x.fecha) from crm_comunidades_v2.meta_ads_anuncio_metrica x where x.cliente_id = m.cliente_id and x.ad_id = m.ad_id)
    from crm_comunidades_v2.meta_ads_anuncio_metrica m
   where (p_cliente is null or m.cliente_id = p_cliente)
   order by m.cliente_id, m.ad_id, m.fecha desc;

  -- 1) Códigos cargados a mano que todavía no tienen ad_id: se vinculan por nombre normalizado y comunidad.
  update crm_comunidades_v2.anuncio_codigo a
     set ad_id = u.ad_id, adset_nombre = u.adset, campana_nombre = coalesce(nullif(u.campana, ''), a.campana_nombre)
    from _anu_ult u
   where a.ad_id is null and a.cliente_id = u.cliente_id and a.comunidad_id = u.comunidad_id
     and crm_comunidades_v2.normalizar_nombre(a.anuncio_nombre) = crm_comunidades_v2.normalizar_nombre(u.ad_nombre)
     and not exists (select 1 from crm_comunidades_v2.anuncio_codigo b where b.cliente_id = a.cliente_id and b.ad_id = u.ad_id);

  -- 2) Anuncios que ya están en el catálogo: se actualizan nombre, campaña y conjunto (el código no cambia).
  update crm_comunidades_v2.anuncio_codigo a
     set anuncio_nombre = u.ad_nombre, campana_nombre = coalesce(nullif(u.campana, ''), a.campana_nombre), adset_nombre = u.adset
    from _anu_ult u
   where a.cliente_id = u.cliente_id and a.ad_id = u.ad_id
     and (a.anuncio_nombre is distinct from u.ad_nombre or a.adset_nombre is distinct from u.adset
          or a.campana_nombre is distinct from coalesce(nullif(u.campana, ''), a.campana_nombre))
     and btrim(u.ad_nombre) <> '';

  -- 3) Anuncios nuevos, en dos pasadas para que un número del nombre nunca se lo lleve otro anuncio:
  --    a) los que traen número en el nombre conservan ese número si está libre (el primero que apareció se lo queda);
  --    b) el resto (sin número, o con el número ya tomado) recibe el primer número libre de su zona.
  for v_pasada in 1..2 loop
    for r in
      select u.*, co.nombre as zona
        from _anu_ult u
        join crm_comunidades_v2.comunidad co on co.id = u.comunidad_id and co.cliente_id = u.cliente_id
       where not exists (select 1 from crm_comunidades_v2.anuncio_codigo a where a.cliente_id = u.cliente_id and a.ad_id = u.ad_id)
         and btrim(u.ad_nombre) <> ''
         and (v_pasada = 2 or crm_comunidades_v2.numero_anuncio(u.ad_nombre) is not null)
       order by u.primero, u.ad_id
    loop
      v_pref := crm_comunidades_v2.prefijo_zona(r.zona);
      v_n := crm_comunidades_v2.numero_anuncio(r.ad_nombre);
      v_cod := case when v_n is not null then v_pref || '-' || lpad(v_n::text, 2, '0') end;
      if v_cod is not null and exists (select 1 from crm_comunidades_v2.anuncio_codigo b where b.cliente_id = r.cliente_id and b.codigo = v_cod) then
        continue when v_pasada = 1;   -- número tomado: espera a la segunda pasada
        v_cod := null;
      end if;
      if v_cod is null then
        select coalesce(max(substring(b.codigo from '-([0-9]+)$')::int), 0) into v_max
          from crm_comunidades_v2.anuncio_codigo b
         where b.cliente_id = r.cliente_id and b.codigo like v_pref || '-%';
        v_n := v_max + 1;
        v_cod := v_pref || '-' || lpad(v_n::text, 2, '0');
        while exists (select 1 from crm_comunidades_v2.anuncio_codigo b where b.cliente_id = r.cliente_id and b.codigo = v_cod) loop
          v_n := v_n + 1; v_cod := v_pref || '-' || lpad(v_n::text, 2, '0');
        end loop;
      end if;
      insert into crm_comunidades_v2.anuncio_codigo (cliente_id, comunidad_id, codigo, anuncio_nombre, campana_nombre, adset_nombre, ad_id, automatico)
      values (r.cliente_id, r.comunidad_id, v_cod, r.ad_nombre, nullif(r.campana, ''), r.adset, r.ad_id, true);
      v_nuevos := v_nuevos + 1;
    end loop;
  end loop;

  return v_nuevos;
end;
$$;
revoke all on function crm_comunidades_v2.registrar_anuncios_en_catalogo(uuid) from public, anon, authenticated;
grant execute on function crm_comunidades_v2.registrar_anuncios_en_catalogo(uuid) to service_role;
comment on function crm_comunidades_v2.registrar_anuncios_en_catalogo(uuid) is
  'Registra en anuncio_codigo cada anuncio de meta_ads_anuncio_metrica que todavía no tiene código (ZONA-NN) y actualiza los nombres. Idempotente. La corre meta_anuncios_aplicar.';

-- meta_anuncios_aplicar (db/040) ahora también deja el catálogo al día. El resto de la función es idéntico.
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

    -- Catálogo al día: cada anuncio nuevo recibe su código (PAL-01...) y los nombres se actualizan.
    perform crm_comunidades_v2.registrar_anuncios_en_catalogo(null);
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

-- Alta inicial con lo que ya hay cargado de Windsor.
select crm_comunidades_v2.registrar_anuncios_en_catalogo(null);

-- Rendimiento por anuncio (db/041), ahora vinculado por ad_id. "instrumentado" = el código ya se vio en alguna entrada o aviso
-- (si la plantilla de Meta lo lleva); mientras no se vio, las columnas del CRM son null ("no se puede saber"), no 0.
drop function if exists crm_comunidades_v2.rendimiento_por_anuncio(uuid, date, date, uuid);
create function crm_comunidades_v2.rendimiento_por_anuncio(
  p_cliente   uuid,
  p_desde     date default null,
  p_hasta     date default null,
  p_comunidad uuid default null
)
returns table (comunidad_id uuid, comunidad text, codigo text, ad_id text, ad_nombre text, campana_nombre text, adset_nombre text, instrumentado boolean,
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
           max(m.ad_nombre) as ad_nombre, max(m.campana_nombre) as campana, max(m.adset_nombre) as adset,
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
    select a.comunidad_id, a.codigo, a.ad_id, a.anuncio_nombre, a.campana_nombre, a.adset_nombre
      from crm_comunidades_v2.anuncio_codigo a
     where a.cliente_id = p_cliente and (p_comunidad is null or a.comunidad_id = p_comunidad)
  ),
  vistos as (
    select e.anuncio_codigo as codigo from crm_comunidades_v2.evento_crudo e where e.cliente_id = p_cliente and e.anuncio_codigo is not null
    union
    select s.anuncio_codigo from crm_comunidades_v2.ingreso_sin_clasificar s where s.cliente_id = p_cliente and s.anuncio_codigo is not null
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
           coalesce(m.ad_id, c.ad_id) as ad_id,
           coalesce(m.ad_nombre, c.anuncio_nombre) as ad_nombre, coalesce(m.campana, c.campana_nombre) as campana, coalesce(m.adset, c.adset_nombre) as adset,
           m.dias, m.ultimo, m.inv, m.imp, m.lc, m.imp_lc, m.conv
      from meta m
      full join cat c
        on c.comunidad_id = m.comunidad_id
       and (c.ad_id = m.ad_id
            or (c.ad_id is null and crm_comunidades_v2.normalizar_nombre(c.anuncio_nombre) = crm_comunidades_v2.normalizar_nombre(m.ad_nombre)))
  ),
  filas as (
    select a.*, (a.codigo is not null and exists (select 1 from vistos v where v.codigo = a.codigo)) as visto
      from anuncios a
  )
  select a.comunidad_id, co.nombre, a.codigo, a.ad_id, a.ad_nombre, a.campana, a.adset, a.visto,
         coalesce(a.dias, 0), a.ultimo, round(coalesce(a.inv, 0), 2), coalesce(a.imp, 0)::bigint, a.lc::bigint, a.imp_lc::bigint,
         coalesce(a.conv, 0)::bigint,
         (case when a.visto then coalesce(ent.n, 0) end)::bigint,
         (case when a.visto then coalesce(sin.n, 0) end)::bigint
    from acceso ac
    join filas a on ac.ok
    join crm_comunidades_v2.comunidad co on co.id = a.comunidad_id and co.cliente_id = p_cliente
    left join ent on a.visto and ent.comunidad_id = a.comunidad_id and ent.codigo = a.codigo
    left join sin on a.visto and sin.codigo = a.codigo
  union all
  -- Por comunidad: entradas de personas cuyo primer contacto no traía código de anuncio.
  select ent.comunidad_id, co.nombre, null::text, null::text, null::text, null::text, null::text, false,
         0, null::date, 0::numeric, 0::bigint, null::bigint, null::bigint, 0::bigint, ent.n::bigint, 0::bigint
    from acceso ac
    join ent on ac.ok and ent.codigo is null
    join crm_comunidades_v2.comunidad co on co.id = ent.comunidad_id and co.cliente_id = p_cliente
   order by 2, 3 nulls last, 5 nulls last;
$f$;

revoke all on function crm_comunidades_v2.rendimiento_por_anuncio(uuid, date, date, uuid) from public, anon;
grant execute on function crm_comunidades_v2.rendimiento_por_anuncio(uuid, date, date, uuid) to authenticated, service_role;
comment on function crm_comunidades_v2.rendimiento_por_anuncio(uuid, date, date, uuid) is
  'Rendimiento por anuncio: Meta (gasto, clics en el enlace, conversaciones) y CRM por código (entradas, sin clasificar). Un código "visto" es el que ya llegó en alguna entrada; los demás muestran null. Solo Marketing.';
