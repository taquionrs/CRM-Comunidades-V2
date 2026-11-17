// Pruebas del CRR (db/043) sobre un Postgres local con TODAS las migraciones del repo. Correr: npm run test:db
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { nuevaBase, como } from "./harness.mjs";

const S = "crm_comunidades_v2";
const CLI = "00000000-0000-0000-0000-0000000000c1", CLI2 = "00000000-0000-0000-0000-0000000000c2";
const BOE = "00000000-0000-0000-0000-0000000000a1", PAL = "00000000-0000-0000-0000-0000000000a2", DEV = "00000000-0000-0000-0000-0000000000a3", OTRA = "00000000-0000-0000-0000-0000000000a4";
let db;
const U = {};

// Las cargas reales de Cortado en Jarrito: 14/10 (primera, lista completa), 26/10 (lista completa) y 13/11 (solo Boedo).
before(async () => {
  db = await nuevaBase();
  await db.exec(`
    set search_path = crm_comunidades_v2, public;
    insert into cliente (id, nombre, slug) values ('${CLI}', 'Cortado', 'cortado'), ('${CLI2}', 'Otro', 'otro');
    insert into comunidad (id, cliente_id, nombre) values ('${BOE}', '${CLI}', 'Boedo'), ('${PAL}', '${CLI}', 'Palermo'), ('${DEV}', '${CLI}', 'Villa Devoto'), ('${OTRA}', '${CLI2}', 'Otra');
    insert into carga_miembros (cliente_id, comunidad_id, cargada_en, numeros_validos, nuevos, salieron, lista_completa) values
      ('${CLI}', '${BOE}', timestamptz '2026-10-14 12:00:00-03', 11, 11, 0, true),
      ('${CLI}', '${PAL}', timestamptz '2026-10-14 12:00:00-03', 32, 32, 0, true),
      ('${CLI}', '${DEV}', timestamptz '2026-10-14 12:00:00-03', 26, 26, 0, true),
      ('${CLI}', '${BOE}', timestamptz '2026-10-26 12:00:00-03', 51, 40, 0, true),
      ('${CLI}', '${PAL}', timestamptz '2026-10-26 12:00:00-03', 41, 10, 1, true),
      ('${CLI}', '${DEV}', timestamptz '2026-10-26 12:00:00-03', 49, 25, 2, true),
      ('${CLI}', '${BOE}', timestamptz '2026-11-13 12:00:00-03', 62, 11, 0, true),
      ('${CLI}', '${DEV}', timestamptz '2026-11-01 12:00:00-03', 5, 5, 0, false),
      ('${CLI2}', '${OTRA}', timestamptz '2026-10-14 12:00:00-03', 10, 10, 0, true),
      ('${CLI2}', '${OTRA}', timestamptz '2026-10-26 12:00:00-03', 10, 0, 0, true);
    insert into usuario_crm (email, rol, admin) values ('general@taquion.com.ar', 'general', false);
  `);
  const { rows: [u] } = await db.query(`insert into auth.users (email) values ('general@taquion.com.ar') returning id`);
  const { rows: [s] } = await db.query(`insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id`, [u.id]);
  U.general = { id: u.id, email: "general@taquion.com.ar", sesion: s.id };
});

const ctx = () => ({ rol: "authenticated", claims: { sub: U.general.id, email: U.general.email, session_id: U.general.sesion } });
const crr = async (desde = null, hasta = null, cli = CLI) =>
  (await como(db, ctx(), (tx) => tx.query(`select * from ${S}.crr_por_carga($1::uuid, $2::date, $3::date)`, [cli, desde, hasta]))).rows;
const f = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const resumen = (rows) => rows.map((r) => [r.comunidad, f(r.desde), f(r.hasta), r.miembros_inicio, r.nuevos, r.bajas, r.miembros_fin, Number(r.crr_pct), Number(r.churn_pct), r.cuadra]);

test("CRR entre la carga del 14/10 y la del 26/10: (final − nuevos) ÷ inicio", async () => {
  const r = await crr("2026-10-20", "2026-10-31");
  assert.deepEqual(resumen(r), [
    ["Boedo", "2026-10-14", "2026-10-26", 11, 40, 0, 51, 100, 0, true],
    ["Palermo", "2026-10-14", "2026-10-26", 32, 10, 1, 41, 96.88, 3.12, true],
    ["Villa Devoto", "2026-10-14", "2026-10-26", 26, 25, 2, 49, 92.31, 7.69, true],
  ]);
});

test("el total de las tres comunidades del 26/10 es el mismo con la fórmula del CRR y con 1 − bajas ÷ inicio", async () => {
  const r = await crr("2026-10-26", "2026-10-26");
  const suma = (k) => r.reduce((s, x) => s + x[k], 0);
  assert.deepEqual([suma("miembros_inicio"), suma("nuevos"), suma("miembros_fin"), suma("bajas")], [69, 75, 141, 3]);
  const porFormula = Math.round((suma("miembros_fin") - suma("nuevos")) / suma("miembros_inicio") * 10000) / 100;
  const porBajas = Math.round((1 - suma("bajas") / suma("miembros_inicio")) * 10000) / 100;
  assert.equal(porFormula, 95.65);
  assert.equal(porBajas, 95.65);
});

test("sin fechas trae todo el historial, el más reciente primero; la primera carga de cada comunidad no genera fila", async () => {
  const r = await crr();
  assert.deepEqual(r.map((x) => [x.comunidad, f(x.hasta)]), [["Boedo", "2026-11-13"], ["Boedo", "2026-10-26"], ["Palermo", "2026-10-26"], ["Villa Devoto", "2026-10-26"]]);
});

test("Boedo del 26/10 al 13/11: 51 al inicio, 11 nuevos, 62 al final: CRR 100 %", async () => {
  const [b] = await crr("2026-11-01", "2026-11-30");
  assert.deepEqual(resumen([b]), [["Boedo", "2026-10-26", "2026-11-13", 51, 11, 0, 62, 100, 0, true]]);
  assert.equal(b.dias, 18);
});

test("una comunidad sin segunda carga de lista completa no tiene CRR (Palermo y Devoto en noviembre)", async () => {
  const r = await crr("2026-11-01", "2026-11-30");
  assert.deepEqual(r.map((x) => x.comunidad), ["Boedo"]);
});

test("una carga que no es lista completa no cuenta (la de Devoto del 01/11 con 5 miembros)", async () => {
  const r = await crr("2026-11-01", "2026-11-12");
  assert.equal(r.length, 0);
});

test("churn es 100 menos el CRR", async () => {
  for (const x of await crr()) assert.equal(Math.round((Number(x.crr_pct) + Number(x.churn_pct)) * 100) / 100, 100);
});

test("si las cargas no cuadran lo avisa (cuadra = false) pero calcula igual con la fórmula", async () => {
  await db.exec(`insert into ${S}.carga_miembros (cliente_id, comunidad_id, cargada_en, numeros_validos, nuevos, salieron, lista_completa)
                 values ('${CLI}', '${PAL}', timestamptz '2026-11-14 12:00:00-03', 50, 2, 0, true)`);
  const [p] = await crr("2026-11-14", "2026-11-14");
  assert.equal(p.cuadra, false);    // 41 + 2 - 0 no es 50
  assert.equal(Number(p.crr_pct), Math.round((50 - 2) / 41 * 10000) / 100);
  await db.exec(`delete from ${S}.carga_miembros where cargada_en = timestamptz '2026-11-14 12:00:00-03'`);
});

test("no mezcla clientes", async () => {
  assert.ok((await crr()).every((x) => x.comunidad !== "Otra"));
  const o = await crr(null, null, CLI2);
  assert.deepEqual(o.map((x) => [x.comunidad, Number(x.crr_pct)]), [["Otra", 100]]);
});

test("un grupo sin miembros al inicio no divide por cero", async () => {
  await db.exec(`insert into ${S}.carga_miembros (cliente_id, comunidad_id, cargada_en, numeros_validos, nuevos, salieron, lista_completa) values
    ('${CLI2}', '${OTRA}', timestamptz '2026-12-01 12:00:00-03', 0, 0, 10, true), ('${CLI2}', '${OTRA}', timestamptz '2026-12-02 12:00:00-03', 3, 3, 0, true)`);
  const [x] = await crr("2026-12-02", "2026-12-02", CLI2);
  assert.equal(x.crr_pct, null);
  assert.equal(x.churn_pct, null);
  await db.exec(`delete from ${S}.carga_miembros where cargada_en >= timestamptz '2026-12-01 00:00:00-03'`);
});

test("lo ve cualquier usuario del CRM; la clave pública no puede ni llamarla", async () => {
  assert.ok((await crr()).length > 0);
  await assert.rejects(como(db, { rol: "anon" }, (tx) => tx.query(`select * from ${S}.crr_por_carga($1::uuid)`, [CLI])), /permission denied/i);
});
