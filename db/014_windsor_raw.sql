-- ============================================================================
-- CRM de Comunidades V2 — zona de aterrizaje para Windsor.ai (PR #24)
--
-- Windsor.ai puede escribir los datos de Meta Ads directamente en la base ("Data destination" Supabase /
-- PostgreSQL). Para que ese servicio externo NO toque el CRM, se le da un usuario propio que solo puede
-- crear y escribir tablas dentro de un esquema aparte: windsor_raw.
--
--   windsor_raw          esquema donde Windsor crea y actualiza sus tablas (datos crudos de Meta, por
--                        campaña, conjunto de anuncios y día). NO está expuesto por la API del panel.
--   windsor_escritor     usuario de Windsor. Sin acceso a crm_comunidades_v2 ni a ningún otro esquema.
--                        Se crea SIN contraseña y sin poder iniciar sesión: la contraseña la define quien
--                        configura Windsor (ver docs/how-to/conectar-windsor-a-supabase.md).
--
-- Lo que sigue (db/015): una función que convierte lo que Windsor aterriza en meta_ads_metrica por
-- comunidad, usando comunidad_meta_origen. Aplicar después de 013. Idempotente.
-- ============================================================================
create schema if not exists windsor_raw;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'windsor_escritor') then
    create role windsor_escritor nologin noinherit connection limit 3;
  end if;
end $$;

-- Solo el esquema windsor_raw. Nada más.
grant usage, create on schema windsor_raw to windsor_escritor;
revoke all on schema crm_comunidades_v2 from windsor_escritor;
revoke create on schema public from windsor_escritor;

-- Lo que Windsor cree en su esquema lo puede leer el CRM: el usuario principal de la base (postgres), dueño de
-- la función de la db/015, pasa a ser miembro de windsor_escritor y hereda el acceso a esas tablas.
-- (El sentido contrario no existe: windsor_escritor no hereda nada de postgres.)
grant windsor_escritor to postgres;

comment on schema windsor_raw is
  'Datos crudos que Windsor.ai escribe por su cuenta (Meta Ads por campaña, conjunto y día). Aislado del CRM: el usuario windsor_escritor no tiene acceso a crm_comunidades_v2. No está expuesto por la API.';
