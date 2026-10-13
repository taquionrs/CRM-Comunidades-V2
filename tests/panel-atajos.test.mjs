// Pruebas de los atajos de período de Control_Comunidades. El panel es un HTML sin build, así que se extrae el bloque
// marcado ATAJOS-FECHAS de public/index.html y se evalúa acá. Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const ini = html.indexOf("/* ATAJOS-FECHAS:INICIO */");
const fin = html.indexOf("/* ATAJOS-FECHAS:FIN */");
assert.ok(ini >= 0 && fin > ini, "no se encontró el bloque ATAJOS-FECHAS en public/index.html");
const { hoyAR, sumarDias, ATAJOS_FECHAS } = new Function(html.slice(ini, fin) + "\nreturn { hoyAR, sumarDias, ATAJOS_FECHAS };")();
const rango = (id, hoy) => ATAJOS_FECHAS.find((a) => a.id === id).rango(hoy);

test("hoyAR: usa la hora de Buenos Aires (no la de UTC)", () => {
  // 02:30 UTC del 14/10 son las 23:30 del 13/10 en Argentina
  assert.equal(hoyAR(new Date("2026-10-14T02:30:00Z")), "2026-10-13");
  assert.equal(hoyAR(new Date("2026-10-14T03:00:00Z")), "2026-10-14");
  assert.equal(hoyAR(new Date("2026-01-01T01:00:00Z")), "2025-12-31");
});

test("sumarDias: cruza meses, años y el 29 de febrero sin errores", () => {
  assert.equal(sumarDias("2026-10-13", -6), "2026-10-07");
  assert.equal(sumarDias("2026-03-02", -6), "2026-02-24");
  assert.equal(sumarDias("2027-01-03", -6), "2026-12-28");
  assert.equal(sumarDias("2028-03-01", -1), "2028-02-29");   // año bisiesto
  assert.equal(sumarDias("2026-03-01", -1), "2026-02-28");   // no bisiesto
  assert.equal(sumarDias("2026-10-13", 0), "2026-10-13");
});

test("atajos: ayer es un solo día y los 'últimos N días' incluyen hoy y los N-1 anteriores", () => {
  const hoy = "2026-10-13";
  assert.deepEqual(rango("ayer", hoy), { desde: "2026-10-12", hasta: "2026-10-12" });
  assert.deepEqual(rango("7", hoy),  { desde: "2026-10-07", hasta: "2026-10-13" });
  assert.deepEqual(rango("10", hoy), { desde: "2026-10-04", hasta: "2026-10-13" });
  assert.deepEqual(rango("15", hoy), { desde: "2026-09-29", hasta: "2026-10-13" });
  assert.deepEqual(rango("30", hoy), { desde: "2026-09-14", hasta: "2026-10-13" });
});

test("atajos: cantidad de días de cada rango (de 'desde' a 'hasta' inclusive)", () => {
  const dias = (r) => (Date.parse(r.hasta) - Date.parse(r.desde)) / 86400000 + 1;
  for (const hoy of ["2026-10-13", "2026-03-02", "2028-03-01", "2027-01-03"]) {
    assert.equal(dias(rango("ayer", hoy)), 1);
    assert.equal(dias(rango("7", hoy)), 7);
    assert.equal(dias(rango("10", hoy)), 10);
    assert.equal(dias(rango("15", hoy)), 15);
    assert.equal(dias(rango("30", hoy)), 30);
  }
});

test("atajos: están los cinco pedidos, en orden, con sus etiquetas", () => {
  assert.deepEqual(ATAJOS_FECHAS.map((a) => a.etiqueta), ["Ayer", "Últimos 7 días", "Últimos 10 días", "Últimos 15 días", "Últimos 30 días"]);
});
