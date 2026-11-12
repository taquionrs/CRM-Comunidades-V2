-- db/037 · El CTR sale de los clics en el enlace (PR #67).
-- El desglose por campaña (db/036) devolvía las impresiones de todos los días, pero los clics en el enlace solo de los días que ya traen el dato:
-- dividir uno por otro daba un CTR demasiado bajo mientras hubiera días sin dato. Ahora también devuelve `impresiones_enlace`
-- (impresiones de los días con clics en el enlace), igual que ya hacen comunidad_performance_rango y metricas_globales_cliente.
-- Solo agrega una columna al final. Se recrea la función (cambia el tipo de retorno) con los mismos permisos de db/036: solo Marketing.

drop function if exists crm_comunidades_v2.desglose_campanas(uuid, date, date, uuid);
create function crm_comunidades_v2.desglose_campanas(p_cliente uuid, p_desde date default null, p_hasta date default null, p_comunidad uuid default null)
returns table (medio text, campana text, adset text, comunidad_id uuid, comunidad_nombre text,
               inversion numeric, conversaciones bigint, impresiones bigint, clics bigint, leads bigint, dias int, clics_enlace bigint,
               impresiones_enlace bigint)
language sql
stable
set search_path = crm_comunidades_v2, public
as $f$
  select crm_comunidades_v2._exigir_marketing();
  select d.medio, d.campana, d.adset, d.comunidad_id, coalesce(co.nombre, 'Campañas globales (sin comunidad)'),
         round(sum(d.inversion), 2), sum(d.conversaciones)::bigint, sum(d.impresiones)::bigint, sum(d.clics)::bigint, sum(d.leads)::bigint,
         count(distinct d.fecha)::int, sum(d.clics_enlace)::bigint,
         coalesce(sum(d.impresiones) filter (where d.clics_enlace is not null), 0)::bigint
    from crm_comunidades_v2.ads_campana_dia d
    left join crm_comunidades_v2.comunidad co on co.id = d.comunidad_id
   where d.cliente_id = p_cliente
     and (p_desde is null or d.fecha >= p_desde)
     and (p_hasta is null or d.fecha <= p_hasta)
     and (p_comunidad is null or d.comunidad_id = p_comunidad)
   group by d.medio, d.campana, d.adset, d.comunidad_id, co.nombre
   order by 6 desc, 1, 2, 3;
$f$;
revoke all on function crm_comunidades_v2.desglose_campanas(uuid, date, date, uuid) from public, anon;
grant execute on function crm_comunidades_v2.desglose_campanas(uuid, date, date, uuid) to authenticated, service_role;
comment on function crm_comunidades_v2.desglose_campanas(uuid, date, date, uuid) is
  'Desglose por medio, campaña y conjunto de las campañas que cuentan. Incluye clics e impresiones del enlace (solo días con dato) para el CTR del enlace. Solo Marketing.';
