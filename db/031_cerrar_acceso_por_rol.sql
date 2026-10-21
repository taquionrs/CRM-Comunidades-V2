-- ============================================================================
-- CRM de Comunidades V2 — cierre del acceso anónimo y permisos por rol, parte 2 de 2
-- Ref: specs/2026-10-21-sso-cloudflare-y-roles.md
--
-- ⚠️ Aplicar JUNTO con el deploy del panel con login (y después de 030). Sin sesión, el panel no ve nada.
-- ⚠️ Antes, cambiar el nodo de n8n que lee `comunidad` por la función datos_comunidad_planilla (ver
--    docs/how-to/configurar-n8n-contactos-wsp.md): este cambio le quita a la clave anon la lectura de las tablas.
--
-- Qué hace:
--   1. La clave anon deja de leer el esquema: solo conserva las dos funciones de n8n, que exigen su secreto.
--   2. RLS por rol (db/030): cliente y comunidad, cualquier usuario del CRM; lo demás que usa el panel
--      (datos personales, plata, logs), solo Marketing. Editar comunidades y Mi/Mf, solo Marketing.
--   3. Los conteos de Overview y Control_Comunidades (comunidad_performance, kpis_macro y
--      comunidad_performance_rango) se calculan con los permisos del dueño, así el rol General ve los conteos
--      sin poder leer las filas de origen. La plata (inversión, CPMI, CPME y costos) sale NULL si no es Marketing.
--   4. Las funciones del panel que leen plata o datos personales, o que escriben, exigen Marketing
--      (_exigir_marketing, al principio de cada una). Se copian tal cual de su última versión.
--   5. EXECUTE de las funciones: nada por defecto para anon/authenticated; cada una se habilita explícitamente.
--
-- Reemplaza a db/003 (lectura abierta temporal) y a db/005 (que no se aplica). Idempotente.
-- ============================================================================
set search_path = crm_comunidades_v2, public;

-- ----------------------------------------------------------------------------
-- 1 y 2. Tablas: RLS en todas, políticas por rol
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
  p record;
begin
  for t in select tablename from pg_tables where schemaname = 'crm_comunidades_v2' loop
    execute format('alter table crm_comunidades_v2.%I enable row level security', t);
  end loop;
  -- Se borran TODAS las políticas anteriores (001, 003 y las que se agregaron después).
  for p in select policyname, tablename from pg_policies where schemaname = 'crm_comunidades_v2' loop
    execute format('drop policy %I on crm_comunidades_v2.%I', p.policyname, p.tablename);
  end loop;

  -- Cualquier usuario del CRM: selector de cliente y nombres de comunidades.
  foreach t in array array['cliente', 'comunidad'] loop
    execute format('create policy usuario_crm_select on crm_comunidades_v2.%I for select to authenticated '
                   'using ((select crm_comunidades_v2.es_usuario_crm()))', t);
  end loop;

  -- Solo Marketing: datos personales, plata y registros que lee el panel.
  foreach t in array array['usuario_curado', 'meta_ads_metrica', 'evento_crudo', 'webhook_intento', 'envio_planilla',
                           'usuario_estado_historial', 'trigger_entregado', 'clic_me_sumo', 'comunidad_meta_origen',
                           'ads_campana_dia', 'campania_regla_historial'] loop
    execute format('create policy marketing_select on crm_comunidades_v2.%I for select to authenticated '
                   'using ((select crm_comunidades_v2.es_marketing()))', t);
  end loop;

  -- Solo Marketing escribe desde el panel (alta de comunidades, Mi/Mf, adset_name).
  foreach t in array array['comunidad', 'usuario_curado', 'meta_ads_metrica'] loop
    execute format('create policy marketing_insert on crm_comunidades_v2.%I for insert to authenticated '
                   'with check ((select crm_comunidades_v2.es_marketing()))', t);
    execute format('create policy marketing_update on crm_comunidades_v2.%I for update to authenticated '
                   'using ((select crm_comunidades_v2.es_marketing())) with check ((select crm_comunidades_v2.es_marketing()))', t);
    execute format('create policy marketing_delete on crm_comunidades_v2.%I for delete to authenticated '
                   'using ((select crm_comunidades_v2.es_marketing()))', t);
  end loop;
  -- El resto de las tablas (cargas de miembros, configuración, registros de Windsor, usuarios) queda sin políticas:
  -- solo se llega a ellas por funciones security definer o con la clave de servicio.
end $$;

-- anon: nada de tablas ni vistas. authenticated: solo escribe donde hay política de escritura.
revoke all on all tables in schema crm_comunidades_v2 from anon;
alter default privileges in schema crm_comunidades_v2 revoke all on tables from anon;
revoke insert, update, delete on all tables in schema crm_comunidades_v2 from authenticated;
grant insert, update, delete on crm_comunidades_v2.comunidad, crm_comunidades_v2.usuario_curado, crm_comunidades_v2.meta_ads_metrica to authenticated;
revoke all on crm_comunidades_v2.usuario_crm, crm_comunidades_v2.usuario_crm_auditoria, crm_comunidades_v2.config_n8n,
              crm_comunidades_v2.config_carga_miembros from authenticated;

-- ----------------------------------------------------------------------------
-- 3. Conteos para todos los roles, plata solo para Marketing
-- ----------------------------------------------------------------------------
-- Mismas columnas, tipos y cálculos que db/021. security_invoker = false: lee con los permisos del dueño, filtrado por
-- es_usuario_crm(). Ojo: una vista con security_invoker usada adentro sigue leyendo con los permisos de quien consulta,
-- por eso acá no se usa evento_deduplicado. Esa vista y base_limpia siguen con security_invoker (datos personales: solo Marketing).
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
where a.ok;

create or replace view crm_comunidades_v2.kpis_macro with (security_invoker = false) as
with acceso as (select crm_comunidades_v2.es_marketing() as mk)
select
  p.cliente_id,
  case when a.mk then coalesce(sum(p.inversion), 0) end as inversion_total,
  coalesce(sum(p.conversaciones_meta), 0) as conversaciones_totales,
  case when a.mk then round(coalesce(sum(p.inversion), 0) / nullif(coalesce(sum(p.conversaciones_meta), 0), 0), 2) end as cpl_global,
  coalesce(sum(p.clics_unicos), 0) as clics_unicos_totales,
  coalesce(sum(p.miembros_finales), 0) as miembros_efectivos_totales,
  case when a.mk then round(coalesce(sum(p.inversion), 0) / nullif(sum(p.miembros_finales) - sum(p.miembros_iniciales), 0), 2) end as cpme_global,
  round(
    sum(p.bajas_estimadas)::numeric
    / nullif(sum(p.bajas_estimadas) + sum(p.miembros_finales) filter (where p.bajas_estimadas is not null), 0) * 100, 2
  ) as tasa_fuga_global_pct
from acceso a
cross join crm_comunidades_v2.comunidad_performance p
group by p.cliente_id, a.mk;

revoke all on crm_comunidades_v2.comunidad_performance, crm_comunidades_v2.kpis_macro,
              crm_comunidades_v2.evento_deduplicado, crm_comunidades_v2.base_limpia from anon;
grant select on crm_comunidades_v2.comunidad_performance, crm_comunidades_v2.kpis_macro,
               crm_comunidades_v2.evento_deduplicado, crm_comunidades_v2.base_limpia to authenticated, service_role;

-- Matriz de Control_Comunidades: misma firma, columnas y cálculos que db/022, ahora security definer con el mismo
-- criterio que las vistas de arriba (vacía sin acceso, plata NULL si no es Marketing).
create or replace function crm_comunidades_v2.comunidad_performance_rango(
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
  costo_por_clic_me_sumo numeric
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
           sum(leads_meta)          as leads_meta
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
    case when a.mk then round(coalesce(m.inversion, 0) / nullif(coalesce(k.clics_me_sumo, 0), 0), 2) end
  from acceso a
  cross join crm_comunidades_v2.comunidad c
  left join m on m.comunidad_id = c.id
  left join u on u.comunidad_id = c.id
  left join t on t.comunidad_id = c.id
  left join k on k.comunidad_id = c.id
  where c.cliente_id = p_cliente
    and a.ok
  order by c.nombre;
$$;

-- ----------------------------------------------------------------------------
-- 4. Funciones del panel que solo puede usar Marketing (copiadas de su última versión, con el control al principio)
-- ----------------------------------------------------------------------------
-- desglose_campanas: copia de db/031_cerrar_acceso_por_rol.sql con el control de rol al principio.
create or replace function crm_comunidades_v2.desglose_campanas(p_cliente uuid, p_desde date default null, p_hasta date default null, p_comunidad uuid default null)
returns table (medio text, campana text, adset text, comunidad_id uuid, comunidad_nombre text,
               inversion numeric, conversaciones bigint, impresiones bigint, clics bigint, leads bigint, dias int)
language sql
stable
set search_path = crm_comunidades_v2, public
as $f$
  select crm_comunidades_v2._exigir_marketing();
  select crm_comunidades_v2._exigir_marketing();
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

-- campanas_windsor: copia de db/031_cerrar_acceso_por_rol.sql con el control de rol al principio.
create or replace function crm_comunidades_v2.campanas_windsor(p_dias int default 90, p_tabla text default 'windsor_raw.facebook_ads')
returns table (
  campana text, adset text, cuenta_id text,
  gasto numeric, conversaciones bigint, clics bigint, impresiones bigint,
  desde date, hasta date, dias int,
  regla_id uuid, alcance text, cliente_id uuid, cliente_nombre text, comunidad_id uuid, comunidad_nombre text,
  cuenta boolean, motivo text
)
language plpgsql
security definer
set search_path = crm_comunidades_v2, public
as $$
begin
  perform crm_comunidades_v2._exigir_marketing();
  perform crm_comunidades_v2._exigir_marketing();
  perform crm_comunidades_v2._windsor_normalizar(p_tabla);
  return query
  select n.campana, n.adset, max(n.cuenta_id),
         round(sum(n.inversion), 2), sum(n.conversaciones)::bigint, sum(n.clics)::bigint, sum(n.impresiones)::bigint,
         min(n.fecha), max(n.fecha), count(distinct n.fecha)::int,
         r.id,
         case when r.id is null then null when r.adset_nombre is null then 'campana' else 'conjunto' end,
         r.cliente_id, cl.nombre, r.comunidad_id, co.nombre, r.cuenta, r.motivo_exclusion
    from _windsor_norm n
    left join lateral (
      select o.* from crm_comunidades_v2.comunidad_meta_origen o
       where crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(n.campana)
         and (o.adset_nombre is null or crm_comunidades_v2.normalizar_nombre(o.adset_nombre) = crm_comunidades_v2.normalizar_nombre(n.adset))
       order by (o.adset_nombre is null)
       limit 1) r on true
    left join crm_comunidades_v2.cliente cl on cl.id = r.cliente_id
    left join crm_comunidades_v2.comunidad co on co.id = r.comunidad_id
   where n.fecha >= current_date - greatest(coalesce(p_dias, 90), 1)
   group by n.campana, n.adset, r.id, r.adset_nombre, r.cliente_id, cl.nombre, r.comunidad_id, co.nombre, r.cuenta, r.motivo_exclusion
   order by 4 desc, 1, 2;
end;
$$;

-- consultas_windsor: copia de db/031_cerrar_acceso_por_rol.sql con el control de rol al principio.
create or replace function crm_comunidades_v2.consultas_windsor(p_limite int default 300)
returns table (
  ocurrio_en timestamptz, tipo text, estado text, titulo text,
  filas_origen int, filas_asignadas int, registros_escritos int, filas_sin_comunidad int, gasto_sin_comunidad numeric,
  detalle text
)
language sql
stable
security definer
set search_path = crm_comunidades_v2, public, cron
as $$
  select crm_comunidades_v2._exigir_marketing();
  select crm_comunidades_v2._exigir_marketing();
  select * from (
    select e.ocurrio_en, 'entrega'::text, 'ok'::text,
           case e.operacion when 'INSERT' then 'Windsor escribió filas' when 'DELETE' then 'Windsor reemplazó filas (borró las anteriores)' else 'Estado de la tabla de Windsor' end,
           e.filas, null::int, null::int, null::int, null::numeric,
           e.tabla || coalesce(' · fechas ' || e.fecha_desde || ' a ' || e.fecha_hasta, '')
      from crm_comunidades_v2.windsor_entrega_log e
    union all
    select s.corrida_en,
           case when s.tabla like 'windsor_raw.%' then 'conversion' else 'csv' end,
           case when s.error is not null then 'error' else 'ok' end,
           case when s.tabla like 'windsor_raw.%' then 'Conversión a métricas por comunidad' else 'Importación manual por CSV' end,
           s.filas_origen, s.filas_asignadas, s.registros_escritos, s.filas_sin_comunidad, s.gasto_sin_comunidad,
           coalesce(s.error, s.tabla
             || case when coalesce(s.filas_excluidas, 0) > 0 then ' · no cuenta por regla: ' || s.filas_excluidas || ' filas, $' || round(s.gasto_excluido)::text else '' end
             || case when coalesce(s.registros_borrados, 0) > 0 then ' · se quitaron ' || s.registros_borrados || ' registros que ya no corresponden' else '' end)
      from crm_comunidades_v2.windsor_sync_log s
    union all
    select d.start_time, 'programada', coalesce(d.status, 'running'), 'Trabajo programado (pg_cron)',
           null::int, null::int, null::int, null::int, null::numeric,
           coalesce(d.return_message, '') || ' · ' || coalesce(to_char(d.end_time - d.start_time, 'SS.MS') || ' s', '')
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid
     where j.jobname = 'sincronizar-meta-windsor'
    union all
    select m.cargada_en, 'carga_miembros', 'ok',
           'Carga de miembros · ' || cm.nombre,
           m.filas_leidas, m.numeros_validos, m.numeros_validos, null::int, null::numeric,
           coalesce(m.archivo, 'sin nombre de archivo')
             || ' · ' || case when m.lista_completa then 'lista completa' else 'solo personas nuevas' end
             || ' · ' || m.numeros_validos || ' números'
             || case when m.invalidos > 0 then ', ' || m.invalidos || ' inválidos' else '' end
             || case when m.repetidos > 0 then ', ' || m.repetidos || ' repetidos en el archivo' else '' end
             || case when m.sin_fecha > 0 then ', ' || m.sin_fecha || ' sin fecha (se usó la de hoy)' else '' end
             || ' · +' || coalesce(m.nuevos, 0) || ' nuevos'
             || case when m.duplicados > 0 then ' · ' || m.duplicados || ' ya cargados (' ||
                  case m.duplicados_accion when 'actualizar_fecha' then m.fechas_actualizadas || ' con la fecha actualizada' else 'ignorados' end || ')' else '' end
             || case when coalesce(m.salieron, 0) > 0 then ' · −' || m.salieron || ' salidas' else '' end
             || ' · coincide con ' || m.coincidencias_crm || ' contactos del CRM'
             || case when m.uso_como_mi then ' · usada como miembros iniciales' else '' end
             || coalesce(' · cargada por ' || m.cargada_por, '')
      from crm_comunidades_v2.carga_miembros m
      join crm_comunidades_v2.comunidad cm on cm.id = m.comunidad_id
    union all
    select h.cambiado_en, 'campanas', 'ok',
           case h.accion when 'cuenta' then 'Campaña: pasó a contar' when 'no_cuenta' then 'Campaña: pasó a no contar'
                         when 'sin_asignar' then 'Campaña: quedó sin asignar' else 'Recalculo manual de las métricas de Meta' end,
           null::int, null::int, null::int, null::int, null::numeric,
           coalesce(h.campana, '') || coalesce(' [' || h.adset || ']', '')
             || coalesce(' · ' || h.destino, '')
             || coalesce(' · por ' || h.cambiado_por, '')
      from crm_comunidades_v2.campania_regla_historial h
  ) t
  order by 1 desc
  limit greatest(1, least(coalesce(p_limite, 300), 2000));
$$;

-- guardar_regla_campana: copia de db/031_cerrar_acceso_por_rol.sql con el control de rol al principio.
create or replace function crm_comunidades_v2.guardar_regla_campana(
  p_campana text, p_adset text, p_accion text, p_comunidad uuid default null, p_motivo text default null, p_por text default null)
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
  if p_accion not in ('cuenta', 'no_cuenta', 'sin_asignar') then raise exception 'Acción inválida (cuenta, no_cuenta o sin_asignar)'; end if;

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

-- recalcular_meta_windsor: copia de db/031_cerrar_acceso_por_rol.sql con el control de rol al principio.
create or replace function crm_comunidades_v2.recalcular_meta_windsor(p_por text default null)
returns table (filas_origen int, filas_asignadas int, registros_escritos int, filas_sin_comunidad int, gasto_sin_comunidad numeric)
language plpgsql
security definer
set search_path = crm_comunidades_v2, public
as $$
begin
  perform crm_comunidades_v2._exigir_marketing();
  perform crm_comunidades_v2._exigir_marketing();
  if exists (select 1 from crm_comunidades_v2.campania_regla_historial h where h.accion = 'recalcular' and h.cambiado_en > clock_timestamp() - interval '10 seconds') then
    raise exception 'Esperá unos segundos: ya se recalculó hace instantes';
  end if;
  insert into crm_comunidades_v2.campania_regla_historial (cambiado_por, accion) values (left(nullif(btrim(p_por), ''), 80), 'recalcular');
  return query select * from crm_comunidades_v2.sincronizar_meta_desde_windsor('windsor_raw.facebook_ads');
end;
$$;

-- vista_previa_carga_miembros: copia de db/031_cerrar_acceso_por_rol.sql con el control de rol al principio.
create or replace function crm_comunidades_v2.vista_previa_carga_miembros(p_clave text, p_comunidad uuid, p_filas jsonb, p_lista_completa boolean default false)
returns table (total_archivo int, nuevos int, reingresos int, duplicados int, duplicados_otra_fecha int, salidas int,
               coincidencias_crm int, activos_actuales int, activos_resultantes int, duplicados_detalle jsonb)
language plpgsql
stable
security definer
set search_path = crm_comunidades_v2, public, extensions
as $$
declare
  v_nuevos int; v_rein int; v_dup int; v_dupf int; v_sal int; v_coinc int; v_act int; v_tot int; v_det jsonb;
begin
  perform crm_comunidades_v2._exigir_marketing();
  perform crm_comunidades_v2._exigir_marketing();
  perform crm_comunidades_v2._verificar_clave_carga(p_clave);
  if not exists (select 1 from crm_comunidades_v2.comunidad c where c.id = p_comunidad) then raise exception 'La comunidad no existe'; end if;

  select count(*), count(*) filter (where k.tipo = 'nuevo'), count(*) filter (where k.tipo = 'reingreso'),
         count(*) filter (where k.tipo = 'duplicado'),
         count(*) filter (where k.tipo = 'duplicado' and k.f is not null and k.f <> k.f_actual)
    into v_tot, v_nuevos, v_rein, v_dup, v_dupf
    from crm_comunidades_v2._clasificar_carga(p_comunidad, p_filas) k;

  select count(*) into v_act from crm_comunidades_v2.miembro_comunidad mc where mc.comunidad_id = p_comunidad and mc.salio_en is null;

  v_sal := 0;
  if coalesce(p_lista_completa, false) then
    select count(*) into v_sal from crm_comunidades_v2.miembro_comunidad mc
     where mc.comunidad_id = p_comunidad and mc.salio_en is null
       and mc.telefono_id not in (select k.t from crm_comunidades_v2._clasificar_carga(p_comunidad, p_filas) k);
  end if;

  select count(distinct e.telefono_id) into v_coinc from crm_comunidades_v2.evento_crudo e
   where e.comunidad_id = p_comunidad
     and e.telefono_id in (select k.t from crm_comunidades_v2._clasificar_carga(p_comunidad, p_filas) k where k.tipo in ('nuevo', 'reingreso'));

  select coalesce(jsonb_agg(jsonb_build_object('telefono', d.t, 'fecha_actual', d.f_actual, 'fecha_archivo', d.f) order by d.t), '[]'::jsonb) into v_det
    from (select k.t, k.f_actual, k.f from crm_comunidades_v2._clasificar_carga(p_comunidad, p_filas) k where k.tipo = 'duplicado' order by k.t limit 300) d;

  return query select v_tot, v_nuevos, v_rein, v_dup, v_dupf, v_sal, v_coinc, v_act, v_act + v_nuevos + v_rein - v_sal, v_det;
end;
$$;

-- cargar_miembros_grupo: copia de db/031_cerrar_acceso_por_rol.sql con el control de rol al principio.
create or replace function crm_comunidades_v2.cargar_miembros_grupo(
  p_clave text, p_comunidad uuid, p_archivo text, p_filas jsonb, p_cargada_por text default null,
  p_filas_leidas int default 0, p_repetidos int default 0, p_invalidos int default 0, p_sin_fecha int default 0,
  p_lista_completa boolean default false, p_duplicados text default null, p_confirmo_salidas boolean default false,
  p_usar_como_mi boolean default false)
returns table (carga_id uuid, activos int, nuevos int, reingresos int, duplicados int, salidas int, coincidencias_crm int)
language plpgsql
security definer
set search_path = crm_comunidades_v2, public, extensions
as $$
declare
  v_cliente uuid; v_id uuid; v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_tot int; v_nuevos int; v_rein int; v_dup int; v_dupf int; v_sal int; v_coinc int; v_act int; v_res int;
  v_actualizadas int := 0;
begin
  perform crm_comunidades_v2._exigir_marketing();
  perform crm_comunidades_v2._exigir_marketing();
  perform crm_comunidades_v2._verificar_clave_carga(p_clave);
  select c.cliente_id into v_cliente from crm_comunidades_v2.comunidad c where c.id = p_comunidad;
  if v_cliente is null then raise exception 'La comunidad no existe'; end if;
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) > 20000 then raise exception 'La lista es inválida o demasiado larga (máximo 20.000 filas)'; end if;

  select vp.total_archivo, vp.nuevos, vp.reingresos, vp.duplicados, vp.duplicados_otra_fecha, vp.salidas, vp.coincidencias_crm, vp.activos_actuales
    into v_tot, v_nuevos, v_rein, v_dup, v_dupf, v_sal, v_coinc, v_act
    from crm_comunidades_v2.vista_previa_carga_miembros(p_clave, p_comunidad, p_filas, p_lista_completa) vp;

  if v_tot = 0 then raise exception 'La lista no tiene ningún número válido'; end if;
  if v_dup > 0 and coalesce(p_duplicados, '') not in ('ignorar', 'actualizar_fecha') then
    raise exception 'Hay % números que ya estaban cargados: elegí qué hacer con ellos (ignorar o actualizar la fecha)', v_dup;
  end if;
  if v_sal > 0 and not coalesce(p_confirmo_salidas, false) then
    raise exception 'La carga dejaría % personas como salidas: hay que confirmarlas', v_sal;
  end if;

  insert into crm_comunidades_v2.carga_miembros
    (cliente_id, comunidad_id, archivo, cargada_por, filas_leidas, numeros_validos, repetidos, invalidos, coincidencias_crm, nuevos, salieron,
     uso_como_mi, duplicados, duplicados_accion, lista_completa, sin_fecha)
  values (v_cliente, p_comunidad, left(p_archivo, 200), left(nullif(btrim(p_cargada_por), ''), 80), greatest(p_filas_leidas, 0), v_tot,
          greatest(p_repetidos, 0), greatest(p_invalidos, 0), v_coinc, v_nuevos + v_rein, v_sal,
          coalesce(p_usar_como_mi, false), v_dup, case when v_dup > 0 then p_duplicados end, coalesce(p_lista_completa, false), greatest(p_sin_fecha, 0))
  returning id into v_id;

  -- El orden importa: primero lo que ya existe (reingresos, fechas, salidas) y al final los nuevos, para no confundirlos con duplicados.
  update crm_comunidades_v2.miembro_comunidad mc
     set salio_en = null, fecha = coalesce(k.f, v_hoy), carga_id = v_id, actualizado_en = clock_timestamp()
    from crm_comunidades_v2._clasificar_carga(p_comunidad, p_filas) k
   where k.tipo = 'reingreso' and mc.comunidad_id = p_comunidad and mc.telefono_id = k.t;

  if v_dup > 0 and p_duplicados = 'actualizar_fecha' then
    update crm_comunidades_v2.miembro_comunidad mc
       set fecha = k.f, carga_id = v_id, actualizado_en = clock_timestamp()
      from crm_comunidades_v2._clasificar_carga(p_comunidad, p_filas) k
     where k.tipo = 'duplicado' and k.f is not null and k.f <> mc.fecha and mc.comunidad_id = p_comunidad and mc.telefono_id = k.t;
    get diagnostics v_actualizadas = row_count;
    update crm_comunidades_v2.carga_miembros cm set fechas_actualizadas = v_actualizadas where cm.id = v_id;
  end if;

  if coalesce(p_lista_completa, false) and v_sal > 0 then
    update crm_comunidades_v2.miembro_comunidad mc
       set salio_en = v_hoy, actualizado_en = clock_timestamp()
     where mc.comunidad_id = p_comunidad and mc.salio_en is null
       and mc.telefono_id not in (select k.t from crm_comunidades_v2._clasificar_carga(p_comunidad, p_filas) k);
  end if;

  insert into crm_comunidades_v2.miembro_comunidad (comunidad_id, cliente_id, telefono_id, fecha, carga_id)
  select p_comunidad, v_cliente, k.t, coalesce(k.f, v_hoy), v_id
    from crm_comunidades_v2._clasificar_carga(p_comunidad, p_filas) k where k.tipo = 'nuevo';

  select count(*) into v_res from crm_comunidades_v2.miembro_comunidad mc where mc.comunidad_id = p_comunidad and mc.salio_en is null;
  update crm_comunidades_v2.comunidad c
     set miembros_finales = v_res,
         miembros_iniciales = case when coalesce(p_usar_como_mi, false) then v_res else c.miembros_iniciales end
   where c.id = p_comunidad;

  return query select v_id, v_res, v_nuevos, v_rein, v_dup, v_sal, v_coinc;
end;
$$;

-- ver_miembros_grupo: copia de db/031_cerrar_acceso_por_rol.sql con el control de rol al principio.
create or replace function crm_comunidades_v2.ver_miembros_grupo(p_clave text, p_comunidad uuid)
returns table (telefono_id text, fecha date, salio_en date, nombre text, entro_por_flow boolean, primera_entrada timestamptz)
language plpgsql
stable
security definer
set search_path = crm_comunidades_v2, public, extensions
as $$
begin
  perform crm_comunidades_v2._exigir_marketing();
  perform crm_comunidades_v2._exigir_marketing();
  perform crm_comunidades_v2._verificar_clave_carga(p_clave);
  return query
  select mc.telefono_id, mc.fecha, mc.salio_en,
         (select nullif(btrim(coalesce(e.payload->'contact'->>'name', e.payload->'contact'->>'first_name', '')), '')
            from crm_comunidades_v2.evento_crudo e
           where e.telefono_id = mc.telefono_id and e.cliente_id = mc.cliente_id
             and nullif(btrim(coalesce(e.payload->'contact'->>'name', e.payload->'contact'->>'first_name', '')), '') is not null
           order by e.recibido_en desc limit 1),
         exists (select 1 from crm_comunidades_v2.evento_crudo e where e.comunidad_id = mc.comunidad_id and e.telefono_id = mc.telefono_id),
         (select min(e.recibido_en) from crm_comunidades_v2.evento_crudo e where e.comunidad_id = mc.comunidad_id and e.telefono_id = mc.telefono_id)
    from crm_comunidades_v2.miembro_comunidad mc
   where mc.comunidad_id = p_comunidad
   order by mc.salio_en is not null, mc.fecha desc, mc.telefono_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- 5. EXECUTE: nada por defecto; cada función se habilita a quien la usa
-- ----------------------------------------------------------------------------
revoke execute on all functions in schema crm_comunidades_v2 from public, anon, authenticated;
alter default privileges in schema crm_comunidades_v2 revoke execute on functions from public, anon, authenticated;
grant execute on all functions in schema crm_comunidades_v2 to service_role;

-- n8n (clave anon + secreto en el encabezado).
grant execute on function crm_comunidades_v2.registrar_envio_planilla(uuid, text, text),
                          crm_comunidades_v2.datos_comunidad_planilla(uuid) to anon;

-- Panel, cualquier usuario del CRM (cada una controla el rol por dentro o lo hacen las políticas).
grant execute on function
  crm_comunidades_v2._email_sesion(), crm_comunidades_v2.mi_acceso(), crm_comunidades_v2.es_usuario_crm(),
  crm_comunidades_v2.es_marketing(), crm_comunidades_v2.es_admin_crm(), crm_comunidades_v2._exigir_marketing(),
  crm_comunidades_v2.usuarios_crm(), crm_comunidades_v2.guardar_usuario_crm(text, text, boolean), crm_comunidades_v2.quitar_usuario_crm(text),
  crm_comunidades_v2.bajas_reales_comunidad(uuid, date, date),
  crm_comunidades_v2.comunidad_performance_rango(uuid, date, date, text),
  crm_comunidades_v2.normalizar_nombre(text)
  to authenticated;

-- Panel, solo Marketing (el control está dentro de cada función).
grant execute on function
  crm_comunidades_v2.desglose_campanas(uuid, date, date, uuid),
  crm_comunidades_v2.campanas_windsor(int, text),
  crm_comunidades_v2.consultas_windsor(int),
  crm_comunidades_v2.guardar_regla_campana(text, text, text, uuid, text, text),
  crm_comunidades_v2.recalcular_meta_windsor(text),
  crm_comunidades_v2.vista_previa_carga_miembros(text, uuid, jsonb, boolean),
  crm_comunidades_v2.cargar_miembros_grupo(text, uuid, text, jsonb, text, int, int, int, int, boolean, text, boolean, boolean),
  crm_comunidades_v2.ver_miembros_grupo(text, uuid)
  to authenticated;
