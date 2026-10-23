// Postgres local (PGlite) con lo mínimo de Supabase para correr las migraciones de db/ y probar la RLS por rol.
// Lo usan las pruebas de tests/db (npm run test:db). No toca ninguna base real.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DB_DIR = fileURLToPath(new URL("../../db/", import.meta.url));

// Lo que en Supabase ya existe: roles de la API, esquema auth (usuarios, sesiones y el JWT de cada pedido),
// pgcrypto en el esquema extensions y pg_cron (simulado: solo guarda los trabajos).
const SUPABASE = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema extensions;
create extension pgcrypto schema extensions;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
                            created_at timestamptz not null default now());
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text);
create table cron.job_run_details (runid bigserial primary key, jobid bigint, status text, return_message text, start_time timestamptz, end_time timestamptz);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$ insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command) returning jobid $$;
create function cron.unschedule(p_jobid bigint) returns boolean language sql as $$ delete from cron.job where jobid = p_jobid returning true $$;
create schema windsor_raw;
`;

/** Migraciones en orden (las de db/mantenimiento son datos puntuales y no entran). */
export function migraciones({ hasta = Infinity } = {}) {
  return fs.readdirSync(DB_DIR)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f) && parseInt(f, 10) <= hasta)
    .sort()
    .map((f) => path.join(DB_DIR, f));
}

export async function nuevaBase(archivos = migraciones()) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE);
  for (const f of archivos) {
    const sql = fs.readFileSync(f, "utf8").replace(/create extension if not exists pg_cron;/gi, "-- pg_cron simulado");
    try {
      await db.exec(sql);
    } catch (err) {
      throw new Error(`${path.basename(f)}: ${err.message}`);
    }
  }
  return db;
}

/**
 * Corre `fn` como lo haría un pedido de la API de Supabase: con el rol (anon, authenticated o service_role),
 * los claims del JWT y, si hace falta, los encabezados HTTP. Todo dentro de una transacción que se deshace.
 */
export async function como(db, { rol = "anon", claims = {}, headers = null } = {}, fn) {
  let resultado;
  const DESHACER = new Error("deshacer");
  try {
    await db.transaction(async (tx) => {
      await tx.exec(`set local role ${rol}`);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: rol, ...claims })]);
      if (headers) await tx.query(`select set_config('request.headers', $1, true)`, [JSON.stringify(headers)]);
      resultado = await fn(tx);
      throw DESHACER;
    });
  } catch (err) {
    if (err !== DESHACER) throw err;
  }
  return resultado;
}
