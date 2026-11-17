-- ============================================================================
-- PR #86 — Ocultar "Todo un País (general)"
-- ============================================================================
-- Igual que "Cortado en Jarrito (general)" (db/047): es el canal oficial del cliente (su número de WhatsApp), no una comunidad.
-- Queda oculta en el CRM (no se muestra ni se cuenta) sin borrar ningún dato. Idempotente.
-- Aplicar después de 047.
-- ============================================================================
update crm_comunidades_v2.comunidad c
   set oculta = true
  from crm_comunidades_v2.cliente cl
 where cl.id = c.cliente_id and cl.nombre = 'Todo un País' and c.nombre = 'Todo un País (general)';
