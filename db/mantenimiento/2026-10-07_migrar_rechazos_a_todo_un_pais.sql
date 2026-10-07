-- ============================================================================
-- Mantenimiento (YA EJECUTADO el 2026-10-07; se conserva como registro, no volver a correr sin revisar)
--
-- Contexto: el flow de Instagram de Todo un País ("Test Comunidades IG") envió sus POST con el
-- x-cliente y el secreto de Cortado. El CRM los rechazó con 404 (comunidades que Cortado no tiene)
-- y quedaron en webhook_intento de Cortado, sin el contenido del POST (db/009 todavía no existía).
--
-- Qué hace: convierte esos rechazos en eventos aceptados de Todo un País, con la hora original.
--   * "San Luis" se convierte en "San Luis Capital" (nombre de la comunidad en el CRM).
--   * Marca cada evento con payload->'_recuperado' (de dónde vino, id del rechazo, si no tenía contenido).
--   * Borra del registro de rechazos los que migró. Si los conteos no coinciden, aborta.
--   * Completa el nombre de las personas cuyo rechazo sí guardó el contenido.
-- Resultado de la corrida real: 133 candidatos = 133 insertados = 133 borrados.
-- Nota: evento_crudo.tipo solo admite 'webhook_manychat' (check), por eso la marca va en el payload.
-- ============================================================================
begin;
create temp table _resultado on commit drop as
with tup as (select id from crm_comunidades_v2.cliente where slug = 'todo-un-pais'),
cand as (
  select w.id as wid, w.telefono_id, w.creado_en, w.comunidad_recibida, w.payload, c.slug as cliente_origen,
         case w.comunidad_recibida when 'San Luis' then 'San Luis Capital' else w.comunidad_recibida end as comunidad_destino
  from crm_comunidades_v2.webhook_intento w
  join crm_comunidades_v2.cliente c on c.id = w.cliente_id
  where w.estado = 404 and w.telefono_id is not null
    and w.comunidad_recibida in ('San Luis', 'Quines', 'La Toma')
    and c.slug in ('cortado-en-jarrito', 'todo-un-pais')
),
ins as (
  insert into crm_comunidades_v2.evento_crudo (cliente_id, comunidad_id, telefono_id, tipo, payload, recibido_en)
  select tup.id, m.id, cand.telefono_id, 'webhook_manychat',
         coalesce(jsonb_set(cand.payload, '{community_id}', to_jsonb(cand.comunidad_destino)), jsonb_build_object('community_id', cand.comunidad_destino))
           || jsonb_build_object('_recuperado', jsonb_build_object('de', 'webhook_intento', 'id', cand.wid, 'cliente_origen', cand.cliente_origen,
                'comunidad_original', cand.comunidad_recibida, 'sin_contenido', cand.payload is null, 'fecha_recuperacion', now())),
         cand.creado_en
  from cand cross join tup join crm_comunidades_v2.comunidad m on m.cliente_id = tup.id and m.nombre = cand.comunidad_destino
  returning id, (payload->'_recuperado'->>'id')::uuid as wid
),
del as (delete from crm_comunidades_v2.webhook_intento where id in (select wid from ins) returning id)
select (select count(*) from cand) as candidatos, (select count(*) from ins) as insertados, (select count(*) from del) as borrados;

update crm_comunidades_v2.usuario_curado u set nombre = x.nombre
from (select distinct on (e.telefono_id) e.cliente_id, e.telefono_id, nullif(btrim(coalesce(e.payload->'contact'->>'name','')), '') as nombre
      from crm_comunidades_v2.evento_crudo e join crm_comunidades_v2.cliente c on c.id = e.cliente_id
      where c.slug = 'todo-un-pais' and e.payload->'_recuperado' is not null and e.payload->'contact' is not null
      order by e.telefono_id, e.recibido_en) x
where u.cliente_id = x.cliente_id and u.telefono_id = x.telefono_id and u.nombre is null
  and x.nombre is not null and x.nombre !~ '^[0-9 +()-]+$';

do $$ declare r record; begin
  select * into r from _resultado;
  if r.candidatos <> r.insertados or r.insertados <> r.borrados then raise exception 'Los conteos no coinciden: % / % / %', r.candidatos, r.insertados, r.borrados; end if;
end $$;
select * from _resultado;
commit;
