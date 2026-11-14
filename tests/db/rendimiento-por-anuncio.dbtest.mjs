// Pruebas de rendimiento_por_anuncio (db/041) sobre un Postgres local con TODAS las migraciones del repo.
// Correr: npm run test:db (usa @electric-sql/pglite, no toca ninguna base real).
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { nuevaBase, como } from "./harness.mjs";

const S = "crm_comunidades_v2";
const CLI = "00000000-0000-0000-0000-0000000000c1", CLI2 = "00000000-0000-0000-0000-0000000000c2";
const PAL = "00000000-0000-0000-0000-0000000000a1", BOE = "00000000-0000-0000-0000-0000000000a2", OTRA = "00000000-0000-0000-0000-0000000000a3";
let db;
const U = {};

before(async () => {
  db = await nuevaBase();
  await db.exec(`
    set search_path = crm_comunidades_v2, public;
    insert into cliente (id, nombre, slug) values ('${CLI}', 'Cortado', 'cortado'), ('${CLI2}', 'Otro', 'otro');
    insert into comunidad (id, cliente_id, nombre) values ('${PAL}', '${CLI}', 'Palermo'), ('${BOE}', '${CLI}', 'Boedo'), ('${OTRA}', '${CLI2}', 'Otra');
    -- Catálogo: P1 y P2 en Palermo (P3 no tiene datos de Meta); Boedo no está instrumentado.
    insert into anuncio_codigo (cliente_id, comunidad_id, codigo, anuncio_nombre) values
      ('${CLI}', '${PAL}', 'P1', 'TQN_WA_PALERMO_01'), ('${CLI}', '${PAL}', 'P2', 'tqn_wa_palermo_02'), ('${CLI}', '${PAL}', 'P3', 'TQN_WA_PALERMO_03');
    -- Meta por anuncio (db/040). El nombre de Meta puede variar en mayúsculas y espacios: se vincula normalizado.
    insert into meta_ads_anuncio_metrica (cliente_id, comunidad_id, fecha, ad_id, ad_nombre, campana_nombre, adset_nombre, inversion, impresiones, clics, clics_enlace, conversaciones_meta) values
      ('${CLI}', '${PAL}', '2020-10-01', 'a1', 'TQN_WA_PALERMO_01', 'CAMP', 'ADS_PAL', 100, 1000, 50, 40, 5),
      ('${CLI}', '${PAL}', '2020-10-02', 'a1', 'TQN_WA_PALERMO_01', 'CAMP', 'ADS_PAL', 50, 500, 20, null, 2),
      ('${CLI}', '${PAL}', '2020-10-01', 'a2', ' TQN_WA_Palermo_02 ', 'CAMP', 'ADS_PAL', 30, 300, 10, 8, 1),
      ('${CLI}', '${BOE}', '2020-10-01', 'b1', 'TQN_WA_BOEDO_01', 'CAMP', 'ADS_BOE', 200, 2000, 90, 70, 20),
      ('${CLI}', '${PAL}', '2020-11-20', 'a1', 'TQN_WA_PALERMO_01', 'CAMP', 'ADS_PAL', 999, 9999, 999, 999, 99),
      ('${CLI2}', '${OTRA}', '2020-10-01', 'o1', 'OTRO_AD', 'CAMP', 'X', 777, 1, 1, 1, 1);
    -- Entradas (primer contacto): 0001 y 0002 con P1, 0003 con P2, 0004 sin código en Palermo, 0005 sin código en Boedo.
    -- 0001 vuelve a escribir después (el primer contacto es el que cuenta). 0006 llega con P1 pero en noviembre.
    insert into evento_crudo (cliente_id, comunidad_id, telefono_id, payload, anuncio_codigo, recibido_en) values
      ('${CLI}', '${PAL}', '5491100000001', '{}', 'P1', timestamptz '2020-10-01 12:00:00-03'),
      ('${CLI}', '${PAL}', '5491100000001', '{}', null, timestamptz '2020-10-02 12:00:00-03'),
      ('${CLI}', '${PAL}', '5491100000002', '{}', 'P1', timestamptz '2020-10-01 13:00:00-03'),
      ('${CLI}', '${PAL}', '5491100000003', '{}', 'P2', timestamptz '2020-10-02 13:00:00-03'),
      ('${CLI}', '${PAL}', '5491100000004', '{}', null, timestamptz '2020-10-02 14:00:00-03'),
      ('${CLI}', '${BOE}', '5491100000005', '{}', null, timestamptz '2020-10-01 15:00:00-03'),
      ('${CLI}', '${PAL}', '5491100000006', '{}', 'P1', timestamptz '2020-11-20 15:00:00-03'),
      ('${CLI2}', '${OTRA}', '5491100000099', '{}', null, timestamptz '2020-10-01 15:00:00-03');
    -- Sin clasificar: 0010 con P2 (cuenta), 0001 con P1 (ya tiene entrada: no cuenta).
    insert into ingreso_sin_clasificar (cliente_id, telefono_id, mensaje, payload, anuncio_codigo, recibido_en) values
      ('${CLI}', '5491100000010', 'hola P2', '{}', 'P2', timestamptz '2020-10-02 10:00:00-03'),
      ('${CLI}', '5491100000001', 'hola P1', '{}', 'P1', timestamptz '2020-09-30 10:00:00-03');
    insert into usuario_crm (email, rol, admin) values ('mkt@taquion.com.ar', 'marketing', false), ('general@taquion.com.ar', 'general', false);
  `);
  for (const email of ["mkt@taquion.com.ar", "general@taquion.com.ar"]) {
    const { rows: [u] } = await db.query(`insert into auth.users (email) values ($1) returning id`, [email]);
    const { rows: [s] } = await db.query(`insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id`, [u.id]);
    U[email.split("@")[0]] = { id: u.id, email, sesion: s.id };
  }
});

const sesion = (k) => ({ rol: "authenticated", claims: { sub: U[k].id, email: U[k].email, session_id: U[k].sesion } });
const rend = async (ctx, desde = "2020-10-01", hasta = "2020-10-31", comunidad = null) =>
  (await como(db, ctx, (tx) => tx.query(`select * from ${S}.rendimiento_por_anuncio($1::uuid, $2::date, $3::date, $4::uuid)`, [CLI, desde, hasta, comunidad]))).rows;
const resumen = (rows) => rows.map((r) => [r.comunidad, r.codigo ?? "sin código", Number(r.inversion), r.entradas == null ? null : Number(r.entradas), r.sin_clasificar == null ? null : Number(r.sin_clasificar)]);

test("una fila por anuncio con Meta y entradas por código, más las entradas sin código de cada comunidad", async () => {
  const r = await rend(sesion("mkt"));
  assert.deepEqual(resumen(r), [
    ["Boedo", "sin código", 200, null, null],        // anuncio de Meta que todavía no tiene código
    ["Boedo", "sin código", 0, 1, 0],                // entradas de Boedo sin código
    ["Palermo", "P1", 150, 2, 0],
    ["Palermo", "P2", 30, 1, 1],
    ["Palermo", "P3", 0, 0, 0],                      // código del catálogo sin datos de Meta en el período
    ["Palermo", "sin código", 0, 1, 0],
  ]);
});

test("el anuncio de Meta se vincula con el catálogo por nombre normalizado (mayúsculas y espacios)", async () => {
  const r = await rend(sesion("mkt"));
  const p2 = r.find((x) => x.codigo === "P2");
  assert.equal(p2.instrumentado, true);
  assert.equal(Number(p2.conversaciones), 1);
});

test("clics en el enlace: null si ningún día lo trae; si algún día lo trae suma solo esos días y las impresiones de esos días", async () => {
  const r = await rend(sesion("mkt"));
  const p1 = r.find((x) => x.codigo === "P1");
  assert.equal(Number(p1.clics_enlace), 40);
  assert.equal(Number(p1.impresiones_enlace), 1000);   // el 02/10 no traía el dato: sus 500 impresiones no entran al CTR del enlace
  assert.equal(Number(p1.impresiones), 1500);
  assert.equal(Number(p1.dias), 2);
  assert.equal(p1.ultimo_dia.toISOString?.().slice(0, 10) ?? String(p1.ultimo_dia).slice(0, 10), "2020-10-02");
  const p3 = r.find((x) => x.codigo === "P3");
  assert.equal(p3.clics_enlace, null);
});

test("las entradas de una zona suman lo mismo que 'Entradas únicas' (primer contacto): 0001 cuenta una sola vez", async () => {
  const r = await rend(sesion("mkt"));
  const palermo = r.filter((x) => x.comunidad === "Palermo").reduce((s, x) => s + Number(x.entradas ?? 0), 0);
  assert.equal(palermo, 4);   // 0001, 0002, 0003 y 0004
});

test("el período filtra por fecha de Buenos Aires: en noviembre solo aparece la entrada con P1 del 20/11", async () => {
  const r = await rend(sesion("mkt"), "2020-11-01", "2020-11-30");
  const p1 = r.find((x) => x.codigo === "P1");
  assert.equal(Number(p1.entradas), 1);
  assert.equal(Number(p1.inversion), 999);
});

test("sin fechas trae todo el histórico; con una comunidad elegida solo esa", async () => {
  const todo = await rend(sesion("mkt"), null, null);
  assert.equal(Number(todo.find((x) => x.codigo === "P1").inversion), 1149);
  const soloBoedo = await rend(sesion("mkt"), "2020-10-01", "2020-10-31", BOE);
  assert.ok(soloBoedo.every((x) => x.comunidad === "Boedo"));
});

test("no mezcla clientes: nada del otro cliente aparece", async () => {
  const r = await rend(sesion("mkt"), null, null);
  assert.ok(r.every((x) => x.comunidad !== "Otra"));
  assert.ok(!r.some((x) => Number(x.inversion) === 777));
});

test("es plata: lo ve Marketing; un usuario General recibe la lista vacía y la clave pública no puede ni llamarla", async () => {
  const general = await rend(sesion("general"));
  assert.equal(general.length, 0);
  await assert.rejects(como(db, { rol: "anon" }, (tx) => tx.query(`select * from ${S}.rendimiento_por_anuncio($1::uuid)`, [CLI])), /permission denied/i);
});

test("la migración corrige los nombres cortos del catálogo y es idempotente", async () => {
  await db.exec(`insert into ${S}.anuncio_codigo (cliente_id, comunidad_id, codigo, anuncio_nombre, campana_nombre) values ('${CLI}', '${PAL}', 'P7', 'PALERMO_07', 'CAMP_X')`);
  const sql = (await import("node:fs")).readFileSync(new URL("../../db/041_rendimiento_por_anuncio.sql", import.meta.url), "utf8");
  await db.exec(sql);
  await db.exec(sql);
  const { rows } = await db.query(`select anuncio_nombre from ${S}.anuncio_codigo where codigo = 'P7'`);
  assert.equal(rows[0].anuncio_nombre, "CAMP_X_PALERMO_07");
});
