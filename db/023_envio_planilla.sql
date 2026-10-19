-- 023 — Estado del envío a la planilla (n8n) visible en Data_Cruda
--
-- El flujo de n8n escribe en Google Sheets los contactos de WhatsApp (docs/how-to/configurar-n8n-contactos-wsp.md). Hasta ahora el CRM no se
-- enteraba de cómo le iba: si n8n fallaba (por ejemplo, porque faltaba una pestaña), esa persona no quedaba en la planilla y nada lo mostraba.
-- Desde ahora n8n avisa el resultado de cada evento y Data_Cruda lo muestra en la columna "Planilla":
--   registrado  se escribió en la planilla
--   ignorado    no es un contacto de WhatsApp (Instagram), a propósito no va a la planilla
--   error       n8n no pudo escribir (con el motivo)
-- Un evento sin fila acá aparece como "Sin registro" (anterior a esta integración, o n8n no llegó a avisar).
--
-- Seguridad: n8n llama a registrar_envio_planilla con la clave publishable y un encabezado secreto (x-crm-secret). La función compara el hash de
-- ese encabezado con config_n8n; el valor real de la clave NO está en el repositorio. La tabla solo guarda estado y motivo (nunca teléfonos).

create table if not exists crm_comunidades_v2.config_n8n (
  id          boolean primary key default true check (id),
  clave_hash  text not null,
  cambiada_en timestamptz not null default now()
);
alter table crm_comunidades_v2.config_n8n enable row level security;
revoke all on crm_comunidades_v2.config_n8n from anon, authenticated;
grant select, insert, update on crm_comunidades_v2.config_n8n to service_role;
comment on table crm_comunidades_v2.config_n8n is
  'Hash (sha256) del secreto que n8n manda en el encabezado x-crm-secret. El valor real no se guarda en ningún archivo del repositorio.';

create table if not exists crm_comunidades_v2.envio_planilla (
  evento_id      uuid primary key references crm_comunidades_v2.evento_crudo(id) on delete cascade,
  cliente_id     uuid not null,
  estado         text not null check (estado in ('registrado', 'ignorado', 'error')),
  motivo         text,
  actualizado_en timestamptz not null default clock_timestamp()
);
create index if not exists idx_envio_planilla_cliente_estado on crm_comunidades_v2.envio_planilla (cliente_id, estado);

alter table crm_comunidades_v2.envio_planilla enable row level security;
-- Igual que el resto de las tablas hoy (db/003): lectura abierta temporal. No tiene datos personales (solo estado y motivo). db/005 la restringe por cliente.
drop policy if exists lectura_abierta on crm_comunidades_v2.envio_planilla;
create policy lectura_abierta on crm_comunidades_v2.envio_planilla for select using (true);
revoke all on crm_comunidades_v2.envio_planilla from anon, authenticated;
grant select on crm_comunidades_v2.envio_planilla to anon, authenticated;
grant select, insert, update on crm_comunidades_v2.envio_planilla to service_role;
comment on table crm_comunidades_v2.envio_planilla is
  'Resultado de enviar cada evento_crudo a la planilla de Google (n8n). Una fila por evento; si n8n reintenta, se actualiza.';

-- n8n la llama por POST /rest/v1/rpc/registrar_envio_planilla con los encabezados apikey, Content-Profile: crm_comunidades_v2 y x-crm-secret.
create or replace function crm_comunidades_v2.registrar_envio_planilla(p_evento_id uuid, p_estado text, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = crm_comunidades_v2, public, extensions
as $$
declare
  v_secreto text;
  v_hash text;
  v_cliente uuid;
begin
  v_secreto := coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-crm-secret', '');
  select c.clave_hash into v_hash from crm_comunidades_v2.config_n8n c where c.id;
  if v_hash is null or encode(digest(v_secreto, 'sha256'), 'hex') <> v_hash then
    raise exception 'Clave incorrecta' using errcode = '42501';
  end if;
  if p_estado not in ('registrado', 'ignorado', 'error') then
    raise exception 'Estado inválido (registrado, ignorado o error)';
  end if;
  select e.cliente_id into v_cliente from crm_comunidades_v2.evento_crudo e where e.id = p_evento_id;
  if v_cliente is null then raise exception 'El evento no existe'; end if;

  insert into crm_comunidades_v2.envio_planilla (evento_id, cliente_id, estado, motivo)
  values (p_evento_id, v_cliente, p_estado, left(nullif(btrim(p_motivo), ''), 300))
  on conflict (evento_id) do update
    set estado = excluded.estado, motivo = excluded.motivo, actualizado_en = clock_timestamp();
end;
$$;
revoke all on function crm_comunidades_v2.registrar_envio_planilla(uuid, text, text) from public;
grant execute on function crm_comunidades_v2.registrar_envio_planilla(uuid, text, text) to anon, authenticated, service_role;
comment on function crm_comunidades_v2.registrar_envio_planilla(uuid, text, text) is
  'Registra si n8n pudo escribir un evento en la planilla. Exige el encabezado x-crm-secret (hash en config_n8n). Solo guarda estado y motivo.';
