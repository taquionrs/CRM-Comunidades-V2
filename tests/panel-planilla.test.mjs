// Pruebas de cómo Data_Cruda muestra el estado del envío a la planilla (db/023). Se extrae el bloque PLANILLA-ESTADO de public/index.html.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const ini = html.indexOf("/* PLANILLA-ESTADO:INICIO */");
const fin = html.indexOf("/* PLANILLA-ESTADO:FIN */");
assert.ok(ini >= 0 && fin > ini, "no se encontró el bloque PLANILLA-ESTADO en public/index.html");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const { pillPlanilla } = new Function("esc", html.slice(ini, fin) + "\nreturn { pillPlanilla };")(esc);

test("sin fila: 'Sin registro' (n8n no avisó), no un error", () => {
  const h = pillPlanilla(undefined);
  assert.match(h, /Sin registro/);
  assert.ok(!/pill-bad/.test(h));
});

test("registrado: pastilla de éxito", () => {
  assert.match(pillPlanilla({ estado: "registrado" }), /pill pill-ok[^>]*>Registrado</);
});

test("ignorado: se explica que es Instagram y no es un error", () => {
  const h = pillPlanilla({ estado: "ignorado" });
  assert.match(h, /Ignorado \(Instagram\)/);
  assert.ok(!/pill-bad/.test(h));
});

test("error: pastilla roja y el motivo a la vista", () => {
  const h = pillPlanilla({ estado: "error", motivo: "Falta la pestaña Cortado-Palermo" });
  assert.match(h, /pill pill-bad[^>]*>Error</);
  assert.match(h, /Falta la pestaña Cortado-Palermo/);
});

test("el motivo y el estado se escapan (no se inyecta HTML)", () => {
  const h = pillPlanilla({ estado: "error", motivo: '<img src=x onerror="alert(1)">' });
  assert.ok(!h.includes("<img"));
  assert.ok(!pillPlanilla({ estado: "<b>raro</b>" }).includes("<b>"));
});

test("un estado desconocido no rompe la tabla", () => {
  assert.match(pillPlanilla({ estado: "algo-nuevo" }), /algo-nuevo/);
});
