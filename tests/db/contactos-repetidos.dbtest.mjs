// Pruebas de contactos_repetidos (db/032) sobre un Postgres local con TODAS las migraciones del repo.
// Correr: npm run test:db (necesita npm install: usa @electric-sql/pglite, no toca ninguna base real).
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { nuevaBase, como } from "./harness.mjs";

const S = "crm_comunidades_v2";
const CLI = "00000000-0000-0000-0000-0000000000c1", COM_A = "00000000-0000-0000-0000-0000000000a1", COM_B = "00000000-0000-0000-0000-0000000000a2";
let db;
const U = {};

before(async () => {
  db = await nuevaBase();
  await db.exec(`
    set search_path = crm_comunidades_v2, public;
    insert into cliente (id, nombre, slug) values ('${CLI}', 'Cliente Uno', 'cliente-uno');
    insert into comunidad (id, cliente_id, nombre) values ('${COM_A}', '${CLI}', 'Palermo'), ('${COM_B}', '${CLI}', 'Boedo');
    insert into evento_crudo (cliente_id, comunidad_id, telefono_id, payload, recibido_en) values
      ('${CLI}', '${COM_A}', '5491100000001', '{"contact":{"name":"Prueba Uno"}}', timestamptz '2020-08-01 12:00:00-03'),
      ('${CLI}', '${COM_A}', '5491100000001', '{"contact":{"name":"Prueba Uno"}}', timestamptz '2020-08-01 12:10:00-03'),
      ('${CLI}', '${COM_A}', '5491100000001', '{"contact":{"name":"Prueba Uno B"}}', timestamptz '2020-08-11 12:00:00-03'),
      ('${CLI}', '${COM_A}', '5491100000002', '{}', timestamptz '2020-08-02 09:00:00-03'),
      ('${CLI}', '${COM_B}', '5491100000002', '{}', timestamptz '2020-08-03 09:00:00-03'),
      ('${CLI}', '${COM_A}', '5491100000003', '{}', timestamptz '2020-08-04 09:00:00-03'),
      ('${CLI}', '${COM_B}', 'ig:99999', '{"contact":{"ig_username":"prueba_ig"}}', timestamptz '2020-08-05 09:00:00-03'),
      ('${CLI}', '${COM_B}', 'ig:99999', '{"contact":{"ig_username":"prueba_ig"}}', timestamptz '2020-08-06 09:00:00-03'),
      ('${CLI}', '${COM_A}', '5491100000004', '{}', timestamptz '2020-08-07 23:30:00-03'),
      ('${CLI}', '${COM_A}', '5491100000004', '{}', timestamptz '2020-08-07 23:45:00-03');
    insert into usuario_crm (email, rol, admin) values ('general@taquion.com.ar', 'general', false), ('mkt@taquion.com.ar', 'marketing', false);
  `);
  for (const email of ["general@taquion.com.ar", "mkt@taquion.com.ar"]) {
    const { rows: [u] } = await db.query(`insert into auth.users (email) values ($1) returning id`, [email]);
    const { rows: [s] } = await db.query(`insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id`, [u.id]);
    U[email.split("@")[0]] = { id: u.id, email, sesion: s.id };
  }
});

const sesion = (k) => ({ rol: "authenticated", claims: { sub: U[k].id, email: U[k].email, session_id: U[k].sesion } });
const repetidos = async (ctx, d = "2020-08-01", h = "2020-08-31", com = null, lim = 500) =>
  (await como(db, ctx, (tx) => tx.query(`select ${S}.contactos_repetidos($1::uuid, $2::date, $3::date, $4::uuid, $5::int) as r`, [CLI, d, h, com, lim]))).rows[0].r;

test("resumen: contactos, eventos, repetidos, registros de más, misma comunidad y varias", async () => {
  const { resumen: r, filas } = await repetidos(sesion("mkt"));
  assert.deepEqual([r.contactos, r.eventos, r.contactos_repetidos, r.registros_de_mas, r.misma_comunidad, r.varias_comunidades], [5, 10, 4, 5, 3, 1]);
  assert.equal(filas.length, 4);
});

test("el detalle viene de más a menos veces, con el último nombre, las comunidades y el usuario de Instagram", async () => {
  const { filas } = await repetidos(sesion("mkt"));
  assert.equal(filas[0].telefono_id, "5491100000001");
  assert.equal(filas[0].veces, 3);
  assert.equal(filas[0].nombre, "Prueba Uno B");
  const dos = filas.find((f) => f.telefono_id === "5491100000002");
  assert.equal(dos.n_comunidades, 2);
  assert.deepEqual(dos.comunidades, ["Boedo", "Palermo"]);
  assert.equal(filas.find((f) => f.telefono_id === "ig:99999").usuario_instagram, "prueba_ig");
});

test("con una comunidad elegida solo se cuentan los eventos de esa comunidad", async () => {
  const { resumen: r, filas } = await repetidos(sesion("mkt"), "2020-08-01", "2020-08-31", COM_B);
  assert.equal(r.contactos_repetidos, 1);
  assert.equal(filas[0].telefono_id, "ig:99999");
});

test("las fechas se toman en hora de Buenos Aires", async () => {
  assert.equal((await repetidos(sesion("mkt"), "2020-08-07", "2020-08-07")).resumen.contactos_repetidos, 1);
  assert.equal((await repetidos(sesion("mkt"), "2020-08-08", "2020-08-08")).resumen.eventos, 0);
});

test("el límite recorta las filas pero no el resumen, y sin fechas cuenta toda la historia", async () => {
  const lim = await repetidos(sesion("mkt"), "2020-08-01", "2020-08-31", null, 2);
  assert.equal(lim.filas.length, 2);
  assert.equal(lim.resumen.contactos_repetidos, 4);
  const todo = await repetidos(sesion("mkt"), null, null);
  assert.equal(todo.resumen.contactos_repetidos, 4);
});

test("solo Marketing: General y la clave pública no pueden usarla; la clave de servicio sí", async () => {
  await assert.rejects(repetidos(sesion("general")), /Necesitás el rol Marketing/);
  await assert.rejects(repetidos({ rol: "anon" }), /permission denied/);
  assert.equal((await repetidos({ rol: "service_role" })).resumen.contactos_repetidos, 4);
});
