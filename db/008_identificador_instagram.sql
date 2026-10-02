-- ============================================================================
-- CRM de Comunidades V2 — contactos de Instagram (PR #4)
--
-- Hasta ahora la persona se identificaba solo por su teléfono (db/006 exige
-- solo dígitos, mínimo 8). Un contacto de Instagram no tiene teléfono: ManyChat
-- manda su identificador de Instagram (contact.ig_id). Para que el mismo flow
-- sirva en los dos canales, la columna `telefono_id` (se mantiene el nombre por
-- compatibilidad) acepta ahora dos formatos:
--
--   WhatsApp   5491133433782          solo dígitos, mínimo 8 (como antes)
--   Instagram  ig:17841400000000000   prefijo "ig:" + identificador numérico
--
-- El prefijo impide que un identificador de Instagram se confunda con un
-- teléfono. El canal NO se guarda en una columna aparte: se deduce del prefijo.
-- La atribución First-Contact, las vistas y el historial no cambian: siguen
-- funcionando por (cliente_id, telefono_id).
--
-- Limitación conocida: la misma persona en WhatsApp e Instagram cuenta como dos
-- (sin teléfono no hay forma de saber que son la misma).
--
-- Aplicar después de 007. Idempotente.
-- ============================================================================
alter table crm_comunidades_v2.evento_crudo drop constraint if exists evento_crudo_telefono_digitos;
alter table crm_comunidades_v2.evento_crudo drop constraint if exists evento_crudo_identificador_valido;
alter table crm_comunidades_v2.evento_crudo
  add constraint evento_crudo_identificador_valido
  check (telefono_id ~ '^[0-9]{8,}$' or telefono_id ~ '^ig:[0-9]{5,}$') not valid;

alter table crm_comunidades_v2.usuario_curado drop constraint if exists usuario_curado_telefono_digitos;
alter table crm_comunidades_v2.usuario_curado drop constraint if exists usuario_curado_identificador_valido;
alter table crm_comunidades_v2.usuario_curado
  add constraint usuario_curado_identificador_valido
  check (telefono_id ~ '^[0-9]{8,}$' or telefono_id ~ '^ig:[0-9]{5,}$') not valid;

comment on column crm_comunidades_v2.evento_crudo.telefono_id is
  'Identificador de la persona: teléfono (solo dígitos, WhatsApp) o ig:<id numérico> (Instagram).';
comment on column crm_comunidades_v2.usuario_curado.telefono_id is
  'Identificador de la persona: teléfono (solo dígitos, WhatsApp) o ig:<id numérico> (Instagram).';
