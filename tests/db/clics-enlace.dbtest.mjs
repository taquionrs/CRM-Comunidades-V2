// Pruebas de los clics en el enlace de Meta (db/036) sobre un Postgres local con TODAS las migraciones del repo.
// Correr: npm run test:db (usa @electric-sql/pglite, no toca ninguna base real).
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { nuevaBase, como } from "./harness.mjs";

const S = "crm_comunidades_v2";
const CLI = "00000000-0000-0000-0000-0000000000c1";
const COM_A = "00000000-0000-0000-0000-0000000000a1";
let db;
const U = {};
let D1, D2, D3;

before(async () => {
  db = await nuevaBase();
  const { rows: [f] } = await db.query(`select (current_date - 3)::text as d1, (current_date - 2)::text as d2, (current_date - 1)::text as d3`);
  ({ d1: D1, d2: D2, d3: D3 } = f);
  await db.exec(`
    set search_path = crm_comunidades_v2, public;
    insert into cliente (id, nombre, slug) values ('${CLI}', 'Cliente Uno', 'cliente-uno');
    insert into comunidad (id, cliente_id, nombre) values ('${COM_A}', '${CLI}', 'Boedo');
    insert into comunidad_meta_origen (cliente_id, comunidad_id, campana_nombre, adset_nombre, cuenta) values
      ('${CLI}', '${COM_A}', 'CAMP_WSP', 'ADSET_BOEDO', true),
      ('${CLI}', null, 'CAMP_GLOBAL', null, true);
    insert into usuario_crm (email, rol, admin) values ('general@taquion.com.ar', 'general', false), ('mkt@taquion.com.ar', 'marketing', false);
  `);
  for (const email of ["general@taquion.com.ar", "mkt@taquion.com.ar"]) {
    const { rows: [u] } = await db.query(`insert into auth.users (email) values ($1) returning id`, [email]);
    const { rows: [s] } = await db.query(`insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id`, [u.id]);
    U[email.split("@")[0]] = { id: u.id, email, sesion: s.id };
  }
  // "Traer de Meta ahora": 3 días de la campaña de Boedo (el 3.º sin clics en el enlace) y 2 de una global (la 2.ª sin el dato).
  const filas = [
    { d: D1, account_id: null, campaign: "CAMP_WSP", adset_name: "ADSET_BOEDO", spend: "100", impressions: "1000", clicks: "40", lc: "30", conv: "5", leads: "0" },
    { d: D2, account_id: null, campaign: "CAMP_WSP", adset_name: "ADSET_BOEDO", spend: "200", impressions: "2000", clicks: "80", lc: "70", conv: "9", leads: "0" },
    { d: D3, account_id: null, campaign: "CAMP_WSP", adset_name: "ADSET_BOEDO", spend: "300", impressions: "3000", clicks: "90", conv: "3", leads: "0" },
    { d: D1, account_id: null, campaign: "CAMP_GLOBAL", adset_name: "X", spend: "50", impressions: "500", clicks: "20", lc: "10", conv: "2", leads: "0" },
    { d: D3, account_id: null, campaign: "CAMP_GLOBAL", adset_name: "X", spend: "70", impressions: "700", clicks: "25", conv: "1", leads: "0" },
  ];
  await db.query(`select * from ${S}.meta_en_vivo_aplicar($1::jsonb, current_date - 3, current_date - 1)`, [JSON.stringify(filas)]);
});

const sesion = (k) => ({ rol: "authenticated", claims: { sub: U[k].id, email: U[k].email, session_id: U[k].sesion } });
const matriz = async (ctx) =>
  (await como(db, ctx, (tx) => tx.query(`select * from ${S}.comunidad_performance_rango($1::uuid, null, null, 'todos')`, [CLI]))).rows[0];

test("Traer de Meta ahora: guarda los clics en el enlace de cada día y un día sin el dato queda en NULL, no en 0", async () => {
  const { rows } = await db.query(`select fecha::text, clics, clics_enlace from ${S}.meta_ads_metrica where comunidad_id = $1 order by fecha`, [COM_A]);
  assert.deepEqual(rows.map((r) => [r.fecha, r.clics, r.clics_enlace]), [[D1, 40, 30], [D2, 80, 70], [D3, 90, null]]);
});

test("la matriz suma los clics en el enlace y calcula CTR y CPC solo con los días que traen el dato", async () => {
  const r = await matriz(sesion("mkt"));
  assert.equal(Number(r.clics_enlace), 100);
  assert.equal(Number(r.clics), 210, "todos los clics siguen aparte");
  assert.equal(Number(r.dias_sin_clics_enlace), 1);
  assert.equal(Number(r.ctr_enlace_pct), 3.33);   // 100 ÷ (1000 + 2000) impresiones, sin el día incompleto
  assert.equal(Number(r.cpc_enlace), 3);          // (100 + 200) ÷ 100 clics
  assert.equal(Number(r.ctr_anuncio_pct), 3.5);   // el CTR de todos los clics no cambia: 210 ÷ 6000
});

test("el rol General ve los clics en el enlace pero no el costo por clic (plata)", async () => {
  const r = await matriz(sesion("general"));
  assert.equal(Number(r.clics_enlace), 100);
  assert.equal(r.cpc_enlace, null);
  assert.equal(r.inversion, null);
});

test("una comunidad sin ninguna carga de Meta devuelve clics_enlace NULL, no 0", async () => {
  await db.exec(`insert into ${S}.comunidad (id, cliente_id, nombre) values ('00000000-0000-0000-0000-0000000000a2', '${CLI}', 'Devoto')`);
  const { rows } = await como(db, sesion("mkt"), (tx) => tx.query(`select nombre, clics_enlace, ctr_enlace_pct, dias_sin_clics_enlace from ${S}.comunidad_performance_rango($1::uuid, null, null, 'todos') order by nombre`, [CLI]));
  const devoto = rows.find((r) => r.nombre === "Devoto");
  assert.equal(devoto.clics_enlace, null);
  assert.equal(devoto.ctr_enlace_pct, null);
  assert.equal(Number(devoto.dias_sin_clics_enlace), 0);
});

test("las campañas globales también guardan los clics en el enlace", async () => {
  const [g] = (await como(db, sesion("mkt"), (tx) => tx.query(`select * from ${S}.metricas_globales_cliente($1::uuid, null, null)`, [CLI]))).rows;
  assert.equal(Number(g.clics), 45);
  assert.equal(Number(g.clics_enlace), 10);
  assert.equal(Number(g.impresiones_enlace), 500);
  assert.equal(Number(g.inversion_enlace), 50);
});

test("el desglose por campaña trae los clics en el enlace (solo Marketing)", async () => {
  const filas = (await como(db, sesion("mkt"), (tx) => tx.query(`select campana, clics, clics_enlace from ${S}.desglose_campanas($1::uuid, null, null, null) order by campana`, [CLI]))).rows;
  assert.deepEqual(filas.map((f) => [f.campana, Number(f.clics), f.clics_enlace == null ? null : Number(f.clics_enlace)]), [["CAMP_GLOBAL", 45, 10], ["CAMP_WSP", 210, 100]]);
  await assert.rejects(como(db, sesion("general"), (tx) => tx.query(`select * from ${S}.desglose_campanas($1::uuid, null, null, null)`, [CLI])));
});

test("el desglose trae las impresiones de los días con clics en el enlace (base del CTR del enlace, db/037)", async () => {
  const filas = (await como(db, sesion("mkt"), (tx) => tx.query(`select campana, impresiones, impresiones_enlace from ${S}.desglose_campanas($1::uuid, null, null, null) order by campana`, [CLI]))).rows;
  // CAMP_WSP: 6.000 impresiones en 3 días, pero solo 3.000 (D1 y D2) traen clics en el enlace; CAMP_GLOBAL: 1.200 en total y 500 con el dato.
  assert.deepEqual(filas.map((f) => [f.campana, Number(f.impresiones), Number(f.impresiones_enlace)]), [["CAMP_GLOBAL", 1200, 500], ["CAMP_WSP", 6000, 3000]]);
});

test("tarea diaria de Windsor (db/038): sin actions_link_click no borra el dato que ya estaba; un día que nunca lo tuvo sigue en NULL; al agregar el campo se carga", async () => {
  await db.exec(`
    create table windsor_raw.facebook_ads (
      "date" date, account_id text, campaign text, adset_name text, spend numeric, impressions numeric, clicks numeric,
      actions_onsite_conversion_messaging_conversation_started_7d numeric, actions_onsite_conversion_lead_grouped numeric);
    insert into windsor_raw.facebook_ads values (current_date - 3, null, 'CAMP_WSP', 'ADSET_BOEDO', 100, 1000, 40, 5, 0);
    insert into windsor_raw.facebook_ads values (current_date - 1, null, 'CAMP_WSP', 'ADSET_BOEDO', 300, 3000, 90, 3, 0);
  `);
  await db.query(`select * from ${S}.sincronizar_meta_desde_windsor('windsor_raw.facebook_ads')`);
  let { rows } = await db.query(`select clics_enlace from ${S}.meta_ads_metrica where comunidad_id = $1 and fecha = current_date - 3`, [COM_A]);
  assert.equal(rows[0].clics_enlace, 30, "la tabla de Windsor no trae el campo: se conserva el valor que ya había (el de 'Traer de Meta ahora')");
  const { rows: det0 } = await db.query(`select clics_enlace from ${S}.ads_campana_dia where comunidad_id = $1 and fecha = current_date - 3`, [COM_A]);
  assert.equal(det0[0].clics_enlace, 30, "el detalle por campaña también se conserva");
  const { rows: nunca } = await db.query(`select clics_enlace from ${S}.meta_ads_metrica where comunidad_id = $1 and fecha = current_date - 1`, [COM_A]);
  assert.equal(nunca[0].clics_enlace, null, "un día que nunca tuvo el dato sigue en NULL (no se inventa un 0)");

  await db.exec(`alter table windsor_raw.facebook_ads add column actions_link_click numeric; update windsor_raw.facebook_ads set actions_link_click = 33;`);
  await db.query(`select * from ${S}.sincronizar_meta_desde_windsor('windsor_raw.facebook_ads')`);
  ({ rows } = await db.query(`select clics_enlace from ${S}.meta_ads_metrica where comunidad_id = $1 and fecha = current_date - 3`, [COM_A]));
  assert.equal(rows[0].clics_enlace, 33);
  const { rows: det } = await db.query(`select clics_enlace from ${S}.ads_campana_dia where comunidad_id = $1 and fecha = current_date - 3`, [COM_A]);
  assert.equal(det[0].clics_enlace, 33, "el detalle por campaña también");
  // Un 0 real es un dato: pisa el valor anterior (solo NULL conserva).
  await db.exec(`update windsor_raw.facebook_ads set actions_link_click = 0 where "date" = current_date - 3`);
  await db.query(`select * from ${S}.sincronizar_meta_desde_windsor('windsor_raw.facebook_ads')`);
  ({ rows } = await db.query(`select clics_enlace from ${S}.meta_ads_metrica where comunidad_id = $1 and fecha = current_date - 3`, [COM_A]));
  assert.equal(rows[0].clics_enlace, 0);
});
