-- ============================================================================
-- CRM de Comunidades V2 — CRR: tasa de retención de miembros (PR #74)
--
--   CRR = (miembros al final − miembros nuevos) ÷ miembros al inicio × 100
--   Churn = 100 − CRR   (cuántos de los miembros del inicio ya no están)
--
-- Se mide ENTRE DOS CARGAS DE LISTA COMPLETA del grupo (db/019, db/020), que son una foto exacta de quién está en el grupo ese día:
--   inicio  = miembros de la carga anterior          (numeros_validos de la carga previa)
--   final   = miembros de la carga que cierra        (numeros_validos de esa carga)
--   nuevos  = personas que aparecen por primera vez o vuelven  (carga_miembros.nuevos: nuevos + reingresos)
--   bajas   = personas del grupo anterior que ya no están     (carga_miembros.salieron)
--   cuadra  = inicio + nuevos − bajas = final  (si no cuadra, hay que revisar las cargas: el CRR igual se calcula con la fórmula)
-- No se estima nada: una comunidad sin dos cargas de lista completa no tiene CRR. Solo conteos (nunca teléfonos).
--
-- crr_por_carga(cliente, desde, hasta): una fila por comunidad y por intervalo entre cargas cuya carga de cierre cae dentro de las
-- fechas elegidas (null = todo el historial). Las fechas son de Buenos Aires. Cualquier usuario del CRM ve los conteos.
--
-- Diferencia con la "fuga" de db/021: la fuga usa bajas ÷ (bajas + miembros finales), que mide sobre todas las personas que estuvieron
-- en el grupo. El CRR usa como base solo a los miembros del inicio, que es la definición habitual de retención.
--
-- Aplicar después de 042 (o de 041 si 042 no está). Idempotente.
-- ============================================================================
set search_path = crm_comunidades_v2, public;

create or replace function crm_comunidades_v2.crr_por_carga(
  p_cliente uuid,
  p_desde   date default null,
  p_hasta   date default null
)
returns table (comunidad_id uuid, comunidad text, desde date, hasta date, dias integer,
               miembros_inicio integer, nuevos integer, bajas integer, miembros_fin integer,
               crr_pct numeric, churn_pct numeric, cuadra boolean)
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
  cargas as (
    select c.comunidad_id, c.cargada_en,
           (c.cargada_en at time zone 'America/Argentina/Buenos_Aires')::date as dia,
           c.numeros_validos as miembros, coalesce(c.nuevos, 0) as nuevos, coalesce(c.salieron, 0) as bajas
      from crm_comunidades_v2.carga_miembros c
     where c.cliente_id = p_cliente and c.lista_completa
  ),
  pares as (
    select k.*, lag(k.dia) over w as dia_ant, lag(k.miembros) over w as miembros_ant,
           round((k.miembros - k.nuevos)::numeric / nullif(lag(k.miembros) over w, 0) * 100, 2) as crr
      from cargas k
    window w as (partition by k.comunidad_id order by k.cargada_en)
  )
  select p.comunidad_id, co.nombre, p.dia_ant, p.dia, (p.dia - p.dia_ant)::int,
         p.miembros_ant::int, p.nuevos::int, p.bajas::int, p.miembros::int,
         p.crr,
         100 - p.crr,   -- churn: sobre el CRR ya redondeado, así los dos siempre suman 100
         (p.miembros_ant + p.nuevos - p.bajas = p.miembros)
    from acceso ac
    join pares p on ac.ok and p.dia_ant is not null
    join crm_comunidades_v2.comunidad co on co.id = p.comunidad_id and co.cliente_id = p_cliente
   where (p_desde is null or p.dia >= p_desde) and (p_hasta is null or p.dia <= p_hasta)
   order by p.dia desc, co.nombre;
$f$;

revoke all on function crm_comunidades_v2.crr_por_carga(uuid, date, date) from public, anon;
grant execute on function crm_comunidades_v2.crr_por_carga(uuid, date, date) to authenticated, service_role;
comment on function crm_comunidades_v2.crr_por_carga(uuid, date, date) is
  'CRR = (miembros al final − nuevos) ÷ miembros al inicio × 100, entre dos cargas de lista completa de cada comunidad. Churn = 100 − CRR. Solo conteos.';
