-- 020 — Carga de miembros: solo Fecha y Teléfono, miembros acumulados y duplicados que se confirman
--
-- Cambia el diseño de db/019. No se consiguen nombres ni usuarios: cada fila de la carga trae solo FECHA y TELÉFONO.
-- La fecha es la de ingreso al grupo si se conoce; si no, la fecha en que se registró (si falta, se usa la de hoy).
--
-- Antes (019): cada carga era una foto completa del grupo.
-- Ahora (020): cada comunidad tiene su lista de miembros (miembro_comunidad), con la fecha de cada uno. Una carga puede traer:
--   - solo las personas nuevas, o
--   - la lista completa del grupo (opcional: "lista completa" marca como salidas a quienes ya estaban y no aparecen).
-- Los números que ya estaban cargados (duplicados) NO se suben solos: la vista previa los lista y la persona elige
-- ignorarlos o actualizar su fecha. Las salidas también se confirman. Los miembros finales (Mf) = miembros que no salieron.
--
-- Mismo esquema de seguridad que 019 (clave de carga, tablas sin acceso directo desde el panel).
-- Las tablas carga_miembros y miembro_grupo de 019 se conservan (la segunda queda sin uso nuevo).

create table if not exists crm_comunidades_v2.miembro_comunidad (
  comunidad_id   uuid not null,
  cliente_id     uuid not null,
  telefono_id    text not null check (telefono_id ~ '^[0-9]{8,15}$'),
  fecha          date not null,        -- ingreso al grupo si se conoce; si no, la fecha del registro
  salio_en       date,                 -- null = sigue en el grupo
  carga_id       uuid references crm_comunidades_v2.carga_miembros(id) on delete set null,
  actualizado_en timestamptz not null default clock_timestamp(),
  primary key (comunidad_id, telefono_id),
  foreign key (comunidad_id, cliente_id) references crm_comunidades_v2.comunidad (id, cliente_id) on delete cascade
);
create index if not exists idx_miembro_comunidad_cliente on crm_comunidades_v2.miembro_comunidad (cliente_id, telefono_id);

alter table crm_comunidades_v2.miembro_comunidad enable row level security;
revoke all on crm_comunidades_v2.miembro_comunidad from anon, authenticated;
grant select, insert, update on crm_comunidades_v2.miembro_comunidad to service_role;
comment on table crm_comunidades_v2.miembro_comunidad is
  'Miembros de cada grupo (solo teléfono y fecha). Dato personal: solo se lee con ver_miembros_grupo() y la clave de carga.';

alter table crm_comunidades_v2.carga_miembros
  add column if not exists duplicados int not null default 0,
  add column if not exists duplicados_accion text,
  add column if not exists lista_completa boolean not null default false,
  add column if not exists fechas_actualizadas int not null default 0,
  add column if not exists sin_fecha int not null default 0;

-- Lo ya cargado con 019 (la última foto de cada grupo) pasa a la lista acumulada, con la fecha de esa carga.
insert into crm_comunidades_v2.miembro_comunidad (comunidad_id, cliente_id, telefono_id, fecha, carga_id)
select g.comunidad_id, g.cliente_id, g.telefono_id, (m.cargada_en at time zone 'America/Argentina/Buenos_Aires')::date, m.id
  from crm_comunidades_v2.miembro_grupo g
  join crm_comunidades_v2.carga_miembros m on m.id = g.carga_id
 where m.id = (select m2.id from crm_comunidades_v2.carga_miembros m2 where m2.comunidad_id = g.comunidad_id order by m2.cargada_en desc limit 1)
on conflict (comunidad_id, telefono_id) do nothing;

-- Las funciones de 019 se reemplazan (otra forma de recibir los datos).
drop function if exists crm_comunidades_v2.vista_previa_carga_miembros(text, uuid, text[]);
drop function if exists crm_comunidades_v2.cargar_miembros_grupo(text, uuid, text, text[], text, int, int, int, boolean);
drop function if exists crm_comunidades_v2.ver_miembros_grupo(text, uuid);

-- Interna: compara las filas del archivo [{t: teléfono, f: 'AAAA-MM-DD' o null}] con los miembros de la comunidad.
-- tipo: 'nuevo' (no estaba), 'reingreso' (había salido y vuelve) o 'duplicado' (ya estaba). Un número repetido en el archivo
-- cuenta una vez, con su fecha más antigua.
create or replace function crm_comunidades_v2._clasificar_carga(p_comunidad uuid, p_filas jsonb)
returns table (t text, f date, f_actual date, salio_en date, tipo text)
language sql
stable
security definer
set search_path = crm_comunidades_v2, public
as $$
  with arch as (
    select distinct on (x.tel) x.tel, x.fec from (
      select e->>'t' as tel,
             case when (e->>'f') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (e->>'f')::date end as fec
        from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) e
       where (e->>'t') ~ '^[0-9]{8,15}$') x
     order by x.tel, x.fec nulls last)
  select a.tel, a.fec, mc.fecha, mc.salio_en,
         case when mc.telefono_id is null then 'nuevo' when mc.salio_en is not null then 'reingreso' else 'duplicado' end
    from arch a
    left join crm_comunidades_v2.miembro_comunidad mc on mc.comunidad_id = p_comunidad and mc.telefono_id = a.tel;
$$;
revoke all on function crm_comunidades_v2._clasificar_carga(uuid, jsonb) from public, anon, authenticated;

-- Vista previa: no guarda nada. p_filas llega del panel ya limpio, pero se vuelve a validar acá.
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
revoke all on function crm_comunidades_v2.vista_previa_carga_miembros(text, uuid, jsonb, boolean) from public;
grant execute on function crm_comunidades_v2.vista_previa_carga_miembros(text, uuid, jsonb, boolean) to anon, authenticated, service_role;

-- Guarda la carga. Si hay duplicados hay que decir qué hacer con ellos ('ignorar' o 'actualizar_fecha'); si la lista es completa y
-- habría salidas, hay que confirmarlas. Todo junto o nada.
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
revoke all on function crm_comunidades_v2.cargar_miembros_grupo(text, uuid, text, jsonb, text, int, int, int, int, boolean, text, boolean, boolean) from public;
grant execute on function crm_comunidades_v2.cargar_miembros_grupo(text, uuid, text, jsonb, text, int, int, int, int, boolean, text, boolean, boolean) to anon, authenticated, service_role;

-- Lista de miembros de una comunidad (con los que ya salieron), con el nombre que tenga el contacto en el CRM si entró por el flow.
create or replace function crm_comunidades_v2.ver_miembros_grupo(p_clave text, p_comunidad uuid)
returns table (telefono_id text, fecha date, salio_en date, nombre text, entro_por_flow boolean, primera_entrada timestamptz)
language plpgsql
stable
security definer
set search_path = crm_comunidades_v2, public, extensions
as $$
begin
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
revoke all on function crm_comunidades_v2.ver_miembros_grupo(text, uuid) from public;
grant execute on function crm_comunidades_v2.ver_miembros_grupo(text, uuid) to anon, authenticated, service_role;

-- Línea de tiempo de "Consultas": el detalle de la carga de miembros cambia (sin números de teléfono). Mismos permisos que en 018/019.
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
           coalesce(s.error, s.tabla)
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
  ) t
  order by 1 desc
  limit greatest(1, least(coalesce(p_limite, 300), 2000));
$$;
revoke all on function crm_comunidades_v2.consultas_windsor(int) from public;
grant execute on function crm_comunidades_v2.consultas_windsor(int) to anon, authenticated, service_role;
