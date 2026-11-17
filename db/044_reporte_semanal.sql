-- ============================================================================
-- CRM de Comunidades V2 — Reporte semanal (PR #75)
--
-- Una sola función arma TODO el reporte (la usan el botón del panel y el flujo de n8n del lunes), así los números salen siempre del CRM y
-- nunca de una planilla armada a mano ni de un agente de IA:
--
--   reporte_semanal(cliente, desde, hasta)   una fila por comunidad + una fila de total del cliente (es_total = true)
--
-- Dos partes por comunidad:
--   1) PAUTA DEL PERÍODO (las fechas pedidas): inversión, conversaciones y clics en el enlace de Meta, entradas al flow, cobertura
--      (entradas ÷ conversaciones) y costo por entrada.
--   2) MIEMBROS, en el ÚLTIMO INTERVALO CERRADO entre dos cargas de lista completa que termina a más tardar en "hasta" (db/043):
--      miembros al inicio, nuevos, bajas, miembros al final, CRR y churn, y con la inversión y las entradas de ESE mismo intervalo:
--        costo por miembro nuevo (CPMN) = inversión del intervalo ÷ nuevos
--        tasa de triaje = nuevos ÷ entradas al flow del intervalo (decisión del 27/10: ingresos al grupo ÷ entradas al flow;
--        puede pasar de 100 % si al grupo entra gente que no pasó por el flow)
--   + frescura: fecha de la última carga de lista completa y días sin carga (contados hasta hoy).
--
-- El total suma la pauta de todas las comunidades; las columnas de miembros del total solo se llenan si todas las comunidades con
-- intervalo comparten las mismas fechas (si no, sumar intervalos distintos sería estimar). Nada se inventa: lo que no se puede
-- calcular queda en null.
--
-- Es plata (inversión): solo Marketing, como meta_ads_metrica (db/031). Las fechas son de Buenos Aires.
-- Aplicar después de 043. Idempotente.
-- ============================================================================
set search_path = crm_comunidades_v2, public;

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
     where co.cliente_id = p_cliente
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

revoke all on function crm_comunidades_v2.reporte_semanal(uuid, date, date) from public, anon;
grant execute on function crm_comunidades_v2.reporte_semanal(uuid, date, date) to authenticated, service_role;
comment on function crm_comunidades_v2.reporte_semanal(uuid, date, date) is
  'Reporte semanal: pauta del período por comunidad (inversión, chats, entradas, cobertura, costo por entrada) y miembros del último intervalo cerrado entre cargas de lista completa (CRR, churn, CPMN, triaje, frescura), más el total del cliente. Solo Marketing.';
