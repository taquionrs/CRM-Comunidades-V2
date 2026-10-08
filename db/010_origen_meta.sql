-- ============================================================================
-- CRM de Comunidades V2 — a qué comunidad pertenece cada campaña / conjunto de anuncios de Meta (PR #10)
--
-- Contexto (decisión del 2026-10-08, ver specs 3 septendecies): los datos de Meta Ads salen de Windsor.ai y
-- Cortado en Jarrito y Todo un País comparten UNA cuenta publicitaria ("TQN - Growing 2 - LC"). El cliente se
-- distingue por el nombre de la CAMPAÑA y la comunidad por el CONJUNTO DE ANUNCIOS (adset). El mapeo anterior
-- (comunidad.adset_name, un solo valor y único por cliente) no alcanza: una comunidad puede tener varios
-- conjuntos y los nombres de Meta no son prolijos (espacios, tildes, "PAÍS").
--
--   comunidad_meta_origen  una fila = "este conjunto de anuncios (o toda esta campaña) es de esta comunidad".
--     adset_nombre NULL = toda la campaña va a esa comunidad (se usa para la comunidad "general" de un cliente:
--     la inversión de campañas que no distinguen barrio).
--   normalizar_nombre()    recorta, quita tildes, colapsa espacios y pasa a minúsculas. El importador aplica la
--     misma regla; la unicidad se evalúa sobre el nombre normalizado.
--   cliente.meta_cuenta_id ID de la cuenta publicitaria de Meta de la que sale su inversión.
--
-- No guarda datos personales. Aplicar después de 009. Idempotente.
-- ============================================================================
create or replace function crm_comunidades_v2.normalizar_nombre(t text)
returns text language sql immutable parallel safe as $$
  select lower(regexp_replace(btrim(translate(coalesce(t, ''),
    'ÁÀÄÂÃáàäâãÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüûÝýÿÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuYyyCcNn')), '\s+', ' ', 'g'))
$$;

comment on function crm_comunidades_v2.normalizar_nombre(text) is
  'Normaliza un nombre de Meta para compararlo: recorta, quita tildes, colapsa espacios, minúsculas. Igual a normalizarNombre() de scripts/lib/windsor-mapeo.mjs.';

alter table crm_comunidades_v2.cliente add column if not exists meta_cuenta_id text;
comment on column crm_comunidades_v2.cliente.meta_cuenta_id is
  'ID de la cuenta publicitaria de Meta (Windsor, conector facebook) de la que sale la inversión del cliente.';

create table if not exists crm_comunidades_v2.comunidad_meta_origen (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null,
  comunidad_id    uuid not null,
  campana_nombre  text not null check (btrim(campana_nombre) <> ''),
  adset_nombre    text check (adset_nombre is null or btrim(adset_nombre) <> ''),
  creado_en       timestamptz not null default now(),
  foreign key (comunidad_id, cliente_id)
    references crm_comunidades_v2.comunidad (id, cliente_id) on delete cascade
);

-- Un mismo (campaña, conjunto) no puede ir a dos comunidades de un cliente. adset NULL = "toda la campaña".
create unique index if not exists uq_comunidad_meta_origen
  on crm_comunidades_v2.comunidad_meta_origen
  (cliente_id, crm_comunidades_v2.normalizar_nombre(campana_nombre), coalesce(crm_comunidades_v2.normalizar_nombre(adset_nombre), ''));

alter table crm_comunidades_v2.comunidad_meta_origen enable row level security;

-- Igual que el resto de las tablas hoy (db/003): lectura abierta temporal, sin login. db/005 la restringe por cliente.
drop policy if exists lectura_abierta on crm_comunidades_v2.comunidad_meta_origen;
create policy lectura_abierta on crm_comunidades_v2.comunidad_meta_origen for select using (true);

grant select on crm_comunidades_v2.comunidad_meta_origen to anon, authenticated;
grant select, insert, update, delete on crm_comunidades_v2.comunidad_meta_origen to service_role;

comment on table crm_comunidades_v2.comunidad_meta_origen is
  'Qué campaña / conjunto de anuncios de Meta pertenece a cada comunidad. adset_nombre NULL = toda la campaña. Lo lee scripts/windsor-importar.mjs.';
