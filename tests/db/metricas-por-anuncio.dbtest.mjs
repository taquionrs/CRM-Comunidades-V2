// Pruebas de las métricas de Meta por anuncio (db/040) sobre un Postgres local con TODAS las migraciones del repo.
// Correr: npm run test:db (usa @electric-sql/pglite, no toca ninguna base real).
import test, { before, beforeEach } from "node:test";
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
    insert into cliente (id, nombre, slug, meta_cuenta_id) values ('${CLI}', 'Cortado', 'cortado', '111'), ('${CLI2}', 'Otro', 'otro', null);
    insert into comunidad (id, cliente_id, nombre) values ('${PAL}', '${CLI}', 'Palermo'), ('${BOE}', '${CLI}', 'Boedo'), ('${OTRA}', '${CLI2}', 'Otra');
    insert into comunidad_meta_origen (cliente_id, comunidad_id, campana_nombre, adset_nombre, cuenta) values
      ('${CLI}', '${PAL}', 'CAMP', 'ADS_PALERMO', true),
      ('${CLI}', '${BOE}', 'CAMP', 'ADS_BOEDO', true),
      ('${CLI}', '${BOE}', 'CAMP_NO', null, false),
      ('${CLI2}', '${OTRA}', 'CAMP_OTRO', null, true);
    insert into usuario_crm (email, rol, admin) values ('mkt@taquion.com.ar', 'marketing', false), ('general@taquion.com.ar', 'general', false);
  `);
  for (const email of ["mkt@taquion.com.ar", "general@taquion.com.ar"]) {
    const { rows: [u] } = await db.query(`insert into auth.users (email) values ($1) returning id`, [email]);
    const { rows: [s] } = await db.query(`insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id`, [u.id]);
    U[email.split("@")[0]] = { id: u.id, email, sesion: s.id };
  }
});

// Cada prueba parte de cero: sin métricas por anuncio, sin métricas por comunidad y sin la pausa de 45 segundos entre consultas.
beforeEach(async () => {
  await db.exec(`delete from ${S}.meta_ads_anuncio_metrica; delete from ${S}.meta_ads_metrica; delete from ${S}.windsor_sync_log;`);
});

const sesion = (k) => ({ rol: "authenticated", claims: { sub: U[k].id, email: U[k].email, session_id: U[k].sesion } });
const fila = (o) => ({ d: "2020-10-01", account_id: "111", campaign: "CAMP", adset_name: "ADS_PALERMO", ad_id: "P1", ad_name: "PALERMO_01",
                       spend: "10", impressions: "100", clicks: "5", lc: "4", conv: "2", ...o });
const aplicar = async (filas, desde = "2020-10-01", hasta = "2020-10-03") => {
  const { rows } = await db.query(`select * from ${S}.meta_anuncios_aplicar($1::jsonb, $2::date, $3::date)`, [JSON.stringify(filas), desde, hasta]);
  return rows[0];
};
const guardadas = async () => (await db.query(`select ad_id, comunidad_id, fecha::text as fecha, inversion::float as inv, impresiones, clics, clics_enlace, conversaciones_meta as conv
                                                  from ${S}.meta_ads_anuncio_metrica order by fecha, ad_id`)).rows;

test("cada fila va a la comunidad de su conjunto y se guarda un registro por día y anuncio", async () => {
  const r = await aplicar([
    fila({}),
    fila({ ad_id: "P2", ad_name: "PALERMO_02", spend: "7.5", conv: "1" }),
    fila({ adset_name: "ADS_BOEDO", ad_id: "B1", ad_name: "BOEDO_01", spend: "20" }),
    fila({ d: "2020-10-02" }),
  ]);
  assert.equal(r.filas_origen, 4);
  assert.equal(r.filas_asignadas, 4);
  assert.equal(r.registros_escritos, 4);
  const g = await guardadas();
  assert.deepEqual(g.map((x) => [x.fecha, x.ad_id, x.comunidad_id === PAL ? "Palermo" : "Boedo", x.inv]),
    [["2020-10-01", "B1", "Boedo", 20], ["2020-10-01", "P1", "Palermo", 10], ["2020-10-01", "P2", "Palermo", 7.5], ["2020-10-02", "P1", "Palermo", 10]]);
});

test("varias filas del mismo anuncio y día se suman (por ejemplo, una por ubicación)", async () => {
  await aplicar([fila({ spend: "10.10", clicks: "5", lc: "4", conv: "2" }), fila({ spend: "5.25", clicks: "3", lc: "2", conv: "1" })]);
  const [g] = await guardadas();
  assert.equal(g.inv, 15.35);
  assert.equal(g.clics, 8);
  assert.equal(g.clics_enlace, 6);
  assert.equal(g.conv, 3);
});

test("clics en el enlace: NULL si ninguna fila lo trae (no es 0), suma si alguna lo trae", async () => {
  await aplicar([fila({ lc: "" }), fila({ ad_id: "P2", lc: "" }), fila({ ad_id: "P3", lc: "0" })]);
  const g = Object.fromEntries((await guardadas()).map((x) => [x.ad_id, x.clics_enlace]));
  assert.deepEqual(g, { P1: null, P2: null, P3: 0 });
});

test("una fila sin ad_id no se guarda y se informa; una campaña que no está en el mapeo se ignora", async () => {
  const r = await aplicar([fila({}), fila({ ad_id: "" }), fila({ campaign: "CAMPAÑA_AJENA", ad_id: "X1" })]);
  assert.equal(r.filas_sin_anuncio, 1);
  assert.equal(r.registros_escritos, 1);
  assert.equal(r.filas_sin_comunidad, 0);
  assert.deepEqual((await guardadas()).map((x) => x.ad_id), ["P1"]);
});

test("un conjunto que no figura en una campaña mapeada no se asigna: queda informado con su gasto", async () => {
  const r = await aplicar([fila({}), fila({ adset_name: "ADS_NUEVO", ad_id: "N1", spend: "99.5" })]);
  assert.equal(r.filas_sin_comunidad, 1);
  assert.equal(Number(r.gasto_sin_comunidad), 99.5);
  assert.deepEqual((await guardadas()).map((x) => x.ad_id), ["P1"]);
});

test("las campañas que no cuentan (cuenta = false) y las de otra cuenta publicitaria no se guardan", async () => {
  const r = await aplicar([fila({}), fila({ campaign: "CAMP_NO", adset_name: "LO_QUE_SEA", ad_id: "Z1" }), fila({ account_id: "999", ad_id: "Z2" })]);
  assert.equal(r.registros_escritos, 1);
  assert.deepEqual((await guardadas()).map((x) => x.ad_id), ["P1"]);
  const { rows: [l] } = await db.query(`select filas_excluidas from ${S}.windsor_sync_log order by corrida_en desc limit 1`);
  assert.equal(l.filas_excluidas, 1);
});

test("volver a traer el mismo rango reemplaza: no duplica y un anuncio que Meta ya no devuelve desaparece", async () => {
  await aplicar([fila({}), fila({ ad_id: "P2" })]);
  await db.exec(`delete from ${S}.windsor_sync_log`);
  await aplicar([fila({ spend: "11" })]);
  const g = await guardadas();
  assert.deepEqual(g.map((x) => [x.ad_id, x.inv]), [["P1", 11]]);
});

test("los días fuera del rango pedido no se tocan ni se aceptan", async () => {
  await aplicar([fila({ d: "2020-10-01" }), fila({ d: "2020-10-03" })], "2020-10-01", "2020-10-03");
  await db.exec(`delete from ${S}.windsor_sync_log`);
  await aplicar([fila({ d: "2020-10-03", spend: "50" }), fila({ d: "2020-10-09", ad_id: "FUERA" })], "2020-10-03", "2020-10-03");
  const g = await guardadas();
  assert.deepEqual(g.map((x) => [x.fecha, x.ad_id, x.inv]), [["2020-10-01", "P1", 10], ["2020-10-03", "P1", 50]]);
});

test("una respuesta vacía de Windsor no borra lo que ya estaba", async () => {
  await aplicar([fila({})]);
  await db.exec(`delete from ${S}.windsor_sync_log`);
  const r = await aplicar([]);
  assert.equal(r.registros_escritos, 0);
  assert.equal((await guardadas()).length, 1);
});

test("solo se reemplazan los clientes que llegaron: los datos de otro cliente quedan", async () => {
  await aplicar([fila({}), fila({ campaign: "CAMP_OTRO", adset_name: "X", ad_id: "O1", account_id: "555" })]);
  await db.exec(`delete from ${S}.windsor_sync_log`);
  await aplicar([fila({ spend: "12" })]);
  const g = await guardadas();
  assert.deepEqual(g.map((x) => x.ad_id), ["O1", "P1"]);
});

test("rango inválido: más de 31 días, fechas futuras o invertido", async () => {
  await assert.rejects(aplicar([], "2020-01-01", "2020-03-01"), /31 días/);
  await assert.rejects(aplicar([], "2020-10-03", "2020-10-01"), /no es válido/);
  const manana = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  await assert.rejects(aplicar([], manana, manana), /futuras/);
});

test("dos consultas seguidas: la segunda espera (misma pausa de 45 segundos que Meta en vivo)", async () => {
  await aplicar([fila({})]);
  await assert.rejects(aplicar([fila({})]), /Esper[aá] un momento/);
});

test("el cuadre contra meta_ads_metrica da lo mismo cuando los datos son consistentes", async () => {
  await aplicar([fila({}), fila({ ad_id: "P2", spend: "7.5", lc: "3", conv: "1" }), fila({ adset_name: "ADS_BOEDO", ad_id: "B1", spend: "20", lc: "6", conv: "4" })]);
  await db.exec(`insert into ${S}.meta_ads_metrica (cliente_id, comunidad_id, fecha, inversion, conversaciones_meta, impresiones, clics, leads_meta, clics_enlace) values
    ('${CLI}', '${PAL}', '2020-10-01', 17.5, 3, 200, 10, 0, 7), ('${CLI}', '${BOE}', '2020-10-01', 20, 4, 100, 5, 0, 6)`);
  const { rows } = await db.query(`select comunidad, inversion_anuncios::float a, inversion_comunidad::float c, conversaciones_anuncios::int ca, conversaciones_comunidad::int cc,
                                          clics_enlace_anuncios::int la, clics_enlace_comunidad::int lc from ${S}.meta_anuncios_cuadre($1::uuid, '2020-10-01', '2020-10-03')`, [CLI]);
  assert.deepEqual(rows.map((r) => [r.comunidad, r.a, r.c, r.ca, r.cc, r.la, r.lc]), [["Boedo", 20, 20, 4, 4, 6, 6], ["Palermo", 17.5, 17.5, 3, 3, 7, 7]]);
});

test("el gasto por anuncio lo lee Marketing, no un usuario General ni la clave pública; nadie lo escribe desde el panel", async () => {
  await aplicar([fila({})]);
  const mkt = (await como(db, sesion("mkt"), (tx) => tx.query(`select ad_id from ${S}.meta_ads_anuncio_metrica`))).rows;
  assert.deepEqual(mkt.map((r) => r.ad_id), ["P1"]);
  const general = (await como(db, sesion("general"), (tx) => tx.query(`select ad_id from ${S}.meta_ads_anuncio_metrica`))).rows;
  assert.equal(general.length, 0);
  await assert.rejects(como(db, { rol: "anon" }, (tx) => tx.query(`select * from ${S}.meta_ads_anuncio_metrica`)), /permission denied/i);
  await assert.rejects(como(db, sesion("mkt"), (tx) => tx.query(`delete from ${S}.meta_ads_anuncio_metrica`)), /permission denied/i);
});

test("solo el servidor corre meta_anuncios_aplicar; el cuadre lo ve Marketing y no General", async () => {
  await assert.rejects(como(db, sesion("mkt"), (tx) => tx.query(`select * from ${S}.meta_anuncios_aplicar('[]'::jsonb, '2020-10-01', '2020-10-01')`)), /permission denied/i);
  await assert.rejects(como(db, { rol: "anon" }, (tx) => tx.query(`select * from ${S}.meta_anuncios_cuadre($1::uuid, '2020-10-01', '2020-10-03')`, [CLI])), /permission denied/i);
  await aplicar([fila({})]);
  const mkt = (await como(db, sesion("mkt"), (tx) => tx.query(`select * from ${S}.meta_anuncios_cuadre($1::uuid, '2020-10-01', '2020-10-03')`, [CLI]))).rows;
  assert.equal(mkt.length, 1);
  const general = (await como(db, sesion("general"), (tx) => tx.query(`select * from ${S}.meta_anuncios_cuadre($1::uuid, '2020-10-01', '2020-10-03')`, [CLI]))).rows;
  assert.equal(general.length, 0);
});
