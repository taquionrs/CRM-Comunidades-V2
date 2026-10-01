-- ============================================================================
-- CRM de Comunidades V2 — registro de intentos rechazados del webhook (PR #2)
--
-- evento_crudo guarda solo lo que el webhook ACEPTÓ. Cuando ManyChat manda un
-- POST que se rechaza (secreto incorrecto, comunidad que no existe, contacto
-- sin teléfono...) hasta ahora no quedaba rastro en el CRM. Esta tabla guarda
-- esos rechazos para mostrarlos en la tab Data_Cruda (filtro "Rechazados").
--
-- Qué se guarda: cliente, código HTTP, motivo en palabras, la comunidad que
-- llegó en community_id y el teléfono si se llegó a leer. NUNCA se guarda el
-- secreto recibido ni el body completo.
--
-- Qué NO se guarda: los intentos donde el cliente no se puede identificar
-- (headers ausentes o slug inexistente). No se pueden atribuir a ningún
-- cliente y serían ruido de escáneres que llenarían la tabla.
--
-- Lo escribe solo la Edge Function manychat-webhook (service_role).
-- Aplicar después de 004. Idempotente.
-- ============================================================================
create table if not exists crm_comunidades_v2.webhook_intento (
  id                 uuid primary key default gen_random_uuid(),
  cliente_id         uuid not null references crm_comunidades_v2.cliente (id) on delete cascade,
  estado             int  not null check (estado between 400 and 599),
  motivo             text not null,
  comunidad_recibida text,
  telefono_id        text,
  creado_en          timestamptz not null default now()
);

create index if not exists idx_webhook_intento_cliente_fecha
  on crm_comunidades_v2.webhook_intento (cliente_id, creado_en desc);

alter table crm_comunidades_v2.webhook_intento enable row level security;

-- Igual que el resto de las tablas hoy (db/003): lectura abierta temporal, sin login.
-- db/005 la restringe a los clientes del usuario cuando se active el login.
drop policy if exists lectura_abierta on crm_comunidades_v2.webhook_intento;
create policy lectura_abierta on crm_comunidades_v2.webhook_intento for select using (true);

-- Supabase no aplica GRANTs automáticos sobre un schema propio (ver db/001).
grant select on crm_comunidades_v2.webhook_intento to anon, authenticated;
grant select, insert on crm_comunidades_v2.webhook_intento to service_role;

comment on table crm_comunidades_v2.webhook_intento is
  'Intentos rechazados del webhook de ManyChat, por cliente. Se muestran en Data_Cruda con el filtro Rechazados. No guarda el secreto ni el body.';
