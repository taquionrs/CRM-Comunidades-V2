// Pruebas de objetivos_puesto y del registro de horas manuales (db/033) sobre un Postgres local con TODAS las migraciones del repo.
// Correr: npm run test:db (necesita npm install: usa @electric-sql/pglite, no toca ninguna base real).
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { nuevaBase, como } from "./harness.mjs";

const S = "crm_comunidades_v2";
const CLI = "00000000-0000-0000-0000-0000000000c1", A = "00000000-0000-0000-0000-0000000000a1", B = "00000000-0000-0000-0000-0000000000a2", C3 = "00000000-0000-0000-0000-0000000000a3";
const CARGA_MI = "00000000-0000-0000-0000-0000000000b1", CARGA_2 = "00000000-0000-0000-0000-0000000000b2";
let db;
const U = {};

before(async () => {
  db = await nuevaBase();
  await db.exec(`
    set search_path = crm_comunidades_v2, public;
    insert into cliente (id, nombre, slug) values ('${CLI}', 'Cliente Uno', 'cliente-uno');
    insert into comunidad (id, cliente_id, nombre, miembros_iniciales, miembros_finales) values
      ('${A}', '${CLI}', 'Palermo', 5, 4), ('${B}', '${CLI}', 'Boedo', 3, 2), ('${C3}', '${CLI}', 'Sin carga', 0, 0);
    -- Personas: tres automáticas y una recuperada a mano; entradas en Palermo (3) y Boedo (1)
    insert into evento_crudo (cliente_id, comunidad_id, telefono_id, payload, recibido_en) values
      ('${CLI}', '${A}', '5491100000001', '{}', timestamptz '2026-10-10 12:00:00-03'),
      ('${CLI}', '${A}', '5491100000002', '{}', timestamptz '2026-10-11 12:00:00-03'),
      ('${CLI}', '${A}', '5491100000003', '{"_recuperado":{"de":"webhook_intento"}}', timestamptz '2026-10-12 12:00:00-03'),
      ('${CLI}', '${B}', '5491100000004', '{}', timestamptz '2026-10-12 13:00:00-03'),
      ('${CLI}', '${A}', '5491100000001', '{}', timestamptz '2026-10-13 12:00:00-03'),     -- repite: no suma una entrada nueva
      ('${CLI}', '${A}', '5491100000009', '{}', timestamptz '2026-09-01 12:00:00-03');    -- fuera del período
    insert into clic_me_sumo (cliente_id, comunidad_id, telefono_id, recibido_en) values
      ('${CLI}', '${A}', '5491100000001', timestamptz '2026-10-10 12:05:00-03'),
      ('${CLI}', '${A}', '5491100000001', timestamptz '2026-10-10 12:06:00-03'),          -- la misma persona: 1
      ('${CLI}', '${B}', '5491100000004', timestamptz '2026-10-12 13:05:00-03');
    insert into meta_ads_metrica (cliente_id, comunidad_id, fecha, inversion, conversaciones_meta, impresiones, clics, leads_meta) values
      ('${CLI}', '${A}', '2026-10-10', 1000, 10, 100, 5, 0), ('${CLI}', '${A}', '2026-10-11', 500, 5, 100, 5, 0),
      ('${CLI}', '${B}', '2026-10-12', 300, 4, 100, 5, 0);
    insert into ads_campana_dia (medio, cliente_id, comunidad_id, fecha, campana, adset, inversion) values
      ('Meta Ads', '${CLI}', '${A}', '2026-10-10', 'C', '', 1000), ('Meta Ads', '${CLI}', '${A}', '2026-10-11', 'C', '', 500);   -- falta Boedo (300)
    -- Listas de miembros: una de partida (MI) y una completa posterior
    insert into carga_miembros (id, cliente_id, comunidad_id, numeros_validos, lista_completa, uso_como_mi) values
      ('${CARGA_MI}', '${CLI}', '${A}', 3, true, true), ('${CARGA_2}', '${CLI}', '${A}', 4, true, false);
    insert into miembro_comunidad (comunidad_id, cliente_id, telefono_id, fecha, salio_en, carga_id) values
      ('${A}', '${CLI}', '5491100000101', '2026-10-10', null, '${CARGA_MI}'),            -- de la lista de partida: no cuenta como ingreso
      ('${A}', '${CLI}', '5491100000102', '2026-10-11', null, '${CARGA_2}'),
      ('${A}', '${CLI}', '5491100000103', '2026-10-12', null, '${CARGA_2}'),
      ('${A}', '${CLI}', '5491100000104', '2026-10-12', '2026-10-13', '${CARGA_2}'),
      ('${B}', '${CLI}', '5491100000105', '2026-10-12', null, null);
    insert into usuario_crm (email, rol, admin) values ('general@taquion.com.ar', 'general', false), ('mkt@taquion.com.ar', 'marketing', false);
    insert into windsor_sync_log (tabla, gasto_sin_comunidad) values ('windsor_raw.facebook_ads', 0);
  `);
  for (const email of ["general@taquion.com.ar", "mkt@taquion.com.ar"]) {
    const { rows: [u] } = await db.query(`insert into auth.users (email) values ($1) returning id`, [email]);
    const { rows: [s] } = await db.query(`insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id`, [u.id]);
    U[email.split("@")[0]] = { id: u.id, email, sesion: s.id };
  }
});

const sesion = (k) => ({ rol: "authenticated", claims: { sub: U[k].id, email: U[k].email, session_id: U[k].sesion } });
const obj = async (ctx, d = "2026-10-01", h = "2026-10-31") =>
  (await como(db, ctx, (tx) => tx.query(`select ${S}.objetivos_puesto($1::uuid, $2::date, $3::date) as r`, [CLI, d, h]))).rows[0].r;

test("% de ingresos sin toque humano: cuenta personas, no eventos, y marca como recuperadas las del rescate", async () => {
  const { sin_toque_humano: s } = await obj(sesion("mkt"));
  assert.deepEqual([s.personas, s.automaticas, s.pct], [4, 3, 75]);
  const todo = await obj(sesion("mkt"), null, null);
  assert.equal(todo.sin_toque_humano.personas, 5);   // suma la persona de septiembre
});

test("tasa de triaje por comunidad: ingresos ÷ entradas al flow (las conversaciones de Meta son contexto), y el total suma sin promediar", async () => {
  const { triaje } = await obj(sesion("mkt"));
  const p = triaje.comunidades.find((c) => c.nombre === "Palermo");
  assert.deepEqual([p.conversaciones, p.entradas, p.clics_me_sumo, p.ingresos_grupo], [15, 3, 1, 3]);   // los 3 ingresos: sin contar la lista de partida
  assert.deepEqual([p.tasa_triaje, p.tasa_clics, p.entradas_por_conversacion], [100, 33.3, 20]);   // 3 ÷ 3 · 1 ÷ 3 · 3 ÷ 15
  const b = triaje.comunidades.find((c) => c.nombre === "Boedo");
  assert.deepEqual([b.conversaciones, b.entradas, b.clics_me_sumo, b.ingresos_grupo], [4, 1, 1, 1]);
  const s = triaje.comunidades.find((c) => c.nombre === "Sin carga");
  assert.deepEqual([s.tasa_triaje, s.entradas_por_conversacion], [null, null]);   // sin entradas ni conversaciones no hay tasa
  assert.deepEqual([triaje.total.conversaciones, triaje.total.entradas, triaje.total.ingresos_grupo], [19, 4, 4]);
  assert.equal(triaje.total.entradas_por_conversacion, 21.1);   // 4 / 19, no el promedio de 20 y 25
  assert.deepEqual([triaje.total.tasa_triaje, triaje.total.tasa_clics], [100, 50]);   // 4 ÷ 4 · 2 ÷ 4
});

test("horas manuales: las puede registrar y borrar Marketing, General no, y el resumen suma por tarea", async () => {
  await como(db, sesion("mkt"), async (tx) => {
    await tx.query(`insert into ${S}.registro_horas_manuales (fecha, tarea, minutos) values ('2026-10-26', 'Cargar conteo de miembros', 40), ('2026-10-26', 'Importar CSV de Windsor', 20), ('2026-10-27', 'Cargar conteo de miembros', 30)`);
    const r = (await tx.query(`select ${S}.objetivos_puesto($1::uuid, '2026-10-01', '2026-10-31') as r`, [CLI])).rows[0].r;
    assert.deepEqual([r.horas_manuales.registros, r.horas_manuales.minutos, r.horas_manuales.dias_con_registro], [3, 90, 2]);
    assert.deepEqual(r.horas_manuales.por_tarea[0], { tarea: "Cargar conteo de miembros", minutos: 70 });
    const { rows: [fila] } = await tx.query(`select por from ${S}.registro_horas_manuales limit 1`);
    assert.equal(fila.por, "mkt@taquion.com.ar");   // quién lo registró, de la sesión
    const borrado = await tx.query(`delete from ${S}.registro_horas_manuales where tarea = 'Importar CSV de Windsor'`);
    assert.equal(borrado.affectedRows, 1);   // Marketing puede borrar sus registros
  });
  await assert.rejects(como(db, sesion("general"), (tx) => tx.query(`insert into ${S}.registro_horas_manuales (fecha, tarea, minutos) values ('2026-10-26', 'x tarea', 5)`)), /row-level security|permission denied/);
  await assert.rejects(como(db, { rol: "anon" }, (tx) => tx.query(`select * from ${S}.registro_horas_manuales`)), /permission denied/);
  await assert.rejects(como(db, sesion("mkt"), (tx) => tx.query(`insert into ${S}.registro_horas_manuales (fecha, tarea, minutos) values ('2026-10-26', 'ok tarea', 0)`)), /check/);
});

test("chequeos de integridad: marcan lo que no cierra y dejan en verde lo que sí", async () => {
  const { chequeos } = await obj(sesion("mkt"));
  const c = Object.fromEntries(chequeos.map((x) => [x.id, x]));
  assert.equal(c.desglose_vs_tabla.estado, "aviso");            // faltan 300 de Boedo
  assert.match(c.desglose_vs_tabla.detalle, /300/);
  assert.equal(c.windsor_al_dia.estado, "ok");
  assert.equal(c.eventos_recientes.estado, "aviso");            // los eventos de prueba son de octubre de 2026, no de las últimas 48 h reales
  assert.equal(c.planilla_sin_errores.estado, "ok");
  assert.equal(c.gasto_con_comunidad.estado, "ok");
  assert.equal(c.mi_mf_cargados.estado, "aviso");
  assert.match(c.mi_mf_cargados.detalle, /Sin carga/);
  assert.equal(c.bajas_calculables.estado, "aviso");            // Palermo tiene 2 listas completas; Boedo y Sin carga no
  assert.match(c.bajas_calculables.detalle, /Boedo/);
  assert.doesNotMatch(c.bajas_calculables.detalle, /Palermo/);
  assert.equal(c.mf_vs_listas.estado, "aviso");                 // Palermo: MF 4 contra 3 en la lista
  assert.match(c.mf_vs_listas.detalle, /Palermo \(MF 4 contra 3/);
});

test("solo Marketing: General y la clave pública no pueden pedir los objetivos; la clave de servicio sí", async () => {
  await assert.rejects(obj(sesion("general")), /Necesitás el rol Marketing/);
  await assert.rejects(obj({ rol: "anon" }), /permission denied/);
  assert.equal((await obj({ rol: "service_role" })).triaje.total.conversaciones, 19);
});

test("no devuelve teléfonos: el JSON solo trae conteos, nombres de comunidad y de tareas", async () => {
  const txt = JSON.stringify(await obj(sesion("mkt")));
  assert.doesNotMatch(txt, /5491100000\d{3}/);
});
