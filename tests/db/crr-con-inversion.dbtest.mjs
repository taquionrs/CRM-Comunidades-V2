// Pruebas de crr_por_carga_con_inversion (db/046) sobre un Postgres local con TODAS las migraciones del repo. Correr: npm run test:db
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { nuevaBase, como } from "./harness.mjs";

const S = "crm_comunidades_v2";
const CLI = "00000000-0000-0000-0000-0000000000c1", CLI2 = "00000000-0000-0000-0000-0000000000c2";
const PAL = "00000000-0000-0000-0000-0000000000a2", DEV = "00000000-0000-0000-0000-0000000000a3", OTRA = "00000000-0000-0000-0000-0000000000a4";
let db;
const U = {};

before(async () => {
  db = await nuevaBase();
  await db.exec(`
    set search_path = crm_comunidades_v2, public;
    insert into cliente (id, nombre, slug) values ('${CLI}', 'Cortado', 'cortado'), ('${CLI2}', 'Otro', 'otro');
    insert into comunidad (id, cliente_id, nombre) values ('${PAL}', '${CLI}', 'Palermo'), ('${DEV}', '${CLI}', 'Villa Devoto'), ('${OTRA}', '${CLI2}', 'Otra');
    insert into carga_miembros (cliente_id, comunidad_id, cargada_en, numeros_validos, nuevos, salieron, lista_completa) values
      ('${CLI}', '${PAL}', timestamptz '2026-10-14 12:00:00-03', 32, 32, 0, true), ('${CLI}', '${PAL}', timestamptz '2026-10-26 12:00:00-03', 41, 10, 1, true),
      ('${CLI}', '${PAL}', timestamptz '2026-11-17 12:00:00-03', 41, 2, 2, true),
      ('${CLI}', '${DEV}', timestamptz '2026-10-14 12:00:00-03', 26, 26, 0, true), ('${CLI}', '${DEV}', timestamptz '2026-10-26 12:00:00-03', 49, 25, 2, true),
      ('${CLI2}', '${OTRA}', timestamptz '2026-10-14 12:00:00-03', 5, 5, 0, true), ('${CLI2}', '${OTRA}', timestamptz '2026-10-26 12:00:00-03', 6, 1, 0, true);
    insert into meta_ads_metrica (cliente_id, comunidad_id, fecha, inversion, conversaciones_meta, impresiones, clics, leads_meta, clics_enlace) values
      ('${CLI}', '${PAL}', '2026-10-14', 777, 0, 0, 0, 0, null),
      ('${CLI}', '${PAL}', '2026-10-15', 100, 0, 0, 0, 0, null), ('${CLI}', '${PAL}', '2026-10-26', 50, 0, 0, 0, 0, null),
      ('${CLI}', '${PAL}', '2026-11-02', 200, 0, 0, 0, 0, null), ('${CLI}', '${PAL}', '2026-11-17', 25.5, 0, 0, 0, 0, null),
      ('${CLI}', '${DEV}', '2026-10-20', 30, 0, 0, 0, 0, null),
      ('${CLI2}', '${OTRA}', '2026-10-20', 9999, 0, 0, 0, 0, null);
    insert into usuario_crm (email, rol, admin) values ('mkt@taquion.com.ar', 'marketing', false), ('general@taquion.com.ar', 'general', false);
  `);
  for (const email of ["mkt@taquion.com.ar", "general@taquion.com.ar"]) {
    const { rows: [u] } = await db.query(`insert into auth.users (email) values ($1) returning id`, [email]);
    const { rows: [s] } = await db.query(`insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id`, [u.id]);
    U[email.split("@")[0]] = { id: u.id, email, sesion: s.id };
  }
});

const sesion = (k) => ({ rol: "authenticated", claims: { sub: U[k].id, email: U[k].email, session_id: U[k].sesion } });
const consulta = async (k = "mkt", desde = null, hasta = null) =>
  (await como(db, sesion(k), (tx) => tx.query(`select * from ${S}.crr_por_carga_con_inversion($1::uuid, $2::date, $3::date)`, [CLI, desde, hasta]))).rows;
const n = (v) => (v == null ? null : Number(v));
const d = (v) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);

test("trae los mismos períodos y conteos que crr_por_carga, más la inversión de cada intervalo", async () => {
  const filas = await consulta();
  const igual = (await como(db, sesion("mkt"), (tx) => tx.query(`select * from ${S}.crr_por_carga($1::uuid, null, null)`, [CLI]))).rows;
  assert.equal(filas.length, igual.length);
  assert.equal(filas.length, 3);
  const p = filas.find((f) => f.comunidad === "Palermo" && d(f.hasta) === "2026-11-17");
  assert.deepEqual([p.miembros_inicio, p.nuevos, p.bajas, p.miembros_fin, n(p.crr_pct)], [41, 2, 2, 41, 95.12]);
});

test("la inversión del intervalo cuenta desde el día siguiente a la carga anterior hasta el día de la carga de cierre, inclusive", async () => {
  const filas = await consulta();
  const p1 = filas.find((f) => f.comunidad === "Palermo" && d(f.hasta) === "2026-10-26");
  assert.equal(n(p1.inversion_periodo), 150);
  const p2 = filas.find((f) => f.comunidad === "Palermo" && d(f.hasta) === "2026-11-17");
  assert.equal(n(p2.inversion_periodo), 225.5);
});

test("una comunidad con gasto solo en su intervalo lo trae completo", async () => {
  const v = (await consulta()).find((f) => f.comunidad === "Villa Devoto");
  assert.equal(n(v.inversion_periodo), 30);
});

test("no mezcla clientes: la inversión de otro cliente no aparece", async () => {
  const filas = await consulta();
  assert.ok(filas.every((f) => f.comunidad !== "Otra"));
  assert.ok(filas.every((f) => n(f.inversion_periodo) < 9999));
});

test("la plata es solo de Marketing: el rol General ve los conteos y la inversión en null", async () => {
  const filas = await consulta("general");
  assert.equal(filas.length, 3);
  assert.ok(filas.every((f) => f.inversion_periodo === null));
  assert.ok(filas.every((f) => f.miembros_inicio != null));
});

test("sin sesión (anónimo) no devuelve nada", async () => {
  const r = await como(db, { rol: "anon" }, async (tx) => { try { return (await tx.query(`select * from ${S}.crr_por_carga_con_inversion($1::uuid)`, [CLI])).rows; } catch (e) { return "denegado"; } });
  assert.ok(r === "denegado" || r.length === 0);
});

test("respeta las fechas elegidas como crr_por_carga", async () => {
  const filas = await consulta("mkt", "2026-11-01", "2026-11-30");
  assert.equal(filas.length, 1);
  assert.equal(d(filas[0].hasta), "2026-11-17");
});
