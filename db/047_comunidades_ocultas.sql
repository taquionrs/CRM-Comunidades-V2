-- ============================================================================
-- PR #85 — Comunidades ocultas ("Cortado en Jarrito (general)" no es una comunidad: es el canal oficial, su número de WhatsApp)
-- ============================================================================
-- comunidad.oculta = true: la comunidad sigue existiendo en la base (el webhook y los flows de ManyChat la usan y sus datos no se borran),
-- pero deja de verse y de contarse en el CRM: el panel la saca de tablas, filtros, totales, CRR y exportaciones, y las funciones del servidor
-- que arman el CRR, el reporte semanal (Excel y n8n) y el centro de acciones la dejan afuera.
--
-- Esta migración: (1) agrega la columna, (2) oculta "Cortado en Jarrito (general)", (3) vuelve a definir con el filtro "not oculta" la vista comunidad_performance (y con ella kpis_macro, los totales de Overview), la función
-- comunidad_performance_rango (Control_Comunidades), entradas_flow_cliente, crr_por_carga, reporte_semanal y acciones_pendientes (el resto de cada
-- cuerpo es idéntico a db/031, 035, 036, 043, 044 y 045).
-- crr_por_carga_con_inversion (db/046) llama a crr_por_carga, así que hereda el filtro. Idempotente.
-- Para ocultar otra comunidad: update crm_comunidades_v2.comunidad set oculta = true where id = '...';
-- ============================================================================
set search_path = crm_comunidades_v2, public;

alter table crm_comunidades_v2.comunidad add column if not exists oculta boolean not null default false;
comment on column crm_comunidades_v2.comunidad.oculta is 'true = no se muestra ni se cuenta en el CRM (por ejemplo, el canal oficial "(general)", que no es una comunidad). Los datos no se borran.';

update crm_comunidades_v2.comunidad set oculta = true where nombre = 'Cortado en Jarrito (general)';

create or replace view crm_comunidades_v2.comunidad_performance with (security_invoker = false) as
with acceso as (select crm_comunidades_v2.es_usuario_crm() as ok, crm_comunidades_v2.es_marketing() as mk)
select
  c.cliente_id,
  c.id as comunidad_id,
  c.nombre,
  c.miembros_iniciales,
  c.miembros_finales,
  case when a.mk then coalesce(m.inversion, 0) end as inversion,
  coalesce(m.conversaciones_meta, 0) as conversaciones_meta,
  coalesce(m.impresiones, 0) as impresiones,
  coalesce(u.clics_unicos, 0) as clics_unicos,
  case when a.mk then round(coalesce(m.inversion, 0) / nullif(coalesce(m.conversaciones_meta, 0), 0), 2) end as cpl,
  case when a.mk then round(coalesce(m.inversion, 0) / nullif(coalesce(u.clics_unicos, 0), 0), 2) end as cpcu,
  case when a.mk then round(coalesce(m.inversion, 0) / nullif(c.miembros_finales - c.miembros_iniciales, 0), 2) end as cpmn,
  (c.miembros_finales - c.miembros_iniciales) as crecimiento_neto,
  crm_comunidades_v2.bajas_reales_comunidad(c.id, null, null) as bajas_estimadas,
  round(crm_comunidades_v2.bajas_reales_comunidad(c.id, null, null)::numeric
        / nullif(crm_comunidades_v2.bajas_reales_comunidad(c.id, null, null) + c.miembros_finales, 0) * 100, 2) as tasa_fuga_pct
from acceso a
cross join crm_comunidades_v2.comunidad c
left join (
  select comunidad_id, sum(inversion) as inversion, sum(conversaciones_meta) as conversaciones_meta, sum(impresiones) as impresiones
  from crm_comunidades_v2.meta_ads_metrica
  group by comunidad_id
) m on m.comunidad_id = c.id
left join (
  -- Primer contacto por (cliente, persona): la misma regla que la vista evento_deduplicado (db/004), escrita acá
  -- porque esa vista lee con los permisos de quien consulta y el rol General no puede leer evento_crudo.
  select d.comunidad_atribuida_id, count(*) as clics_unicos
  from (select distinct on (e.cliente_id, e.telefono_id) e.comunidad_id as comunidad_atribuida_id
          from crm_comunidades_v2.evento_crudo e
         order by e.cliente_id, e.telefono_id, e.recibido_en asc) d
  group by d.comunidad_atribuida_id
) u on u.comunidad_atribuida_id = c.id
where a.ok and not c.oculta;

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
  where c.cliente_id = p_cliente and not c.oculta
    and a.ok
  order by c.nombre;
$$;
revoke all on function crm_comunidades_v2.comunidad_performance_rango(uuid, date, date, text) from public, anon;
grant execute on function crm_comunidades_v2.comunidad_performance_rango(uuid, date, date, text) to authenticated, service_role;

create or replace function crm_comunidades_v2.entradas_flow_cliente(
  p_cliente uuid,
  p_desde   date default null,
  p_hasta   date default null,
  p_canal   text default null
)
returns table (clasificadas bigint, sin_clasificar bigint, total bigint, tasa_clasificacion_pct numeric, hay_registro boolean)
language sql
stable
security definer
set search_path = crm_comunidades_v2, public
as $f$
  -- Acceso: cualquier usuario del CRM. Sin JWT es una conexión directa a la base (SQL Editor, pg_cron) y la clave de servicio es de
  -- las Edge Functions: no se controlan acá (mismo criterio que _exigir_marketing, db/031). La clave pública (anon) no tiene EXECUTE.
  with acceso as (
    select (nullif(current_setting('request.jwt.claims', true), '') is null
            or auth.role() = 'service_role'
            or crm_comunidades_v2.es_usuario_crm()) as ok
  ),
  primeros as (
    select x.telefono_id, x.recibido_en
      from (select distinct on (e.telefono_id) e.telefono_id, e.recibido_en, e.comunidad_id
              from crm_comunidades_v2.evento_crudo e
             where e.cliente_id = p_cliente
             order by e.telefono_id, e.recibido_en asc) x
     where not exists (select 1 from crm_comunidades_v2.comunidad co where co.id = x.comunidad_id and co.oculta)
  ),
  clas as (
    select count(*) as n
      from primeros p
     where (p_canal is null or p_canal = 'todos'
            or (p_canal = 'instagram' and p.telefono_id like 'ig:%')
            or (p_canal = 'whatsapp' and p.telefono_id not like 'ig:%'))
       and (p_desde is null or (p.recibido_en at time zone 'America/Argentina/Buenos_Aires')::date >= p_desde)
       and (p_hasta is null or (p.recibido_en at time zone 'America/Argentina/Buenos_Aires')::date <= p_hasta)
  ),
  pend as (
    select count(distinct s.telefono_id) as n
      from crm_comunidades_v2.ingreso_sin_clasificar s
     where s.cliente_id = p_cliente
       and (p_canal is null or p_canal = 'todos'
            or (p_canal = 'instagram' and s.telefono_id like 'ig:%')
            or (p_canal = 'whatsapp' and s.telefono_id not like 'ig:%'))
       and (p_desde is null or (s.recibido_en at time zone 'America/Argentina/Buenos_Aires')::date >= p_desde)
       and (p_hasta is null or (s.recibido_en at time zone 'America/Argentina/Buenos_Aires')::date <= p_hasta)
       and not exists (select 1 from crm_comunidades_v2.evento_crudo e
                        where e.cliente_id = s.cliente_id and e.telefono_id = s.telefono_id)
  )
  select clas.n::bigint,
         pend.n::bigint,
         (clas.n + pend.n)::bigint,
         round(clas.n::numeric / nullif(clas.n + pend.n, 0) * 100, 2),
         exists (select 1 from crm_comunidades_v2.ingreso_sin_clasificar x where x.cliente_id = p_cliente)
    from acceso a, clas, pend
   where a.ok;
$f$;

create or replace function crm_comunidades_v2.crr_por_carga(
  p_cliente uuid,
  p_desde   date default null,
  p_hasta   date default null
)
returns table (comunidad_id uuid, comunidad text, desde date, hasta date, dias integer,
               miembros_inicio integer, nuevos integer, bajas integer, miembros_fin integer,
               crr_pct numeric, churn_pct numeric, cuadra boolean)
language sql
stable
security definer
set search_path = crm_comunidades_v2, public
as $f$
  with acceso as (
    select (nullif(current_setting('request.jwt.claims', true), '') is null
            or auth.role() = 'service_role'
            or crm_comunidades_v2.es_usuario_crm()) as ok
  ),
  cargas as (
    select c.comunidad_id, c.cargada_en,
           (c.cargada_en at time zone 'America/Argentina/Buenos_Aires')::date as dia,
           c.numeros_validos as miembros, coalesce(c.nuevos, 0) as nuevos, coalesce(c.salieron, 0) as bajas
      from crm_comunidades_v2.carga_miembros c
     where c.cliente_id = p_cliente and c.lista_completa
  ),
  pares as (
    select k.*, lag(k.dia) over w as dia_ant, lag(k.miembros) over w as miembros_ant,
           round((k.miembros - k.nuevos)::numeric / nullif(lag(k.miembros) over w, 0) * 100, 2) as crr
      from cargas k
    window w as (partition by k.comunidad_id order by k.cargada_en)
  )
  select p.comunidad_id, co.nombre, p.dia_ant, p.dia, (p.dia - p.dia_ant)::int,
         p.miembros_ant::int, p.nuevos::int, p.bajas::int, p.miembros::int,
         p.crr,
         100 - p.crr,   -- churn: sobre el CRR ya redondeado, así los dos siempre suman 100
         (p.miembros_ant + p.nuevos - p.bajas = p.miembros)
    from acceso ac
    join pares p on ac.ok and p.dia_ant is not null
    join crm_comunidades_v2.comunidad co on co.id = p.comunidad_id and co.cliente_id = p_cliente and not co.oculta
   where (p_desde is null or p.dia >= p_desde) and (p_hasta is null or p.dia <= p_hasta)
   order by p.dia desc, co.nombre;
$f$;

create or replace function crm_comunidades_v2.reporte_semanal(p_cliente uuid, p_desde date, p_hasta date)
returns table (
  es_total boolean, comunidad_id uuid, comunidad text, desde date, hasta date,
  inversion numeric, conversaciones bigint, clics_enlace bigint, entradas bigint, cobertura_pct numeric, costo_por_entrada numeric,
  ultima_carga date, dias_sin_carga integer,
  miembros_desde date, miembros_hasta date, miembros_inicio integer, nuevos integer, bajas integer, miembros_fin integer,
  crr_pct numeric, churn_pct numeric, cuadra boolean,
  inversion_intervalo numeric, entradas_intervalo bigint, cpmn numeric, triaje_pct numeric
)
language plpgsql
stable
security definer
set search_path = crm_comunidades_v2, public
as $f$
begin
  if p_desde is null or p_hasta is null or p_desde > p_hasta then raise exception 'El rango de fechas no es válido'; end if;
  if p_hasta - p_desde > 92 then raise exception 'El rango máximo es de 93 días'; end if;
  if not (nullif(current_setting('request.jwt.claims', true), '') is null
          or auth.role() = 'service_role'
          or crm_comunidades_v2.es_marketing()) then
    return;   -- sin permiso: lista vacía, igual que el resto de las funciones con plata
  end if;

  return query
  with hoy as (select (now() at time zone 'America/Argentina/Buenos_Aires')::date as d),
  primeros as (
    select distinct on (e.telefono_id) e.telefono_id, e.comunidad_id,
           (e.recibido_en at time zone 'America/Argentina/Buenos_Aires')::date as dia
      from crm_comunidades_v2.evento_crudo e
     where e.cliente_id = p_cliente
     order by e.telefono_id, e.recibido_en asc
  ),
  met as (
    select m.comunidad_id, sum(m.inversion) as inv, sum(m.conversaciones_meta) as conv,
           case when count(m.clics_enlace) = 0 then null else sum(m.clics_enlace) end as lc
      from crm_comunidades_v2.meta_ads_metrica m
     where m.cliente_id = p_cliente and m.fecha between p_desde and p_hasta
     group by m.comunidad_id
  ),
  ent as (
    select p.comunidad_id, count(*) as n from primeros p where p.dia between p_desde and p_hasta group by p.comunidad_id
  ),
  ult as (
    select distinct on (r.comunidad_id) r.comunidad_id, r.desde, r.hasta, r.miembros_inicio, r.nuevos, r.bajas, r.miembros_fin, r.crr_pct, r.churn_pct, r.cuadra
      from crm_comunidades_v2.crr_por_carga(p_cliente, null, p_hasta) r
     order by r.comunidad_id, r.hasta desc
  ),
  carga as (
    select c.comunidad_id, max((c.cargada_en at time zone 'America/Argentina/Buenos_Aires')::date) as ultima
      from crm_comunidades_v2.carga_miembros c where c.cliente_id = p_cliente and c.lista_completa group by c.comunidad_id
  ),
  inter as (
    select u.comunidad_id,
           (select coalesce(sum(m.inversion), 0) from crm_comunidades_v2.meta_ads_metrica m
             where m.comunidad_id = u.comunidad_id and m.fecha > u.desde and m.fecha <= u.hasta) as inv_int,
           (select count(*) from primeros p where p.comunidad_id = u.comunidad_id and p.dia > u.desde and p.dia <= u.hasta) as ent_int
      from ult u
  ),
  base as (
    select co.id as cid, co.nombre,
           coalesce(met.inv, 0) as inv, coalesce(met.conv, 0) as conv, met.lc, coalesce(ent.n, 0) as ent,
           carga.ultima, u.desde as m_desde, u.hasta as m_hasta, u.miembros_inicio as m_ini, u.nuevos as m_nue, u.bajas as m_baj, u.miembros_fin as m_fin,
           u.crr_pct as m_crr, u.churn_pct as m_churn, u.cuadra as m_cuadra, i.inv_int, i.ent_int
      from crm_comunidades_v2.comunidad co
      left join met on met.comunidad_id = co.id
      left join ent on ent.comunidad_id = co.id
      left join ult u on u.comunidad_id = co.id
      left join inter i on i.comunidad_id = co.id
      left join carga on carga.comunidad_id = co.id
     where co.cliente_id = p_cliente and not co.oculta
       and (met.comunidad_id is not null or ent.comunidad_id is not null or u.comunidad_id is not null or carga.comunidad_id is not null)
  ),
  filas as (
    select false as es_total, b.cid, b.nombre::text as nombre, p_desde as d1, p_hasta as d2,
           round(b.inv, 2) as inv, b.conv::bigint as conv, b.lc::bigint as lc, b.ent::bigint as ent,
           round(b.ent::numeric / nullif(b.conv, 0) * 100, 2) as cob, round(b.inv / nullif(b.ent, 0), 2) as cpe,
           b.ultima, (select h.d from hoy h) - b.ultima as dsc,
           b.m_desde, b.m_hasta, b.m_ini, b.m_nue, b.m_baj, b.m_fin, b.m_crr, b.m_churn, b.m_cuadra,
           round(b.inv_int, 2) as inv_int, b.ent_int::bigint as ent_int,
           round(b.inv_int / nullif(b.m_nue, 0), 2) as cpmn, round(b.m_nue::numeric / nullif(b.ent_int, 0) * 100, 2) as triaje
      from base b
  ),
  total as (
    select true as es_total, null::uuid as cid, 'Total del cliente'::text as nombre, p_desde as d1, p_hasta as d2,
           round(sum(f.inv), 2) as inv, sum(f.conv)::bigint as conv,
           (case when count(f.lc) = 0 then null else sum(f.lc) end)::bigint as lc, sum(f.ent)::bigint as ent,
           round(sum(f.ent)::numeric / nullif(sum(f.conv), 0) * 100, 2) as cob, round(sum(f.inv) / nullif(sum(f.ent), 0), 2) as cpe,
           min(f.ultima) as ultima, max(f.dsc) as dsc,
           -- Miembros del total: solo si todas las comunidades con intervalo comparten las mismas fechas.
           (case when same.ok then same.d1 end) as m_desde, (case when same.ok then same.d2 end) as m_hasta,
           (case when same.ok then sum(f.m_ini)::int end) as m_ini, (case when same.ok then sum(f.m_nue)::int end) as m_nue,
           (case when same.ok then sum(f.m_baj)::int end) as m_baj, (case when same.ok then sum(f.m_fin)::int end) as m_fin,
           (case when same.ok then round((sum(f.m_fin) - sum(f.m_nue))::numeric / nullif(sum(f.m_ini), 0) * 100, 2) end) as m_crr,
           (case when same.ok then round(100 - (sum(f.m_fin) - sum(f.m_nue))::numeric / nullif(sum(f.m_ini), 0) * 100, 2) end) as m_churn,
           (case when same.ok then bool_and(f.m_cuadra) end) as m_cuadra,
           (case when same.ok then round(sum(f.inv_int), 2) end) as inv_int, (case when same.ok then sum(f.ent_int)::bigint end) as ent_int,
           (case when same.ok then round(sum(f.inv_int) / nullif(sum(f.m_nue), 0), 2) end) as cpmn,
           (case when same.ok then round(sum(f.m_nue)::numeric / nullif(sum(f.ent_int), 0) * 100, 2) end) as triaje
      from filas f
     cross join (select (count(distinct (g.m_desde, g.m_hasta)) = 1) as ok, min(g.m_desde) as d1, min(g.m_hasta) as d2
                   from filas g where g.m_desde is not null) same
     group by same.ok, same.d1, same.d2
  )
  select * from (select * from filas union all select * from total) z
   order by z.es_total, z.nombre;
end;
$f$;

create or replace function crm_comunidades_v2.acciones_pendientes(p_cliente uuid)
returns table (codigo text, prioridad integer, mensaje text, boton text, destino text,
               comunidad_ids uuid[], comunidades text[], dato numeric)
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
  hoy as (select (now() at time zone 'America/Argentina/Buenos_Aires')::date as d),
  cargas as (
    select c.comunidad_id, count(*) as n,
           max((c.cargada_en at time zone 'America/Argentina/Buenos_Aires')::date) as ultima
      from crm_comunidades_v2.carga_miembros c
     where c.cliente_id = p_cliente and c.lista_completa
     group by c.comunidad_id
  ),
  estado as (
    select co.id, co.nombre, coalesce(ca.n, 0) as n, ca.ultima, (select h.d from hoy h) - ca.ultima as dias
      from crm_comunidades_v2.comunidad co
      left join cargas ca on ca.comunidad_id = co.id
     where co.cliente_id = p_cliente and not co.oculta
  ),
  ultimo_intervalo as (
    select distinct on (r.comunidad_id) r.comunidad_id, r.cuadra
      from crm_comunidades_v2.crr_por_carga(p_cliente) r
     order by r.comunidad_id, r.hasta desc
  ),
  sync_meta as (
    select max(l.corrida_en) as ultima
      from crm_comunidades_v2.windsor_sync_log l
     where l.tabla like 'windsor_raw.facebook_ads%' or l.tabla like 'windsor_raw.en_vivo%'
  ),
  ultima_corrida as (
    select l.gasto_sin_comunidad as gasto
      from crm_comunidades_v2.windsor_sync_log l
     where l.tabla like 'windsor_raw.facebook_ads%' or l.tabla like 'windsor_raw.en_vivo%'
     order by l.corrida_en desc limit 1
  ),
  sin_clasificar as (
    select count(distinct s.telefono_id) as n
      from crm_comunidades_v2.ingreso_sin_clasificar s
     where s.cliente_id = p_cliente and s.recibido_en > now() - interval '7 days'
       and not exists (select 1 from crm_comunidades_v2.evento_crudo e where e.cliente_id = s.cliente_id and e.telefono_id = s.telefono_id)
  ),
  acciones as (
    -- 1) Más de 8 días sin carga de lista completa.
    select 'miembros_sin_carga'::text as codigo, 1 as prioridad,
           (case when count(*) = 1
                 then 'Cargá la lista de ' || min(e.nombre) || ': hace ' || min(e.dias) || ' días que no se actualiza. Sin eso el CRR queda viejo.'
                 else 'Cargá la lista de miembros de ' || crm_comunidades_v2.lista_en_texto(array_agg(e.nombre order by e.nombre))
                      || (case when min(e.dias) = max(e.dias) then ': llevan ' || min(e.dias) || ' días sin actualizarse.' else ': llevan entre ' || min(e.dias) || ' y ' || max(e.dias) || ' días sin actualizarse.' end)
                      || ' Sin eso el CRR queda viejo.' end) as mensaje,
           'Cargar miembros'::text as boton, 'cargar_miembros'::text as destino,
           array_agg(e.id order by e.nombre) as comunidad_ids, array_agg(e.nombre order by e.nombre) as comunidades, max(e.dias)::numeric as dato
      from estado e where e.n >= 1 and e.dias > 8
    having count(*) > 0
    union all
    -- 2) La última carga no cuadra.
    select 'carga_no_cuadra', 1,
           (case when count(*) = 1
                 then min(co.nombre) || ': la última carga no cuadra (miembros al inicio + nuevos − bajas no da los miembros al final). Revisala antes de confiar en su CRR.'
                 else 'Las últimas cargas de ' || crm_comunidades_v2.lista_en_texto(array_agg(co.nombre order by co.nombre))
                      || ' no cuadran (inicio + nuevos − bajas no da el final). Revisalas antes de confiar en su CRR.' end),
           'Ver las cargas', 'consultas', array_agg(co.id order by co.nombre), array_agg(co.nombre order by co.nombre), count(*)::numeric
      from ultimo_intervalo u join crm_comunidades_v2.comunidad co on co.id = u.comunidad_id
     where u.cuadra is false
    having count(*) > 0
    union all
    -- 3) La sincronización con Meta no corre hace más de 48 h.
    select 'meta_sin_sincronizar', 1,
           'La sincronización con Meta no corre desde el ' || to_char(m.ultima at time zone 'America/Argentina/Buenos_Aires', 'DD/MM') || '. Traé los datos a mano.',
           'Traer de Meta ahora', 'traer_meta', null::uuid[], null::text[],
           extract(day from now() - m.ultima)::numeric
      from sync_meta m where m.ultima is not null and m.ultima < now() - interval '48 hours'
    union all
    -- 4) Comunidades sin ninguna carga de lista completa.
    select 'miembros_sin_cargas', 2,
           (case when count(*) = 1
                 then min(e.nombre) || ' no tiene ninguna carga de lista completa de miembros: cargala para empezar a medir su CRR.'
                 else crm_comunidades_v2.lista_en_texto(array_agg(e.nombre order by e.nombre))
                      || ' no tienen ninguna carga de lista completa de miembros: cargalas para empezar a medir su CRR.' end),
           'Cargar miembros', 'cargar_miembros', array_agg(e.id order by e.nombre), array_agg(e.nombre order by e.nombre), count(*)::numeric
      from estado e where e.n = 0
    having count(*) > 0
    union all
    -- 5) Una sola carga (reciente): falta otra para calcular el CRR.
    select 'miembros_una_carga', 2,
           (case when count(*) = 1
                 then min(e.nombre) || ' tiene una sola carga de lista completa: cargá otra para calcular su CRR.'
                 else crm_comunidades_v2.lista_en_texto(array_agg(e.nombre order by e.nombre))
                      || ' tienen una sola carga de lista completa: cargá otra para calcular su CRR.' end),
           'Cargar miembros', 'cargar_miembros', array_agg(e.id order by e.nombre), array_agg(e.nombre order by e.nombre), count(*)::numeric
      from estado e where e.n = 1 and e.dias <= 8
    having count(*) > 0
    union all
    -- 6) Gasto sin comunidad en la última sincronización.
    select 'gasto_sin_comunidad', 2,
           'Hay $' || replace(to_char(round(u.gasto), 'FM999,999,999,999'), ',', '.') || ' de gasto sin comunidad: un conjunto de anuncios nuevo no está asignado.',
           'Campañas', 'campanas', null::uuid[], null::text[], u.gasto::numeric
      from ultima_corrida u where coalesce(u.gasto, 0) > 0
    union all
    -- 7) Personas que escribieron y no eligieron comunidad.
    select 'sin_clasificar', 3,
           s.n || ' personas escribieron en los últimos 7 días y no eligieron comunidad.',
           'Ver en Data_Cruda', 'data_cruda', null::uuid[], null::text[], s.n::numeric
      from sin_clasificar s where s.n >= 3
  )
  select a.codigo, a.prioridad, a.mensaje, a.boton, a.destino, a.comunidad_ids, a.comunidades, a.dato
    from acceso ac
    join acciones a on ac.ok
   where not exists (select 1 from crm_comunidades_v2.accion_pospuesta p
                      where p.cliente_id = p_cliente and p.codigo = a.codigo and p.hasta >= (select h.d from hoy h))
   order by a.prioridad, a.dato desc nulls last, a.codigo;
$f$;
