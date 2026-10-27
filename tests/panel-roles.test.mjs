// Pruebas de lo que muestra el panel según el rol (bloque ROLES de public/index.html). Quien decide es la base
// (db/031, probado en tests/db): esto verifica que el panel no ofrezca pestañas, columnas ni botones que no corresponden.
// Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const ini = html.indexOf("/* ROLES:INICIO */");
const fin = html.indexOf("/* ROLES:FIN */");
assert.ok(ini >= 0 && fin > ini, "no se encontró el bloque ROLES en public/index.html");
const TABS = [
  { key: "overview" }, { key: "control" }, { key: "objetivos" }, { key: "atribucion" }, { key: "base_limpia" }, { key: "dedup" }, { key: "crudo" },
];
const api = (acceso) => new Function("TABS", "state", html.slice(ini, fin) + "\nreturn { tabsVisibles, esMarketing, esAdmin };")(TABS, { acceso });
const claves = (a) => api(a).tabsVisibles().map((t) => t.key);

test("General ve Overview, Control_Comunidades y Atribución; nada con datos personales", () => {
  assert.deepEqual(claves({ rol: "general", admin: false }), ["overview", "control", "atribucion"]);
});

test("Marketing ve todas las pestañas; Usuarios solo si es administrador", () => {
  assert.deepEqual(claves({ rol: "marketing", admin: false }), ["overview", "control", "objetivos", "atribucion", "base_limpia", "dedup", "crudo"]);
  assert.deepEqual(claves({ rol: "marketing", admin: true }).at(-1), "usuarios");
  assert.deepEqual(claves({ rol: "general", admin: true }), ["overview", "control", "atribucion", "usuarios"]);
});

test("sin acceso cargado no se ofrece nada de Marketing ni de administración", () => {
  const a = api(null);
  assert.equal(a.esMarketing(), false);
  assert.equal(a.esAdmin(), false);
});

test("las columnas de plata de Control_Comunidades están marcadas y solo se muestran a Marketing", () => {
  const marcadas = [...html.matchAll(/\{ id:'([a-z_]+)', grupo:'[^']*', etiqueta:'[^']*', plata:true,/g)].map((m) => m[1]);
  assert.deepEqual(marcadas.sort(), ["costo_clic", "costo_entrada", "costo_lead", "cpl", "cpmn", "inversion"]);
  assert.match(html, /COLUMNAS_CONTROL\.filter\(c => esMarketing\(\) \|\| !c\.plata\)/);
});

test("los botones y formularios de Marketing no se dibujan para General", () => {
  assert.match(html, /\$\{esMarketing\(\) \? `<button class="btn" id="btnCampanas"/);
  assert.match(html, /\(esMarketing\(\) \? renderComunidadesForm\(filtros \? filtros\.todas : comunidades\) : ''\)/);
  assert.match(html, /\]\.filter\(\(\[, , plata\]\) => esMarketing\(\) \|\| !plata\)\);/);
});
