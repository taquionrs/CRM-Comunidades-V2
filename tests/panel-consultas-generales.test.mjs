// Overview: consultas generales (db/050) — total sin comunidad, sin registrar y registradas. Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const ini = html.indexOf("/* ENTRADAS-FLOW:INICIO */"), fin = html.indexOf("/* ENTRADAS-FLOW:FIN */");
assert.ok(ini >= 0 && fin > ini);
const { entradasFlowDesdeFila } = new Function(html.slice(ini, fin) + "\nreturn { entradasFlowDesdeFila };")();

test("con la función nueva trae las consultas generales y cuántas ya quedaron registradas", () => {
  const r = entradasFlowDesdeFila({ clasificadas: 536, sin_clasificar: 9, total: 545, tasa_clasificacion_pct: 98.3, hay_registro: true, consultas_generales: "10", consultas_registradas: "1" });
  assert.equal(r.consultas_generales, 10);
  assert.equal(r.consultas_registradas, 1);
  assert.equal(r.sin_clasificar, 9);
  assert.equal(r.total, 545);
});

test("si la base todavía no trae las consultas generales (db/050 sin aplicar) no inventa números", () => {
  const r = entradasFlowDesdeFila({ clasificadas: 6, sin_clasificar: 2, total: 8, hay_registro: true });
  assert.equal("consultas_generales" in r, false);
});

test("Overview muestra: total sin comunidad, sin registrar y registradas; y mantiene el total con y sin comunidad y la tasa", () => {
  assert.match(html, /'Entradas totales al flow \(sin comunidad\): consultas generales'/);
  assert.match(html, /'Entradas de consultas generales sin registrar'/);
  assert.match(html, /'Entradas de consultas generales registradas'/);
  assert.match(html, /'Entradas totales al flow \(con y sin comunidad\)'/);
  assert.match(html, /'Tasa de clasificación'/);
  assert.match(html, /'Escribieron y no eligieron comunidad'/);   // se conserva mientras db/050 no esté aplicada
});
