// Pruebas de las consultas generales en entradas_flow_cliente (db/050) sobre un Postgres local con TODAS las migraciones del repo. Correr: npm run test:db
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { nuevaBase, como } from "./harness.mjs";

const S = "crm_comunidades_v2";
const CLI = "00000000-0000-0000-0000-0000000000c1", CLI2 = "00000000-0000-0000-0000-0000000000c2";
const PAL = "00000000-0000-0000-0000-0000000000a2", OTRA = "00000000-0000-0000-0000-0000000000a4";
let db, U;

before(async () => {
  db = await nuevaBase();
  await db.exec(`
    set search_path = crm_comunidades_v2, public;
    insert into cliente (id, nombre, slug) values ('${CLI}', 'Cortado', 'cortado'), ('${CLI2}', 'Otro', 'otro');
    insert into comunidad (id, cliente_id, nombre) values ('${PAL}', '${CLI}', 'Palermo'), ('${OTRA}', '${CLI2}', 'Otra');
    -- Con comunidad: 0001 (preguntó antes y después eligió), 0002 (eligió directo), ig:55555 (Instagram, eligió directo).
    insert into evento_crudo (cliente_id, comunidad_id, telefono_id, payload, recibido_en) values
      ('${CLI}', '${PAL}', '5491100000001', '{}', timestamptz '2026-11-12 12:00:00-03'),
      ('${CLI}', '${PAL}', '5491100000002', '{}', timestamptz '2026-11-12 12:00:00-03'),
      ('${CLI}', '${PAL}', 'ig:55555',      '{}', timestamptz '2026-11-12 12:00:00-03');
    -- Consultas generales: 0001 (después registrada) · 0003 (avisó dos veces: cuenta una) · ig:77777 (Instagram, sin registrar) · 0004 (fuera del período)
    -- y una persona de otro cliente que no debe aparecer.
    insert into ingreso_sin_clasificar (cliente_id, telefono_id, mensaje, payload, recibido_en) values
      ('${CLI}', '5491100000001', 'Hola, info', '{}', timestamptz '2026-11-11 10:00:00-03'),
      ('${CLI}', '5491100000003', 'Hola, info', '{}', timestamptz '2026-11-13 10:00:00-03'),
      ('${CLI}', '5491100000003', 'hola', '{}', timestamptz '2026-11-13 11:00:00-03'),
      ('${CLI}', 'ig:77777', 'info', '{}', timestamptz '2026-11-14 10:00:00-03'),
      ('${CLI}', '5491100000004', 'info', '{}', timestamptz '2026-10-01 10:00:00-03'),
      ('${CLI2}', '5491100000099', 'info', '{}', timestamptz '2026-11-13 10:00:00-03');
    insert into usuario_crm (email, rol, admin) values ('general@taquion.com.ar', 'general', false);
  `);
  const { rows: [u] } = await db.query(`insert into auth.users (email) values ('general@taquion.com.ar') returning id`);
  const { rows: [s] } = await db.query(`insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id`, [u.id]);
  U = { id: u.id, email: "general@taquion.com.ar", sesion: s.id };
});

const sesion = () => ({ rol: "authenticated", claims: { sub: U.id, email: U.email, session_id: U.sesion } });
const q = async (desde = null, hasta = null, canal = "todos") =>
  (await como(db, sesion(), (tx) => tx.query(`select * from ${S}.entradas_flow_cliente($1::uuid, $2::date, $3::date, $4)`, [CLI, desde, hasta, canal]))).rows[0];
const n = (r) => [r.clasificadas, r.sin_clasificar, r.total, r.consultas_generales, r.consultas_registradas].map(Number);

test("todo el histórico: 4 consultas generales (0001, 0003, ig:77777 y 0004), 3 sin registrar y 1 registrada", async () => {
  assert.deepEqual(n(await q()), [3, 3, 6, 4, 1]);   // clasificadas 3 · sin registrar 3 · total 6 · consultas 4 · registradas 1
});

test("las consultas registradas ya están dentro de las clasificadas: el total no las cuenta dos veces", async () => {
  const r = await q();
  assert.equal(Number(r.total), Number(r.clasificadas) + Number(r.sin_clasificar));
  assert.equal(Number(r.consultas_generales), Number(r.sin_clasificar) + Number(r.consultas_registradas));
});

test("respeta el período: solo las consultas con aviso dentro de las fechas", async () => {
  assert.deepEqual(n(await q("2026-11-10", "2026-11-30")), [3, 2, 5, 3, 1]);
  assert.deepEqual(n(await q("2026-12-01", "2026-12-31")), [0, 0, 0, 0, 0]);
});

test("respeta el canal: WhatsApp e Instagram por separado", async () => {
  assert.deepEqual(n(await q("2026-11-10", "2026-11-30", "whatsapp")), [2, 1, 3, 2, 1]);
  assert.deepEqual(n(await q("2026-11-10", "2026-11-30", "instagram")), [1, 1, 2, 1, 0]);
});

test("no mezcla clientes", async () => {
  assert.ok(Number((await q()).consultas_generales) < 5);
});

test("sin sesión de usuario del CRM no devuelve nada", async () => {
  const r = await como(db, { rol: "anon" }, async (tx) => { try { return (await tx.query(`select * from ${S}.entradas_flow_cliente($1::uuid)`, [CLI])).rows; } catch (e) { return "denegado"; } });
  assert.ok(r === "denegado" || r.length === 0);
});
