// Pruebas de las campañas globales del cliente (db/034) sobre un Postgres local con TODAS las migraciones del repo.
// Una campaña global no pertenece a ninguna comunidad: su gasto queda a nivel cliente y NO toca la comunidad "(general)", que es una comunidad real.
// Correr: npm run test:db (necesita npm install: usa @electric-sql/pglite, no toca ninguna base real).
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { nuevaBase, como } from "./harness.mjs";

const S = "crm_comunidades_v2";
const CLI = "00000000-0000-0000-0000-0000000000c1", OTRO = "00000000-0000-0000-0000-0000000000c2";
const PAL = "00000000-0000-0000-0000-0000000000a1", GEN = "00000000-0000-0000-0000-0000000000a2", OT = "00000000-0000-0000-0000-0000000000a3";
const GLOBAL = "TQN_CAMP_GLOBAL_CLIENTE_UNO", BARRIO = "TQN_CAMP_BARRIO_CLIENTE_UNO";
let db;
const U = {};

before(async () => {
  db = await nuevaBase();
  await db.exec(`
    set search_path = crm_comunidades_v2, public;
    create table windsor_raw.facebook_ads ("date" date, account_id text, campaign text, adset_name text, spend numeric, impressions numeric, clicks numeric,
      actions_onsite_conversion_messaging_conversation_started_7d numeric, actions_onsite_conversion_lead_grouped numeric);
    insert into windsor_raw.facebook_ads values
      ('2026-10-20', 'acc', '${GLOBAL}', 'A', 1000, 100, 10, 5, 0), ('2026-10-20', 'acc', '${GLOBAL}', 'B', 500, 50, 5, 2, 0),
      ('2026-10-21', 'acc', '${GLOBAL}', 'A', 300, 30, 3, 1, 0),
      ('2026-10-20', 'acc', '${BARRIO}', 'PALERMO', 200, 20, 2, 1, 0);
    insert into cliente (id, nombre, slug) values ('${CLI}', 'Cliente Uno', 'cliente-uno'), ('${OTRO}', 'Cliente Dos', 'cliente-dos');
    insert into comunidad (id, cliente_id, nombre, miembros_iniciales, miembros_finales) values
      ('${PAL}', '${CLI}', 'Palermo', 10, 12), ('${GEN}', '${CLI}', 'Cliente Uno (general)', 5, 8), ('${OT}', '${OTRO}', 'Otra', 1, 1);
    insert into usuario_crm (email, rol, admin) values ('general@taquion.com.ar', 'general', false), ('mkt@taquion.com.ar', 'marketing', false);
  `);
  for (const email of ["general@taquion.com.ar", "mkt@taquion.com.ar"]) {
    const { rows: [u] } = await db.query(`insert into auth.users (email) values ($1) returning id`, [email]);
    const { rows: [s] } = await db.query(`insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id`, [u.id]);
    U[email.split("@")[0]] = { id: u.id, email, sesion: s.id };
  }
});

const sesion = (k) => ({ rol: "authenticated", claims: { sub: U[k].id, email: U[k].email, session_id: U[k].sesion } });
const SERVICIO = { rol: "service_role" };
const q = (ctx, sql, params = []) => como(db, ctx, (tx) => tx.query(sql, params)).then((r) => r.rows);
// Las lecturas (q) se deshacen solas; guardar necesita CONFIRMAR la transacción, como el panel, para que la regla quede.
const persistente = (ctx, fn) => db.transaction(async (tx) => {
  await tx.exec(`set local role ${ctx.rol}`);
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: ctx.rol, ...(ctx.claims || {}) })]);
  return fn(tx);
});
const guardar = (ctx, camp, adset, accion, comunidad = null, cliente = null) =>
  persistente(ctx, (tx) => tx.query(`select ${S}.guardar_regla_campana($1, $2, $3, $4::uuid, null, 'prueba', $5::uuid)`, [camp, adset, accion, comunidad, cliente]));
// Como lo corre la tarea diaria (pg_cron, con el usuario dueño de la base), que sí puede leer windsor_raw.
const sincronizar = () => db.query(`select * from ${S}.sincronizar_meta_desde_windsor('windsor_raw.facebook_ads')`);
const globalDia = () => q(SERVICIO, `select fecha::text as fecha, inversion::float as inversion, conversaciones_meta from ${S}.meta_ads_metrica_global where cliente_id = '${CLI}' order by fecha`);
const metricaComunidad = (c) => q(SERVICIO, `select fecha::text as fecha, inversion::float as inversion from ${S}.meta_ads_metrica where comunidad_id = '${c}' order by fecha`);

test("una campaña global del cliente suma a nivel cliente y no a ninguna comunidad (ni a la (general))", async () => {
  await guardar(sesion("mkt"), GLOBAL, null, "cuenta_global", null, CLI);
  await guardar(sesion("mkt"), BARRIO, "PALERMO", "cuenta", PAL);
  await sincronizar();
  assert.deepEqual(await globalDia(), [{ fecha: "2026-10-20", inversion: 1500, conversaciones_meta: 7 }, { fecha: "2026-10-21", inversion: 300, conversaciones_meta: 1 }]);
  assert.deepEqual(await metricaComunidad(GEN), []);      // la (general) no recibe nada: es una comunidad real
  assert.deepEqual(await metricaComunidad(PAL), [{ fecha: "2026-10-20", inversion: 200 }]);   // lo que apunta a un barrio sigue igual
});

test("el detalle por campaña guarda lo global sin comunidad y el desglose lo nombra", async () => {
  const filas = await q(SERVICIO, `select comunidad_id, adset, inversion::float as inversion from ${S}.ads_campana_dia where campana = '${GLOBAL}' order by fecha, adset`);
  assert.equal(filas.length, 3);
  assert.ok(filas.every((f) => f.comunidad_id === null));
  const d = await q(sesion("mkt"), `select campana, comunidad_nombre, inversion::float as inversion from ${S}.desglose_campanas('${CLI}', null, null, null) order by inversion desc`);
  const g = d.filter((x) => x.campana === GLOBAL);
  assert.ok(g.every((x) => x.comunidad_nombre === "Campañas globales (sin comunidad)"));
  assert.equal(g.reduce((s, x) => s + x.inversion, 0), 1800);   // los dos conjuntos juntos
  assert.equal(d.find((x) => x.campana === BARRIO).comunidad_nombre, "Palermo");
});

test("metricas_globales_cliente: Marketing ve la inversión; General solo los conteos; sin sesión nada", async () => {
  const [m] = await q(sesion("mkt"), `select * from ${S}.metricas_globales_cliente('${CLI}', null, null)`);
  assert.deepEqual([Number(m.inversion), Number(m.conversaciones_meta), Number(m.clics)], [1800, 8, 18]);
  const [g] = await q(sesion("general"), `select * from ${S}.metricas_globales_cliente('${CLI}', null, null)`);
  assert.equal(g.inversion, null);
  assert.equal(Number(g.conversaciones_meta), 8);
  const [rango] = await q(sesion("mkt"), `select * from ${S}.metricas_globales_cliente('${CLI}', '2026-10-21', '2026-10-21')`);
  assert.equal(Number(rango.inversion), 300);
  await assert.rejects(q({ rol: "anon" }, `select * from ${S}.metricas_globales_cliente('${CLI}', null, null)`), /permission denied/);
  await assert.rejects(q({ rol: "anon" }, `select * from ${S}.meta_ads_metrica_global`), /permission denied/);
  await assert.rejects(q(sesion("general"), `select * from ${S}.meta_ads_metrica_global`).then((r) => { if (r.length === 0) throw new Error("permission denied (sin filas)"); }), /permission denied/);
});

test("la regla global se ve en la lista de campañas, sin comunidad", async () => {
  const f = await q(sesion("mkt"), `select campana, adset, cliente_id, comunidad_id, cuenta from ${S}.campanas_windsor(90, 'windsor_raw.facebook_ads') where campana = '${GLOBAL}'`);
  assert.equal(f.length, 2);
  assert.ok(f.every((x) => x.cliente_id === CLI && x.comunidad_id === null && x.cuenta === true));
});

test("pasar la campaña a una comunidad concreta mueve el gasto y limpia lo global; sin asignar lo saca de todos lados", async () => {
  await guardar(sesion("mkt"), GLOBAL, null, "cuenta", PAL);
  await sincronizar();
  assert.deepEqual(await globalDia(), []);
  assert.deepEqual((await metricaComunidad(PAL)).map((x) => x.inversion), [1700, 300]);   // 200 del barrio + 1500 el 20/10, y 300 el 21/10
  await guardar(sesion("mkt"), GLOBAL, null, "cuenta_global", null, CLI);
  await sincronizar();
  assert.equal((await globalDia()).length, 2);
  assert.deepEqual(await metricaComunidad(PAL), [{ fecha: "2026-10-20", inversion: 200 }]);
  await guardar(sesion("mkt"), GLOBAL, null, "sin_asignar");
  await sincronizar();
  assert.deepEqual(await globalDia(), []);
  assert.equal((await q(SERVICIO, `select count(*)::int as n from ${S}.ads_campana_dia where campana = '${GLOBAL}'`))[0].n, 0);
});

test("el historial registra la acción y se validan los datos", async () => {
  await guardar(sesion("mkt"), GLOBAL, null, "cuenta_global", null, CLI);
  const h = await q(SERVICIO, `select accion, destino from ${S}.campania_regla_historial where accion = 'cuenta_global' order by cambiado_en desc limit 1`);
  assert.equal(h[0].destino, "Cliente Uno / campañas globales (sin comunidad)");
  await assert.rejects(guardar(sesion("mkt"), GLOBAL, null, "cuenta_global"), /Elegí el cliente/);
  await assert.rejects(guardar(sesion("mkt"), GLOBAL, null, "cuenta_global", null, "00000000-0000-0000-0000-00000000dead"), /no existe/);
  await assert.rejects(guardar(sesion("mkt"), "CAMPAÑA_QUE_NO_EXISTE", null, "cuenta_global", null, CLI), /no existe en los datos de Windsor/);
  await assert.rejects(guardar(sesion("mkt"), GLOBAL, null, "inventada", null, CLI), /Acción inválida/);
});

test("solo Marketing puede asignarla; la clave pública y el rol General no", async () => {
  await assert.rejects(guardar(sesion("general"), GLOBAL, null, "cuenta_global", null, CLI), /Necesitás el rol Marketing/);
  await assert.rejects(guardar({ rol: "anon" }, GLOBAL, null, "cuenta_global", null, CLI), /permission denied/);
});

test("lo de otro cliente no se toca al limpiar", async () => {
  await db.exec(`insert into ${S}.meta_ads_metrica_global (cliente_id, fecha, inversion) values ('${OTRO}', '2026-10-20', 777)`);
  await guardar(sesion("mkt"), GLOBAL, null, "cuenta_global", null, CLI);
  await sincronizar();
  const otro = await q(SERVICIO, `select inversion::float as inversion from ${S}.meta_ads_metrica_global where cliente_id = '${OTRO}'`);
  assert.deepEqual(otro, [{ inversion: 777 }]);   // sin reglas en Windsor para ese cliente: no se limpia
});
