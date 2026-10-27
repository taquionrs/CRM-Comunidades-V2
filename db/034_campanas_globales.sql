-- 034 — Campañas globales del cliente: el gasto se guarda a nivel cliente, no en una comunidad
--
-- Pedido (2026-10-27): en las campañas de WhatsApp el prospecto elige su comunidad dentro del flow; la campaña no pertenece a ninguna comunidad.
-- Hasta ahora toda regla de campaña tenía que apuntar a una comunidad, y la comunidad "(general)" no sirve de depósito: es una comunidad real
-- (el grupo y el bot que dispara los triggers, con sus miembros y su planilla), y recibir gasto que no es suyo contaminaba sus métricas.
--
--   comunidad_meta_origen.comunidad_id   ahora puede ser NULL: una regla sin comunidad es "campaña global del cliente" (y se agrega la clave al cliente).
--   meta_ads_metrica_global              gasto y resultados por cliente y día de esas campañas (no se reparte entre comunidades).
--   ads_campana_dia.comunidad_id         ahora puede ser NULL (el detalle por campaña de lo global).
--   _windsor_aplicar                     (db/029) escribe lo global en meta_ads_metrica_global y lo limpia igual que lo demás. Nada más cambia.
--   guardar_regla_campana                nueva acción 'cuenta_global' (con p_cliente). La firma cambia: se reemplaza la anterior.
--   desglose_campanas                    las filas globales salen como "Campañas globales (sin comunidad)".
--   metricas_globales_cliente            lo global de un cliente en un período, para la fila de Control_Comunidades y los totales de Overview.
--   campania_regla_historial             acepta la acción 'cuenta_global'.
-- Lo que ya estaba asignado a comunidades no cambia. Aplicar después de 032.

alter table crm_comunidades_v2.comunidad_meta_origen alter column comunidad_id drop not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'comunidad_meta_origen_cliente_fk') then
    alter table crm_comunidades_v2.comunidad_meta_origen
      add constraint comunidad_meta_origen_cliente_fk foreign key (cliente_id) references crm_comunidades_v2.cliente (id) on delete cascade;
  end if;
end $$;

alter table crm_comunidades_v2.campania_regla_historial drop constraint if exists campania_regla_historial_accion_check;
alter table crm_comunidades_v2.campania_regla_historial
  add constraint campania_regla_historial_accion_check check (accion in ('cuenta', 'cuenta_global', 'no_cuenta', 'sin_asignar', 'recalcular'));

create table if not exists crm_comunidades_v2.meta_ads_metrica_global (
  cliente_id           uuid not null references crm_comunidades_v2.cliente (id) on delete cascade,
  fecha                date not null,
  inversion            numeric(14,2) not null default 0,
  conversaciones_meta  int not null default 0,
  impresiones          int not null default 0,
  clics                int not null default 0,
  leads_meta           int not null default 0,
  primary key (cliente_id, fecha)
);
alter table crm_comunidades_v2.meta_ads_metrica_global enable row level security;
revoke all on crm_comunidades_v2.meta_ads_metrica_global from public, anon, authenticated;
grant select on crm_comunidades_v2.meta_ads_metrica_global to authenticated;
grant all on crm_comunidades_v2.meta_ads_metrica_global to service_role;
drop policy if exists marketing_select on crm_comunidades_v2.meta_ads_metrica_global;
create policy marketing_select on crm_comunidades_v2.meta_ads_metrica_global for select to authenticated
  using ((select crm_comunidades_v2.es_marketing()));
comment on table crm_comunidades_v2.meta_ads_metrica_global is
  'Gasto y resultados de Meta por cliente y día de las campañas globales (el prospecto elige su comunidad en el flow). No se reparte entre comunidades.';

alter table crm_comunidades_v2.ads_campana_dia drop constraint if exists ads_campana_dia_pkey;
alter table crm_comunidades_v2.ads_campana_dia alter column comunidad_id drop not null;
create unique index if not exists uq_ads_campana_dia
  on crm_comunidades_v2.ads_campana_dia (medio, cliente_id, (coalesce(comunidad_id, '00000000-0000-0000-0000-000000000000'::uuid)), fecha, campana, adset);

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
   where comunidad_id is not null
   group by cliente_id, comunidad_id, fecha
  on conflict (comunidad_id, fecha) do update
     set inversion = excluded.inversion, conversaciones_meta = excluded.conversaciones_meta,
         impresiones = excluded.impresiones, clics = excluded.clics, leads_meta = excluded.leads_meta;
  get diagnostics v_escritos = row_count;

  -- Campañas globales del cliente (regla sin comunidad): el gasto queda a nivel cliente, no en ninguna comunidad.
  insert into crm_comunidades_v2.meta_ads_metrica_global (cliente_id, fecha, inversion, conversaciones_meta, impresiones, clics, leads_meta)
  select cliente_id, fecha, round(sum(inversion), 2), sum(conversaciones), sum(impresiones), sum(clics), sum(leads)
    from _windsor_asig
   where comunidad_id is null
   group by cliente_id, fecha
  on conflict (cliente_id, fecha) do update
     set inversion = excluded.inversion, conversaciones_meta = excluded.conversaciones_meta,
         impresiones = excluded.impresiones, clics = excluded.clics, leads_meta = excluded.leads_meta;
  get diagnostics v_globales = row_count;
  v_escritos := v_escritos + v_globales;

  -- Detalle por campaña y conjunto de lo que cuenta (alimenta el desglose de Control_Comunidades). Mismos datos que meta_ads_metrica, con más granularidad.
  insert into crm_comunidades_v2.ads_campana_dia
         (medio, cliente_id, comunidad_id, fecha, campana, adset, inversion, conversaciones, impresiones, clics, leads, actualizado_en)
  select 'Meta Ads', a.cliente_id, a.comunidad_id, a.fecha, n.campana, n.adset, round(sum(a.inversion), 2),
         sum(a.conversaciones), sum(a.impresiones), sum(a.clics), sum(a.leads), clock_timestamp()
    from _windsor_asig a join _windsor_norm n on n.rn = a.rn
   group by a.cliente_id, a.comunidad_id, a.fecha, n.campana, n.adset
  on conflict (medio, cliente_id, (coalesce(comunidad_id, '00000000-0000-0000-0000-000000000000'::uuid)), fecha, campana, adset) do update
     set inversion = excluded.inversion, conversaciones = excluded.conversaciones, impresiones = excluded.impresiones,
         clics = excluded.clics, leads = excluded.leads, actualizado_en = excluded.actualizado_en;

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

-- La firma de guardar_regla_campana cambia (se suma p_cliente): se reemplaza la anterior.
drop function if exists crm_comunidades_v2.guardar_regla_campana(text, text, text, uuid, text, text);
create or replace function crm_comunidades_v2.guardar_regla_campana(
  p_campana text, p_adset text, p_accion text, p_comunidad uuid default null, p_motivo text default null, p_por text default null, p_cliente uuid default null)
returns void
language plpgsql
security definer
set search_path = crm_comunidades_v2, public
as $$
declare
  v_camp text := btrim(coalesce(p_campana, ''));
  v_adset text := nullif(btrim(coalesce(p_adset, '')), '');
  v_cli uuid; v_dest text; v_antes jsonb; v_despues jsonb := '[]'::jsonb; v_amplia record; v_n int;
  v_motivo text := coalesce(nullif(btrim(p_motivo), ''), 'Marcada como "no cuenta" desde el panel');
begin
  perform crm_comunidades_v2._exigir_marketing();
  perform crm_comunidades_v2._exigir_marketing();
  if v_camp = '' then raise exception 'Falta el nombre de la campaña'; end if;
  if p_accion not in ('cuenta', 'cuenta_global', 'no_cuenta', 'sin_asignar') then raise exception 'Acción inválida (cuenta, cuenta_global, no_cuenta o sin_asignar)'; end if;

  -- Solo se puede clasificar algo que realmente llega de Windsor.
  perform crm_comunidades_v2._windsor_normalizar('windsor_raw.facebook_ads');
  if not exists (select 1 from _windsor_norm n
                  where crm_comunidades_v2.normalizar_nombre(n.campana) = crm_comunidades_v2.normalizar_nombre(v_camp)
                    and (v_adset is null or crm_comunidades_v2.normalizar_nombre(n.adset) = crm_comunidades_v2.normalizar_nombre(v_adset))) then
    raise exception 'Esa campaña o conjunto no existe en los datos de Windsor';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('comunidad_id', o.comunidad_id, 'cuenta', o.cuenta)), '[]'::jsonb) into v_antes
    from crm_comunidades_v2.comunidad_meta_origen o
   where crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(v_camp)
     and coalesce(crm_comunidades_v2.normalizar_nombre(o.adset_nombre), '') = coalesce(crm_comunidades_v2.normalizar_nombre(v_adset), '');

  if p_accion = 'cuenta' then
    if p_comunidad is null then raise exception 'Elegí la comunidad en la que cuenta'; end if;
    select co.cliente_id, cl.nombre || ' / ' || co.nombre into v_cli, v_dest
      from crm_comunidades_v2.comunidad co join crm_comunidades_v2.cliente cl on cl.id = co.cliente_id where co.id = p_comunidad;
    if v_cli is null then raise exception 'La comunidad no existe'; end if;
    delete from crm_comunidades_v2.comunidad_meta_origen o
     where crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(v_camp)
       and coalesce(crm_comunidades_v2.normalizar_nombre(o.adset_nombre), '') = coalesce(crm_comunidades_v2.normalizar_nombre(v_adset), '');
    insert into crm_comunidades_v2.comunidad_meta_origen (cliente_id, comunidad_id, campana_nombre, adset_nombre, cuenta, motivo_exclusion)
    values (v_cli, p_comunidad, v_camp, v_adset, true, null);
    v_despues := jsonb_build_array(jsonb_build_object('comunidad_id', p_comunidad, 'cuenta', true));

  elsif p_accion = 'cuenta_global' then
    if p_cliente is null then raise exception 'Elegí el cliente al que pertenece la campaña global'; end if;
    select cl.id, cl.nombre || ' / campañas globales (sin comunidad)' into v_cli, v_dest from crm_comunidades_v2.cliente cl where cl.id = p_cliente;
    if v_cli is null then raise exception 'El cliente no existe'; end if;
    delete from crm_comunidades_v2.comunidad_meta_origen o
     where crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(v_camp)
       and coalesce(crm_comunidades_v2.normalizar_nombre(o.adset_nombre), '') = coalesce(crm_comunidades_v2.normalizar_nombre(v_adset), '');
    insert into crm_comunidades_v2.comunidad_meta_origen (cliente_id, comunidad_id, campana_nombre, adset_nombre, cuenta, motivo_exclusion)
    values (v_cli, null, v_camp, v_adset, true, null);
    v_despues := jsonb_build_array(jsonb_build_object('cliente_id', v_cli, 'global', true, 'cuenta', true));

  elsif p_accion = 'no_cuenta' then
    update crm_comunidades_v2.comunidad_meta_origen o
       set cuenta = false, motivo_exclusion = v_motivo
     where crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(v_camp)
       and coalesce(crm_comunidades_v2.normalizar_nombre(o.adset_nombre), '') = coalesce(crm_comunidades_v2.normalizar_nombre(v_adset), '');
    get diagnostics v_n = row_count;
    if v_n = 0 and v_adset is not null then
      select o.* into v_amplia from crm_comunidades_v2.comunidad_meta_origen o
       where crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(v_camp) and o.adset_nombre is null limit 1;
      if found and v_amplia.cuenta then
        insert into crm_comunidades_v2.comunidad_meta_origen (cliente_id, comunidad_id, campana_nombre, adset_nombre, cuenta, motivo_exclusion)
        values (v_amplia.cliente_id, v_amplia.comunidad_id, v_camp, v_adset, false, v_motivo);
        v_n := 1;
      end if;
    end if;
    if v_n > 0 then v_despues := jsonb_build_array(jsonb_build_object('cuenta', false)); end if;

  else
    delete from crm_comunidades_v2.comunidad_meta_origen o
     where crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(v_camp)
       and coalesce(crm_comunidades_v2.normalizar_nombre(o.adset_nombre), '') = coalesce(crm_comunidades_v2.normalizar_nombre(v_adset), '');
  end if;

  insert into crm_comunidades_v2.campania_regla_historial (cambiado_por, campana, adset, accion, destino, antes, despues)
  values (left(nullif(btrim(p_por), ''), 80), v_camp, v_adset, p_accion, v_dest, v_antes, v_despues);
end;
$$;


revoke all on function crm_comunidades_v2.guardar_regla_campana(text, text, text, uuid, text, text, uuid) from public, anon;
grant execute on function crm_comunidades_v2.guardar_regla_campana(text, text, text, uuid, text, text, uuid) to authenticated, service_role;

-- desglose_campanas: mismas columnas; las filas globales no tienen comunidad.
create or replace function crm_comunidades_v2.desglose_campanas(p_cliente uuid, p_desde date default null, p_hasta date default null, p_comunidad uuid default null)
returns table (medio text, campana text, adset text, comunidad_id uuid, comunidad_nombre text,
               inversion numeric, conversaciones bigint, impresiones bigint, clics bigint, leads bigint, dias int)
language sql
stable
set search_path = crm_comunidades_v2, public
as $f$
  select crm_comunidades_v2._exigir_marketing();
  select crm_comunidades_v2._exigir_marketing();
  select d.medio, d.campana, d.adset, d.comunidad_id, coalesce(co.nombre, 'Campañas globales (sin comunidad)'),
         round(sum(d.inversion), 2), sum(d.conversaciones)::bigint, sum(d.impresiones)::bigint, sum(d.clics)::bigint, sum(d.leads)::bigint,
         count(distinct d.fecha)::int
    from crm_comunidades_v2.ads_campana_dia d
    left join crm_comunidades_v2.comunidad co on co.id = d.comunidad_id
   where d.cliente_id = p_cliente
     and (p_desde is null or d.fecha >= p_desde)
     and (p_hasta is null or d.fecha <= p_hasta)
     and (p_comunidad is null or d.comunidad_id = p_comunidad)
   group by d.medio, d.campana, d.adset, d.comunidad_id, co.nombre
   order by 6 desc, 1, 2, 3;
$f$;

-- Lo global de un cliente en un período. Cualquier usuario del CRM ve los conteos; la inversión solo la ve Marketing (igual que en las comunidades).
create or replace function crm_comunidades_v2.metricas_globales_cliente(p_cliente uuid, p_desde date default null, p_hasta date default null)
returns table (inversion numeric, conversaciones_meta bigint, impresiones bigint, clics bigint, leads_meta bigint)
language plpgsql
stable
security definer
set search_path = crm_comunidades_v2, public
as $f$
begin
  return query
  with a as (select crm_comunidades_v2.es_usuario_crm() as ok, crm_comunidades_v2.es_marketing() as mk)
  select case when a.mk then coalesce(sum(g.inversion), 0) end,
         coalesce(sum(g.conversaciones_meta), 0)::bigint, coalesce(sum(g.impresiones), 0)::bigint, coalesce(sum(g.clics), 0)::bigint, coalesce(sum(g.leads_meta), 0)::bigint
    from a
    left join crm_comunidades_v2.meta_ads_metrica_global g
      on g.cliente_id = p_cliente and (p_desde is null or g.fecha >= p_desde) and (p_hasta is null or g.fecha <= p_hasta)
   where a.ok
   group by a.mk;
end;
$f$;
revoke all on function crm_comunidades_v2.metricas_globales_cliente(uuid, date, date) from public, anon;
grant execute on function crm_comunidades_v2.metricas_globales_cliente(uuid, date, date) to authenticated, service_role;
comment on function crm_comunidades_v2.metricas_globales_cliente(uuid, date, date) is
  'Gasto y resultados de las campañas globales de un cliente en un período. Solo conteos para el rol General; la inversión solo para Marketing.';
