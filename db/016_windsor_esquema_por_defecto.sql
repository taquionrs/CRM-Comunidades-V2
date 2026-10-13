-- ============================================================================
-- CRM de Comunidades V2 — esquema por defecto del usuario de Windsor (PR #26)
--
-- El destino "PostgreSQL" de Windsor.ai pide usuario, contraseña, host, puerto, base y nombre de tabla, pero NO
-- un esquema. Sin este ajuste, una tabla creada con un nombre sin esquema iría a "public", donde windsor_escritor
-- no tiene permiso (db/014) y la creación fallaría. Con esto, cae en windsor_raw. Aplicar después de 015. Idempotente.
-- ============================================================================
alter role windsor_escritor set search_path = windsor_raw;
