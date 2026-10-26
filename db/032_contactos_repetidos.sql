-- 032 — Contactos que se registraron más de una vez
--
-- Pedido (2026-10-26): un filtro que cuente todos los contactos que se registraron varias veces, sea por pruebas o porque alguien entró a una comunidad,
-- salió y volvió a entrar. Data_Cruda solo muestra los últimos 200 eventos, así que la cuenta se hace en la base sobre TODA la historia.
--
--   contactos_repetidos(cliente, desde, hasta, comunidad, límite)   devuelve un JSON con
--     resumen: contactos distintos, eventos, contactos repetidos, eventos de esos contactos, registros "de más", cuántos repiten dentro de una misma comunidad
--              y cuántos aparecen en más de una comunidad.
--     filas:   un renglón por contacto repetido (veces, primer y último registro, comunidades, nombre), de más a menos veces. Hasta `límite` (500 por omisión, 2000 máximo).
--
-- Reglas: un "registro" es un evento aceptado de evento_crudo (los rechazados no cuentan). Las fechas se toman en hora de Buenos Aires. Con una comunidad elegida
-- se cuentan solo los eventos de esa comunidad (así se ven los reingresos a esa comunidad). La base no puede saber el motivo (prueba, reingreso, doble toque):
-- muestra los datos para que el equipo lo decida.
-- Solo Marketing (datos personales), igual que el resto de lo que lee Data_Cruda. Aplicar después de 031.

create or replace function crm_comunidades_v2.contactos_repetidos(
  p_cliente uuid, p_desde date default null, p_hasta date default null, p_comunidad uuid default null, p_limite int default 500)
returns jsonb
language plpgsql
stable
set search_path = crm_comunidades_v2, public
as $f$
declare
  v_limite int := least(greatest(coalesce(p_limite, 500), 1), 2000);
  v_zona constant text := 'America/Argentina/Buenos_Aires';
begin
  perform crm_comunidades_v2._exigir_marketing();
  return (
    with ev as (
      select e.telefono_id, e.comunidad_id, e.recibido_en,
             nullif(btrim(e.payload #>> '{contact,name}'), '') as nombre,
             nullif(btrim(e.payload #>> '{contact,ig_username}'), '') as usuario_instagram
        from crm_comunidades_v2.evento_crudo e
       where e.cliente_id = p_cliente
         and (p_desde is null or (e.recibido_en at time zone v_zona)::date >= p_desde)
         and (p_hasta is null or (e.recibido_en at time zone v_zona)::date <= p_hasta)
         and (p_comunidad is null or e.comunidad_id = p_comunidad)
    ), agg as (
      select ev.telefono_id, count(*)::int as veces, min(ev.recibido_en) as primera, max(ev.recibido_en) as ultima,
             count(distinct ev.comunidad_id)::int as n_comunidades,
             array_agg(distinct co.nombre order by co.nombre) as comunidades,
             (array_agg(ev.nombre order by ev.recibido_en desc) filter (where ev.nombre is not null))[1] as nombre,
             (array_agg(ev.usuario_instagram order by ev.recibido_en desc) filter (where ev.usuario_instagram is not null))[1] as usuario_instagram
        from ev join crm_comunidades_v2.comunidad co on co.id = ev.comunidad_id
       group by ev.telefono_id
    ), rep as (
      select * from agg where veces > 1
    )
    select jsonb_build_object(
      'resumen', jsonb_build_object(
        'contactos',               (select count(*) from agg),
        'eventos',                 (select coalesce(sum(veces), 0) from agg),
        'contactos_repetidos',     (select count(*) from rep),
        'eventos_de_repetidos',    (select coalesce(sum(veces), 0) from rep),
        'registros_de_mas',        (select coalesce(sum(veces - 1), 0) from rep),
        'misma_comunidad',         (select count(*) from rep where n_comunidades = 1),
        'varias_comunidades',      (select count(*) from rep where n_comunidades > 1)),
      'filas', coalesce((
        select jsonb_agg(to_jsonb(r) order by r.veces desc, r.ultima desc)
          from (select telefono_id, veces, primera, ultima, n_comunidades, comunidades, nombre, usuario_instagram
                  from rep order by veces desc, ultima desc limit v_limite) r), '[]'::jsonb)));
end;
$f$;

revoke all on function crm_comunidades_v2.contactos_repetidos(uuid, date, date, uuid, int) from public, anon;
grant execute on function crm_comunidades_v2.contactos_repetidos(uuid, date, date, uuid, int) to authenticated, service_role;
comment on function crm_comunidades_v2.contactos_repetidos(uuid, date, date, uuid, int) is
  'Contactos con más de un registro (evento aceptado) en un rango de fechas y comunidad opcional: resumen y detalle. Solo Marketing. Alimenta el bloque "Contactos repetidos" de Data_Cruda.';
