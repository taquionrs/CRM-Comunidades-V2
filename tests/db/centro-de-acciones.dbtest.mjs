// Pruebas del centro de acciones (db/045) sobre un Postgres local con TODAS las migraciones del repo. Correr: npm run test:db
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { nuevaBase, como } from "./harness.mjs";

const S = "crm_comunidades_v2";
const CLI = "00000000-0000-0000-0000-0000000000c1", CLI2 = "00000000-0000-0000-0000-0000000000c2";
const BOE = "00000000-0000-0000-0000-0000000000a1", PAL = "00000000-0000-0000-0000-0000000000a2", DEV = "00000000-0000-0000-0000-0000000000a3",
  GEN = "00000000-0000-0000-0000-0000000000a4", OTRA = "00000000-0000-0000-0000-0000000000a5";
let db;
const U = {};

before(async () => {
  db = await nuevaBase();
  await db.exec(`
    set search_path = crm_comunidades_v2, public;
    insert into cliente (id, nombre, slug) values ('${CLI}', 'Cortado', 'cortado'), ('${CLI2}', 'Otro', 'otro');
    insert into comunidad (id, cliente_id, nombre) values ('${BOE}', '${CLI}', 'Boedo'), ('${PAL}', '${CLI}', 'Palermo'), ('${DEV}', '${CLI}', 'Villa Devoto'),
      ('${GEN}', '${CLI}', 'Cortado en Jarrito (general)'), ('${OTRA}', '${CLI2}', 'Otra');
    insert into usuario_crm (email, rol, admin) values ('mkt@taquion.com.ar', 'marketing', false), ('general@taquion.com.ar', 'general', false);
  `);
  for (const email of ["mkt@taquion.com.ar", "general@taquion.com.ar"]) {
    const { rows: [u] } = await db.query(`insert into auth.users (email) values ($1) returning id`, [email]);
    const { rows: [s] } = await db.query(`insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id`, [u.id]);
    U[email.split("@")[0]] = { id: u.id, email, sesion: s.id };
  }
});

const sesion = (k) => ({ rol: "authenticated", claims: { sub: U[k].id, email: U[k].email, session_id: U[k].sesion } });
// Carga de lista completa hace `dias` días. Todos los tiempos son relativos a hoy: las pruebas no dependen de la fecha en que se corran.
const carga = (com, cli, dias, validos, nuevos = 0, salieron = 0, completa = true) =>
  `insert into ${S}.carga_miembros (cliente_id, comunidad_id, cargada_en, numeros_validos, nuevos, salieron, lista_completa)
   values ('${cli}', '${com}', now() - interval '${dias} days', ${validos}, ${nuevos}, ${salieron}, ${completa});`;
const log = (tabla, dias, gasto = 0) =>
  `insert into ${S}.windsor_sync_log (tabla, corrida_en, filas_origen, registros_escritos, filas_sin_comunidad, gasto_sin_comunidad)
   values ('${tabla}', now() - interval '${dias} days', 10, 10, ${gasto > 0 ? 1 : 0}, ${gasto});`;
const sinClas = (tel, dias) =>
  `insert into ${S}.ingreso_sin_clasificar (cliente_id, telefono_id, mensaje, payload, recibido_en) values ('${CLI}', '${tel}', 'hola', '{}', now() - interval '${dias} days');`;

// Cada prueba parte de cero, con un escenario "al día" (todas las comunidades con dos cargas recientes) al que se le cambia lo que haga falta.
const cargasAlDia = (comunidades = [BOE, PAL, DEV, GEN]) => comunidades.map((c) => carga(c, CLI, 12, 10) + carga(c, CLI, 2, 12, 2, 0)).join("\n");
const alDia = () => cargasAlDia() + "\n" + log("windsor_raw.facebook_ads", 0);
async function escenario(sql = "") {
  await db.exec(`delete from ${S}.accion_pospuesta; delete from ${S}.carga_miembros; delete from ${S}.windsor_sync_log;
                 delete from ${S}.ingreso_sin_clasificar; delete from ${S}.evento_crudo;`);
  await db.exec(sql);
}
const acciones = async (k = "mkt", cli = CLI) =>
  (await como(db, sesion(k), (tx) => tx.query(`select * from ${S}.acciones_pendientes($1::uuid)`, [cli]))).rows;
const por = (rows, codigo) => rows.find((r) => r.codigo === codigo);

test("todo al día: no hay nada que completar", async () => {
  await escenario(alDia());
  assert.deepEqual(await acciones(), []);
});

test("varias comunidades sin carga hace más de 8 días son UNA sola acción, con el mensaje ya escrito y las comunidades involucradas", async () => {
  await escenario([PAL, DEV].map((c) => carga(c, CLI, 30, 10) + carga(c, CLI, 22, 12, 2, 0)).join("\n") + carga(BOE, CLI, 12, 10) + carga(BOE, CLI, 2, 12, 2, 0) + carga(GEN, CLI, 12, 10) + carga(GEN, CLI, 2, 12, 2, 0));
  const a = por(await acciones(), "miembros_sin_carga");
  assert.deepEqual(a.comunidades, ["Palermo", "Villa Devoto"]);
  assert.equal(a.comunidad_ids.length, 2);
  assert.equal(a.mensaje, "Cargá la lista de miembros de Palermo y Villa Devoto: llevan 22 días sin actualizarse. Sin eso el CRR queda viejo.");
  assert.equal(a.boton, "Cargar miembros");
  assert.equal(a.destino, "cargar_miembros");
  assert.equal(a.prioridad, 1);
  assert.equal(Number(a.dato), 22);
});

test("con días distintos dice entre cuántos y cuántos; con una sola comunidad dice hace cuántos días", async () => {
  await escenario(carga(PAL, CLI, 30, 10) + carga(PAL, CLI, 22, 12, 2, 0) + carga(DEV, CLI, 20, 10) + carga(DEV, CLI, 15, 12, 2, 0)
    + [BOE, GEN].map((c) => carga(c, CLI, 12, 10) + carga(c, CLI, 2, 12, 2, 0)).join("\n"));
  assert.match(por(await acciones(), "miembros_sin_carga").mensaje, /Palermo y Villa Devoto: llevan entre 15 y 22 días sin actualizarse/);
  await escenario(carga(PAL, CLI, 30, 10) + carga(PAL, CLI, 22, 12, 2, 0) + [BOE, DEV, GEN].map((c) => carga(c, CLI, 12, 10) + carga(c, CLI, 2, 12, 2, 0)).join("\n"));
  assert.equal(por(await acciones(), "miembros_sin_carga").mensaje, "Cargá la lista de Palermo: hace 22 días que no se actualiza. Sin eso el CRR queda viejo.");
});

test("a los 8 días justos todavía no se pide; a los 9 sí", async () => {
  await escenario(cargasAlDia([BOE, DEV, GEN]) + "\n" + carga(PAL, CLI, 20, 10) + carga(PAL, CLI, 8, 12, 2, 0));
  assert.equal(por(await acciones(), "miembros_sin_carga"), undefined);
  await escenario(cargasAlDia([BOE, DEV, GEN]) + "\n" + carga(PAL, CLI, 20, 10) + carga(PAL, CLI, 9, 12, 2, 0));
  assert.ok(por(await acciones(), "miembros_sin_carga"));
});

test("una comunidad con una sola carga reciente pide otra para calcular el CRR; si esa carga es vieja entra en 'sin carga', no en las dos", async () => {
  await escenario([BOE, DEV, GEN].map((c) => carga(c, CLI, 12, 10) + carga(c, CLI, 2, 12, 2, 0)).join("\n") + carga(PAL, CLI, 3, 10));
  const r = await acciones();
  assert.equal(por(r, "miembros_una_carga").mensaje, "Palermo tiene una sola carga de lista completa: cargá otra para calcular su CRR.");
  assert.equal(por(r, "miembros_sin_carga"), undefined);
  await escenario([BOE, DEV, GEN].map((c) => carga(c, CLI, 12, 10) + carga(c, CLI, 2, 12, 2, 0)).join("\n") + carga(PAL, CLI, 20, 10));
  const r2 = await acciones();
  assert.deepEqual(por(r2, "miembros_sin_carga").comunidades, ["Palermo"]);
  assert.equal(por(r2, "miembros_una_carga"), undefined);
});

test("una carga que no es lista completa no cuenta como carga", async () => {
  await escenario([BOE, DEV, GEN].map((c) => carga(c, CLI, 12, 10) + carga(c, CLI, 2, 12, 2, 0)).join("\n") + carga(PAL, CLI, 1, 5, 5, 0, false));
  assert.equal(por(await acciones(), "miembros_sin_cargas").mensaje, "Palermo no tiene ninguna carga de lista completa de miembros: cargala para empezar a medir su CRR.");
});

test("la última carga que no cuadra se avisa, y lleva a ver las cargas", async () => {
  await escenario([BOE, DEV, GEN].map((c) => carga(c, CLI, 12, 10) + carga(c, CLI, 2, 12, 2, 0)).join("\n") + carga(PAL, CLI, 14, 10) + carga(PAL, CLI, 5, 20, 2, 0));
  const a = por(await acciones(), "carga_no_cuadra");
  assert.equal(a.mensaje, "Palermo: la última carga no cuadra (miembros al inicio + nuevos − bajas no da los miembros al final). Revisala antes de confiar en su CRR.");
  assert.equal(a.destino, "consultas");
  assert.equal(a.prioridad, 1);
});

test("Meta sin sincronizar: se pide si la sincronización no corre hace más de 48 horas, aunque no haya gasto nuevo (campañas apagadas)", async () => {
  await escenario(cargasAlDia() + "\n" + log("windsor_raw.facebook_ads", 3));
  const a = por(await acciones(), "meta_sin_sincronizar");
  assert.match(a.mensaje, /^La sincronización con Meta no corre desde el \d{2}\/\d{2}\. Traé los datos a mano\.$/);
  assert.equal(a.destino, "traer_meta");
  await escenario(cargasAlDia() + "\n" + log("windsor_raw.facebook_ads", 1));
  assert.equal(por(await acciones(), "meta_sin_sincronizar"), undefined);
});

test("sin ninguna sincronización registrada no inventa una alerta; las consultas por anuncio no cuentan como sincronización", async () => {
  await escenario(cargasAlDia());
  assert.equal(por(await acciones(), "meta_sin_sincronizar"), undefined);
  await escenario(cargasAlDia() + "\n" + log("windsor_raw.facebook_ads", 5) + log("windsor_raw.anuncios 2026-11-02 a 2026-11-13", 0));
  assert.ok(por(await acciones(), "meta_sin_sincronizar"));
});

test("gasto sin comunidad: avisa el monto de la última sincronización y lleva a Campañas", async () => {
  await escenario(cargasAlDia() + "\n" + log("windsor_raw.facebook_ads", 1, 1500000));
  const a = por(await acciones(), "gasto_sin_comunidad");
  assert.equal(a.mensaje, "Hay $1.500.000 de gasto sin comunidad: un conjunto de anuncios nuevo no está asignado.");
  assert.equal(a.destino, "campanas");
  await escenario(alDia());
  assert.equal(por(await acciones(), "gasto_sin_comunidad"), undefined);
});

test("sin clasificar: desde 3 personas distintas en 7 días; no cuenta a quien ya eligió comunidad ni lo de hace más de 7 días", async () => {
  await escenario(alDia() + sinClas("5491100000001", 1) + sinClas("5491100000001", 2) + sinClas("5491100000002", 3));
  assert.equal(por(await acciones(), "sin_clasificar"), undefined);        // 2 personas distintas
  await escenario(alDia() + sinClas("5491100000001", 1) + sinClas("5491100000002", 2) + sinClas("5491100000003", 3));
  assert.equal(por(await acciones(), "sin_clasificar").mensaje, "3 personas escribieron en los últimos 7 días y no eligieron comunidad.");
  await escenario(alDia() + sinClas("5491100000001", 1) + sinClas("5491100000002", 2) + sinClas("5491100000003", 9));
  assert.equal(por(await acciones(), "sin_clasificar"), undefined);        // la tercera es de hace 9 días
  await escenario(alDia() + sinClas("5491100000001", 1) + sinClas("5491100000002", 2) + sinClas("5491100000003", 3)
    + `insert into ${S}.evento_crudo (cliente_id, comunidad_id, telefono_id, payload) values ('${CLI}', '${BOE}', '5491100000003', '{}');`);
  assert.equal(por(await acciones(), "sin_clasificar"), undefined);        // la tercera ya eligió comunidad
});

test("las acciones salen ordenadas por prioridad", async () => {
  await escenario(carga(PAL, CLI, 30, 10) + carga(PAL, CLI, 22, 12, 2, 0) + carga(DEV, CLI, 3, 10) + carga(BOE, CLI, 12, 10) + carga(BOE, CLI, 2, 12, 2, 0)
    + carga(GEN, CLI, 12, 10) + carga(GEN, CLI, 2, 12, 2, 0) + log("windsor_raw.facebook_ads", 0) + sinClas("5491100000001", 1) + sinClas("5491100000002", 1) + sinClas("5491100000003", 1));
  assert.deepEqual((await acciones()).map((r) => [r.prioridad, r.codigo]), [[1, "miembros_sin_carga"], [2, "miembros_una_carga"], [3, "sin_clasificar"]]);
});

test("posponer deja la acción en silencio hasta la fecha y devuelve cuándo vuelve", async () => {
  await escenario(alDia() + sinClas("5491100000001", 1) + sinClas("5491100000002", 1) + sinClas("5491100000003", 1));
  const antes = await acciones();
  assert.ok(por(antes, "sin_clasificar"));
  const { rows: [r] } = await como(db, sesion("mkt"), (tx) => tx.query(`select ${S}.posponer_accion($1::uuid, 'sin_clasificar', 7, '  Ya lo estoy haciendo  ') as hasta`, [CLI])).then((x) => ({ rows: x.rows }));
  assert.ok(r.hasta);
  // como() deshace todo: se repite en una transacción que sí se queda.
  await db.exec(`select set_config('request.jwt.claims', '', false)`);
  await db.query(`select ${S}.posponer_accion($1::uuid, 'sin_clasificar', 7, '  Ya lo estoy haciendo  ')`, [CLI]);
  assert.equal(por(await acciones(), "sin_clasificar"), undefined);
  const { rows: [p] } = await db.query(`select motivo, por, (hasta - (now() at time zone 'America/Argentina/Buenos_Aires')::date) as dias from ${S}.accion_pospuesta`);
  assert.equal(p.motivo, "Ya lo estoy haciendo");
  assert.equal(p.dias, 7);
});

test("una acción pospuesta vuelve cuando se cumple la fecha, y posponer una no oculta a las otras", async () => {
  await escenario(carga(PAL, CLI, 30, 10) + carga(PAL, CLI, 22, 12, 2, 0) + [BOE, DEV, GEN].map((c) => carga(c, CLI, 12, 10) + carga(c, CLI, 2, 12, 2, 0)).join("\n")
    + log("windsor_raw.facebook_ads", 0) + sinClas("5491100000001", 1) + sinClas("5491100000002", 1) + sinClas("5491100000003", 1));
  await db.exec(`insert into ${S}.accion_pospuesta (cliente_id, codigo, hasta) values ('${CLI}', 'sin_clasificar', (now() at time zone 'America/Argentina/Buenos_Aires')::date)`);
  let r = await acciones();
  assert.equal(por(r, "sin_clasificar"), undefined);                        // hasta hoy inclusive: sigue en silencio
  assert.ok(por(r, "miembros_sin_carga"));                                   // las demás no se ocultan
  await db.exec(`update ${S}.accion_pospuesta set hasta = (now() at time zone 'America/Argentina/Buenos_Aires')::date - 1`);
  r = await acciones();
  assert.ok(por(r, "sin_clasificar"));                                       // ayer venció: vuelve
});

test("posponer valida el código, los días y el rol", async () => {
  const pos = (sql, k = "mkt") => como(db, sesion(k), (tx) => tx.query(sql, [CLI]));
  await assert.rejects(pos(`select ${S}.posponer_accion($1::uuid, 'inventada', 7)`), /no existe/);
  await assert.rejects(pos(`select ${S}.posponer_accion($1::uuid, 'sin_clasificar', 0)`), /entre 1 y 30/);
  await assert.rejects(pos(`select ${S}.posponer_accion($1::uuid, 'sin_clasificar', 31)`), /entre 1 y 30/);
  await assert.rejects(pos(`select ${S}.posponer_accion($1::uuid, 'sin_clasificar', 7)`, "general"), /Marketing/);
  await assert.rejects(como(db, { rol: "anon" }, (tx) => tx.query(`select ${S}.posponer_accion($1::uuid, 'sin_clasificar', 7)`, [CLI])), /permission denied/i);
});

test("no mezcla clientes: lo de otro cliente no aparece", async () => {
  await escenario(alDia() + carga(OTRA, CLI2, 40, 5) + carga(OTRA, CLI2, 30, 6, 1, 0));
  assert.deepEqual(await acciones(), []);
  const o = await acciones("mkt", CLI2);
  assert.deepEqual(por(o, "miembros_sin_carga").comunidades, ["Otra"]);
});

test("es del rol Marketing: un usuario General recibe la lista vacía y la clave pública no puede llamarla", async () => {
  await escenario(carga(PAL, CLI, 30, 10) + carga(PAL, CLI, 22, 12, 2, 0));
  assert.ok((await acciones("mkt")).length > 0);
  assert.equal((await acciones("general")).length, 0);
  await assert.rejects(como(db, { rol: "anon" }, (tx) => tx.query(`select * from ${S}.acciones_pendientes($1::uuid)`, [CLI])), /permission denied/i);
});

test("lista_en_texto: una, dos y tres o más", async () => {
  const q = async (a) => (await db.query(`select ${S}.lista_en_texto($1::text[]) as t`, [a])).rows[0].t;
  assert.equal(await q([]), "");
  assert.equal(await q(["A"]), "A");
  assert.equal(await q(["A", "B"]), "A y B");
  assert.equal(await q(["A", "B", "C"]), "A, B y C");
});
