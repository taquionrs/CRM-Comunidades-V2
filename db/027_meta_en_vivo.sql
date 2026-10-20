-- 027 — Meta en vivo: traer de Windsor, a pedido y para el rango elegido, y actualizar las métricas
--
-- Hasta ahora Windsor escribía una vez por día en windsor_raw y de ahí salía todo (db/015, db/025). Ahora el panel puede pedir "Traer de Meta ahora":
-- una función del servidor (supabase/functions/meta-en-vivo) consulta a Windsor para el rango elegido y le pasa las filas a la base, que aplica LAS
-- MISMAS reglas de siempre (qué campañas cuentan y en qué comunidad, db/025) y actualiza meta_ads_metrica.
--
-- Para no duplicar la lógica de asignación se la separa en una pieza común:
--   _windsor_normalizar_json(filas)       arma la misma tabla temporal que _windsor_normalizar, pero desde filas en JSON.
--   _windsor_aplicar(etiqueta)            asigna, actualiza meta_ads_metrica, quita lo que ya no corresponde y deja el registro en windsor_sync_log.
--                                         Es exactamente la lógica de sincronizar_meta_desde_windsor de db/025, sin cambios.
--   sincronizar_meta_desde_windsor(tabla) = normalizar la tabla cruda + _windsor_aplicar (mismo resultado que antes).
--   meta_en_vivo_aplicar(filas, desde, hasta)   la usa solo la función del servidor (service_role). Valida el rango (hasta 31 días, sin fechas futuras),
--                                         frena si hubo otra consulta en vivo hace menos de 45 segundos y descarta las filas fuera del rango.
--
-- El registro queda en windsor_sync_log con tabla = 'windsor_raw.en_vivo <desde> a <hasta>', así aparece en "Consultas" como una conversión.

create or replace function crm_comunidades_v2._windsor_normalizar_json(p_filas jsonb)
returns void
language plpgsql
set search_path = crm_comunidades_v2, public
as $$
begin
  drop table if exists _windsor_norm;
  create temp table _windsor_norm on commit drop as
  select row_number() over () as rn,
         left(x.d, 10)::date as fecha,
         nullif(btrim(x.account_id), '') as cuenta_id,
         btrim(coalesce(x.campaign, '')) as campana,
         btrim(coalesce(x.adset_name, '')) as adset,
         coalesce(nullif(x.spend, ''), '0')::numeric as inversion,
         round(coalesce(nullif(x.impressions, ''), '0')::numeric)::int as impresiones,
         round(coalesce(nullif(x.clicks, ''), '0')::numeric)::int as clics,
         round(coalesce(nullif(x.conv, ''), '0')::numeric)::int as conversaciones,
         round(coalesce(nullif(x.leads, ''), '0')::numeric)::int as leads
    from jsonb_to_recordset(coalesce(p_filas, '[]'::jsonb))
         as x(d text, account_id text, campaign text, adset_name text, spend text, impressions text, clicks text, conv text, leads text)
   where x.d ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}';
end;
$$;
revoke all on function crm_comunidades_v2._windsor_normalizar_json(jsonb) from public, anon, authenticated;

-- La lógica de asignación y actualización (la misma de db/025), sobre la tabla temporal _windsor_norm que dejó quien la llama.
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

  -- Lo que ya estaba en la base para fechas que trae Windsor y que ninguna regla vigente respalda. Solo si se asignó algo: un mapeo vacío no borra nada.
  if v_asig > 0 then
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

-- La sincronización de siempre (misma firma y mismo resultado), ahora apoyada en la pieza común.
create or replace function crm_comunidades_v2.sincronizar_meta_desde_windsor(p_tabla text default 'windsor_raw.facebook_ads')
returns table (filas_origen int, filas_asignadas int, registros_escritos int, filas_sin_comunidad int, gasto_sin_comunidad numeric)
language plpgsql
set search_path = crm_comunidades_v2, public
as $$
begin
  perform crm_comunidades_v2._windsor_normalizar(p_tabla);
  return query select * from crm_comunidades_v2._windsor_aplicar(p_tabla);
end;
$$;
revoke all on function crm_comunidades_v2.sincronizar_meta_desde_windsor(text) from public, anon, authenticated;
grant execute on function crm_comunidades_v2.sincronizar_meta_desde_windsor(text) to service_role;

-- Lo que usa la función del servidor: filas de Windsor para un rango → métricas. Solo service_role.
-- Cada fila: { d: 'AAAA-MM-DD', account_id, campaign, adset_name, spend, impressions, clicks, conv, leads }.
create or replace function crm_comunidades_v2.meta_en_vivo_aplicar(p_filas jsonb, p_desde date, p_hasta date)
returns table (filas_origen int, filas_asignadas int, registros_escritos int, filas_sin_comunidad int, gasto_sin_comunidad numeric)
language plpgsql
security definer
set search_path = crm_comunidades_v2, public
as $$
begin
  if p_desde is null or p_hasta is null or p_desde > p_hasta then raise exception 'El rango de fechas no es válido'; end if;
  if p_hasta - p_desde > 30 then raise exception 'El rango máximo es de 31 días'; end if;
  if p_hasta > current_date then raise exception 'No se pueden pedir fechas futuras'; end if;
  if jsonb_typeof(p_filas) is distinct from 'array' then raise exception 'Las filas de Windsor tienen que ser una lista'; end if;
  if jsonb_array_length(p_filas) > 50000 then raise exception 'Demasiadas filas (máximo 50.000)'; end if;
  if exists (select 1 from crm_comunidades_v2.windsor_sync_log l
              where l.tabla like 'windsor_raw.en_vivo%' and l.corrida_en > clock_timestamp() - interval '45 seconds') then
    raise exception 'Esperá un momento: ya se consultó Windsor hace instantes';
  end if;

  perform crm_comunidades_v2._windsor_normalizar_json(p_filas);
  delete from _windsor_norm n where n.fecha < p_desde or n.fecha > p_hasta;   -- nada fuera del rango pedido
  return query select * from crm_comunidades_v2._windsor_aplicar('windsor_raw.en_vivo ' || p_desde || ' a ' || p_hasta);
end;
$$;
revoke all on function crm_comunidades_v2.meta_en_vivo_aplicar(jsonb, date, date) from public, anon, authenticated;
grant execute on function crm_comunidades_v2.meta_en_vivo_aplicar(jsonb, date, date) to service_role;
comment on function crm_comunidades_v2.meta_en_vivo_aplicar(jsonb, date, date) is
  'Aplica a meta_ads_metrica las filas que la función del servidor trajo de Windsor para un rango (hasta 31 días), con las reglas de comunidad_meta_origen. Solo service_role.';
