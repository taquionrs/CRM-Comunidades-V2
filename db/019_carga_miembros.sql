-- 019 — Carga de miembros de los grupos (botón "Cargar miembros" del panel)
--
-- Para qué: medir la salud de cada grupo (miembros finales, crecimiento, bajas, costo por miembro) y ver quiénes están en el
-- grupo, sin depender de una planilla externa. La persona sube la lista de números de un grupo; el CRM guarda una foto con
-- fecha, actualiza los miembros finales (Mf) de la comunidad y deja constancia en la línea de tiempo de "Consultas".
--
-- EXCEPCIÓN DE SEGURIDAD (decisión del usuario, 2026-10-14): se construye ANTES del login. Como todavía no hay usuarios con
-- sesión, el acceso a los números de teléfono se protege con una CLAVE DE CARGA:
--   - las tablas con números no se pueden leer ni escribir desde el panel (RLS activo y ningún permiso a anon/authenticated);
--   - solo se llega a ellas por las funciones de abajo, y todas exigen la clave;
--   - la clave se guarda como hash en config_carga_miembros; el valor real NO está en este repositorio (se carga aparte).
-- Cuando exista el login (db/005) esto se puede cambiar por acceso por usuario.
--
--   carga_miembros               una fila por carga (quién la hizo, cuándo, archivo, cuántos números, qué cambió)
--   miembro_grupo                los números de cada carga (la foto del grupo en esa fecha)
--   config_carga_miembros        el hash de la clave de carga
--   vista_previa_carga_miembros  calcula lo que pasaría, sin guardar nada
--   cargar_miembros_grupo        guarda la foto, actualiza Mf (y Mi si se pide) y deja el registro
--   ver_miembros_grupo           devuelve la última foto del grupo con nombre y si entró por el flow
--   consultas_windsor            suma el tipo 'carga_miembros' a la línea de tiempo (sin números de teléfono)

create table if not exists crm_comunidades_v2.config_carga_miembros (
  id         boolean primary key default true check (id),
  clave_hash text not null,
  cambiada_en timestamptz not null default now()
);

create table if not exists crm_comunidades_v2.carga_miembros (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null,
  comunidad_id      uuid not null,
  archivo           text,
  cargada_en        timestamptz not null default clock_timestamp(),
  cargada_por       text,
  filas_leidas      int not null default 0,
  numeros_validos   int not null,
  repetidos         int not null default 0,
  invalidos         int not null default 0,
  coincidencias_crm int not null default 0,
  nuevos            int,
  salieron          int,
  uso_como_mi       boolean not null default false,
  foreign key (comunidad_id, cliente_id)
    references crm_comunidades_v2.comunidad (id, cliente_id) on delete cascade
);
create index if not exists idx_carga_miembros_comunidad on crm_comunidades_v2.carga_miembros (comunidad_id, cargada_en desc);

create table if not exists crm_comunidades_v2.miembro_grupo (
  carga_id     uuid not null references crm_comunidades_v2.carga_miembros(id) on delete cascade,
  cliente_id   uuid not null,
  comunidad_id uuid not null,
  telefono_id  text not null check (telefono_id ~ '^[0-9]{8,15}$'),
  primary key (carga_id, telefono_id)
);
create index if not exists idx_miembro_grupo_comunidad_tel on crm_comunidades_v2.miembro_grupo (comunidad_id, telefono_id);

-- RLS activo y sin ninguna política ni permiso para anon/authenticated: el panel no lee ni escribe estas tablas directo.
alter table crm_comunidades_v2.config_carga_miembros enable row level security;
alter table crm_comunidades_v2.carga_miembros enable row level security;
alter table crm_comunidades_v2.miembro_grupo enable row level security;
revoke all on crm_comunidades_v2.config_carga_miembros, crm_comunidades_v2.carga_miembros, crm_comunidades_v2.miembro_grupo from anon, authenticated;
grant select, insert, update on crm_comunidades_v2.config_carga_miembros, crm_comunidades_v2.carga_miembros, crm_comunidades_v2.miembro_grupo to service_role;

comment on table crm_comunidades_v2.carga_miembros is
  'Cada carga de la lista de miembros de un grupo de WhatsApp (botón "Cargar miembros"). Solo se escribe con cargar_miembros_grupo().';
comment on table crm_comunidades_v2.miembro_grupo is
  'Números de teléfono (solo dígitos, con código de país) de cada carga: la foto del grupo en esa fecha. Dato personal: solo se lee con ver_miembros_grupo() y la clave de carga.';
comment on table crm_comunidades_v2.config_carga_miembros is
  'Hash de la clave de carga (sha256). El valor real de la clave no se guarda en ningún archivo del repositorio.';

-- Comprobación de la clave (interna). Mensaje igual para clave mala y para clave sin configurar: no da pistas.
create or replace function crm_comunidades_v2._verificar_clave_carga(p_clave text)
returns void
language plpgsql
stable
security definer
set search_path = crm_comunidades_v2, public, extensions
as $$
declare v_hash text;
begin
  select clave_hash into v_hash from crm_comunidades_v2.config_carga_miembros where id;
  if v_hash is null or p_clave is null or encode(digest(p_clave, 'sha256'), 'hex') <> v_hash then
    raise exception 'Clave de carga incorrecta' using errcode = '42501';
  end if;
end;
$$;
revoke all on function crm_comunidades_v2._verificar_clave_carga(text) from public, anon, authenticated;

-- Vista previa: no guarda nada. Los números llegan ya limpios del panel, pero se vuelven a validar acá.
create or replace function crm_comunidades_v2.vista_previa_carga_miembros(p_clave text, p_comunidad uuid, p_numeros text[])
returns table (total int, nuevos int, salieron int, coincidencias_crm int, hay_carga_anterior boolean)
language plpgsql
stable
security definer
set search_path = crm_comunidades_v2, public, extensions
as $$
declare
  v_prev uuid;
begin
  perform crm_comunidades_v2._verificar_clave_carga(p_clave);
  if not exists (select 1 from crm_comunidades_v2.comunidad c where c.id = p_comunidad) then raise exception 'La comunidad no existe'; end if;

  select m.id into v_prev from crm_comunidades_v2.carga_miembros m where m.comunidad_id = p_comunidad order by m.cargada_en desc limit 1;

  return query
  with nuevos_n as (select distinct n from unnest(p_numeros) n where n ~ '^[0-9]{8,15}$'),
       prev as (select mg.telefono_id as n from crm_comunidades_v2.miembro_grupo mg where mg.carga_id = v_prev)
  select (select count(*) from nuevos_n)::int,
         case when v_prev is null then null else (select count(*) from nuevos_n where n not in (select n from prev)) end::int,
         case when v_prev is null then null else (select count(*) from prev where n not in (select n from nuevos_n)) end::int,
         (select count(distinct e.telefono_id) from crm_comunidades_v2.evento_crudo e
           where e.comunidad_id = p_comunidad and e.telefono_id in (select n from nuevos_n))::int,
         v_prev is not null;
end;
$$;
revoke all on function crm_comunidades_v2.vista_previa_carga_miembros(text, uuid, text[]) from public;
grant execute on function crm_comunidades_v2.vista_previa_carga_miembros(text, uuid, text[]) to anon, authenticated, service_role;

-- Guarda la carga: foto con fecha + Mf (y Mi si se pidió) + registro. Todo junto o nada.
create or replace function crm_comunidades_v2.cargar_miembros_grupo(
  p_clave text, p_comunidad uuid, p_archivo text, p_numeros text[], p_cargada_por text default null,
  p_filas_leidas int default 0, p_repetidos int default 0, p_invalidos int default 0, p_usar_como_mi boolean default false)
returns table (carga_id uuid, total int, nuevos int, salieron int, coincidencias_crm int)
language plpgsql
security definer
set search_path = crm_comunidades_v2, public, extensions
as $$
declare
  v_cliente uuid;
  v_id uuid;
  v_total int; v_nuevos int; v_salieron int; v_coinc int;
  v_num text[];
begin
  perform crm_comunidades_v2._verificar_clave_carga(p_clave);
  select c.cliente_id into v_cliente from crm_comunidades_v2.comunidad c where c.id = p_comunidad;
  if v_cliente is null then raise exception 'La comunidad no existe'; end if;
  if coalesce(array_length(p_numeros, 1), 0) > 20000 then raise exception 'La lista es demasiado larga (máximo 20.000 números)'; end if;

  select array_agg(distinct n) into v_num from unnest(p_numeros) n where n ~ '^[0-9]{8,15}$';
  if v_num is null then raise exception 'La lista no tiene ningún número válido'; end if;

  select vp.total, vp.nuevos, vp.salieron, vp.coincidencias_crm into v_total, v_nuevos, v_salieron, v_coinc
    from crm_comunidades_v2.vista_previa_carga_miembros(p_clave, p_comunidad, v_num) vp;

  insert into crm_comunidades_v2.carga_miembros
    (cliente_id, comunidad_id, archivo, cargada_por, filas_leidas, numeros_validos, repetidos, invalidos, coincidencias_crm, nuevos, salieron, uso_como_mi)
  values (v_cliente, p_comunidad, left(p_archivo, 200), left(nullif(btrim(p_cargada_por), ''), 80), greatest(p_filas_leidas, 0), v_total,
          greatest(p_repetidos, 0), greatest(p_invalidos, 0), v_coinc, v_nuevos, v_salieron, coalesce(p_usar_como_mi, false))
  returning id into v_id;

  insert into crm_comunidades_v2.miembro_grupo (carga_id, cliente_id, comunidad_id, telefono_id)
  select v_id, v_cliente, p_comunidad, n from unnest(v_num) n;

  update crm_comunidades_v2.comunidad
     set miembros_finales = v_total,
         miembros_iniciales = case when coalesce(p_usar_como_mi, false) then v_total else miembros_iniciales end
   where id = p_comunidad;

  return query select v_id, v_total, v_nuevos, v_salieron, v_coinc;
end;
$$;
revoke all on function crm_comunidades_v2.cargar_miembros_grupo(text, uuid, text, text[], text, int, int, int, boolean) from public;
grant execute on function crm_comunidades_v2.cargar_miembros_grupo(text, uuid, text, text[], text, int, int, int, boolean) to anon, authenticated, service_role;

-- Última foto del grupo, con el nombre que tiene el contacto en el CRM (si entró por el flow) y cuándo entró.
create or replace function crm_comunidades_v2.ver_miembros_grupo(p_clave text, p_comunidad uuid)
returns table (carga_id uuid, cargada_en timestamptz, cargada_por text, archivo text, telefono_id text, nombre text, entro_por_flow boolean, primera_entrada timestamptz)
language plpgsql
stable
security definer
set search_path = crm_comunidades_v2, public, extensions
as $$
declare v_carga uuid;
begin
  perform crm_comunidades_v2._verificar_clave_carga(p_clave);
  select m.id into v_carga from crm_comunidades_v2.carga_miembros m where m.comunidad_id = p_comunidad order by m.cargada_en desc limit 1;
  if v_carga is null then return; end if;
  return query
  select m.id, m.cargada_en, m.cargada_por, m.archivo, g.telefono_id,
         (select nullif(btrim(coalesce(e.payload->'contact'->>'name', e.payload->'contact'->>'first_name', '')), '')
            from crm_comunidades_v2.evento_crudo e
           where e.telefono_id = g.telefono_id and e.cliente_id = g.cliente_id
             and nullif(btrim(coalesce(e.payload->'contact'->>'name', e.payload->'contact'->>'first_name', '')), '') is not null
           order by e.recibido_en desc limit 1),
         exists (select 1 from crm_comunidades_v2.evento_crudo e where e.comunidad_id = g.comunidad_id and e.telefono_id = g.telefono_id),
         (select min(e.recibido_en) from crm_comunidades_v2.evento_crudo e where e.comunidad_id = g.comunidad_id and e.telefono_id = g.telefono_id)
    from crm_comunidades_v2.miembro_grupo g
    join crm_comunidades_v2.carga_miembros m on m.id = g.carga_id
   where g.carga_id = v_carga
   order by g.telefono_id;
end;
$$;
revoke all on function crm_comunidades_v2.ver_miembros_grupo(text, uuid) from public;
grant execute on function crm_comunidades_v2.ver_miembros_grupo(text, uuid) to anon, authenticated, service_role;

-- Línea de tiempo de "Consultas": se suma el tipo 'carga_miembros'. Sin números de teléfono. Mismos permisos que en db/018.
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
             || ' · ' || m.numeros_validos || ' números' || case when m.invalidos > 0 then ', ' || m.invalidos || ' inválidos' else '' end
             || case when m.repetidos > 0 then ', ' || m.repetidos || ' repetidos' else '' end
             || case when m.nuevos is not null then ' · +' || m.nuevos || ' / −' || m.salieron || ' vs. la carga anterior' else ' · primera carga de este grupo' end
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
