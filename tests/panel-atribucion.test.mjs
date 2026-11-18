// Pestaña Atribución actualizada (18/11/2026): dice lo que el CRM atribuye hoy y lo que falta, sin afirmar lo que ya no es cierto. Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const i = html.indexOf("const REQUISITOS_ATRIBUCION = ["), f = html.indexOf("/* ================= TAB 3: Base_Limpia");
assert.ok(i >= 0 && f > i);
const { REQUISITOS_ATRIBUCION, renderAtribucion } = new Function("esc", html.slice(i, f) + "\nreturn { REQUISITOS_ATRIBUCION, renderAtribucion };")(esc);
const out = renderAtribucion();

test("ya no dice que el CRM no atribuye ni que la sección está vacía", () => {
  assert.ok(!/no<\/b> hace atribución/.test(out));
  assert.ok(!/todavía no tiene contenido/.test(out));
  assert.ok(!/En construcción/.test(out));
  assert.match(out, /Parcial/);
});

test("explica qué se atribuye hoy: gasto a comunidad, persona a comunidad, entrada a anuncio por código; y qué no", () => {
  assert.match(out, /El gasto de Meta a una comunidad/);
  assert.match(out, /Por primer contacto/);
  assert.match(out, /código del anuncio \(ZONA-NN\)/);
  assert.match(out, /Rendimiento por anuncio/);
  assert.match(out, /Un miembro del grupo a su anuncio[\s\S]*Todavía no se hace/);
});

test("los cinco requisitos están con su estado actual: el ingreso al grupo ya existe y el anuncio de origen es parcial", () => {
  const estado = Object.fromEntries(REQUISITOS_ATRIBUCION.map((r) => [r.requisito, r.estado]));
  assert.equal(REQUISITOS_ATRIBUCION.length, 5);
  assert.equal(estado["Anuncio o campaña de origen de cada persona"], "Parcial");
  assert.equal(estado["Ingreso real al grupo"], "Disponible");
  assert.equal(estado["Identidad de la persona entre canales"], "No disponible");
  assert.equal(estado["Regla de atribución definida"], "Pendiente de decidir");
  assert.equal(estado["Uso de datos personales"], "Pendiente");
});

test("el estado Disponible se pinta en verde, Parcial en naranja y No disponible en rojo", () => {
  assert.match(out, /est ok">Disponible/);
  assert.match(out, /est medio">Parcial/);
  assert.match(out, /est mal">No disponible/);
});

test("lleva la fecha de la revisión y el camino que sigue (código en el mensaje, pospuesto con las campañas apagadas)", () => {
  assert.match(out, /Revisión del 18\/11\/2026/);
  assert.match(out, /pospuesto mientras las campañas están apagadas/);
  assert.match(out, /Qué sigue/);
});
