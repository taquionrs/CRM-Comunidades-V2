// Pruebas del reporte semanal (db/044) sobre un Postgres local con TODAS las migraciones del repo. Correr: npm run test:db
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { nuevaBase, como } from "./harness.mjs";

const S = "crm_comunidades_v2";
const CLI = "00000000-0000-0000-0000-0000000000c1", CLI2 = "00000000-0000-0000-0000-0000000000c2";
const BOE = "00000000-0000-0000-0000-0000000000a1", PAL = "00000000-0000-0000-0000-0000000000a2", DEV = "00000000-0000-0000-0000-0000000000a3", OTRA = "00000000-0000-0000-0000-0000000000a4";
let db;
const U = {};

before(async () => {
  db = await nuevaBase();
  await db.exec(`
    set search_path = crm_comunidades_v2, public;
    insert into cliente (id, nombre, slug) values ('${CLI}', 'Cortado', 'cortado'), ('${CLI2}', 'Otro', 'otro');
    insert into comunidad (id, cliente_id, nombre) values ('${BOE}', '${CLI}', 'Boedo'), ('${PAL}', '${CLI}', 'Palermo'), ('${DEV}', '${CLI}', 'Villa Devoto'), ('${OTRA}', '${CLI2}', 'Otra');
    insert into carga_miembros (cliente_id, comunidad_id, cargada_en, numeros_validos, nuevos, salieron, lista_completa) values
      ('${CLI}', '${BOE}', timestamptz '2026-10-14 12:00:00-03', 11, 11, 0, true), ('${CLI}', '${BOE}', timestamptz '2026-10-26 12:00:00-03', 51, 40, 0, true),
      ('${CLI}', '${PAL}', timestamptz '2026-10-14 12:00:00-03', 32, 32, 0, true), ('${CLI}', '${PAL}', timestamptz '2026-10-26 12:00:00-03', 41, 10, 1, true),
      ('${CLI}', '${DEV}', timestamptz '2026-10-14 12:00:00-03', 26, 26, 0, true), ('${CLI}', '${DEV}', timestamptz '2026-10-26 12:00:00-03', 49, 25, 2, true),
      ('${CLI2}', '${OTRA}', timestamptz '2026-10-14 12:00:00-03', 5, 5, 0, true), ('${CLI2}', '${OTRA}', timestamptz '2026-10-26 12:00:00-03', 6, 1, 0, true);
    insert into meta_ads_metrica (cliente_id, comunidad_id, fecha, inversion, conversaciones_meta, impresiones, clics, leads_meta, clics_enlace) values
      ('${CLI}', '${BOE}', '2026-10-16', 100, 4, 0, 0, 0, null), ('${CLI}', '${BOE}', '2026-10-20', 100, 5, 0, 0, 0, 50), ('${CLI}', '${BOE}', '2026-10-25', 100, 6, 0, 0, 0, 60),
      ('${CLI}', '${PAL}', '2026-10-21', 50, 2, 0, 0, 0, 20),
      ('${CLI}', '${DEV}', '2026-10-15', 30, 1, 0, 0, 0, null),
      ('${CLI2}', '${OTRA}', '2026-10-21', 9999, 99, 0, 0, 0, 99);
    insert into evento_crudo (cliente_id, comunidad_id, telefono_id, payload, recibido_en) values
      ('${CLI}', '${BOE}', '5491100000001', '{}', timestamptz '2026-10-17 12:00:00-03'),
      ('${CLI}', '${BOE}', '5491100000001', '{}', timestamptz '2026-10-21 12:00:00-03'),
      ('${CLI}', '${BOE}', '5491100000002', '{}', timestamptz '2026-10-20 12:00:00-03'),
      ('${CLI}', '${BOE}', '5491100000003', '{}', timestamptz '2026-10-24 12:00:00-03'),
      ('${CLI}', '${PAL}', '5491100000004', '{}', timestamptz '2026-10-22 12:00:00-03'),
      ('${CLI}', '${DEV}', '5491100000005', '{}', timestamptz '2026-10-16 12:00:00-03'),
      ('${CLI2}', '${OTRA}', '5491100000099', '{}', timestamptz '2026-10-21 12:00:00-03');
    insert into usuario_crm (email, rol, admin) values ('mkt@taquion.com.ar', 'marketing', false), ('general@taquion.com.ar', 'general', false);
  `);
  for (const email of ["mkt@taquion.com.ar", "general@taquion.com.ar"]) {
    const { rows: [u] } = await db.query(`insert into auth.users (email) values ($1) returning id`, [email]);
    const { rows: [s] } = await db.query(`insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id`, [u.id]);
    U[email.split("@")[0]] = { id: u.id, email, sesion: s.id };
  }
});

const sesion = (k) => ({ rol: "authenticated", claims: { sub: U[k].id, email: U[k].email, session_id: U[k].sesion } });
const rep = async (desde = "2026-10-19", hasta = "2026-10-26", k = "mkt") =>
  (await como(db, sesion(k), (tx) => tx.query(`select * from ${S}.reporte_semanal($1::uuid, $2::date, $3::date)`, [CLI, desde, hasta]))).rows;
const n = (v) => (v == null ? null : Number(v));
const d = (v) => (v == null ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));
const fila = (rows, nombre) => rows.find((r) => r.comunidad === nombre);

test("pauta del período por comunidad: inversión, chats, clics en el enlace, entradas, cobertura y costo por entrada", async () => {
  const r = await rep();
  const b = fila(r, "Boedo");
  assert.deepEqual([n(b.inversion), n(b.conversaciones), n(b.clics_enlace), n(b.entradas), n(b.cobertura_pct), n(b.costo_por_entrada)], [200, 11, 110, 2, 18.18, 100]);
  const p = fila(r, "Palermo");
  assert.deepEqual([n(p.inversion), n(p.conversaciones), n(p.clics_enlace), n(p.entradas), n(p.cobertura_pct), n(p.costo_por_entrada)], [50, 2, 20, 1, 50, 50]);
});

test("una comunidad sin pauta ni entradas en el período no inventa cobertura ni costo (null), y el 0 es 0", async () => {
  const v = fila(await rep(), "Villa Devoto");
  assert.deepEqual([n(v.inversion), n(v.conversaciones), n(v.entradas)], [0, 0, 0]);
  assert.equal(v.clics_enlace, null);
  assert.equal(v.cobertura_pct, null);
  assert.equal(v.costo_por_entrada, null);
});

test("miembros del último intervalo cerrado: inicio, nuevos, bajas, final, CRR y churn (db/043)", async () => {
  const p = fila(await rep(), "Palermo");
  assert.deepEqual([d(p.miembros_desde), d(p.miembros_hasta), p.miembros_inicio, p.nuevos, p.bajas, p.miembros_fin, n(p.crr_pct), n(p.churn_pct), p.cuadra],
    ["2026-10-14", "2026-10-26", 32, 10, 1, 41, 96.88, 3.12, true]);
});

test("costo por miembro nuevo y triaje usan la inversión y las entradas del MISMO intervalo, no las del período pedido", async () => {
  const r = await rep();
  const b = fila(r, "Boedo");   // intervalo 14→26/10: 300 de inversión (incluye el 16/10), 3 entradas (incluye la del 17/10), 40 nuevos
  assert.deepEqual([n(b.inversion_intervalo), n(b.entradas_intervalo), n(b.cpmn), n(b.triaje_pct)], [300, 3, 7.5, 1333.33]);
  const v = fila(r, "Villa Devoto");
  assert.deepEqual([n(v.inversion_intervalo), n(v.entradas_intervalo), n(v.cpmn), n(v.triaje_pct)], [30, 1, 1.2, 2500]);
});

test("la fila de total suma la pauta y recalcula las razones con los totales (no promedia)", async () => {
  const t = (await rep()).find((r) => r.es_total);
  assert.equal(t.comunidad, "Total del cliente");
  assert.deepEqual([n(t.inversion), n(t.conversaciones), n(t.clics_enlace), n(t.entradas), n(t.cobertura_pct), n(t.costo_por_entrada)], [250, 13, 130, 3, 23.08, 83.33]);
});

test("el total de miembros se llena porque las tres comunidades comparten el mismo intervalo, y recalcula el CRR con los totales", async () => {
  const t = (await rep()).find((r) => r.es_total);
  assert.deepEqual([t.miembros_inicio, t.nuevos, t.bajas, t.miembros_fin, n(t.crr_pct), n(t.churn_pct), t.cuadra], [69, 75, 3, 141, 95.65, 4.35, true]);
  assert.deepEqual([n(t.inversion_intervalo), n(t.entradas_intervalo), n(t.cpmn), n(t.triaje_pct)], [380, 5, 5.07, 1500]);
});

test("si las comunidades tienen intervalos distintos el total de miembros queda vacío (sumar intervalos distintos sería estimar)", async () => {
  await db.exec(`insert into ${S}.carga_miembros (cliente_id, comunidad_id, cargada_en, numeros_validos, nuevos, salieron, lista_completa)
                 values ('${CLI}', '${BOE}', timestamptz '2026-11-13 12:00:00-03', 62, 11, 0, true)`);
  const r = await rep("2026-11-09", "2026-11-15");
  const t = r.find((x) => x.es_total);
  assert.equal(t.miembros_inicio, null);
  assert.equal(t.crr_pct, null);
  assert.equal(fila(r, "Boedo").miembros_inicio, 51);   // la de Boedo sigue calculada por su cuenta
  await db.exec(`delete from ${S}.carga_miembros where cargada_en = timestamptz '2026-11-13 12:00:00-03'`);
});

test("frescura: fecha de la última carga de lista completa y días sin carga hasta hoy", async () => {
  const p = fila(await rep(), "Palermo");
  assert.equal(d(p.ultima_carga), "2026-10-26");
  const { rows: [x] } = await db.query(`select ((now() at time zone 'America/Argentina/Buenos_Aires')::date - date '2026-10-26') as dias`);
  assert.equal(p.dias_sin_carga, x.dias);
});

test("solo el último intervalo que termina a más tardar en la fecha 'hasta': antes de la segunda carga no hay CRR", async () => {
  const p = fila(await rep("2026-10-01", "2026-10-20"), "Palermo");
  assert.equal(p.crr_pct, null);
  assert.equal(p.miembros_inicio, null);
});

test("no mezcla clientes", async () => {
  const r = await rep();
  assert.ok(!r.some((x) => x.comunidad === "Otra"));
  assert.ok(!r.some((x) => n(x.inversion) === 9999));
});

test("es plata: lo ve Marketing; un usuario General recibe la lista vacía y la clave pública no puede llamarla", async () => {
  assert.equal((await rep("2026-10-19", "2026-10-26", "general")).length, 0);
  await assert.rejects(como(db, { rol: "anon" }, (tx) => tx.query(`select * from ${S}.reporte_semanal($1::uuid, '2026-10-19', '2026-10-26')`, [CLI])), /permission denied/i);
});

test("rango inválido: invertido o de más de 93 días", async () => {
  await assert.rejects(rep("2026-10-26", "2026-10-19"), /no es válido/);
  await assert.rejects(rep("2026-01-01", "2026-12-31"), /93 días/);
});
