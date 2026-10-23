-- ============================================================================
-- CRM de Comunidades V2 — usuarios, roles y login con SSO (Cloudflare), parte 1 de 2
-- Ref: specs/2026-10-21-sso-cloudflare-y-roles.md
--
-- SOLO AGREGA: no cambia ninguna política ni permiso existente, así que se puede aplicar antes de que el panel
-- tenga login sin romper nada. El cierre del acceso anónimo es db/031 (se aplica junto con el panel con login).
-- Reemplaza el diseño de la vieja db/005 (asignación por cliente), que nunca se aplicó y se borró del repo.
--
--   usuario_crm            quién entra al CRM, con qué rol (marketing / general) y si administra usuarios
--   usuario_crm_auditoria  cada alta, cambio y baja: quién, cuándo, qué
--   mi_acceso()            el acceso del usuario de la sesión (vacío si no tiene)
--   es_usuario_crm(), es_marketing(), es_admin_crm()   las usan las políticas de db/031
--   usuarios_crm(), guardar_usuario_crm(), quitar_usuario_crm()   la pestaña Usuarios del panel (solo administradores)
--   datos_comunidad_planilla()   lo que n8n necesita para la planilla, con el mismo secreto que registrar_envio_planilla
--
-- La sesión vale 24 h desde el login y se corta al cerrarla: se mira auth.sessions, no solo el token.
-- Aplicar después de 029. Idempotente.
-- ============================================================================
set search_path = crm_comunidades_v2, public;

-- Comprobación previa: las funciones de acceso leen auth.sessions con los permisos del dueño de la función.
do $$
begin
  perform 1 from auth.sessions limit 1;
exception when insufficient_privilege then
  raise exception 'El usuario que aplica la migración no puede leer auth.sessions: aplicarla como postgres (SQL Editor o supabase db query).';
end $$;

-- ----------------------------------------------------------------------------
-- Usuarios y auditoría (solo se leen y escriben con las funciones de abajo)
-- ----------------------------------------------------------------------------
create table if not exists crm_comunidades_v2.usuario_crm (
  email           text primary key check (email = lower(btrim(email)) and email like '%_@_%'),
  rol             text not null check (rol in ('marketing', 'general')),
  admin           boolean not null default false,
  fijo            boolean not null default false,
  creado_en       timestamptz not null default now(),
  creado_por      text not null default 'sistema',
  actualizado_en  timestamptz not null default now(),
  actualizado_por text not null default 'sistema'
);
comment on table crm_comunidades_v2.usuario_crm is
  'Quién entra al CRM y con qué rol. marketing: ve y edita todo. general: conteos sin plata ni datos personales, solo lectura. admin: además gestiona usuarios. fijo: no se cambia desde el panel (solo por SQL).';

create table if not exists crm_comunidades_v2.usuario_crm_auditoria (
  id     bigint generated always as identity primary key,
  en     timestamptz not null default now(),
  por    text not null,
  accion text not null check (accion in ('alta', 'cambio', 'baja')),
  email  text not null,
  rol    text,
  admin  boolean
);
comment on table crm_comunidades_v2.usuario_crm_auditoria is 'Altas, cambios y bajas de usuarios del CRM. Nada se borra.';

alter table crm_comunidades_v2.usuario_crm enable row level security;
alter table crm_comunidades_v2.usuario_crm_auditoria enable row level security;
revoke all on crm_comunidades_v2.usuario_crm, crm_comunidades_v2.usuario_crm_auditoria from public, anon, authenticated;
grant all on crm_comunidades_v2.usuario_crm, crm_comunidades_v2.usuario_crm_auditoria to service_role;

-- Administradores fijos: ven y editan todo y no se pueden quitar desde el panel.
insert into crm_comunidades_v2.usuario_crm (email, rol, admin, fijo)
values ('felipe.pampin@taquion.com.ar', 'marketing', true, true),
       ('nicolas.piantanida@taquion.com.ar', 'marketing', true, true),
       ('marketing@taquion.com.ar', 'marketing', true, true)
on conflict (email) do update set rol = 'marketing', admin = true, fijo = true;

-- ----------------------------------------------------------------------------
-- Acceso de la sesión
-- ----------------------------------------------------------------------------
-- Email de la sesión, solo si la sesión existe (no se cerró) y tiene menos de 24 h desde el login.
create or replace function crm_comunidades_v2._email_sesion()
returns text
language sql stable security definer
set search_path = crm_comunidades_v2, public
as $$
  select lower(auth.jwt() ->> 'email')
   where auth.role() = 'authenticated'
     and exists (
       select 1 from auth.sessions s
        where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
          and s.user_id = auth.uid()
          and s.created_at > now() - interval '24 hours');
$$;

create or replace function crm_comunidades_v2.mi_acceso()
returns table (email text, rol text, admin boolean)
language sql stable security definer
set search_path = crm_comunidades_v2, public
as $$
  select u.email, u.rol, u.admin from crm_comunidades_v2.usuario_crm u where u.email = crm_comunidades_v2._email_sesion();
$$;
comment on function crm_comunidades_v2.mi_acceso() is 'Rol y permiso de administrador del usuario de la sesión. Vacío si no tiene acceso o la sesión venció (24 h).';

create or replace function crm_comunidades_v2.es_usuario_crm()
returns boolean language sql stable security definer set search_path = crm_comunidades_v2, public
as $$ select exists (select 1 from crm_comunidades_v2.mi_acceso()); $$;

create or replace function crm_comunidades_v2.es_marketing()
returns boolean language sql stable security definer set search_path = crm_comunidades_v2, public
as $$ select exists (select 1 from crm_comunidades_v2.mi_acceso() a where a.rol = 'marketing'); $$;

create or replace function crm_comunidades_v2.es_admin_crm()
returns boolean language sql stable security definer set search_path = crm_comunidades_v2, public
as $$ select exists (select 1 from crm_comunidades_v2.mi_acceso() a where a.admin); $$;

-- Para las funciones del panel que solo puede usar Marketing (db/031). Sin JWT es una conexión directa a la base
-- (SQL Editor, pg_cron) y la clave de servicio es de las Edge Functions: no se controlan acá.
create or replace function crm_comunidades_v2._exigir_marketing()
returns void
language plpgsql stable security definer
set search_path = crm_comunidades_v2, public
as $$
begin
  if nullif(current_setting('request.jwt.claims', true), '') is null or auth.role() = 'service_role' then
    return;
  end if;
  if not crm_comunidades_v2.es_marketing() then
    raise exception 'Necesitás el rol Marketing para esta acción.' using errcode = '42501';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Gestión de usuarios (pestaña Usuarios, solo administradores)
-- ----------------------------------------------------------------------------
create or replace function crm_comunidades_v2._exigir_admin_crm()
returns text
language plpgsql stable security definer
set search_path = crm_comunidades_v2, public
as $$
begin
  if not crm_comunidades_v2.es_admin_crm() then
    raise exception 'Solo un administrador puede gestionar usuarios.' using errcode = '42501';
  end if;
  return crm_comunidades_v2._email_sesion();
end;
$$;

create or replace function crm_comunidades_v2.usuarios_crm()
returns jsonb
language plpgsql stable security definer
set search_path = crm_comunidades_v2, public
as $$
begin
  perform crm_comunidades_v2._exigir_admin_crm();
  return jsonb_build_object(
    'usuarios', coalesce((select jsonb_agg(to_jsonb(u) order by u.fijo desc, u.email) from crm_comunidades_v2.usuario_crm u), '[]'::jsonb),
    'auditoria', coalesce((select jsonb_agg(to_jsonb(a) order by a.en desc, a.id desc)
                             from (select * from crm_comunidades_v2.usuario_crm_auditoria order by en desc, id desc limit 200) a), '[]'::jsonb));
end;
$$;

-- Alta o cambio. Reglas: cuenta @taquion.com.ar, nadie se cambia a sí mismo, los fijos no se tocan.
create or replace function crm_comunidades_v2.guardar_usuario_crm(p_email text, p_rol text, p_admin boolean)
returns jsonb
language plpgsql security definer
set search_path = crm_comunidades_v2, public
as $$
declare
  v_actor text := crm_comunidades_v2._exigir_admin_crm();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_prev  crm_comunidades_v2.usuario_crm;
  v_nuevo crm_comunidades_v2.usuario_crm;
begin
  if v_email !~ '^[a-z0-9._%+''-]+@taquion\.com\.ar$' then
    raise exception 'El email tiene que ser una cuenta @taquion.com.ar.' using errcode = '22023';
  end if;
  if p_rol is null or p_rol not in ('marketing', 'general') then
    raise exception 'Rol inválido (marketing o general).' using errcode = '22023';
  end if;
  if v_email = v_actor then
    raise exception 'No podés cambiar ni quitar tu propio acceso. Pedíselo a otro administrador.' using errcode = '42501';
  end if;
  select * into v_prev from crm_comunidades_v2.usuario_crm where email = v_email;
  if v_prev.fijo then
    raise exception 'Es un administrador fijo: no se puede cambiar desde el panel.' using errcode = '42501';
  end if;

  insert into crm_comunidades_v2.usuario_crm (email, rol, admin, creado_por, actualizado_por)
  values (v_email, p_rol, coalesce(p_admin, false), v_actor, v_actor)
  on conflict (email) do update
    set rol = excluded.rol, admin = excluded.admin, actualizado_en = now(), actualizado_por = v_actor
  returning * into v_nuevo;

  insert into crm_comunidades_v2.usuario_crm_auditoria (por, accion, email, rol, admin)
  values (v_actor, case when v_prev.email is null then 'alta' else 'cambio' end, v_email, v_nuevo.rol, v_nuevo.admin);
  return to_jsonb(v_nuevo);
end;
$$;

-- Baja. Devuelve false si no existía. La sesión del usuario deja de servir en el pedido siguiente.
create or replace function crm_comunidades_v2.quitar_usuario_crm(p_email text)
returns boolean
language plpgsql security definer
set search_path = crm_comunidades_v2, public
as $$
declare
  v_actor text := crm_comunidades_v2._exigir_admin_crm();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_prev  crm_comunidades_v2.usuario_crm;
begin
  if v_email = v_actor then
    raise exception 'No podés cambiar ni quitar tu propio acceso. Pedíselo a otro administrador.' using errcode = '42501';
  end if;
  select * into v_prev from crm_comunidades_v2.usuario_crm where email = v_email;
  if v_prev.email is null then
    return false;
  end if;
  if v_prev.fijo then
    raise exception 'Es un administrador fijo: no se puede quitar desde el panel.' using errcode = '42501';
  end if;
  delete from crm_comunidades_v2.usuario_crm where email = v_email;
  insert into crm_comunidades_v2.usuario_crm_auditoria (por, accion, email, rol, admin)
  values (v_actor, 'baja', v_email, v_prev.rol, v_prev.admin);
  return true;
end;
$$;

-- ----------------------------------------------------------------------------
-- n8n: nombre de la comunidad y del cliente para la planilla, con el mismo secreto que registrar_envio_planilla.
-- Reemplaza la lectura de la tabla comunidad con la clave anon, que db/031 cierra.
-- ----------------------------------------------------------------------------
create or replace function crm_comunidades_v2.datos_comunidad_planilla(p_comunidad uuid)
returns table (comunidad text, cliente text, cliente_slug text)
language plpgsql stable security definer
set search_path = crm_comunidades_v2, public, extensions
as $$
declare
  v_encabezados jsonb;
  v_secreto text;
  v_hash text;
begin
  v_encabezados := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_secreto := coalesce(v_encabezados ->> 'x-crm-secret', v_encabezados ->> 'webhook-crm-secret', '');
  select c.clave_hash into v_hash from crm_comunidades_v2.config_n8n c where c.id;
  if v_hash is null or encode(digest(v_secreto, 'sha256'), 'hex') <> v_hash then
    raise exception 'Clave incorrecta' using errcode = '42501';
  end if;
  return query
    select co.nombre, cl.nombre, cl.slug
      from crm_comunidades_v2.comunidad co
      join crm_comunidades_v2.cliente cl on cl.id = co.cliente_id
     where co.id = p_comunidad;
end;
$$;
comment on function crm_comunidades_v2.datos_comunidad_planilla(uuid) is
  'Para n8n: nombre de la comunidad y del cliente de un evento. Exige el encabezado x-crm-secret (o webhook-crm-secret), igual que registrar_envio_planilla.';

-- ----------------------------------------------------------------------------
-- Permisos de las funciones nuevas (001 da EXECUTE por defecto a anon y authenticated: se ajusta acá)
-- ----------------------------------------------------------------------------
revoke all on function crm_comunidades_v2._email_sesion() from public, anon;
revoke all on function crm_comunidades_v2.mi_acceso() from public, anon;
revoke all on function crm_comunidades_v2.es_usuario_crm() from public, anon;
revoke all on function crm_comunidades_v2.es_marketing() from public, anon;
revoke all on function crm_comunidades_v2.es_admin_crm() from public, anon;
revoke all on function crm_comunidades_v2._exigir_marketing() from public, anon;
revoke all on function crm_comunidades_v2._exigir_admin_crm() from public, anon, authenticated;
revoke all on function crm_comunidades_v2.usuarios_crm() from public, anon;
revoke all on function crm_comunidades_v2.guardar_usuario_crm(text, text, boolean) from public, anon;
revoke all on function crm_comunidades_v2.quitar_usuario_crm(text) from public, anon;
revoke all on function crm_comunidades_v2.datos_comunidad_planilla(uuid) from public, authenticated;

grant execute on function crm_comunidades_v2._email_sesion(), crm_comunidades_v2.mi_acceso(), crm_comunidades_v2.es_usuario_crm(),
  crm_comunidades_v2.es_marketing(), crm_comunidades_v2.es_admin_crm(), crm_comunidades_v2._exigir_marketing(),
  crm_comunidades_v2.usuarios_crm(), crm_comunidades_v2.guardar_usuario_crm(text, text, boolean), crm_comunidades_v2.quitar_usuario_crm(text)
  to authenticated, service_role;
grant execute on function crm_comunidades_v2._exigir_admin_crm() to service_role;
grant execute on function crm_comunidades_v2.datos_comunidad_planilla(uuid) to anon, service_role;
