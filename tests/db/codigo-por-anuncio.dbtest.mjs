// Pruebas del código por anuncio (db/039) sobre un Postgres local con TODAS las migraciones del repo.
// Correr: npm run test:db (usa @electric-sql/pglite, no toca ninguna base real).
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { nuevaBase, como } from "./harness.mjs";

const S = "crm_comunidades_v2";
const CLI = "00000000-0000-0000-0000-0000000000c1", CLI2 = "00000000-0000-0000-0000-0000000000c2";
const COM_A = "00000000-0000-0000-0000-0000000000a1", COM_B = "00000000-0000-0000-0000-0000000000a2";
let db;
const U = {};

before(async () => {
  db = await nuevaBase();
  await db.exec(`
    set search_path = crm_comunidades_v2, public;
    insert into cliente (id, nombre, slug) values ('${CLI}', 'Cortado en Jarrito', 'cortado-en-jarrito'), ('${CLI2}', 'Otro', 'otro');
    insert into comunidad (id, cliente_id, nombre) values ('${COM_A}', '${CLI}', 'Palermo'), ('${COM_B}', '${CLI}', 'Boedo');
    insert into anuncio_codigo (cliente_id, comunidad_id, codigo, anuncio_nombre) values ('${CLI}', '${COM_B}', 'B1', 'BOEDO_01')
      on conflict do nothing;
    insert into evento_crudo (cliente_id, comunidad_id, telefono_id, payload, anuncio_codigo, recibido_en) values
      ('${CLI}', '${COM_A}', '5491100000001', '{}', 'P1', timestamptz '2020-09-01 12:00:00-03'),
      ('${CLI}', '${COM_A}', '5491100000001', '{}', 'P1', timestamptz '2020-09-02 12:00:00-03'),
      ('${CLI}', '${COM_A}', '5491100000002', '{}', 'P1', timestamptz '2020-09-02 13:00:00-03'),
      ('${CLI}', '${COM_A}', '5491100000003', '{}', 'P2', timestamptz '2020-09-03 13:00:00-03'),
      ('${CLI}', '${COM_A}', '5491100000004', '{}', null,  timestamptz '2020-09-03 14:00:00-03');
    insert into ingreso_sin_clasificar (cliente_id, telefono_id, mensaje, payload, anuncio_codigo, recibido_en) values
      ('${CLI}', '5491100000010', 'hola P1', '{}', 'P1', timestamptz '2020-09-02 10:00:00-03'),
      ('${CLI}', '5491100000001', 'hola P1', '{}', 'P1', timestamptz '2020-08-31 10:00:00-03');
    insert into usuario_crm (email, rol, admin) values ('general@taquion.com.ar', 'general', false);
  `);
  const { rows: [u] } = await db.query(`insert into auth.users (email) values ('general@taquion.com.ar') returning id`);
  const { rows: [s] } = await db.query(`insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id`, [u.id]);
  U.general = { id: u.id, email: "general@taquion.com.ar", sesion: s.id };
});

const ctx = () => ({ rol: "authenticated", claims: { sub: U.general.id, email: U.general.email, session_id: U.general.sesion } });
const porAnuncio = async (c, cli = CLI, d = null, h = null) =>
  (await como(db, c, (tx) => tx.query(`select * from ${S}.entradas_por_anuncio($1::uuid, $2::date, $3::date)`, [cli, d, h]))).rows;
const resumen = (rows) => Object.fromEntries(rows.map((r) => [r.codigo, [Number(r.entradas), Number(r.sin_clasificar)]]));

test("la migración carga los 4 anuncios de Palermo cuando existe la comunidad (en la base de prueba no hay: solo el de Boedo)", async () => {
  const { rows } = await db.query(`select codigo from ${S}.anuncio_codigo order by 1`);
  assert.deepEqual(rows.map((r) => r.codigo), ["B1"]);
});

test("personas distintas por código: la misma persona dos veces cuenta una; sin código no cuenta", async () => {
  await db.exec(`insert into ${S}.anuncio_codigo (cliente_id, comunidad_id, codigo, anuncio_nombre) values
    ('${CLI}', '${COM_A}', 'P1', 'PALERMO_01'), ('${CLI}', '${COM_A}', 'P2', 'PALERMO_02')`);
  const r = resumen(await porAnuncio(ctx()));
  // P1: personas 0001 y 0002 (0001 dos veces) + sin clasificar 0010 (0001 ya tiene entrada, no cuenta); P2: 0003; B1 sin datos.
  assert.deepEqual(r, { B1: [0, 0], P1: [2, 1], P2: [1, 0] });
});

test("filtra por fechas en hora de Buenos Aires", async () => {
  const r = resumen(await porAnuncio(ctx(), CLI, "2020-09-03", "2020-09-03"));
  assert.deepEqual(r, { B1: [0, 0], P1: [0, 0], P2: [1, 0] });
});

test("un código tiene que ser 1 a 3 letras mayúsculas y 1 a 3 números, y no se repite en un cliente", async () => {
  for (const c of ["p1", "1P", "PALERMO1", "P", "P 1"]) {
    await assert.rejects(db.exec(`insert into ${S}.anuncio_codigo (cliente_id, comunidad_id, codigo, anuncio_nombre) values ('${CLI}', '${COM_A}', '${c}', 'x')`), /check|violates/i, c);
  }
  await assert.rejects(db.exec(`insert into ${S}.anuncio_codigo (cliente_id, comunidad_id, codigo, anuncio_nombre) values ('${CLI}', '${COM_A}', 'P1', 'otro')`), /duplicate|unique/i);
});

test("una comunidad de otro cliente no puede tener el código", async () => {
  await assert.rejects(db.exec(`insert into ${S}.anuncio_codigo (cliente_id, comunidad_id, codigo, anuncio_nombre) values ('${CLI2}', '${COM_A}', 'Z1', 'x')`), /foreign key|violates/i);
});

test("sin sesión (clave pública) no ve ni el catálogo ni los conteos", async () => {
  await assert.rejects(como(db, { rol: "anon" }, (tx) => tx.query(`select * from ${S}.anuncio_codigo`)), /permission denied/i);
  await assert.rejects(como(db, { rol: "anon" }, (tx) => tx.query(`select * from ${S}.entradas_por_anuncio($1::uuid)`, [CLI])), /permission denied/i);
});

test("un usuario del CRM lee el catálogo pero no lo puede modificar", async () => {
  const filas = (await como(db, ctx(), (tx) => tx.query(`select codigo from ${S}.anuncio_codigo`))).rows;
  assert.ok(filas.length >= 1);
  await assert.rejects(como(db, ctx(), (tx) => tx.query(`insert into ${S}.anuncio_codigo (cliente_id, comunidad_id, codigo, anuncio_nombre) values ('${CLI}', '${COM_A}', 'Q1', 'x')`)), /permission denied/i);
});
