-- ============================================================================
-- CRM de Comunidades V2 — programar la sincronización con Windsor (PR #27)
--
-- Windsor escribe la tabla windsor_raw.facebook_ads todos los días a las 09:00 UTC (06:00 de Argentina).
-- Media hora después, pg_cron corre sincronizar_meta_desde_windsor (db/015), que la convierte en meta_ads_metrica
-- por comunidad. El resultado de cada corrida queda en windsor_sync_log; si falla, el error queda en
-- cron.job_run_details. Aplicar después de 015. Idempotente.
-- ============================================================================
create extension if not exists pg_cron;

-- Si ya existía un trabajo con este nombre, se reemplaza (así se puede volver a aplicar sin duplicarlo).
select cron.unschedule(jobid) from cron.job where jobname = 'sincronizar-meta-windsor';

select cron.schedule(
  'sincronizar-meta-windsor',
  '30 9 * * *',
  $$select crm_comunidades_v2.sincronizar_meta_desde_windsor('windsor_raw.facebook_ads')$$
);
