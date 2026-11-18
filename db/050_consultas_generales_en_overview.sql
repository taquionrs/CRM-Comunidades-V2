-- ============================================================================
-- PR #91 — Consultas generales en Overview: totales, sin registrar y registradas
-- ============================================================================
-- Una "consulta general" es una persona que le escribió al número oficial sin elegir comunidad (ManyChat avisa con el texto que mandó,
-- por ejemplo "¡Hola! Quiero más información"; tabla ingreso_sin_clasificar, db/035). Cada una está en uno de dos estados:
--   sin registrar  todavía no tiene ningún evento clasificado (no eligió comunidad)       -> sin_clasificar (ya existía)
--   registrada     escribió una consulta general y después eligió una comunidad (ya figura como entrada de su comunidad)
-- entradas_flow_cliente suma dos columnas al final: consultas_generales (personas distintas con un aviso en el período, registradas o no)
-- y consultas_registradas (consultas_generales − sin_clasificar). Lo demás queda igual: clasificadas, sin_clasificar, total y tasa.
-- Las registradas ya están dentro de "clasificadas" (no se cuentan dos veces en el total).
-- Respeta el período y el canal, y la lista de comunidades ocultas de db/047. Cambia el tipo de retorno: se vuelve a crear la función.
-- Aplicar después de 047. Idempotente.
-- ============================================================================
set search_path = crm_comunidades_v2, public;

drop function if exists crm_comunidades_v2.entradas_flow_cliente(uuid, date, date, text);

create function crm_comunidades_v2.entradas_flow_cliente(
  p_cliente uuid,
  p_desde   date default null,
  p_hasta   date default null,
  p_canal   text default null
)
returns table (clasificadas bigint, sin_clasificar bigint, total bigint, tasa_clasificacion_pct numeric, hay_registro boolean,
               consultas_generales bigint, consultas_registradas bigint)
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
  primeros as (
    select x.telefono_id, x.recibido_en
      from (select distinct on (e.telefono_id) e.telefono_id, e.recibido_en, e.comunidad_id
              from crm_comunidades_v2.evento_crudo e
             where e.cliente_id = p_cliente
             order by e.telefono_id, e.recibido_en asc) x
     where not exists (select 1 from crm_comunidades_v2.comunidad co where co.id = x.comunidad_id and co.oculta)
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
  avisos as (
    select distinct s.telefono_id, s.cliente_id
      from crm_comunidades_v2.ingreso_sin_clasificar s
     where s.cliente_id = p_cliente
       and (p_canal is null or p_canal = 'todos'
            or (p_canal = 'instagram' and s.telefono_id like 'ig:%')
            or (p_canal = 'whatsapp' and s.telefono_id not like 'ig:%'))
       and (p_desde is null or (s.recibido_en at time zone 'America/Argentina/Buenos_Aires')::date >= p_desde)
       and (p_hasta is null or (s.recibido_en at time zone 'America/Argentina/Buenos_Aires')::date <= p_hasta)
  ),
  cons as (
    select count(*) as n,
           count(*) filter (where not exists (select 1 from crm_comunidades_v2.evento_crudo e
                                               where e.cliente_id = a.cliente_id and e.telefono_id = a.telefono_id)) as pend
      from avisos a
  )
  select clas.n::bigint,
         cons.pend::bigint,
         (clas.n + cons.pend)::bigint,
         round(clas.n::numeric / nullif(clas.n + cons.pend, 0) * 100, 2),
         exists (select 1 from crm_comunidades_v2.ingreso_sin_clasificar x where x.cliente_id = p_cliente),
         cons.n::bigint,
         (cons.n - cons.pend)::bigint
    from acceso a, clas, cons
   where a.ok;
$f$;

revoke all on function crm_comunidades_v2.entradas_flow_cliente(uuid, date, date, text) from public, anon;
grant execute on function crm_comunidades_v2.entradas_flow_cliente(uuid, date, date, text) to authenticated, service_role;
comment on function crm_comunidades_v2.entradas_flow_cliente(uuid, date, date, text) is
  'Entradas al flow de un cliente en un período: clasificadas, sin clasificar (consultas generales sin registrar), total y tasa; más consultas generales (personas que escribieron sin elegir comunidad) y cuántas de ellas ya quedaron registradas en una comunidad.';
