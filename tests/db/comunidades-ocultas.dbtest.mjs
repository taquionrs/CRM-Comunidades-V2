// Pruebas de las comunidades ocultas (db/047) sobre un Postgres local con TODAS las migraciones del repo. Correr: npm run test:db
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { nuevaBase, como } from "./harness.mjs";

const S = "crm_comunidades_v2";
const CLI = "00000000-0000-0000-0000-0000000000c1";
const PAL = "00000000-0000-0000-0000-0000000000a2", GEN = "00000000-0000-0000-0000-0000000000a9";
let db, U;

before(async () => {
  db = await nuevaBase();
  await db.exec(`
    set search_path = crm_comunidades_v2, public;
    insert into cliente (id, nombre, slug) values ('${CLI}', 'Cortado', 'cortado');
    insert into comunidad (id, cliente_id, nombre) values ('${PAL}', '${CLI}', 'Palermo'), ('${GEN}', '${CLI}', 'Cortado en Jarrito (general)');
    insert into carga_miembros (cliente_id, comunidad_id, cargada_en, numeros_validos, nuevos, salieron, lista_completa) values
      ('${CLI}', '${PAL}', timestamptz '2026-10-14 12:00:00-03', 32, 32, 0, true), ('${CLI}', '${PAL}', timestamptz '2026-10-26 12:00:00-03', 41, 10, 1, true),
      ('${CLI}', '${GEN}', timestamptz '2026-10-14 12:00:00-03', 10, 10, 0, true), ('${CLI}', '${GEN}', timestamptz '2026-10-26 12:00:00-03', 16, 7, 1, true);
    insert into meta_ads_metrica (cliente_id, comunidad_id, fecha, inversion, conversaciones_meta, impresiones, clics, leads_meta, clics_enlace) values
      ('${CLI}', '${PAL}', '2026-10-20', 50, 2, 0, 0, 0, null), ('${CLI}', '${GEN}', '2026-10-20', 7, 1, 0, 0, 0, null);
    insert into evento_crudo (cliente_id, comunidad_id, telefono_id, payload, recibido_en) values
      ('${CLI}', '${PAL}', '5491100000001', '{}', timestamptz '2026-10-20 12:00:00-03'),
      ('${CLI}', '${GEN}', '5491100000002', '{}', timestamptz '2026-10-20 12:00:00-03'),
      ('${CLI}', '${GEN}', '5491100000003', '{}', timestamptz '2026-10-21 12:00:00-03');
    insert into usuario_crm (email, rol, admin) values ('mkt@taquion.com.ar', 'marketing', false);
  `);
  const { rows: [u] } = await db.query(`insert into auth.users (email) values ('mkt@taquion.com.ar') returning id`);
  const { rows: [s] } = await db.query(`insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id`, [u.id]);
  U = { id: u.id, email: "mkt@taquion.com.ar", sesion: s.id };
});

const sesion = () => ({ rol: "authenticated", claims: { sub: U.id, email: U.email, session_id: U.sesion } });
const q = async (sql, params = []) => (await como(db, sesion(), (tx) => tx.query(sql, params))).rows;
const ocultar = (v) => db.query(`update ${S}.comunidad set oculta = $1 where id = $2`, [v, GEN]);
const nombres = (rows) => rows.map((r) => r.nombre ?? r.comunidad).filter(Boolean).sort();

test("la migración agrega la columna 'oculta' (por defecto false) y no borra nada", async () => {
  const { rows } = await db.query(`select nombre, oculta from ${S}.comunidad order by nombre`);
  assert.deepEqual(rows, [{ nombre: "Cortado en Jarrito (general)", oculta: false }, { nombre: "Palermo", oculta: false }]);   // la siembra vino después de la migración
});

test("sin ocultar nada, todo se ve como antes", async () => {
  await ocultar(false);
  assert.deepEqual(nombres(await q(`select * from ${S}.comunidad_performance where cliente_id = $1`, [CLI])), ["Cortado en Jarrito (general)", "Palermo"]);
});

test("oculta: sale de la vista de Overview y de los totales (kpis_macro)", async () => {
  await ocultar(true);
  assert.deepEqual(nombres(await q(`select * from ${S}.comunidad_performance where cliente_id = $1`, [CLI])), ["Palermo"]);
  const [k] = await q(`select * from ${S}.kpis_macro where cliente_id = $1`, [CLI]);
  assert.equal(Number(k.inversion_total), 50);
  assert.equal(Number(k.conversaciones_totales), 2);
  assert.equal(Number(k.clics_unicos_totales), 1);
});

test("oculta: sale de Control_Comunidades (comunidad_performance_rango)", async () => {
  const filas = await q(`select * from ${S}.comunidad_performance_rango($1::uuid, null, null, 'todos')`, [CLI]);
  assert.deepEqual(nombres(filas), ["Palermo"]);
});

test("oculta: sus entradas no suman en las entradas al flow del cliente", async () => {
  const [e] = await q(`select * from ${S}.entradas_flow_cliente($1::uuid, null, null, 'todos')`, [CLI]);
  assert.equal(Number(e.clasificadas), 1);
  await ocultar(false);
  const [t] = await q(`select * from ${S}.entradas_flow_cliente($1::uuid, null, null, 'todos')`, [CLI]);
  assert.equal(Number(t.clasificadas), 3);
  await ocultar(true);
});

test("oculta: sale del CRR, del costo por miembro y del reporte semanal (con su total)", async () => {
  assert.deepEqual(nombres(await q(`select * from ${S}.crr_por_carga($1::uuid)`, [CLI])), ["Palermo"]);
  assert.deepEqual(nombres(await q(`select * from ${S}.crr_por_carga_con_inversion($1::uuid)`, [CLI])), ["Palermo"]);
  const rep = await q(`select * from ${S}.reporte_semanal($1::uuid, '2026-10-19', '2026-10-26')`, [CLI]);
  assert.deepEqual(nombres(rep.filter((r) => !r.es_total)), ["Palermo"]);
  const total = rep.find((r) => r.es_total);
  assert.equal(Number(total.inversion), 50);
});

test("oculta: no entra en 'Para completar' (acciones pendientes)", async () => {
  await db.query(`delete from ${S}.carga_miembros where comunidad_id = $1 and cargada_en > timestamptz '2026-10-20 00:00:00-03'`, [GEN]);   // dejaría a (general) con una sola carga
  const acciones = await q(`select * from ${S}.acciones_pendientes($1::uuid)`, [CLI]);
  assert.ok(acciones.every((a) => !(a.comunidades || []).includes("Cortado en Jarrito (general)")), JSON.stringify(acciones));
  await ocultar(false);
  const con = await q(`select * from ${S}.acciones_pendientes($1::uuid)`, [CLI]);
  assert.ok(con.some((a) => (a.comunidades || []).includes("Cortado en Jarrito (general)")), "sin ocultar, sí aparece");
  await ocultar(true);
});

test("los datos no se borran: la comunidad oculta sigue en la base con sus cargas, su gasto y sus eventos", async () => {
  const { rows: [c] } = await db.query(`select (select count(*) from ${S}.carga_miembros where comunidad_id = $1) as cargas,
    (select count(*) from ${S}.meta_ads_metrica where comunidad_id = $1) as gasto, (select count(*) from ${S}.evento_crudo where comunidad_id = $1) as eventos`, [GEN]);
  assert.deepEqual([Number(c.cargas), Number(c.gasto), Number(c.eventos)], [1, 1, 2]);
});
