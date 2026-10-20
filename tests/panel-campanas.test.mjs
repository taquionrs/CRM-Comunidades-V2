// Pruebas de la sección "Campañas" (db/026): estados, agrupación, resumen, filtros y traducción del destino elegido. Se extrae el bloque CAMPANAS de
// public/index.html (el panel no tiene build). Todos los nombres son inventados. Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const ini = html.indexOf("/* CAMPANAS:INICIO */");
const fin = html.indexOf("/* CAMPANAS:FIN */");
assert.ok(ini >= 0 && fin > ini, "no se encontró el bloque CAMPANAS en public/index.html");
const api = new Function(html.slice(ini, fin) +
  "\nreturn { estadoCampana, agruparCampanas, resumenCampanas, filtrarCampanas, valorDestinoCampana, interpretarDestinoCampana };")();

const fila = (campana, adset, gasto, reglaId = null, cuenta = null, comunidad = null, cliente = null) => ({
  campana, adset, gasto, conversaciones: 1, clics: 10, impresiones: 100, desde: "2026-10-01", hasta: "2026-10-10",
  regla_id: reglaId, cuenta, comunidad_id: comunidad, cliente_id: cliente, alcance: reglaId ? "conjunto" : null,
});
const FILAS = [
  fila("CAMP_A", "A_BOEDO", 100, "r1", true, "c-boedo", "cli-1"),
  fila("CAMP_A", "A_PALERMO", 200, "r2", true, "c-palermo", "cli-1"),
  fila("CAMP_B", "B_POST", 5000, "r3", false, "c-general", "cli-1"),
  fila("CAMP_B", "B_DARK", 3000, "r3", false, "c-general", "cli-1"),
  fila("CAMP_NUEVA", "", 50),
  fila("CAMP_OTRO", "X", 700),
];

test("estado: una campaña nueva sin regla es 'sin asignar' (no suma); con regla depende de la marca cuenta", () => {
  assert.equal(api.estadoCampana(fila("N", "", 1)), "sin_asignar");
  assert.equal(api.estadoCampana(fila("N", "", 1, "r", true, "c", "k")), "cuenta");
  assert.equal(api.estadoCampana(fila("N", "", 1, "r", false, "c", "k")), "no_cuenta");
});

test("agrupar: junta los conjuntos por campaña, suma el gasto y ordena de mayor a menor", () => {
  const g = api.agruparCampanas(FILAS);
  assert.deepEqual(g.map((x) => x.campana), ["CAMP_B", "CAMP_OTRO", "CAMP_A", "CAMP_NUEVA"]);
  assert.equal(g[0].gasto, 8000);
  assert.equal(g[2].gasto, 300);
  assert.equal(g[0].filas.length, 2);
});

test("agrupar: el estado del grupo es 'mixto' si sus conjuntos no coinciden en estado o destino", () => {
  const g = Object.fromEntries(api.agruparCampanas(FILAS).map((x) => [x.campana, x.estado]));
  assert.equal(g.CAMP_B, "no_cuenta");      // ambos conjuntos no cuentan
  assert.equal(g.CAMP_A, "mixto");          // Boedo y Palermo: mismo estado pero comunidades distintas
  assert.equal(g.CAMP_NUEVA, "sin_asignar");
  const mixto = api.agruparCampanas([fila("M", "a", 1, "r", true, "c", "k"), fila("M", "b", 1)]);
  assert.equal(mixto[0].estado, "mixto");
});

test("resumen: cuenta conjuntos y gasto por estado, y el total", () => {
  const r = api.resumenCampanas(FILAS);
  assert.deepEqual(r.cuenta, { n: 2, gasto: 300 });
  assert.deepEqual(r.no_cuenta, { n: 2, gasto: 8000 });
  assert.deepEqual(r.sin_asignar, { n: 2, gasto: 750 });
  assert.deepEqual(r.total, { n: 6, gasto: 9050 });
});

test("filtros: por estado, por cliente ('sin' = sin asignar) y por texto sin importar tildes ni mayúsculas", () => {
  const g = api.agruparCampanas(FILAS);
  const nombres = (x) => x.map((y) => y.campana).sort();
  assert.deepEqual(nombres(api.filtrarCampanas(g, { estado: "sin_asignar" })), ["CAMP_NUEVA", "CAMP_OTRO"]);
  assert.deepEqual(nombres(api.filtrarCampanas(g, { cliente: "sin" })), ["CAMP_NUEVA", "CAMP_OTRO"]);
  assert.deepEqual(nombres(api.filtrarCampanas(g, { cliente: "cli-1" })), ["CAMP_A", "CAMP_B"]);
  assert.deepEqual(nombres(api.filtrarCampanas(g, { texto: "palermo" })), ["CAMP_A"]);
  assert.deepEqual(nombres(api.filtrarCampanas(g, { texto: "  CAMP_nueva " })), ["CAMP_NUEVA"]);
  // el filtro de estado deja solo los conjuntos que lo cumplen dentro de cada campaña
  const soloCuentan = api.filtrarCampanas(g, { estado: "cuenta" });
  assert.deepEqual(soloCuentan.map((x) => x.filas.length), [2]);
});

test("destino: el valor del selector se traduce a la acción que se guarda", () => {
  assert.deepEqual(api.interpretarDestinoCampana("sin"), { accion: "sin_asignar", comunidad: null });
  assert.deepEqual(api.interpretarDestinoCampana("no"), { accion: "no_cuenta", comunidad: null });
  assert.deepEqual(api.interpretarDestinoCampana("c:abc-123"), { accion: "cuenta", comunidad: "abc-123" });
  assert.equal(api.interpretarDestinoCampana(""), null);      // "Mixto" no es una acción
  assert.equal(api.interpretarDestinoCampana("c:"), null);
  assert.equal(api.interpretarDestinoCampana(undefined), null);
});

test("destino: el valor mostrado para cada fila es coherente con su estado", () => {
  assert.equal(api.valorDestinoCampana(fila("N", "", 1)), "sin");
  assert.equal(api.valorDestinoCampana(fila("N", "", 1, "r", false, "c", "k")), "no");
  assert.equal(api.valorDestinoCampana(fila("N", "", 1, "r", true, "c-x", "k")), "c:c-x");
});
