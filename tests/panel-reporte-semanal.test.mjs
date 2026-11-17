// Pruebas del botón "Reporte semanal (Excel)" de Control_Comunidades (bloque REPORTE-SEMANAL de public/index.html). Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const ini = html.indexOf("/* REPORTE-SEMANAL:INICIO */"), fin = html.indexOf("/* REPORTE-SEMANAL:FIN */");
assert.ok(ini >= 0 && fin > ini, "no se encontró el bloque REPORTE-SEMANAL en public/index.html");
const { semanaReporte, nombreArchivoReporte, filasReporte } = new Function(html.slice(ini, fin) + "\nreturn { semanaReporte, nombreArchivoReporte, filasReporte };")();

// El flujo de n8n usa la misma regla de semana; las dos tienen que dar lo mismo.
const flujo = JSON.parse(fs.readFileSync(new URL("../docs/n8n/reporte-semanal.workflow.json", import.meta.url), "utf8"));
const jsSemana = flujo.nodes.find((n) => n.name === "Definir semana").parameters.jsCode;
const semanaN8n = (ahoraUtc) => {
  const FIJA = new Date(ahoraUtc).getTime();
  class Fecha extends Date { constructor(...a) { if (a.length === 0) super(FIJA); else super(...a); } }
  return new Function("Date", jsSemana)(Fecha)[0].json;
};

test("sin fechas elegidas toma la última semana COMPLETA (lunes a domingo), cualquiera sea el día de hoy", () => {
  assert.deepEqual(semanaReporte("2026-11-17"), { desde: "2026-11-09", hasta: "2026-11-15", semana: 46, version: "V46" });   // martes
  assert.deepEqual(semanaReporte("2026-11-16"), { desde: "2026-11-09", hasta: "2026-11-15", semana: 46, version: "V46" });   // lunes
  assert.deepEqual(semanaReporte("2026-11-15"), { desde: "2026-11-02", hasta: "2026-11-08", semana: 45, version: "V45" });   // domingo: la semana en curso no está completa
  assert.deepEqual(semanaReporte("2026-11-21"), { desde: "2026-11-09", hasta: "2026-11-15", semana: 46, version: "V46" });   // sábado
});

test("con fechas elegidas respeta el período y la versión sale de la fecha 'hasta'", () => {
  assert.deepEqual(semanaReporte("2026-11-17", "2026-10-01", "2026-10-31"), { desde: "2026-10-01", hasta: "2026-10-31", semana: 44, version: "V44" });
});

test("cambio de año: la semana que termina el 3/1/2027 es la 53 de 2026", () => {
  assert.deepEqual(semanaReporte("2027-01-05"), { desde: "2026-12-28", hasta: "2027-01-03", semana: 53, version: "V53" });
});

test("el panel y el flujo de n8n calculan exactamente la misma semana y versión", () => {
  for (const [hoyAr, ahoraUtc] of [["2026-11-17", "2026-11-17T15:00:00Z"], ["2026-11-16", "2026-11-16T11:00:00Z"], ["2026-11-15", "2026-11-15T15:00:00Z"], ["2027-01-05", "2027-01-05T15:00:00Z"], ["2026-03-02", "2026-03-02T11:00:00Z"]]) {
    const p = semanaReporte(hoyAr), n = semanaN8n(ahoraUtc);
    assert.deepEqual([p.desde, p.hasta, p.semana, p.version], [n.desde, n.hasta, n.semana, n.version], hoyAr);
  }
});

test("el archivo lleva el cliente, el período y la versión, y no pisa el de otra semana", () => {
  const a = nombreArchivoReporte("Cortado en Jarrito", semanaReporte("2026-11-17"));
  const b = nombreArchivoReporte("Cortado en Jarrito", semanaReporte("2026-11-24"));
  assert.equal(a, "Reporte semanal Cortado en Jarrito 2026-11-09 a 2026-11-15 V46.xlsx");
  assert.notEqual(a, b);
});

test("el nombre del archivo no lleva caracteres que Windows no acepta", () => {
  const n = nombreArchivoReporte('Cli/ente: "raro"?', semanaReporte("2026-11-17"));
  assert.ok(!/[\\/:*?"<>|]/.test(n.replace(/\.xlsx$/, "")));
});

const SEM = semanaReporte("2026-11-17");
const FILA = { comunidad: "Palermo", inversion: "100.50", conversaciones: 10, clics_enlace: null, entradas: 4, cobertura_pct: "40.00", costo_por_entrada: "25.13", ultima_carga: "2026-10-26", dias_sin_carga: 20,
  miembros_desde: "2026-10-14", miembros_hasta: "2026-10-26", miembros_inicio: 32, nuevos: 10, bajas: 1, miembros_fin: 41, crr_pct: "96.88", churn_pct: "3.12", cuadra: true,
  inversion_intervalo: "50.00", entradas_intervalo: 1, cpmn: "5.00", triaje_pct: "1000.00" };

test("las columnas del Excel son números (no texto) y lo que el CRM no calculó queda vacío, no en 0", () => {
  const [f] = filasReporte([FILA], SEM);
  assert.equal(f["Inversión"], 100.5);
  assert.equal(f["CRR (%)"], 96.88);
  assert.equal(f["Clics en el enlace"], "");
  assert.equal(f["Las cargas cuadran"], "Sí");
  const [t] = filasReporte([{ ...FILA, crr_pct: null, cuadra: null, nuevos: null }], SEM);
  assert.equal(t["CRR (%)"], "");
  assert.equal(t["Nuevos"], "");
  assert.equal(t["Las cargas cuadran"], "");
});

test("el panel y el flujo de n8n arman las mismas columnas, en el mismo orden", () => {
  const jsExcel = flujo.nodes.find((n) => n.name === "Armar Excel").parameters.jsCode;
  const salida = new Function("$", "$input", jsExcel)((nom) => ({ first: () => ({ json: { ...SEM, slug: "x" } }) }), { all: () => [{ json: FILA }] })[0].json;
  const panel = filasReporte([FILA], SEM)[0];
  assert.deepEqual(Object.keys(panel), Object.keys(salida));
  assert.deepEqual(panel, salida);
});

test("el botón está solo para Marketing, dentro de Control_Comunidades, y llama a la función del CRM", () => {
  assert.match(html, /esMarketing\(\) \? `<button class="btn" id="btnCampanas"/);
  assert.match(html, /id="btnReporteSemanal"/);
  assert.match(html, /supabase\.rpc\('reporte_semanal'/);
  assert.match(html, /reporte\.onclick = descargarReporteSemanal/);
  assert.ok(!/key:'reporte'/.test(html), "no tiene que haber una pestaña aparte");
});
