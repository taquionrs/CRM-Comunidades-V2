// Pruebas de ingreso_sin_clasificar y entradas_flow_cliente (db/035) sobre un Postgres local con TODAS las migraciones del repo.
// Correr: npm run test:db (necesita npm install: usa @electric-sql/pglite, no toca ninguna base real).
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
    insert into cliente (id, nombre, slug) values ('${CLI}', 'Cliente Uno', 'cliente-uno'), ('${CLI2}', 'Cliente Dos', 'cliente-dos');
    insert into comunidad (id, cliente_id, nombre) values ('${COM_A}', '${CLI}', 'Palermo'), ('${COM_B}', '${CLI}', 'Boedo');
    -- Personas con comunidad (primer contacto): 0001 (también tocó otra comunidad después), 0002 e ig:55555.
    insert into evento_crudo (cliente_id, comunidad_id, telefono_id, payload, recibido_en) values
      ('${CLI}', '${COM_A}', '5491100000001', '{}', timestamptz '2020-09-01 12:00:00-03'),
      ('${CLI}', '${COM_B}', '5491100000001', '{}', timestamptz '2020-09-02 12:00:00-03'),
      ('${CLI}', '${COM_B}', '5491100000002', '{}', timestamptz '2020-09-03 12:00:00-03'),
      ('${CLI}', '${COM_A}', 'ig:55555',       '{}', timestamptz '2020-09-04 12:00:00-03');
    -- Avisos sin clasificar:
    --   0001 avisó ANTES de elegir comunidad (ya está clasificada: no queda pendiente)
    --   0003 avisó dos veces (cuenta una sola vez) · 0004 avisó más tarde · 0005 avisó a las 23:30 hora de Buenos Aires
    --   ig:77777 es una persona de Instagram
    insert into ingreso_sin_clasificar (cliente_id, telefono_id, mensaje, payload, recibido_en) values
      ('${CLI}', '5491100000001', '¡Hola! Quiero más información', '{}', timestamptz '2020-08-31 10:00:00-03'),
      ('${CLI}', '5491100000003', '¡Hola! Quiero más información', '{"contact":{"first_name":"Beatriz"}}', timestamptz '2020-09-02 10:00:00-03'),
      ('${CLI}', '5491100000003', 'hola', '{}', timestamptz '2020-09-02 11:00:00-03'),
      ('${CLI}', '5491100000004', 'info', '{}', timestamptz '2020-09-10 09:00:00-03'),
      ('${CLI}', 'ig:77777', null, '{}', timestamptz '2020-09-02 12:00:00-03'),
      ('${CLI}', '5491100000005', 'buenas', '{}', timestamptz '2020-09-02 23:30:00-03');
    insert into usuario_crm (email, rol, admin) values ('general@taquion.com.ar', 'general', false), ('mkt@taquion.com.ar', 'marketing', false);
  `);
  for (const email of ["general@taquion.com.ar", "mkt@taquion.com.ar"]) {
    const { rows: [u] } = await db.query(`insert into auth.users (email) values ($1) returning id`, [email]);
    const { rows: [s] } = await db.query(`insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id`, [u.id]);
    U[email.split("@")[0]] = { id: u.id, email, sesion: s.id };
  }
});

const sesion = (k) => ({ rol: "authenticated", claims: { sub: U[k].id, email: U[k].email, session_id: U[k].sesion } });
const entradas = async (ctx, cli = CLI, d = null, h = null, canal = null) =>
  (await como(db, ctx, (tx) => tx.query(`select * from ${S}.entradas_flow_cliente($1::uuid, $2::date, $3::date, $4::text)`, [cli, d, h, canal]))).rows;
const num = (r) => [Number(r.clasificadas), Number(r.sin_clasificar), Number(r.total), r.tasa_clasificacion_pct == null ? null : Number(r.tasa_clasificacion_pct)];

test("toda la historia: 3 clasificadas, 4 sin clasificar (la persona que ya eligió comunidad no cuenta) y tasa de 42,86 %", async () => {
  const [r] = await entradas(sesion("mkt"));
  assert.deepEqual(num(r), [3, 4, 7, 42.86]);
  assert.equal(r.hay_registro, true);
});

test("dos avisos de la misma persona cuentan una sola vez", async () => {
  // 0003 avisó dos veces el 02/09 y no tiene comunidad: en el día 02/09 hay 3 personas (0003, ig:77777 y 0005), no 4.
  const [r] = await entradas(sesion("mkt"), CLI, "2020-09-02", "2020-09-02");
  assert.equal(Number(r.sin_clasificar), 3);
});

test("el período se toma en hora de Buenos Aires: el aviso de las 23:30 es del 02/09 y no del 03/09", async () => {
  const [dia3] = await entradas(sesion("mkt"), CLI, "2020-09-03", "2020-09-03");
  assert.deepEqual(num(dia3), [1, 0, 1, 100]);   // solo 0002 eligió comunidad ese día
  const [rango] = await entradas(sesion("mkt"), CLI, "2020-09-01", "2020-09-03");
  assert.deepEqual(num(rango), [2, 3, 5, 40]);
});

test("el filtro de canal separa WhatsApp e Instagram", async () => {
  assert.deepEqual(num((await entradas(sesion("mkt"), CLI, null, null, "whatsapp"))[0]), [2, 3, 5, 40]);
  assert.deepEqual(num((await entradas(sesion("mkt"), CLI, null, null, "instagram"))[0]), [1, 1, 2, 50]);
  assert.deepEqual(num((await entradas(sesion("mkt"), CLI, null, null, "todos"))[0]), [3, 4, 7, 42.86]);
});

test("un cliente sin ningún aviso: hay_registro es false y la tasa queda vacía", async () => {
  const [r] = await entradas(sesion("mkt"), CLI2);
  assert.equal(r.hay_registro, false);
  assert.deepEqual(num(r), [0, 0, 0, null]);
});

test("el aviso sin clasificar NO cambia la atribución de primer contacto ni los clics únicos", async () => {
  const { rows } = await db.query(`select telefono_id, comunidad_atribuida_id from ${S}.evento_deduplicado where cliente_id = $1 order by telefono_id`, [CLI]);
  assert.equal(rows.length, 3);   // 0001, 0002 e ig:55555: ningún sin clasificar entra
  assert.equal(rows.find((x) => x.telefono_id === "5491100000001").comunidad_atribuida_id, COM_A);
  // Los clics únicos que ve el panel (Control_Comunidades) siguen siendo las 3 personas con comunidad.
  const filas = (await como(db, sesion("mkt"), (tx) => tx.query(`select clics_unicos from ${S}.comunidad_performance_rango($1::uuid, null, null, 'todos')`, [CLI]))).rows;
  assert.equal(filas.reduce((s, f) => s + Number(f.clics_unicos), 0), 3);
});

test("rol General: ve los conteos pero no puede leer las filas (llevan el teléfono)", async () => {
  const [r] = await entradas(sesion("general"));
  assert.deepEqual(num(r), [3, 4, 7, 42.86]);
  const filas = (await como(db, sesion("general"), (tx) => tx.query(`select * from ${S}.ingreso_sin_clasificar`))).rows;
  assert.equal(filas.length, 0);
});

test("rol Marketing: lee las filas con el mensaje y el contenido del POST", async () => {
  const filas = (await como(db, sesion("mkt"), (tx) => tx.query(`select telefono_id, mensaje from ${S}.ingreso_sin_clasificar order by recibido_en`))).rows;
  assert.equal(filas.length, 6);
  assert.equal(filas[1].mensaje, "¡Hola! Quiero más información");
});

test("sin sesión (anon): ni la función ni la tabla", async () => {
  await assert.rejects(como(db, { rol: "anon" }, (tx) => tx.query(`select * from ${S}.entradas_flow_cliente($1::uuid)`, [CLI])), /permission denied/i);
  await assert.rejects(como(db, { rol: "anon" }, (tx) => tx.query(`select * from ${S}.ingreso_sin_clasificar`)), /permission denied/i);
});

test("usuario autenticado que no está en el CRM no ve ningún conteo", async () => {
  const { rows: [u] } = await db.query(`insert into auth.users (email) values ('intruso@taquion.com.ar') returning id`);
  const { rows: [s] } = await db.query(`insert into auth.sessions (user_id, created_at) values ($1, now()) returning id`, [u.id]);
  const rows = await entradas({ rol: "authenticated", claims: { sub: u.id, email: "intruso@taquion.com.ar", session_id: s.id } });
  assert.equal(rows.length, 0);
});

test("conexión directa (SQL Editor, sin sesión) y clave de servicio ven los conteos, como en el resto de las funciones", async () => {
  const directa = (await db.query(`select * from ${S}.entradas_flow_cliente($1::uuid)`, [CLI])).rows;
  assert.deepEqual(num(directa[0]), [3, 4, 7, 42.86]);
  const servicio = await entradas({ rol: "service_role" });
  assert.deepEqual(num(servicio[0]), [3, 4, 7, 42.86]);
});

test("el webhook (service_role) puede guardar un aviso, y ningún usuario del panel puede escribir", async () => {
  await como(db, { rol: "service_role" }, (tx) =>
    tx.query(`insert into ${S}.ingreso_sin_clasificar (cliente_id, telefono_id, mensaje, payload) values ($1, '5491100000099', 'x', '{}')`, [CLI]));
  await assert.rejects(como(db, sesion("mkt"), (tx) =>
    tx.query(`insert into ${S}.ingreso_sin_clasificar (cliente_id, telefono_id) values ($1, '5491100000098')`, [CLI])), /permission denied/i);
  await assert.rejects(como(db, sesion("mkt"), (tx) => tx.query(`delete from ${S}.ingreso_sin_clasificar`)), /permission denied/i);
});

test("la migración se puede correr dos veces sin error (idempotente)", async () => {
  const fs = await import("node:fs");
  const sql = fs.readFileSync(new URL("../../db/035_ingresos_sin_clasificar.sql", import.meta.url), "utf8");
  await db.exec(sql);
  const [r] = await entradas(sesion("mkt"));
  assert.equal(Number(r.total), 7);
});
