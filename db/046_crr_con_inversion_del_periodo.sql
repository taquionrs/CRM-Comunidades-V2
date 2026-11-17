-- ============================================================================
-- PR #82 — Costo por miembro neto con los miembros reales del CRR
-- ============================================================================
-- El "costo por miembro neto" de Control_Comunidades se calculaba con los miembros iniciales y finales (MI y MF), una carga manual vieja.
-- Ahora se calcula con las cargas de lista completa (las mismas del CRR): inversión del período ÷ (miembros al final − miembros al inicio).
--
-- crr_por_carga_con_inversion(cliente, desde, hasta): lo mismo que crr_por_carga (db/043), más la inversión de Meta de la comunidad
-- dentro de cada período entre cargas (desde el día siguiente a la carga anterior hasta el día de la carga de cierre, inclusive; el mismo
-- criterio que el reporte semanal de db/044). La inversión es plata: solo la ven Marketing y el servidor; para el resto viene null y los
-- conteos salen igual.
--
-- Aplicar después de 043 y 044. Idempotente. El panel funciona igual sin esta función (usa crr_por_carga y deja el costo en "Sin dato").
-- ============================================================================
set search_path = crm_comunidades_v2, public;

create or replace function crm_comunidades_v2.crr_por_carga_con_inversion(
  p_cliente uuid,
  p_desde   date default null,
  p_hasta   date default null
)
returns table (comunidad_id uuid, comunidad text, desde date, hasta date, dias integer,
               miembros_inicio integer, nuevos integer, bajas integer, miembros_fin integer,
               crr_pct numeric, churn_pct numeric, cuadra boolean, inversion_periodo numeric)
language sql
stable
security definer
set search_path = crm_comunidades_v2, public
as $f$
  select r.comunidad_id, r.comunidad, r.desde, r.hasta, r.dias, r.miembros_inicio, r.nuevos, r.bajas, r.miembros_fin, r.crr_pct, r.churn_pct, r.cuadra,
         case when (nullif(current_setting('request.jwt.claims', true), '') is null
                    or auth.role() = 'service_role'
                    or crm_comunidades_v2.es_marketing())
              then (select round(coalesce(sum(m.inversion), 0), 2)
                      from crm_comunidades_v2.meta_ads_metrica m
                     where m.cliente_id = p_cliente and m.comunidad_id = r.comunidad_id and m.fecha > r.desde and m.fecha <= r.hasta)
         end
    from crm_comunidades_v2.crr_por_carga(p_cliente, p_desde, p_hasta) r
   order by r.hasta desc, r.comunidad;
$f$;

revoke all on function crm_comunidades_v2.crr_por_carga_con_inversion(uuid, date, date) from public, anon;
grant execute on function crm_comunidades_v2.crr_por_carga_con_inversion(uuid, date, date) to authenticated, service_role;
comment on function crm_comunidades_v2.crr_por_carga_con_inversion(uuid, date, date) is
  'CRR por intervalo entre cargas de lista completa (db/043) más la inversión de Meta del intervalo, para el costo por miembro neto. La inversión (plata) solo la ve Marketing; para el resto es null.';
