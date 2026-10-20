-- 029 — Desglose de campañas en Control_Comunidades
--
-- Pedido (2026-10-20): debajo de la tabla "Métricas por comunidad", ver el desglose de las campañas contempladas (las que cuentan, igual que la tabla de arriba)
-- y que, si algún día hay otros medios (por ejemplo Google Ads), su detalle aparezca en el mismo lugar.
--
-- Hasta ahora la base guardaba el gasto SUMADO por comunidad y por día, sin saber de qué campaña salió. Cambios:
--   ads_campana_dia                 detalle por día, medio ('Meta Ads' hoy; la columna deja el lugar para Google Ads u otros), campaña, conjunto y comunidad.
--                                   Lo escriben las mismas rutinas que meta_ads_metrica (sincronización diaria y "Traer de Meta ahora") con las mismas reglas:
--                                   solo lo que cuenta. Igual que el resto, lectura abierta temporal hasta el SSO; no tiene datos personales.
--   _windsor_aplicar                (db/028) ahora también guarda y limpia ads_campana_dia. Todo lo demás es idéntico.
--   desglose_campanas(cliente, desde, hasta, comunidad)   devuelve el detalle agrupado para el rango (y la comunidad) que mira el panel.
--
-- IMPORTANTE: el detalle se llena hacia adelante. Los días anteriores a esta migración no lo tienen hasta que se vuelvan a traer (corrida de sincronización,
-- que cubre lo que hay en windsor_raw, o "Traer de Meta ahora" para tramos más viejos). El panel avisa cuando el desglose no cubre todo el total de la tabla.

create table if not exists crm_comunidades_v2.ads_campana_dia (
  medio           text not null default 'Meta Ads',
  cliente_id      uuid not null,
  comunidad_id    uuid not null,
  fecha           date not null,
  campana         text not null,
  adset           text not null default '',
  inversion       numeric(14,2) not null default 0,
  conversaciones  int not null default 0,
  impresiones     int not null default 0,
  clics           int not null default 0,
  leads           int not null default 0,
  actualizado_en  timestamptz not null default clock_timestamp(),
  primary key (medio, comunidad_id, fecha, campana, adset),
  foreign key (comunidad_id, cliente_id) references crm_comunidades_v2.comunidad (id, cliente_id) on delete cascade
);
create index if not exists idx_ads_campana_dia_cliente_fecha on crm_comunidades_v2.ads_campana_dia (cliente_id, fecha);

alter table crm_comunidades_v2.ads_campana_dia enable row level security;
-- Igual que el resto de las tablas hoy (db/003): lectura abierta temporal. db/005 la restringe por cliente.
drop policy if exists lectura_abierta on crm_comunidades_v2.ads_campana_dia;
create policy lectura_abierta on crm_comunidades_v2.ads_campana_dia for select using (true);
revoke all on crm_comunidades_v2.ads_campana_dia from anon, authenticated;
grant select on crm_comunidades_v2.ads_campana_dia to anon, authenticated;
grant select, insert, update, delete on crm_comunidades_v2.ads_campana_dia to service_role;
comment on table crm_comunidades_v2.ads_campana_dia is
  'Gasto y resultados por día, medio, campaña, conjunto y comunidad (solo lo que cuenta para las métricas). Lo escribe la sincronización con Windsor. Sin datos personales.';

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

  -- Detalle por campaña y conjunto de lo que cuenta (alimenta el desglose de Control_Comunidades). Mismos datos que meta_ads_metrica, con más granularidad.
  insert into crm_comunidades_v2.ads_campana_dia
         (medio, cliente_id, comunidad_id, fecha, campana, adset, inversion, conversaciones, impresiones, clics, leads, actualizado_en)
  select 'Meta Ads', a.cliente_id, a.comunidad_id, a.fecha, n.campana, n.adset, round(sum(a.inversion), 2),
         sum(a.conversaciones), sum(a.impresiones), sum(a.clics), sum(a.leads), clock_timestamp()
    from _windsor_asig a join _windsor_norm n on n.rn = a.rn
   group by a.cliente_id, a.comunidad_id, a.fecha, n.campana, n.adset
  on conflict (medio, comunidad_id, fecha, campana, adset) do update
     set inversion = excluded.inversion, conversaciones = excluded.conversaciones, impresiones = excluded.impresiones,
         clics = excluded.clics, leads = excluded.leads, actualizado_en = excluded.actualizado_en;

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
    delete from crm_comunidades_v2.ads_campana_dia d
     where d.medio = 'Meta Ads'
       and d.comunidad_id in (select o.comunidad_id from crm_comunidades_v2.comunidad_meta_origen o join crm_comunidades_v2.cliente c on c.id = o.cliente_id and c.activo)
       and d.fecha in (select distinct fecha from _windsor_norm)
       and not exists (select 1 from _windsor_asig a join _windsor_norm n on n.rn = a.rn
                        where a.comunidad_id = d.comunidad_id and a.fecha = d.fecha and n.campana = d.campana and n.adset = d.adset);
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

-- Desglose para el panel: lo que contó cada campaña y conjunto en el rango, y para la comunidad elegida si hay una.
create or replace function crm_comunidades_v2.desglose_campanas(p_cliente uuid, p_desde date default null, p_hasta date default null, p_comunidad uuid default null)
returns table (medio text, campana text, adset text, comunidad_id uuid, comunidad_nombre text,
               inversion numeric, conversaciones bigint, impresiones bigint, clics bigint, leads bigint, dias int)
language sql
stable
set search_path = crm_comunidades_v2, public
as $f$
  select d.medio, d.campana, d.adset, d.comunidad_id, co.nombre,
         round(sum(d.inversion), 2), sum(d.conversaciones)::bigint, sum(d.impresiones)::bigint, sum(d.clics)::bigint, sum(d.leads)::bigint,
         count(distinct d.fecha)::int
    from crm_comunidades_v2.ads_campana_dia d
    join crm_comunidades_v2.comunidad co on co.id = d.comunidad_id
   where d.cliente_id = p_cliente
     and (p_desde is null or d.fecha >= p_desde)
     and (p_hasta is null or d.fecha <= p_hasta)
     and (p_comunidad is null or d.comunidad_id = p_comunidad)
   group by d.medio, d.campana, d.adset, d.comunidad_id, co.nombre
   order by 6 desc, 1, 2, 3;
$f$;
grant execute on function crm_comunidades_v2.desglose_campanas(uuid, date, date, uuid) to anon, authenticated, service_role;
comment on function crm_comunidades_v2.desglose_campanas(uuid, date, date, uuid) is
  'Detalle por medio, campaña y conjunto de lo que cuenta para las métricas, en un rango de fechas (y comunidad opcional). Alimenta el desglose de Control_Comunidades.';
