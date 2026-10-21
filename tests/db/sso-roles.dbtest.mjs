// Pruebas de los permisos por rol (db/030 y db/031) sobre un Postgres local con TODAS las migraciones del repo.
// Correr: npm run test:db (necesita npm install: usa @electric-sql/pglite, no toca ninguna base real).
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { nuevaBase, como, migraciones } from "./harness.mjs";

let db;
const U = {}; // usuario → { id, sesion }
const SECRETO_N8N = "secreto-de-prueba-n8n";

before(async () => {
  db = await nuevaBase();
  // Datos de prueba (como postgres): un cliente, una comunidad, una persona que entró por el flow, gasto de Meta y desglose.
  await db.exec(`
    set search_path = crm_comunidades_v2, public;
    insert into cliente (id, nombre, slug) values ('00000000-0000-0000-0000-0000000000c1', 'Cliente Uno', 'cliente-uno');
    insert into comunidad (id, cliente_id, nombre, miembros_iniciales, miembros_finales)
      values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Comunidad Norte', 10, 15);
    insert into evento_crudo (cliente_id, comunidad_id, telefono_id, payload)
      values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '5491100000001', '{"contact":{"name":"Ana Pérez"}}');
    insert into meta_ads_metrica (cliente_id, comunidad_id, fecha, inversion, conversaciones_meta, impresiones, clics, leads_meta)
      values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '2026-10-01', 1000, 10, 500, 20, 4);
    insert into clic_me_sumo (cliente_id, comunidad_id, telefono_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '5491100000001');
    insert into trigger_entregado (cliente_id, comunidad_id, telefono_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '5491100000001');
    insert into ads_campana_dia (medio, cliente_id, comunidad_id, fecha, campana, adset, inversion, conversaciones, impresiones, clics, leads)
      values ('Meta', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '2026-10-01', 'Campaña A', 'Conjunto 1', 1000, 10, 500, 20, 4);
    insert into config_n8n (clave_hash) values (encode(extensions.digest('${SECRETO_N8N}', 'sha256'), 'hex'));
    insert into usuario_crm (email, rol, admin) values ('general@taquion.com.ar', 'general', false),
                                                       ('mkt@taquion.com.ar', 'marketing', false);
  `);
  for (const email of ["felipe.pampin@taquion.com.ar", "general@taquion.com.ar", "mkt@taquion.com.ar", "nadie@taquion.com.ar", "vencido@taquion.com.ar"]) {
    const { rows: [u] } = await db.query(`insert into auth.users (email) values ($1) returning id`, [email]);
    const vieja = email.startsWith("vencido");
    const { rows: [s] } = await db.query(
      `insert into auth.sessions (user_id, created_at) values ($1, now() - $2::interval) returning id`, [u.id, vieja ? "25 hours" : "1 hour"]);
    U[email.split(/[@.]/)[0]] = { id: u.id, email, sesion: s.id };
  }
  await db.exec(`insert into crm_comunidades_v2.usuario_crm (email, rol) values ('vencido@taquion.com.ar', 'marketing')`);
});

const sesion = (k, extra = {}) => ({ rol: "authenticated", claims: { sub: U[k].id, email: U[k].email, session_id: U[k].sesion, ...extra } });
const filas = async (ctx, sql, params = []) => (await como(db, ctx, (tx) => tx.query(sql, params))).rows;
async function falla(ctx, sql, re, params = []) {
  await assert.rejects(como(db, ctx, (tx) => tx.query(sql, params)), re);
}
const ANON = { rol: "anon" };
const S = "crm_comunidades_v2";
const RANGO = `select * from ${S}.comunidad_performance_rango('00000000-0000-0000-0000-0000000000c1')`;
const DESGLOSE = `select * from ${S}.desglose_campanas('00000000-0000-0000-0000-0000000000c1')`;

// ---------------------------------------------------------------------------
test("anon (la clave pública) ya no lee nada del esquema", async () => {
  for (const t of ["evento_crudo", "usuario_curado", "comunidad", "cliente", "meta_ads_metrica", "kpis_macro", "comunidad_performance", "base_limpia", "usuario_crm"]) {
    await falla(ANON, `select * from ${S}.${t}`, /permission denied/, []);
  }
  await falla(ANON, RANGO, /permission denied/);
  await falla(ANON, `select * from ${S}.recalcular_meta_windsor()`, /permission denied/);
  await falla(ANON, `select ${S}.guardar_usuario_crm('x@taquion.com.ar', 'marketing', true)`, /permission denied/);
});

test("n8n: con su secreto lee el nombre de la comunidad; sin él, no", async () => {
  const ok = await filas({ ...ANON, headers: { "x-crm-secret": SECRETO_N8N } },
    `select * from ${S}.datos_comunidad_planilla('00000000-0000-0000-0000-0000000000a1')`);
  assert.deepEqual(ok, [{ comunidad: "Comunidad Norte", cliente: "Cliente Uno", cliente_slug: "cliente-uno" }]);
  const otroEncabezado = await filas({ ...ANON, headers: { "webhook-crm-secret": SECRETO_N8N } },
    `select * from ${S}.datos_comunidad_planilla('00000000-0000-0000-0000-0000000000a1')`);
  assert.equal(otroEncabezado.length, 1);
  await falla({ ...ANON, headers: { "x-crm-secret": "otro" } }, `select * from ${S}.datos_comunidad_planilla('00000000-0000-0000-0000-0000000000a1')`, /Clave incorrecta/);
  await falla(ANON, `select * from ${S}.datos_comunidad_planilla('00000000-0000-0000-0000-0000000000a1')`, /Clave incorrecta/);
});

test("logueado pero sin alta: no ve nada", async () => {
  const ctx = sesion("nadie");
  assert.deepEqual(await filas(ctx, `select * from ${S}.mi_acceso()`), []);
  assert.equal((await filas(ctx, `select id, nombre, slug from ${S}.cliente`)).length, 0);
  for (const t of ["comunidad", "evento_crudo", "kpis_macro", "comunidad_performance"]) {
    assert.equal((await filas(ctx, `select * from ${S}.${t}`)).length, 0, t);
  }
  assert.equal((await filas(ctx, RANGO)).length, 0);
  await falla(ctx, DESGLOSE, /rol Marketing/);
});

test("General: ve conteos, sin plata ni datos personales", async () => {
  const ctx = sesion("general");
  assert.deepEqual(await filas(ctx, `select rol, admin from ${S}.mi_acceso()`), [{ rol: "general", admin: false }]);
  assert.equal((await filas(ctx, `select id, nombre, slug from ${S}.cliente`)).length, 1);
  assert.equal((await filas(ctx, `select * from ${S}.comunidad`)).length, 1);
  for (const t of ["evento_crudo", "usuario_curado", "base_limpia", "evento_deduplicado", "meta_ads_metrica", "ads_campana_dia", "clic_me_sumo", "webhook_intento"]) {
    assert.equal((await filas(ctx, `select * from ${S}.${t}`)).length, 0, t);
  }

  const [cp] = await filas(ctx, `select * from ${S}.comunidad_performance`);
  assert.equal(cp.inversion, null);
  assert.equal(cp.cpl, null);
  assert.equal(cp.cpcu, null);
  assert.equal(cp.cpmn, null);
  assert.equal(Number(cp.conversaciones_meta), 10);
  assert.equal(Number(cp.clics_unicos), 1, "las entradas al flow se cuentan aunque no pueda leer las filas");
  assert.equal(cp.crecimiento_neto, 5);

  const [k] = await filas(ctx, `select * from ${S}.kpis_macro`);
  assert.equal(k.inversion_total, null);
  assert.equal(k.cpl_global, null);
  assert.equal(k.cpme_global, null);
  assert.equal(Number(k.conversaciones_totales), 10);
  assert.equal(Number(k.clics_unicos_totales), 1);

  const [r] = await filas(ctx, RANGO);
  for (const c of ["inversion", "cpl", "cpcu", "cpmn", "costo_por_lead", "costo_por_clic_me_sumo"]) assert.equal(r[c], null, c);
  assert.equal(Number(r.conversaciones_meta), 10);
  assert.equal(Number(r.clics_unicos), 1);
  assert.equal(Number(r.clics_me_sumo), 1);
  assert.equal(Number(r.triggers_entregados), 1);
  assert.equal(Number(r.leads_meta), 4);
  assert.equal(Number(r.ctr_anuncio_pct), 4);
});

test("General: no edita ni usa las funciones de Marketing", async () => {
  const ctx = sesion("general");
  await falla(ctx, `insert into ${S}.comunidad (cliente_id, nombre) values ('00000000-0000-0000-0000-0000000000c1', 'Nueva')`, /row-level security/);
  assert.equal((await filas(ctx, `update ${S}.comunidad set miembros_finales = 99 returning id`)).length, 0);
  await falla(ctx, DESGLOSE, /rol Marketing/);
  await falla(ctx, `select * from ${S}.consultas_windsor(10)`, /rol Marketing/);
  await falla(ctx, `select * from ${S}.recalcular_meta_windsor()`, /rol Marketing/);
  await falla(ctx, `select * from ${S}.ver_miembros_grupo('clave', '00000000-0000-0000-0000-0000000000a1')`, /rol Marketing/);
  await falla(ctx, `select ${S}.guardar_regla_campana('Campaña A', null, 'cuenta', '00000000-0000-0000-0000-0000000000a1')`, /rol Marketing/);
  await falla(ctx, `select ${S}.usuarios_crm()`, /Solo un administrador/);
});

test("Marketing: ve y edita todo, pero no administra usuarios", async () => {
  const ctx = sesion("mkt");
  assert.equal((await filas(ctx, `select * from ${S}.evento_crudo`)).length, 1);
  assert.equal((await filas(ctx, `select * from ${S}.base_limpia`)).length, 1);
  const [cp] = await filas(ctx, `select * from ${S}.comunidad_performance`);
  assert.equal(Number(cp.inversion), 1000);
  assert.equal(Number(cp.cpl), 100);
  const [k] = await filas(ctx, `select * from ${S}.kpis_macro`);
  assert.equal(Number(k.inversion_total), 1000);
  const [r] = await filas(ctx, RANGO);
  assert.equal(Number(r.inversion), 1000);
  assert.equal(Number(r.costo_por_lead), 250);
  assert.equal((await filas(ctx, DESGLOSE)).length, 1);
  assert.equal((await filas(ctx, `insert into ${S}.comunidad (cliente_id, nombre) values ('00000000-0000-0000-0000-0000000000c1', 'Nueva') returning id`)).length, 1);
  assert.equal((await filas(ctx, `update ${S}.comunidad set miembros_finales = 16 returning id`)).length, 1);
  await falla(ctx, `select ${S}.usuarios_crm()`, /Solo un administrador/);
  await falla(ctx, `select webhook_secret_hash from ${S}.cliente`, /permission denied/);
  await falla(ctx, `select * from ${S}.usuario_crm`, /permission denied/);
});

test("Administrador: gestiona usuarios con sus reglas y queda auditoría", async () => {
  const ctx = sesion("felipe");
  const lista = await filas(ctx, `select ${S}.usuarios_crm() as r`);
  assert.equal(lista[0].r.usuarios.filter((u) => u.fijo).length, 3);

  const alta = await como(db, ctx, async (tx) => {
    const a = await tx.query(`select ${S}.guardar_usuario_crm('Nueva.Persona@taquion.com.ar', 'general', false) as u`);
    const c = await tx.query(`select ${S}.guardar_usuario_crm('nueva.persona@taquion.com.ar', 'marketing', true) as u`);
    const q = await tx.query(`select ${S}.quitar_usuario_crm('nueva.persona@taquion.com.ar') as ok`);
    const aud = await tx.query(`select ${S}.usuarios_crm() as r`);
    return { a: a.rows[0].u, c: c.rows[0].u, q: q.rows[0].ok, aud: aud.rows[0].r.auditoria };
  });
  assert.equal(alta.a.email, "nueva.persona@taquion.com.ar");
  assert.equal(alta.a.creado_por, "felipe.pampin@taquion.com.ar");
  assert.equal(alta.c.rol, "marketing");
  assert.equal(alta.q, true);
  assert.deepEqual(alta.aud.slice(0, 3).map((a) => a.accion), ["baja", "cambio", "alta"]);
  assert.ok(alta.aud.every((a) => a.por === "felipe.pampin@taquion.com.ar"));

  await falla(ctx, `select ${S}.guardar_usuario_crm('alguien@gmail.com', 'general', false)`, /@taquion\.com\.ar/);
  await falla(ctx, `select ${S}.guardar_usuario_crm('x@taquion.com.ar', 'jefe', false)`, /Rol inválido/);
  await falla(ctx, `select ${S}.guardar_usuario_crm('felipe.pampin@taquion.com.ar', 'general', false)`, /propio acceso/);
  await falla(ctx, `select ${S}.guardar_usuario_crm('nicolas.piantanida@taquion.com.ar', 'general', false)`, /administrador fijo/);
  await falla(ctx, `select ${S}.quitar_usuario_crm('marketing@taquion.com.ar')`, /administrador fijo/);
  assert.equal((await filas(ctx, `select ${S}.quitar_usuario_crm('noexiste@taquion.com.ar') as ok`))[0].ok, false);
});

test("una baja rige desde el pedido siguiente", async () => {
  const visto = await como(db, sesion("felipe"), async (tx) => {
    await tx.query(`select ${S}.quitar_usuario_crm('general@taquion.com.ar')`);
    // Mismo pedido, ahora con la sesión de la persona dada de baja.
    await tx.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ role: "authenticated", sub: U.general.id, email: U.general.email, session_id: U.general.sesion })]);
    return (await tx.query(`select * from ${S}.comunidad`)).rows.length;
  });
  assert.equal(visto, 0);
});

test("la sesión vence a las 24 h, se corta al cerrarla y no se puede usar la de otro", async () => {
  assert.deepEqual(await filas(sesion("vencido"), `select * from ${S}.mi_acceso()`), []);
  assert.deepEqual(await filas(sesion("mkt", { session_id: U.felipe.sesion }), `select * from ${S}.mi_acceso()`), []);
  const cerrada = await como(db, sesion("mkt"), async (tx) => {
    await tx.exec(`reset role`);
    await tx.query(`delete from auth.sessions where id = $1`, [U.mkt.sesion]);
    await tx.exec(`set local role authenticated`);
    return (await tx.query(`select * from ${S}.mi_acceso()`)).rows;
  });
  assert.deepEqual(cerrada, []);
});

test("la clave de servicio (Edge Functions) y las conexiones directas (pg_cron) no pasan por el control de rol", async () => {
  const svc = { rol: "service_role" };
  assert.equal((await filas(svc, `select * from ${S}.evento_crudo`)).length, 1);
  assert.equal((await filas(svc, DESGLOSE)).length, 1);
  await db.query(`select crm_comunidades_v2._exigir_marketing()`); // sin JWT: conexión directa, no exige rol
});

test("con solo db/030 aplicada (antes del deploy del panel con login) nada cambia para el panel actual", async () => {
  const intermedia = await nuevaBase(migraciones({ hasta: 30 }));
  await intermedia.exec(`insert into crm_comunidades_v2.cliente (id, nombre, slug) values ('00000000-0000-0000-0000-0000000000c2', 'Otro', 'otro');
    insert into crm_comunidades_v2.comunidad (cliente_id, nombre) values ('00000000-0000-0000-0000-0000000000c2', 'C')`);
  const leidas = await como(intermedia, ANON, async (tx) => ({
    comunidad: (await tx.query(`select * from ${S}.comunidad`)).rows.length,
    kpis: (await tx.query(`select * from ${S}.kpis_macro`)).rows.length,
    rango: (await tx.query(`select * from ${S}.comunidad_performance_rango('00000000-0000-0000-0000-0000000000c2')`)).rows.length,
  }));
  assert.deepEqual(leidas, { comunidad: 1, kpis: 1, rango: 1 });
  const fijos = await intermedia.query(`select count(*)::int as n from crm_comunidades_v2.usuario_crm where fijo`);
  assert.equal(fijos.rows[0].n, 3);
});
