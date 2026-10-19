-- 024 — registrar_envio_planilla acepta los dos nombres del encabezado secreto
--
-- db/023 buscaba el secreto en el encabezado `x-crm-secret`. Al implementar el flujo, la credencial Header Auth de n8n quedó con el nombre
-- `Webhook-crm-secret` (el mismo que usa el webhook de Supabase hacia n8n), así que la función respondía "Clave incorrecta" aunque el valor fuera
-- el correcto. Para no cambiar nada de lo que ya funciona, la función ahora lee `x-crm-secret` y, si no está, `webhook-crm-secret`
-- (PostgREST entrega los nombres de los encabezados en minúsculas). El resto es igual que en 023.

create or replace function crm_comunidades_v2.registrar_envio_planilla(p_evento_id uuid, p_estado text, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = crm_comunidades_v2, public, extensions
as $$
declare
  v_encabezados jsonb;
  v_secreto text;
  v_hash text;
  v_cliente uuid;
begin
  v_encabezados := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_secreto := coalesce(v_encabezados ->> 'x-crm-secret', v_encabezados ->> 'webhook-crm-secret', '');
  select c.clave_hash into v_hash from crm_comunidades_v2.config_n8n c where c.id;
  if v_hash is null or encode(digest(v_secreto, 'sha256'), 'hex') <> v_hash then
    raise exception 'Clave incorrecta' using errcode = '42501';
  end if;
  if p_estado not in ('registrado', 'ignorado', 'error') then
    raise exception 'Estado inválido (registrado, ignorado o error)';
  end if;
  select e.cliente_id into v_cliente from crm_comunidades_v2.evento_crudo e where e.id = p_evento_id;
  if v_cliente is null then raise exception 'El evento no existe'; end if;

  insert into crm_comunidades_v2.envio_planilla (evento_id, cliente_id, estado, motivo)
  values (p_evento_id, v_cliente, p_estado, left(nullif(btrim(p_motivo), ''), 300))
  on conflict (evento_id) do update
    set estado = excluded.estado, motivo = excluded.motivo, actualizado_en = clock_timestamp();
end;
$$;
revoke all on function crm_comunidades_v2.registrar_envio_planilla(uuid, text, text) from public;
grant execute on function crm_comunidades_v2.registrar_envio_planilla(uuid, text, text) to anon, authenticated, service_role;
