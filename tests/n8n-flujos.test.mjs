// Pruebas de los flujos de n8n del reporte semanal y de la carga automática de miembros (docs/n8n/*.workflow.json). Correr: npm test
// No se prueba n8n en sí: se valida la estructura del JSON y se corre la lógica de los nodos de código con datos simulados.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const leer = (f) => JSON.parse(fs.readFileSync(new URL(`../docs/n8n/${f}`, import.meta.url), "utf8"));
const reporte = leer("reporte-semanal.workflow.json");
const carga = leer("carga-miembros-automatica.workflow.json");
const nodo = (flujo, nombre) => flujo.nodes.find((n) => n.name === nombre);

// Corre un nodo "Code" con los ayudantes de n8n simulados ($, $input, $json). `ahora` fija la fecha del sistema.
function correr(flujo, nombre, { entrada = [], nodos = {}, json = {}, item = null, ahora = null } = {}) {
  const js = nodo(flujo, nombre).parameters.jsCode;
  const FIJA = ahora ? new Date(ahora).getTime() : null;
  class Fecha extends Date { constructor(...a) { if (a.length === 0 && FIJA !== null) super(FIJA); else super(...a); } }
  const salida = (nom) => ({ first: () => (nodos[nom] || [])[0], all: () => nodos[nom] || [], item: item?.[nom] });
  const $ = (nom) => salida(nom);
  const $input = { all: () => entrada, first: () => entrada[0] };
  return new Function("$", "$input", "$json", "Date", js)($, $input, json, Fecha);
}
const it = (json, binary) => ({ json, ...(binary ? { binary } : {}) });

// ---------- estructura ----------
for (const [nombre, flujo] of [["reporte semanal", reporte], ["carga de miembros", carga]]) {
  test(`${nombre}: nombres e ids únicos y todas las conexiones apuntan a nodos que existen`, () => {
    const nombres = flujo.nodes.map((n) => n.name), ids = flujo.nodes.map((n) => n.id);
    assert.equal(new Set(nombres).size, nombres.length);
    assert.equal(new Set(ids).size, ids.length);
    for (const [origen, c] of Object.entries(flujo.connections)) {
      assert.ok(nombres.includes(origen), origen);
      for (const salida of c.main) for (const d of salida) assert.ok(nombres.includes(d.node), d.node);
    }
  });
  test(`${nombre}: viene apagado, con zona horaria de Argentina y sin ninguna clave escrita adentro`, () => {
    assert.equal(flujo.active, false);
    assert.equal(flujo.settings.timezone, "America/Argentina/Buenos_Aires");
    const texto = JSON.stringify(flujo);
    assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(texto), "no debe haber un token JWT");
    assert.ok(!/sb_(secret|publishable)_/.test(texto), "no debe haber claves de Supabase");
    for (const n of flujo.nodes) for (const c of Object.values(n.credentials || {})) assert.equal(c.id, "REEMPLAZAR");
  });
  test(`${nombre}: todos los nodos de código son JavaScript válido`, () => {
    for (const n of flujo.nodes.filter((x) => x.type === "n8n-nodes-base.code")) assert.doesNotThrow(() => new Function("$", "$input", "$json", n.parameters.jsCode), n.name);
  });
}

test("reporte: corre cada lunes a las 8:00 y se puede correr a mano; ambos arrancan en 'Definir semana'", () => {
  assert.equal(nodo(reporte, "Cada lunes 8:00").parameters.rule.interval[0].expression, "0 8 * * 1");
  for (const origen of ["Cada lunes 8:00", "Correr a mano"]) assert.equal(reporte.connections[origen].main[0][0].node, "Definir semana");
});

test("reporte: pide el reporte a la función del CRM con perfil de esquema y no calcula nada en n8n", () => {
  const n = nodo(reporte, "Supabase: reporte semanal");
  assert.match(n.parameters.url, /\/rest\/v1\/rpc\/reporte_semanal$/);
  assert.equal(n.parameters.headerParameters.parameters[0].name, "Content-Profile");
  assert.match(n.parameters.jsonBody, /p_cliente.*p_desde.*p_hasta/);
});

// ---------- lógica: semana ----------
test("Definir semana: un martes toma el lunes y el domingo de la semana anterior, y la versión es el número de semana ISO", () => {
  const [r] = correr(reporte, "Definir semana", { ahora: "2026-11-17T15:00:00Z" });
  assert.deepEqual([r.json.desde, r.json.hasta, r.json.semana, r.json.version], ["2026-11-09", "2026-11-15", 46, "V46"]);
  assert.equal(r.json.archivo, "Reporte semanal cortado-en-jarrito 2026-11-09 a 2026-11-15 V46.xlsx");
});

test("Definir semana: el lunes a las 8:00 de Argentina (11:00 UTC) también toma la semana anterior completa", () => {
  const [r] = correr(reporte, "Definir semana", { ahora: "2026-11-16T11:00:00Z" });
  assert.deepEqual([r.json.desde, r.json.hasta], ["2026-11-09", "2026-11-15"]);
});

test("Definir semana: un domingo toma la semana que terminó el domingo anterior, no la que está en curso", () => {
  const [r] = correr(reporte, "Definir semana", { ahora: "2026-11-15T15:00:00Z" });
  assert.deepEqual([r.json.desde, r.json.hasta], ["2026-11-02", "2026-11-08"]);
});

test("Definir semana: cruza bien el cambio de año (primera semana de enero)", () => {
  const [r] = correr(reporte, "Definir semana", { ahora: "2027-01-05T15:00:00Z" });
  assert.deepEqual([r.json.desde, r.json.hasta], ["2026-12-28", "2027-01-03"]);
  assert.equal(r.json.semana, 53);   // 2026 tiene 53 semanas ISO: la que termina el 3/1/2027 es la 53
});

// ---------- lógica: Excel y resumen ----------
const SEM = { slug: "cortado-en-jarrito", desde: "2026-11-09", hasta: "2026-11-15", semana: 46, version: "V46" };
const FILA = { es_total: false, comunidad: "Palermo", inversion: "100.50", conversaciones: 10, clics_enlace: null, entradas: 4, cobertura_pct: "40.00", costo_por_entrada: "25.13",
  ultima_carga: "2026-10-26", dias_sin_carga: 20, miembros_desde: "2026-10-14", miembros_hasta: "2026-10-26", miembros_inicio: 32, nuevos: 10, bajas: 1, miembros_fin: 41,
  crr_pct: "96.88", churn_pct: "3.12", cuadra: true, inversion_intervalo: "50.00", entradas_intervalo: 1, cpmn: "5.00", triaje_pct: "1000.00" };
const TOTAL = { ...FILA, es_total: true, comunidad: "Total del cliente", miembros_desde: null, miembros_hasta: null, miembros_inicio: null, nuevos: null, bajas: null, miembros_fin: null,
  crr_pct: null, churn_pct: null, cuadra: null, cpmn: null, triaje_pct: null, inversion_intervalo: null, entradas_intervalo: null };

test("Armar Excel: una fila por comunidad con los números como números; lo que el CRM no pudo calcular queda vacío (no 0)", () => {
  const filas = correr(reporte, "Armar Excel", { entrada: [it(FILA), it(TOTAL)], nodos: { "Definir semana": [it(SEM)] } }).map((x) => x.json);
  const p = filas[0];
  assert.equal(p["Comunidad"], "Palermo");
  assert.equal(p["Semana"], "V46");
  assert.equal(p["Inversión"], 100.5);
  assert.equal(p["Clics en el enlace"], "");        // null en el CRM = sin dato
  assert.equal(p["CRR (%)"], 96.88);
  assert.equal(p["Las cargas cuadran"], "Sí");
  const t = filas[1];
  assert.equal(t["CRR (%)"], "");                    // el total no tenía intervalo común
  assert.equal(t["Las cargas cuadran"], "");
});

test("Armar Excel no calcula: si el CRM manda un número, sale ese mismo número", () => {
  const raro = { ...FILA, cobertura_pct: "12.34", crr_pct: "55.55" };
  const [p] = correr(reporte, "Armar Excel", { entrada: [it(raro)], nodos: { "Definir semana": [it(SEM)] } }).map((x) => x.json);
  assert.equal(p["Cobertura (%)"], 12.34);
  assert.equal(p["CRR (%)"], 55.55);
});

test("Armar resumen: avisa de los datos de miembros viejos (más de 8 días sin carga) y conserva el Excel adjunto", () => {
  const filasExcel = correr(reporte, "Armar Excel", { entrada: [it(FILA), it(TOTAL)], nodos: { "Definir semana": [it(SEM)] } });
  const [r] = correr(reporte, "Armar resumen", { entrada: [it({}, { data: { fileName: "x.xlsx" } })], nodos: { "Definir semana": [it(SEM)], "Armar Excel": filasExcel } });
  assert.match(r.json.html, /Atención.*Palermo \(20 días\)/);
  assert.match(r.json.html, /CRR 96,9 %/);
  assert.equal(r.json.asunto, "Reporte semanal cortado-en-jarrito V46");
  assert.deepEqual(r.binary, { data: { fileName: "x.xlsx" } });
});

test("Armar resumen: sin datos viejos no muestra la advertencia, y 'no calculable' cuando falta el CRR", () => {
  const fresca = { ...FILA, dias_sin_carga: 3, crr_pct: null, churn_pct: null };
  const filasExcel = correr(reporte, "Armar Excel", { entrada: [it(fresca), it(TOTAL)], nodos: { "Definir semana": [it(SEM)] } });
  const [r] = correr(reporte, "Armar resumen", { entrada: [it({}, { data: {} })], nodos: { "Definir semana": [it(SEM)], "Armar Excel": filasExcel } });
  assert.ok(!/Atención/.test(r.json.html));
  assert.match(r.json.html, /CRR no calculable/);
});

// ---------- lógica: carga de miembros ----------
test("carga: corre solo con archivos conteo-miembros-*.csv y por defecto en modo prueba", () => {
  assert.equal(nodo(carga, "Solo conteos").parameters.conditions.conditions[0].rightValue, "conteo-miembros-");
  assert.match(nodo(carga, "Freno de seguridad").parameters.jsCode, /const MODO = 'prueba'/);
});

test("Armar cargas: agrupa por comunidad, pasa el teléfono a solo dígitos y la fecha a AAAA-MM-DD, y descarta lo inválido", () => {
  const filas = [
    { Comunidad: "Boedo", Fecha: "13/11/2026", Teléfono: "+5491159924465" },
    { Comunidad: "Boedo", Fecha: "14/10/2026", Teléfono: "+54 9 11 5992-4466" },
    { Comunidad: "Palermo", Fecha: "sin fecha", Teléfono: "+5492664706010" },
    { Comunidad: "Palermo", Fecha: "13/11/2026", Teléfono: "12" },
    { Comunidad: "", Fecha: "13/11/2026", Teléfono: "+5491159924467" },
  ];
  const r = correr(carga, "Armar cargas", { entrada: filas.map((x) => it(x)), nodos: { "Descargar CSV": [it({ name: "conteo-miembros-2026-11-13.csv" })] } }).map((x) => x.json);
  assert.deepEqual(r.map((x) => x.comunidad), ["Boedo", "Palermo"]);
  assert.deepEqual(r[0].filas, [{ t: "5491159924465", f: "2026-11-13" }, { t: "5491159924466", f: "2026-10-14" }]);
  assert.deepEqual(r[1].filas, [{ t: "5492664706010", f: null }]);   // sin fecha válida: el CRM usa la de hoy
  assert.equal(r[0].invalidos, 2);
  assert.equal(r[0].archivo, "conteo-miembros-2026-11-13.csv");
});

test("Unir con el id: una comunidad que no existe con ese nombre queda sin id (no se carga)", () => {
  const cargas = [it({ comunidad: "Boedo", filas: [] }), it({ comunidad: "Nombre Mal Escrito", filas: [] })];
  const r = correr(carga, "Unir con el id", { nodos: { "Supabase: comunidades": [it([{ id: "uuid-boedo", nombre: "Boedo" }])], "Armar cargas": cargas } }).map((x) => x.json);
  assert.equal(r[0].comunidad_id, "uuid-boedo");
  assert.equal(r[1].comunidad_id, null);
});

const freno = (vp, comunidadId = "uuid", modoReal = false) => {
  const flujo = JSON.parse(JSON.stringify(carga));
  if (modoReal) nodo(flujo, "Freno de seguridad").parameters.jsCode = nodo(flujo, "Freno de seguridad").parameters.jsCode.replace("const MODO = 'prueba'", "const MODO = 'real'");
  return correr(flujo, "Freno de seguridad", { entrada: [{ json: [vp] }], nodos: { "Unir con el id": [{ json: { comunidad: "Boedo", comunidad_id: comunidadId, filas: [], archivo: "a.csv" } }] } })[0].json;
};
const VP = (o) => ({ total_archivo: 62, nuevos: 11, duplicados: 51, salidas: 0, activos_actuales: 51, ...o });

test("Freno: en modo prueba nunca carga, aunque todo esté bien", () => {
  const r = freno(VP());
  assert.equal(r.ok, true);
  assert.equal(r.hacer_carga, false);
  assert.equal(r.modo, "prueba");
});

test("Freno: en modo real carga si todo está dentro de lo esperado", () => {
  const r = freno(VP(), "uuid", true);
  assert.equal(r.hacer_carga, true);
  assert.deepEqual(r.motivos, []);
});

test("Freno: muchas salidas frena la carga (una lectura incompleta de WhatsApp parecería que se fue mucha gente)", () => {
  const r = freno(VP({ salidas: 12, total_archivo: 45 }), "uuid", true);
  assert.equal(r.hacer_carga, false);
  assert.ok(r.motivos.some((m) => /salidas/.test(m)));
});

test("Freno: un archivo mucho más chico que el grupo actual se considera incompleto", () => {
  const r = freno(VP({ total_archivo: 30, salidas: 3 }), "uuid", true);
  assert.equal(r.hacer_carga, false);
  assert.ok(r.motivos.some((m) => /incompleto/.test(m)));
});

test("Freno: una comunidad sin id en el CRM no se carga", () => {
  const r = freno(VP(), null, true);
  assert.equal(r.hacer_carga, false);
  assert.ok(r.motivos.some((m) => /no existe/.test(m)));
});

test("Freno: con varias comunidades decide cada una por separado (antes solo miraba la primera)", () => {
  const flujo = JSON.parse(JSON.stringify(carga));
  nodo(flujo, "Freno de seguridad").parameters.jsCode = nodo(flujo, "Freno de seguridad").parameters.jsCode.replace("const MODO = 'prueba'", "const MODO = 'real'");
  const cargas = [["General", "u1"], ["Boedo", "u2"], ["Devoto", "u3"], ["Palermo", null]].map(([comunidad, comunidad_id]) => ({ json: { comunidad, comunidad_id, filas: [], archivo: "a.csv" } }));
  const vps = [VP(), VP({ total_archivo: 51 }), VP({ salidas: 12, total_archivo: 45 }), VP()].map((vp) => ({ json: [vp] }));
  const r = correr(flujo, "Freno de seguridad", { entrada: vps, nodos: { "Unir con el id": cargas } });
  assert.equal(r.length, 4);
  assert.deepEqual(r.map((x) => x.json.comunidad), ["General", "Boedo", "Devoto", "Palermo"]);
  assert.deepEqual(r.map((x) => x.json.hacer_carga), [true, true, false, false]);
});

test("Armar aviso: separa lo cargado de lo que espera a una persona e indica por qué", () => {
  const filas = [it({ archivo: "a.csv", hacer_carga: true, resumen: "Boedo: 62", motivos: [], modo: "real" }),
                 it({ archivo: "a.csv", hacer_carga: false, resumen: "Palermo: 30", motivos: ["parece incompleto"], modo: "real" })];
  const [r] = correr(carga, "Armar aviso", { entrada: filas });
  assert.match(r.json.html, /Cargadas/);
  assert.match(r.json.html, /no se cargó:<\/b> parece incompleto/);
  assert.match(r.json.asunto, /para revisar/);
});
