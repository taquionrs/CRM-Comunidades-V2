-- ============================================================================
-- CRM de Comunidades V2 — lectura abierta temporal (sin login)
-- Ref: pedido explícito del usuario 2026-09-25, "quitale el login por ahora"
-- después del primer deploy a Vercel.
--
-- db/001 dejó las 4 tablas con una sola policy (for all) que exige
-- auth.role() = 'authenticated'. Sin pantalla de login, el frontend llama a
-- Supabase con la anon key sin sesión — auth.role() devuelve 'anon', así que
-- ni siquiera el SELECT pasaba, aunque el GRANT de anon ya lo permitía a
-- nivel de tabla (db/001).
--
-- Esta migración separa lectura de escritura: SELECT queda abierto a
-- cualquiera con la anon key (que ya es pública en el bundle del frontend);
-- INSERT/UPDATE/DELETE siguen exigiendo autenticación — el alta de
-- comunidades y las sincronizaciones no van a funcionar desde el panel hasta
-- que haya login real de nuevo. No se tocan GRANTs (anon ya tenía SELECT).
--
-- Aplicar después de 001_init.sql/002_vistas_panel.sql. Idempotente.
-- ============================================================================
set search_path = crm_comunidades_v2, public;

do $$
declare
  t text;
begin
  foreach t in array array['comunidad','evento_crudo','usuario_curado','meta_ads_metrica']
  loop
    execute format('drop policy if exists usuario_autenticado on crm_comunidades_v2.%I;', t);
    execute format('drop policy if exists lectura_abierta on crm_comunidades_v2.%I;', t);
    execute format('drop policy if exists escritura_autenticada_insert on crm_comunidades_v2.%I;', t);
    execute format('drop policy if exists escritura_autenticada_update on crm_comunidades_v2.%I;', t);
    execute format('drop policy if exists escritura_autenticada_delete on crm_comunidades_v2.%I;', t);
    execute format('create policy lectura_abierta on crm_comunidades_v2.%I for select using (true);', t);
    execute format('create policy escritura_autenticada_insert on crm_comunidades_v2.%I for insert with check (auth.role() = ''authenticated'');', t);
    execute format('create policy escritura_autenticada_update on crm_comunidades_v2.%I for update using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'');', t);
    execute format('create policy escritura_autenticada_delete on crm_comunidades_v2.%I for delete using (auth.role() = ''authenticated'');', t);
  end loop;
end $$;
