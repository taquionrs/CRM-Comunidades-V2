-- 028 — La limpieza del gasto que ya no cuenta también corre cuando TODO el gasto del período es de campañas que no cuentan
--
-- Problema (2026-10-20): al traer de Windsor el tramo 14/08 al 12/09, todas las filas eran de la campaña INTE (que no cuenta). La protección de db/025 y
-- db/027 ("no borrar nada si no se asignó ninguna fila") frenó la limpieza y el gasto viejo siguió en meta_ads_metrica ($3.873.506,76 en la comunidad general).
-- Cambio: la protección ahora mira si alguna fila coincidió con ALGUNA regla (cuente o no). Un mapeo vacío o roto sigue sin borrar nada, pero un período en el
-- que todo el gasto es de campañas que no cuentan se limpia como corresponde. El resto de _windsor_aplicar es idéntico a db/027.

create or replace function crm_comunidades_v2._windsor_aplicar(p_etiqueta text)
returns table (filas_origen int, filas_asignadas int, registros_escritos int, filas_sin_comunidad int, gasto_sin_comunidad numeric)
language plpgsql
set search_path = crm_comunidades_v2, public
as $$
declare
  v_origen int; v_asig int; v_escritos int; v_sin int; v_gasto numeric;
  v_excl int; v_gasto_excl numeric; v_borrados int := 0;
begin
  -- Asignación con TODAS las reglas: la de conjunto gana sobre la de "toda la campaña". Después se separan las que cuentan de las que no.
  drop table if exists _windsor_asig_todas;
  create temp table _windsor_asig_todas on commit drop as
  select distinct on (n.rn)
         n.rn, n.fecha, n.inversion, n.impresiones, n.clics, n.conversaciones, n.leads,
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

  insert into crm_comunidades_v2.meta_ads_metrica
         (cliente_id, comunidad_id, fecha, inversion, conversaciones_meta, impresiones, clics, leads_meta)
  select cliente_id, comunidad_id, fecha, round(sum(inversion), 2), sum(conversaciones), sum(impresiones), sum(clics), sum(leads)
    from _windsor_asig
   group by cliente_id, comunidad_id, fecha
  on conflict (comunidad_id, fecha) do update
     set inversion = excluded.inversion, conversaciones_meta = excluded.conversaciones_meta,
         impresiones = excluded.impresiones, clics = excluded.clics, leads_meta = excluded.leads_meta;
  get diagnostics v_escritos = row_count;

  select count(*) into v_origen from _windsor_norm;
  select count(*) into v_asig from _windsor_asig;

  -- Lo que ya estaba en la base para fechas que trae Windsor y que ninguna regla vigente respalda. Solo si alguna fila coincidió con ALGUNA regla (cuente o no):
  -- un mapeo vacío o roto no borra nada, pero un período donde todo el gasto es de campañas que no cuentan sí se limpia.
  if exists (select 1 from _windsor_asig_todas) then
    delete from crm_comunidades_v2.meta_ads_metrica m
     where m.comunidad_id in (select o.comunidad_id from crm_comunidades_v2.comunidad_meta_origen o join crm_comunidades_v2.cliente c on c.id = o.cliente_id and c.activo)
       and m.fecha in (select distinct fecha from _windsor_norm)
       and not exists (select 1 from _windsor_asig a where a.comunidad_id = m.comunidad_id and a.fecha = m.fecha);
    get diagnostics v_borrados = row_count;
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
