-- ============================================================================
-- CRM de Comunidades V2 — Código por anuncio (PR #70, piloto en Palermo)
--
-- Problema: ManyChat no avisa de qué anuncio viene cada persona (el contacto aparece como "Directo" y el
-- payload no trae anuncio, referral ni fuente). Hoy el CRM sabe la ZONA que eligió la persona, no el ANUNCIO.
--
-- Idea: cada anuncio de Meta tiene su propia plantilla de mensaje y la plantilla termina con un código corto
-- ("P1", "P2"...). La persona lo manda dentro del primer mensaje; ManyChat ya lo entrega en
-- contact.last_input_text y el webhook lo reconoce contra esta tabla. Si la persona borra o cambia el código,
-- el contacto entra igual (a la comunidad por la frase) y queda sin anuncio: nunca se pierde un contacto.
--
--   anuncio_codigo                  una fila = "el código P1 es el anuncio X de la comunidad Y". Se carga a mano.
--   evento_crudo.anuncio_codigo     código reconocido en el mensaje de esa entrada (null si no había).
--   ingreso_sin_clasificar.anuncio_codigo   idem para quien escribió sin elegir comunidad.
--   entradas_por_anuncio()          personas distintas por código en un período (solo conteos).
--
-- El código se guarda como texto en el evento (sin llave foránea) para que cambiar o borrar una fila del
-- catálogo no altere lo que ya se registró. El payload completo sigue guardándose tal cual llegó.
--
-- Aplicar después de 038. Idempotente.
-- ============================================================================
set search_path = crm_comunidades_v2, public;

create table if not exists crm_comunidades_v2.anuncio_codigo (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null,
  comunidad_id    uuid not null,
  codigo          text not null check (codigo = upper(btrim(codigo)) and codigo ~ '^[A-Z]{1,3}[0-9]{1,3}$'),
  anuncio_nombre  text not null check (btrim(anuncio_nombre) <> ''),
  campana_nombre  text,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  unique (cliente_id, codigo),
  foreign key (comunidad_id, cliente_id)
    references crm_comunidades_v2.comunidad (id, cliente_id) on delete cascade
);

alter table crm_comunidades_v2.anuncio_codigo enable row level security;

drop policy if exists usuarios_select on crm_comunidades_v2.anuncio_codigo;
create policy usuarios_select on crm_comunidades_v2.anuncio_codigo for select to authenticated
  using ((select crm_comunidades_v2.es_usuario_crm()));

revoke all on crm_comunidades_v2.anuncio_codigo from anon, authenticated;
grant select on crm_comunidades_v2.anuncio_codigo to authenticated;
grant select, insert, update, delete on crm_comunidades_v2.anuncio_codigo to service_role;

comment on table crm_comunidades_v2.anuncio_codigo is
  'Catálogo de códigos por anuncio: el código que va al final del mensaje precargado de cada anuncio de Meta. Lo lee el webhook de ManyChat.';

alter table crm_comunidades_v2.evento_crudo add column if not exists anuncio_codigo text;
alter table crm_comunidades_v2.ingreso_sin_clasificar add column if not exists anuncio_codigo text;
comment on column crm_comunidades_v2.evento_crudo.anuncio_codigo is
  'Código de anuncio reconocido en el primer mensaje de la persona (catálogo anuncio_codigo). null = no venía código.';
comment on column crm_comunidades_v2.ingreso_sin_clasificar.anuncio_codigo is
  'Código de anuncio reconocido en el mensaje de la persona (catálogo anuncio_codigo). null = no venía código.';

create index if not exists idx_evento_crudo_anuncio
  on crm_comunidades_v2.evento_crudo (cliente_id, anuncio_codigo) where anuncio_codigo is not null;

-- Piloto: los 4 anuncios de Palermo de Cortado en Jarrito (campaña de tráfico a WhatsApp). Los nombres son los que usa Meta.
insert into crm_comunidades_v2.anuncio_codigo (cliente_id, comunidad_id, codigo, anuncio_nombre, campana_nombre)
select c.cliente_id, c.id, v.codigo, v.nombre, 'TQN_AON_META_CON_TRAFICO_MANUAL_CORTADO_EN_JARRITO_WHATSAPP'
  from crm_comunidades_v2.comunidad c
  join crm_comunidades_v2.cliente cl on cl.id = c.cliente_id and cl.slug = 'cortado-en-jarrito'
  cross join (values ('P1', 'PALERMO_01'), ('P2', 'PALERMO_02'), ('P3', 'PALERMO_03'), ('P4', 'PALERMO_04')) as v(codigo, nombre)
 where c.nombre = 'Palermo'
on conflict (cliente_id, codigo) do nothing;

-- Personas distintas por código de anuncio en un período (fechas en hora de Buenos Aires). Solo conteos: lo ve cualquier
-- usuario del CRM (mismo criterio que entradas_flow_cliente, db/035).
--   entradas        personas con al menos una entrada a un flow de comunidad con ese código en el período
--   sin_clasificar  personas que escribieron con ese código sin elegir comunidad (y todavía no tienen entrada)
create or replace function crm_comunidades_v2.entradas_por_anuncio(
  p_cliente uuid,
  p_desde   date default null,
  p_hasta   date default null
)
returns table (codigo text, anuncio_nombre text, comunidad text, activo boolean, entradas bigint, sin_clasificar bigint)
language sql
stable
security definer
set search_path = crm_comunidades_v2, public
as $f$
  with acceso as (
    select (nullif(current_setting('request.jwt.claims', true), '') is null
            or auth.role() = 'service_role'
            or crm_comunidades_v2.es_usuario_crm()) as ok
  ),
  ent as (
    select e.anuncio_codigo as codigo, count(distinct e.telefono_id) as n
      from crm_comunidades_v2.evento_crudo e
     where e.cliente_id = p_cliente and e.anuncio_codigo is not null
       and (p_desde is null or (e.recibido_en at time zone 'America/Argentina/Buenos_Aires')::date >= p_desde)
       and (p_hasta is null or (e.recibido_en at time zone 'America/Argentina/Buenos_Aires')::date <= p_hasta)
     group by 1
  ),
  sin as (
    select s.anuncio_codigo as codigo, count(distinct s.telefono_id) as n
      from crm_comunidades_v2.ingreso_sin_clasificar s
     where s.cliente_id = p_cliente and s.anuncio_codigo is not null
       and (p_desde is null or (s.recibido_en at time zone 'America/Argentina/Buenos_Aires')::date >= p_desde)
       and (p_hasta is null or (s.recibido_en at time zone 'America/Argentina/Buenos_Aires')::date <= p_hasta)
       and not exists (select 1 from crm_comunidades_v2.evento_crudo e
                        where e.cliente_id = s.cliente_id and e.telefono_id = s.telefono_id)
     group by 1
  )
  select a.codigo, a.anuncio_nombre, co.nombre, a.activo,
         coalesce(ent.n, 0)::bigint, coalesce(sin.n, 0)::bigint
    from acceso ac
    join crm_comunidades_v2.anuncio_codigo a on ac.ok and a.cliente_id = p_cliente
    join crm_comunidades_v2.comunidad co on co.id = a.comunidad_id and co.cliente_id = a.cliente_id
    left join ent on ent.codigo = a.codigo
    left join sin on sin.codigo = a.codigo
   order by a.codigo;
$f$;

revoke all on function crm_comunidades_v2.entradas_por_anuncio(uuid, date, date) from public, anon;
grant execute on function crm_comunidades_v2.entradas_por_anuncio(uuid, date, date) to authenticated, service_role;
comment on function crm_comunidades_v2.entradas_por_anuncio(uuid, date, date) is
  'Personas distintas por código de anuncio (entradas a flows de comunidad y sin clasificar) en un período. Solo conteos.';
