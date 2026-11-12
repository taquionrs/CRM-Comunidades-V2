-- db/038 · Un día que llega sin clics en el enlace no borra los que ya estaban guardados (PR #68).
-- Problema: los clics en el enlace pueden entrar por dos caminos, "Traer de Meta ahora" (consulta directa a Windsor) y la tarea diaria
-- (tabla windsor_raw.facebook_ads). Si la tarea todavía no entrega actions_link_click, la conversión de las 06:30 reescribía los días con NULL
-- y las columnas volvían a "Sin fuente". Ahora el valor nuevo gana cuando existe y, si viene vacío, se conserva el que había.
-- Un cero real sigue siendo un dato: 0 pisa el valor anterior (solo NULL conserva).
-- Solo cambia _windsor_aplicar (copia de db/036 con tres cláusulas ON CONFLICT ajustadas). Mismos permisos.

create or replace function crm_comunidades_v2._windsor_aplicar(p_etiqueta text)
returns table (filas_origen int, filas_asignadas int, registros_escritos int, filas_sin_comunidad int, gasto_sin_comunidad numeric)
language plpgsql
set search_path = crm_comunidades_v2, public
as $$
declare
  v_origen int; v_asig int; v_escritos int; v_sin int; v_gasto numeric;
  v_excl int; v_gasto_excl numeric; v_borrados int := 0; v_globales int; v_n int;
begin
  -- Asignación con TODAS las reglas: la de conjunto gana sobre la de "toda la campaña". Después se separan las que cuentan de las que no.
  drop table if exists _windsor_asig_todas;
  create temp table _windsor_asig_todas on commit drop as
  select distinct on (n.rn)
         n.rn, n.fecha, n.inversion, n.impresiones, n.clics, n.clics_enlace, n.conversaciones, n.leads,
         o.cliente_id, o.comunidad_id, o.cuenta
    from _windsor_norm n
    join crm_comunidades_v2.comunidad_meta_origen o
      on crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(n.campana)
     and (o.adset_nombre is null
          or crm_comunidades_v2.normalizar_nombre(o.adset_nombre) = crm_comunidades_v2.normalizar_nombre(n.adset))
    join crm_comunidades_v2.cliente c on c.id = o.cliente_id and c.activo
   where c.meta_cuenta_id is null or n.cuenta_id is null or c.meta_cuenta_id = n.cuenta_id
   order by n.rn, (o.adset_nombre is null);

  drop table if exists _windsor_asig;
  create temp table _windsor_asig on commit drop as select * from _windsor_asig_todas where cuenta;

  select count(*), coalesce(sum(inversion), 0) into v_excl, v_gasto_excl from _windsor_asig_todas where not cuenta;

  -- sum() de clics_enlace da NULL si TODAS las filas del día vienen sin el dato: así "no llegó" no se confunde con 0.
  -- Y un día que llega sin el dato NO borra el que ya estaba guardado (por ejemplo el que trajo "Traer de Meta ahora"): coalesce con lo existente.
  insert into crm_comunidades_v2.meta_ads_metrica
         (cliente_id, comunidad_id, fecha, inversion, conversaciones_meta, impresiones, clics, clics_enlace, leads_meta)
  select cliente_id, comunidad_id, fecha, round(sum(inversion), 2), sum(conversaciones), sum(impresiones), sum(clics), sum(clics_enlace), sum(leads)
    from _windsor_asig
   where comunidad_id is not null
   group by cliente_id, comunidad_id, fecha
  on conflict (comunidad_id, fecha) do update
     set inversion = excluded.inversion, conversaciones_meta = excluded.conversaciones_meta,
         impresiones = excluded.impresiones, clics = excluded.clics, leads_meta = excluded.leads_meta,
         clics_enlace = coalesce(excluded.clics_enlace, meta_ads_metrica.clics_enlace);
  get diagnostics v_escritos = row_count;

  -- Campañas globales del cliente (regla sin comunidad): el gasto queda a nivel cliente, no en ninguna comunidad.
  insert into crm_comunidades_v2.meta_ads_metrica_global (cliente_id, fecha, inversion, conversaciones_meta, impresiones, clics, clics_enlace, leads_meta)
  select cliente_id, fecha, round(sum(inversion), 2), sum(conversaciones), sum(impresiones), sum(clics), sum(clics_enlace), sum(leads)
    from _windsor_asig
   where comunidad_id is null
   group by cliente_id, fecha
  on conflict (cliente_id, fecha) do update
     set inversion = excluded.inversion, conversaciones_meta = excluded.conversaciones_meta,
         impresiones = excluded.impresiones, clics = excluded.clics, leads_meta = excluded.leads_meta,
         clics_enlace = coalesce(excluded.clics_enlace, meta_ads_metrica_global.clics_enlace);
  get diagnostics v_globales = row_count;
  v_escritos := v_escritos + v_globales;

  -- Detalle por campaña y conjunto de lo que cuenta (alimenta el desglose de Control_Comunidades). Mismos datos que meta_ads_metrica, con más granularidad.
  insert into crm_comunidades_v2.ads_campana_dia
         (medio, cliente_id, comunidad_id, fecha, campana, adset, inversion, conversaciones, impresiones, clics, clics_enlace, leads, actualizado_en)
  select 'Meta Ads', a.cliente_id, a.comunidad_id, a.fecha, n.campana, n.adset, round(sum(a.inversion), 2),
         sum(a.conversaciones), sum(a.impresiones), sum(a.clics), sum(a.clics_enlace), sum(a.leads), clock_timestamp()
    from _windsor_asig a join _windsor_norm n on n.rn = a.rn
   group by a.cliente_id, a.comunidad_id, a.fecha, n.campana, n.adset
  on conflict (medio, cliente_id, (coalesce(comunidad_id, '00000000-0000-0000-0000-000000000000'::uuid)), fecha, campana, adset) do update
     set inversion = excluded.inversion, conversaciones = excluded.conversaciones, impresiones = excluded.impresiones,
         clics = excluded.clics, leads = excluded.leads, actualizado_en = excluded.actualizado_en,
         clics_enlace = coalesce(excluded.clics_enlace, ads_campana_dia.clics_enlace);

  select count(*) into v_origen from _windsor_norm;
  select count(*) into v_asig from _windsor_asig;

  -- Lo que ya estaba en la base para fechas que trae Windsor y que ninguna regla vigente respalda. Solo si alguna fila coincidió con ALGUNA regla (cuente o no):
  -- un mapeo vacío o roto no borra nada, pero un período donde todo el gasto es de campañas que no cuentan sí se limpia.
  if exists (select 1 from _windsor_asig_todas) then
    delete from crm_comunidades_v2.meta_ads_metrica m
     where m.comunidad_id in (select o.comunidad_id from crm_comunidades_v2.comunidad_meta_origen o join crm_comunidades_v2.cliente c on c.id = o.cliente_id and c.activo
                               where o.comunidad_id is not null)
       and m.fecha in (select distinct fecha from _windsor_norm)
       and not exists (select 1 from _windsor_asig a where a.comunidad_id = m.comunidad_id and a.fecha = m.fecha);
    get diagnostics v_borrados = row_count;
    delete from crm_comunidades_v2.meta_ads_metrica_global g
     where g.cliente_id in (select o.cliente_id from crm_comunidades_v2.comunidad_meta_origen o join crm_comunidades_v2.cliente c on c.id = o.cliente_id and c.activo)
       and g.fecha in (select distinct fecha from _windsor_norm)
       and not exists (select 1 from _windsor_asig a where a.comunidad_id is null and a.cliente_id = g.cliente_id and a.fecha = g.fecha);
    get diagnostics v_n = row_count;
    v_borrados := v_borrados + v_n;
    delete from crm_comunidades_v2.ads_campana_dia d
     where d.medio = 'Meta Ads'
       and d.cliente_id in (select o.cliente_id from crm_comunidades_v2.comunidad_meta_origen o join crm_comunidades_v2.cliente c on c.id = o.cliente_id and c.activo)
       and d.fecha in (select distinct fecha from _windsor_norm)
       and not exists (select 1 from _windsor_asig a join _windsor_norm n on n.rn = a.rn
                        where a.cliente_id = d.cliente_id and coalesce(a.comunidad_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(d.comunidad_id, '00000000-0000-0000-0000-000000000000'::uuid)
                          and a.fecha = d.fecha and n.campana = d.campana and n.adset = d.adset);
  end if;

  select count(*), coalesce(sum(n.inversion), 0) into v_sin, v_gasto
    from _windsor_norm n
   where exists (select 1 from crm_comunidades_v2.comunidad_meta_origen o
                  where crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(n.campana))
     and not exists (select 1 from _windsor_asig_todas a where a.rn = n.rn);

  insert into crm_comunidades_v2.windsor_sync_log
         (tabla, filas_origen, filas_asignadas, registros_escritos, filas_sin_comunidad, gasto_sin_comunidad, filas_excluidas, gasto_excluido, registros_borrados)
  values (p_etiqueta, v_origen, v_asig, v_escritos, v_sin, v_gasto, v_excl, round(v_gasto_excl, 2), v_borrados);

  return query select v_origen, v_asig, v_escritos, v_sin, round(v_gasto, 2);
end;
$$;
revoke all on function crm_comunidades_v2._windsor_aplicar(text) from public, anon, authenticated;
