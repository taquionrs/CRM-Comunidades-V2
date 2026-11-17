// Pruebas de frescura_miembros (db/049) sobre un Postgres local con TODAS las migraciones del repo. Correr: npm run test:db
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { nuevaBase, como } from "./harness.mjs";

const S = "crm_comunidades_v2";
const CLI = "00000000-0000-0000-0000-0000000000c1", CLI2 = "00000000-0000-0000-0000-0000000000c2";
const PAL = "00000000-0000-0000-0000-0000000000a2", DEV = "00000000-0000-0000-0000-0000000000a3", GEN = "00000000-0000-0000-0000-0000000000a9", OTRA = "00000000-0000-0000-0000-0000000000a4";
let db, U;

before(async () => {
  db = await nuevaBase();
  await db.exec(`
    set search_path = crm_comunidades_v2, public;
    insert into cliente (id, nombre, slug) values ('${CLI}', 'Cortado', 'cortado'), ('${CLI2}', 'Otro', 'otro');
    insert into comunidad (id, cliente_id, nombre, oculta) values ('${PAL}', '${CLI}', 'Palermo', false), ('${DEV}', '${CLI}', 'Villa Devoto', false),
      ('${GEN}', '${CLI}', 'Cortado en Jarrito (general)', true), ('${OTRA}', '${CLI2}', 'Otra', false);
    insert into carga_miembros (cliente_id, comunidad_id, cargada_en, numeros_validos, nuevos, salieron, lista_completa) values
      ('${CLI}', '${PAL}', now() - interval '20 days', 30, 30, 0, true),
      ('${CLI}', '${PAL}', now() - interval '3 days', 33, 4, 1, true),
      ('${CLI}', '${PAL}', now() - interval '1 day', 99, 99, 0, false),      -- una carga que no es de lista completa no cuenta
      ('${CLI}', '${GEN}', now() - interval '2 days', 10, 10, 0, true),
      ('${CLI2}', '${OTRA}', now() - interval '1 day', 5, 5, 0, true);
    insert into usuario_crm (email, rol, admin) values ('general@taquion.com.ar', 'general', false);
  `);
  const { rows: [u] } = await db.query(`insert into auth.users (email) values ('general@taquion.com.ar') returning id`);
  const { rows: [s] } = await db.query(`insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id`, [u.id]);
  U = { id: u.id, email: "general@taquion.com.ar", sesion: s.id };
});

const sesion = () => ({ rol: "authenticated", claims: { sub: U.id, email: U.email, session_id: U.sesion } });
const consulta = async () => (await como(db, sesion(), (tx) => tx.query(`select * from ${S}.frescura_miembros($1::uuid)`, [CLI]))).rows;

test("trae la última carga de lista completa y los días de cada comunidad visible", async () => {
  const filas = await consulta();
  const pal = filas.find((f) => f.comunidad_id === PAL);
  assert.equal(pal.dias, 3);   // ignora la carga de ayer que no es de lista completa
});

test("una comunidad sin ninguna carga viene con null (no con 0)", async () => {
  const dev = (await consulta()).find((f) => f.comunidad_id === DEV);
  assert.equal(dev.ultima_carga, null);
  assert.equal(dev.dias, null);
});

test("no trae las comunidades ocultas ni las de otro cliente", async () => {
  const ids = (await consulta()).map((f) => f.comunidad_id).sort();
  assert.deepEqual(ids, [DEV, PAL].sort());
});

test("sin sesión de usuario del CRM no devuelve nada", async () => {
  const r = await como(db, { rol: "anon" }, async (tx) => { try { return (await tx.query(`select * from ${S}.frescura_miembros($1::uuid)`, [CLI])).rows; } catch (e) { return "denegado"; } });
  assert.ok(r === "denegado" || r.length === 0);
});
