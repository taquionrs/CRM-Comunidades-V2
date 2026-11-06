// Pruebas del bloque ENTRADAS-FLOW de public/index.html (entradas totales y tasa de clasificación, db/035). Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const ini = html.indexOf("/* ENTRADAS-FLOW:INICIO */");
const fin = html.indexOf("/* ENTRADAS-FLOW:FIN */");
assert.ok(ini >= 0 && fin > ini, "no se encontró el bloque ENTRADAS-FLOW en public/index.html");
const { entradasFlowDesdeFila } = new Function(html.slice(ini, fin) + "\nreturn { entradasFlowDesdeFila };")();

test("con avisos registrados devuelve clasificadas, sin clasificar, total y tasa con un decimal", () => {
  const r = entradasFlowDesdeFila({ clasificadas: "3", sin_clasificar: 4, total: "7", tasa_clasificacion_pct: "42.86", hay_registro: true });
  assert.deepEqual(r, { clasificadas: 3, sin_clasificar: 4, total: 7, tasa_clasificacion_pct: 42.9 });
});

test("sin ningún aviso registrado todavía no se muestra nada (no hay '100 %' engañoso)", () => {
  assert.equal(entradasFlowDesdeFila({ clasificadas: 50, sin_clasificar: 0, total: 50, tasa_clasificacion_pct: 100, hay_registro: false }), null);
  assert.equal(entradasFlowDesdeFila(null), null);
  assert.equal(entradasFlowDesdeFila(undefined), null);
});

test("período sin personas: total 0 y tasa vacía, no un error", () => {
  const r = entradasFlowDesdeFila({ clasificadas: 0, sin_clasificar: 0, total: 0, tasa_clasificacion_pct: null, hay_registro: true });
  assert.equal(r.total, 0);
  assert.equal(r.tasa_clasificacion_pct, null);
});

test("si el total no llega, se suma de las dos partes", () => {
  const r = entradasFlowDesdeFila({ clasificadas: 6, sin_clasificar: 2, hay_registro: true });
  assert.equal(r.total, 8);
  assert.equal(r.tasa_clasificacion_pct, 75);
});

test("Overview y Data_Cruda están conectados: tarjetas, chip y fila de 'Sin clasificar'", () => {
  assert.match(html, /entradas_flow: entradasFlow/, "Overview tiene que pasar entradas_flow a renderOverview");
  assert.match(html, /\['sin_clasificar','Sin clasificar'\]/, "falta el chip Sin clasificar en Data_Cruda");
  assert.match(html, /function filaSinClasificar\(/);
  assert.match(html, /rpc\('entradas_flow_cliente'/);
  assert.match(html, /from\('ingreso_sin_clasificar'\)/);
});
