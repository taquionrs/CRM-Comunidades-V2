-- ============================================================================
-- CRM de Comunidades V2 — vistas de agregación para panel-data
-- Ref: specs/2026-09-25-v2-desde-cero.md, documento de Jaz, Secciones 3.A-B y
-- Sección 4.C (contrato JSON exacto que arma la Edge Function panel-data).
--
-- Fórmulas tomadas literalmente del documento (Sección 3.A "Módulo Superior"
-- y 3.B "Control_Comunidades"):
--   CPL   = Inversión / Conversaciones (Meta)
--   CPCU  = Inversión / Clics Únicos
--   CPMN  = Inversión / (Mf - Mi)
--   B (bajas estimadas) = Mi + Clics Únicos - Mf
--   Tasa de fuga (%)    = (B / Clics Únicos) × 100
--   CPME global         = Inversión total / (Σ Mf - Σ Mi)
--
-- Aplicar después de 001_init.sql. Idempotente.
-- ============================================================================
set search_path = crm_comunidades_v2, public;

-- ----------------------------------------------------------------------------
-- VISTA: comunidad_performance
-- Una fila por comunidad — base de la tab Control_Comunidades y de
-- `comunidades_performance` en el JSON de panel-data.
-- ----------------------------------------------------------------------------
create or replace view crm_comunidades_v2.comunidad_performance as
select
  c.id as comunidad_id,
  c.nombre,
  c.miembros_iniciales,
  c.miembros_finales,
  coalesce(m.inversion, 0) as inversion,
  coalesce(m.conversaciones_meta, 0) as conversaciones_meta,
  coalesce(m.impresiones, 0) as impresiones,
  coalesce(u.clics_unicos, 0) as clics_unicos,
  round(coalesce(m.inversion, 0) / nullif(coalesce(m.conversaciones_meta, 0), 0), 2) as cpl,
  round(coalesce(m.inversion, 0) / nullif(coalesce(u.clics_unicos, 0), 0), 2) as cpcu,
  round(coalesce(m.inversion, 0) / nullif(c.miembros_finales - c.miembros_iniciales, 0), 2) as cpmn,
  (c.miembros_finales - c.miembros_iniciales) as crecimiento_neto,
  (c.miembros_iniciales + coalesce(u.clics_unicos, 0) - c.miembros_finales) as bajas_estimadas,
  round(
    (c.miembros_iniciales + coalesce(u.clics_unicos, 0) - c.miembros_finales)::numeric
    / nullif(coalesce(u.clics_unicos, 0), 0) * 100, 2
  ) as tasa_fuga_pct
from crm_comunidades_v2.comunidad c
left join (
  select comunidad_id, sum(inversion) as inversion, sum(conversaciones_meta) as conversaciones_meta, sum(impresiones) as impresiones
  from crm_comunidades_v2.meta_ads_metrica
  group by comunidad_id
) m on m.comunidad_id = c.id
left join (
  select comunidad_atribuida_id, count(*) as clics_unicos
  from crm_comunidades_v2.evento_deduplicado
  group by comunidad_atribuida_id
) u on u.comunidad_atribuida_id = c.id;

alter view crm_comunidades_v2.comunidad_performance set (security_invoker = true);
comment on view crm_comunidades_v2.comunidad_performance is
  'Una fila por comunidad con las fórmulas de las Secciones 3.A/3.B del documento de Jaz. clics_unicos = count(evento_deduplicado) atribuidos a esa comunidad (First-Contact Attribution) — nunca se carga a mano.';

-- ----------------------------------------------------------------------------
-- VISTA: base_limpia
-- Junta las dos mitades del Nivel Curado: atribución (evento_deduplicado,
-- siempre derivada, nunca desincronizable) + enriquecimiento (usuario_curado,
-- nombre/email/etiquetas/estado). Es la fuente real de la tab Base_Limpia y
-- de `base_limpia_usuarios` en el JSON de panel-data.
-- ----------------------------------------------------------------------------
create or replace view crm_comunidades_v2.base_limpia as
select
  d.telefono_id as phone_id,
  coalesce(u.nombre, 'Usuario WA') as nombre,
  coalesce(u.email, 'Sin email') as email,
  c.nombre as comunidad_atribuida,
  d.comunidad_atribuida_id,
  d.fecha_primer_contacto,
  coalesce(u.etiquetas, '{}') as etiquetas,
  coalesce(u.estado, 'clic_en_grupo') as estado
from crm_comunidades_v2.evento_deduplicado d
left join crm_comunidades_v2.usuario_curado u on u.telefono_id = d.telefono_id
left join crm_comunidades_v2.comunidad c on c.id = d.comunidad_atribuida_id;

alter view crm_comunidades_v2.base_limpia set (security_invoker = true);
comment on view crm_comunidades_v2.base_limpia is
  'Tabla nominada de la Sección 3, TAB 3 del documento de Jaz. "Usuario WA"/"Sin email" son los defaults literales que describe la Nota de Enriquecimiento del documento para quien todavía no sincronizó nombre.';

grant select on crm_comunidades_v2.base_limpia to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- VISTA: kpis_macro
-- Una sola fila — el roll-up global de Overview (Sección 3.A) y
-- `kpis_macro` en el JSON de panel-data.
-- ----------------------------------------------------------------------------
create or replace view crm_comunidades_v2.kpis_macro as
select
  coalesce(sum(inversion), 0) as inversion_total,
  coalesce(sum(conversaciones_meta), 0) as conversaciones_totales,
  round(coalesce(sum(inversion), 0) / nullif(coalesce(sum(conversaciones_meta), 0), 0), 2) as cpl_global,
  coalesce(sum(clics_unicos), 0) as clics_unicos_totales,
  coalesce(sum(miembros_finales), 0) as miembros_efectivos_totales,
  round(coalesce(sum(inversion), 0) / nullif(sum(miembros_finales) - sum(miembros_iniciales), 0), 2) as cpme_global,
  round(
    coalesce(sum(bajas_estimadas), 0)::numeric / nullif(coalesce(sum(clics_unicos), 0), 0) * 100, 2
  ) as tasa_fuga_global_pct
from crm_comunidades_v2.comunidad_performance;

alter view crm_comunidades_v2.kpis_macro set (security_invoker = true);
comment on view crm_comunidades_v2.kpis_macro is
  'Roll-up global sobre comunidad_performance — una sola fila, base del módulo superior de Overview (Sección 3.A del documento de Jaz).';

grant select on crm_comunidades_v2.comunidad_performance to anon, authenticated, service_role;
grant select on crm_comunidades_v2.kpis_macro to anon, authenticated, service_role;
