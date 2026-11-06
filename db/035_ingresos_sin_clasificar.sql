-- ============================================================================
-- CRM de Comunidades V2 — "Ingresos sin clasificar" (PR #64)
--
-- Hasta hoy el CRM solo se entera de quien dispara el flow con la frase completa de su comunidad. Quien le escribe
-- al número con otro texto ("¡Hola! Quiero más información") es un contacto de ManyChat, pero no deja ningún rastro
-- acá. La respuesta por defecto de ManyChat va a avisar al webhook con "evento": "sin_clasificar", y este aviso
-- queda en su propia tabla.
--
-- Igual que "trigger" (db/011) y "clic_me_sumo" (db/013), el aviso NO es un contacto: no entra a evento_crudo, así
-- que no toca clics únicos, la atribución de primer contacto ni Base_Limpia. Cuando esa misma persona después elige
-- su comunidad, su entrada se atribuye a esa comunidad como siempre (el "sin clasificar" no le quita nada).
--
--   ingreso_sin_clasificar    una fila por aviso (con duplicados). Solo la escribe la Edge Function manychat-webhook.
--   entradas_flow_cliente     entradas clasificadas, sin clasificar, total y tasa de clasificación de un cliente.
--
-- Definiciones (personas distintas, fechas en hora de Buenos Aires):
--   clasificadas   personas cuyo primer contacto (evento_crudo) cae en el período. Es lo mismo que "Entradas únicas".
--   sin_clasificar personas con un aviso sin clasificar en el período que TODAVÍA no tienen ningún evento clasificado.
--                  Si después eligen comunidad, pasan a clasificadas (el número baja solo).
--   total          clasificadas + sin_clasificar: toda persona que entró al flow o le escribió al número.
--   tasa           clasificadas ÷ total.
--
-- Aplicar después de 034. Idempotente.
-- ============================================================================
set search_path = crm_comunidades_v2, public;

create table if not exists crm_comunidades_v2.ingreso_sin_clasificar (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references crm_comunidades_v2.cliente (id) on delete cascade,
  telefono_id  text not null,           -- dígitos (WhatsApp) o ig:<id> (Instagram), igual que evento_crudo
  mensaje      text,                    -- lo último que escribió la persona (contact.last_input_text), si ManyChat lo manda
  payload      jsonb,                   -- el POST completo, tal cual llegó
  recibido_en  timestamptz not null default now()
);

create index if not exists idx_ingreso_sin_clasificar_cliente_fecha
  on crm_comunidades_v2.ingreso_sin_clasificar (cliente_id, recibido_en);
create index if not exists idx_ingreso_sin_clasificar_cliente_persona
  on crm_comunidades_v2.ingreso_sin_clasificar (cliente_id, telefono_id);

alter table crm_comunidades_v2.ingreso_sin_clasificar enable row level security;

-- Trae el teléfono de la persona: lo lee solo Marketing (como evento_crudo). Los conteos los ve cualquier usuario del CRM
-- por la función de abajo.
drop policy if exists marketing_select on crm_comunidades_v2.ingreso_sin_clasificar;
create policy marketing_select on crm_comunidades_v2.ingreso_sin_clasificar for select to authenticated
  using ((select crm_comunidades_v2.es_marketing()));

revoke all on crm_comunidades_v2.ingreso_sin_clasificar from anon, authenticated;
grant select on crm_comunidades_v2.ingreso_sin_clasificar to authenticated;
grant select, insert on crm_comunidades_v2.ingreso_sin_clasificar to service_role;

comment on table crm_comunidades_v2.ingreso_sin_clasificar is
  'Avisos "la persona le escribió al número y no eligió comunidad" que manda la respuesta por defecto de ManyChat. No son contactos: no entran a evento_crudo ni a la atribución.';

-- Entradas del cliente en un período. Cualquier usuario del CRM ve los conteos (no hay datos personales ni plata).
-- hay_registro avisa si el flow ya mandó alguna vez un "sin clasificar": mientras sea false el panel no muestra la tasa,
-- porque "100 % clasificadas" sería engañoso si nadie está avisando.
create or replace function crm_comunidades_v2.entradas_flow_cliente(
  p_cliente uuid,
  p_desde   date default null,
  p_hasta   date default null,
  p_canal   text default null
)
returns table (clasificadas bigint, sin_clasificar bigint, total bigint, tasa_clasificacion_pct numeric, hay_registro boolean)
language sql
stable
security definer
set search_path = crm_comunidades_v2, public
as $f$
  -- Acceso: cualquier usuario del CRM. Sin JWT es una conexión directa a la base (SQL Editor, pg_cron) y la clave de servicio es de
  -- las Edge Functions: no se controlan acá (mismo criterio que _exigir_marketing, db/031). La clave pública (anon) no tiene EXECUTE.
  with acceso as (
    select (nullif(current_setting('request.jwt.claims', true), '') is null
            or auth.role() = 'service_role'
            or crm_comunidades_v2.es_usuario_crm()) as ok
  ),
  primeros as (
    select distinct on (e.telefono_id) e.telefono_id, e.recibido_en
      from crm_comunidades_v2.evento_crudo e
     where e.cliente_id = p_cliente
     order by e.telefono_id, e.recibido_en asc
  ),
  clas as (
    select count(*) as n
      from primeros p
     where (p_canal is null or p_canal = 'todos'
            or (p_canal = 'instagram' and p.telefono_id like 'ig:%')
            or (p_canal = 'whatsapp' and p.telefono_id not like 'ig:%'))
       and (p_desde is null or (p.recibido_en at time zone 'America/Argentina/Buenos_Aires')::date >= p_desde)
       and (p_hasta is null or (p.recibido_en at time zone 'America/Argentina/Buenos_Aires')::date <= p_hasta)
  ),
  pend as (
    select count(distinct s.telefono_id) as n
      from crm_comunidades_v2.ingreso_sin_clasificar s
     where s.cliente_id = p_cliente
       and (p_canal is null or p_canal = 'todos'
            or (p_canal = 'instagram' and s.telefono_id like 'ig:%')
            or (p_canal = 'whatsapp' and s.telefono_id not like 'ig:%'))
       and (p_desde is null or (s.recibido_en at time zone 'America/Argentina/Buenos_Aires')::date >= p_desde)
       and (p_hasta is null or (s.recibido_en at time zone 'America/Argentina/Buenos_Aires')::date <= p_hasta)
       and not exists (select 1 from crm_comunidades_v2.evento_crudo e
                        where e.cliente_id = s.cliente_id and e.telefono_id = s.telefono_id)
  )
  select clas.n::bigint,
         pend.n::bigint,
         (clas.n + pend.n)::bigint,
         round(clas.n::numeric / nullif(clas.n + pend.n, 0) * 100, 2),
         exists (select 1 from crm_comunidades_v2.ingreso_sin_clasificar x where x.cliente_id = p_cliente)
    from acceso a, clas, pend
   where a.ok;
$f$;

revoke all on function crm_comunidades_v2.entradas_flow_cliente(uuid, date, date, text) from public, anon;
grant execute on function crm_comunidades_v2.entradas_flow_cliente(uuid, date, date, text) to authenticated, service_role;
comment on function crm_comunidades_v2.entradas_flow_cliente(uuid, date, date, text) is
  'Entradas clasificadas (primer contacto), sin clasificar (le escribieron al número y todavía no eligieron comunidad), total y tasa de clasificación. Solo conteos: lo ve cualquier usuario del CRM.';
