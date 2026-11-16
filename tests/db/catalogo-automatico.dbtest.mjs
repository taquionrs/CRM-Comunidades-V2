// Pruebas del catálogo automático de anuncios (db/042) sobre un Postgres local con TODAS las migraciones del repo.
// Correr: npm run test:db (usa @electric-sql/pglite, no toca ninguna base real).
import test, { before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { nuevaBase, como } from "./harness.mjs";

const S = "crm_comunidades_v2";
const CLI = "00000000-0000-0000-0000-0000000000c1";
const PAL = "00000000-0000-0000-0000-0000000000a1", BOE = "00000000-0000-0000-0000-0000000000a2", DEV = "00000000-0000-0000-0000-0000000000a3";
let db;
const U = {};
const P = "TQN_WA_";

before(async () => {
  db = await nuevaBase();
  await db.exec(`
    set search_path = crm_comunidades_v2, public;
    insert into cliente (id, nombre, slug) values ('${CLI}', 'Cortado', 'cortado');
    insert into comunidad (id, cliente_id, nombre) values ('${PAL}', '${CLI}', 'Palermo'), ('${BOE}', '${CLI}', 'Boedo'), ('${DEV}', '${CLI}', 'Villa Devoto');
    insert into comunidad_meta_origen (cliente_id, comunidad_id, campana_nombre, adset_nombre, cuenta) values
      ('${CLI}', '${PAL}', 'CAMP', 'ADS_PAL', true), ('${CLI}', '${PAL}', 'CAMP_2', 'ADS_PAL', true),
      ('${CLI}', '${BOE}', 'CAMP', 'ADS_BOE', true), ('${CLI}', '${DEV}', 'CAMP', 'ADS_DEV', true);
    insert into usuario_crm (email, rol, admin) values ('mkt@taquion.com.ar', 'marketing', false);
  `);
  const { rows: [u] } = await db.query(`insert into auth.users (email) values ('mkt@taquion.com.ar') returning id`);
  const { rows: [s] } = await db.query(`insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id`, [u.id]);
  U.mkt = { id: u.id, email: "mkt@taquion.com.ar", sesion: s.id };
});

// Cada prueba parte de cero: sin métricas, sin catálogo, sin eventos y sin la pausa de 45 segundos entre consultas.
beforeEach(async () => {
  await db.exec(`delete from ${S}.anuncio_codigo; delete from ${S}.meta_ads_anuncio_metrica; delete from ${S}.windsor_sync_log;
                 delete from ${S}.evento_crudo; delete from ${S}.ingreso_sin_clasificar;`);
});

const fila = (o) => ({ d: "2020-10-01", account_id: "111", campaign: "CAMP", adset_name: "ADS_PAL", ad_id: "1", ad_name: P + "PALERMO_01",
                       spend: "10", impressions: "100", clicks: "5", lc: "4", conv: "2", ...o });
const aplicar = async (filas) => {
  await db.exec(`delete from ${S}.windsor_sync_log`);
  return (await db.query(`select * from ${S}.meta_anuncios_aplicar($1::jsonb, '2020-10-01', '2020-10-03')`, [JSON.stringify(filas)])).rows[0];
};
const catalogo = async () => (await db.query(`select codigo, ad_id, anuncio_nombre, campana_nombre, adset_nombre, automatico, comunidad_id from ${S}.anuncio_codigo order by codigo`)).rows;
const codigos = async () => Object.fromEntries((await catalogo()).map((r) => [r.ad_id, r.codigo]));

test("cada anuncio nuevo queda en el catálogo con ZONA-NN: la zona de la comunidad y el número del nombre del anuncio", async () => {
  await aplicar([
    fila({}), fila({ ad_id: "2", ad_name: P + "PALERMO_02" }),
    fila({ adset_name: "ADS_BOE", ad_id: "3", ad_name: P + "BOEDO_04" }),
    fila({ adset_name: "ADS_DEV", ad_id: "4", ad_name: P + "DEVOTO_02" }),
  ]);
  assert.deepEqual(await codigos(), { 1: "PAL-01", 2: "PAL-02", 3: "BOE-04", 4: "DEV-02" });
});

test("guarda el ID de Meta, la campaña, el conjunto y que lo creó el CRM", async () => {
  await aplicar([fila({})]);
  const [c] = await catalogo();
  assert.equal(c.ad_id, "1");
  assert.equal(c.campana_nombre, "CAMP");
  assert.equal(c.adset_nombre, "ADS_PAL");
  assert.equal(c.automatico, true);
  assert.equal(c.comunidad_id, PAL);
});

test("un nombre sin número, o con un número ya tomado, recibe el primer número libre de la zona", async () => {
  await aplicar([
    fila({}), fila({ ad_id: "2", ad_name: P + "PALERMO_02" }),
    fila({ ad_id: "9", ad_name: "Anuncio especial" }),                                        // sin número
    fila({ campaign: "CAMP_2", ad_id: "10", ad_name: P + "PALERMO_01" }),                     // PAL-01 ya está tomado por el anuncio 1
  ]);
  const c = await codigos();
  assert.equal(c[1], "PAL-01");
  assert.equal(c[2], "PAL-02");
  assert.deepEqual([c[9], c[10]].sort(), ["PAL-03", "PAL-04"]);
  assert.equal(new Set(Object.values(c)).size, 4, "ningún código repetido");
});

test("volver a consultar no cambia los códigos ni duplica; si Meta le cambia el nombre al anuncio, el código se queda", async () => {
  await aplicar([fila({}), fila({ ad_id: "2", ad_name: P + "PALERMO_02" })]);
  const antes = await codigos();
  await aplicar([fila({ ad_name: P + "PALERMO_99_RENOMBRADO" }), fila({ ad_id: "2", ad_name: P + "PALERMO_02" })]);
  assert.deepEqual(await codigos(), antes);
  const [c1] = (await catalogo()).filter((x) => x.ad_id === "1");
  assert.equal(c1.anuncio_nombre, P + "PALERMO_99_RENOMBRADO");
  assert.equal((await catalogo()).length, 2);
});

test("un código cargado a mano sin ad_id se vincula al anuncio de Meta por nombre y conserva su código", async () => {
  await db.exec(`insert into ${S}.anuncio_codigo (cliente_id, comunidad_id, codigo, anuncio_nombre) values ('${CLI}', '${PAL}', 'P1', ' tqn_wa_palermo_01 ')`);
  await aplicar([fila({})]);
  const c = await catalogo();
  assert.equal(c.length, 1);
  assert.equal(c[0].codigo, "P1");
  assert.equal(c[0].ad_id, "1");
  assert.equal(c[0].automatico, false);
});

test("una respuesta vacía de Windsor no toca el catálogo", async () => {
  await aplicar([fila({})]);
  await aplicar([]);
  assert.equal((await catalogo()).length, 1);
});

test("el catálogo acepta ZONA-NN y el formato anterior, y rechaza lo que no es un código", async () => {
  const ins = (c) => db.exec(`insert into ${S}.anuncio_codigo (cliente_id, comunidad_id, codigo, anuncio_nombre) values ('${CLI}', '${PAL}', '${c}', 'x ${c}')`);
  for (const ok of ["PAL-01", "BOE-4", "ABCD-123", "P1", "PA12"]) await ins(ok);
  for (const mal of ["pal-01", "PALERMO-01", "PAL-", "PAL--01", "PAL-1234", "PAL01X", "P-", "-01", "PAL 01"]) {
    await assert.rejects(ins(mal), /check|violates/i, mal);
  }
});

test("reglas de generación: prefijo de la zona y número del nombre", async () => {
  const q = async (sql, args) => (await db.query(sql, args)).rows[0].v;
  for (const [nombre, esperado] of [["Palermo", "PAL"], ["Villa Devoto", "DEV"], ["Barrio Norte", "NOR"], ["Cortado en Jarrito (general)", "COR"],
                                    ["Ñuñoa", "NUN"], ["Boedo", "BOE"], ["X", "AD"], ["", "AD"], ["123", "AD"]]) {
    assert.equal(await q(`select ${S}.prefijo_zona($1) as v`, [nombre]), esperado, nombre);
  }
  assert.equal(await q(`select ${S}.numero_anuncio($1) as v`, ["TQN_WA_PALERMO_01"]), 1);
  assert.equal(await q(`select ${S}.numero_anuncio($1) as v`, ["TQN_WA_PALERMO_12 "]), 12);
  assert.equal(await q(`select ${S}.numero_anuncio($1) as v`, ["Anuncio especial"]), null);
  assert.equal(await q(`select ${S}.numero_anuncio($1) as v`, [null]), null);
});

test("el rendimiento muestra el código de cada anuncio, pero las columnas del CRM quedan en null hasta que el código se ve en una entrada", async () => {
  await aplicar([fila({}), fila({ ad_id: "2", ad_name: P + "PALERMO_02" })]);
  const rend = async () => (await como(db, { rol: "authenticated", claims: { sub: U.mkt.id, email: U.mkt.email, session_id: U.mkt.sesion } },
    (tx) => tx.query(`select * from ${S}.rendimiento_por_anuncio($1::uuid, '2020-10-01', '2020-10-31', null)`, [CLI]))).rows.filter((r) => r.codigo);
  let r = await rend();
  assert.deepEqual(r.map((x) => [x.codigo, x.instrumentado, x.entradas]), [["PAL-01", false, null], ["PAL-02", false, null]]);
  assert.equal(r[0].adset_nombre, "ADS_PAL");
  assert.equal(r[0].ad_id, "1");
  // Llega una persona con el código PAL-01: ese anuncio pasa a "visto" y muestra números (el otro sigue sin poder saberse).
  await db.exec(`insert into ${S}.evento_crudo (cliente_id, comunidad_id, telefono_id, payload, anuncio_codigo, recibido_en)
                 values ('${CLI}', '${PAL}', '5491100000001', '{}', 'PAL-01', timestamptz '2020-10-02 12:00:00-03')`);
  r = await rend();
  assert.deepEqual(r.map((x) => [x.codigo, x.instrumentado, x.entradas === null ? null : Number(x.entradas)]), [["PAL-01", true, 1], ["PAL-02", false, null]]);
});

test("el catálogo lo lee un usuario del CRM pero no lo modifica, y solo el servidor lo registra", async () => {
  await aplicar([fila({})]);
  const ctx = { rol: "authenticated", claims: { sub: U.mkt.id, email: U.mkt.email, session_id: U.mkt.sesion } };
  assert.equal((await como(db, ctx, (tx) => tx.query(`select codigo from ${S}.anuncio_codigo`))).rows.length, 1);
  await assert.rejects(como(db, ctx, (tx) => tx.query(`update ${S}.anuncio_codigo set activo = false`)), /permission denied/i);
  await assert.rejects(como(db, ctx, (tx) => tx.query(`select ${S}.registrar_anuncios_en_catalogo(null)`)), /permission denied/i);
});
