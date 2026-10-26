// Pruebas de las leyendas de Overview (bloque AYUDAS-OVERVIEW de public/index.html). Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const ini = html.indexOf("/* AYUDAS-OVERVIEW:INICIO */");
const fin = html.indexOf("/* AYUDAS-OVERVIEW:FIN */");
assert.ok(ini >= 0 && fin > ini, "no se encontró el bloque AYUDAS-OVERVIEW en public/index.html");
const { AYUDAS_OVERVIEW } = new Function(html.slice(ini, fin) + "\nreturn { AYUDAS_OVERVIEW };")();

test("cada sigla de Overview tiene su explicación", () => {
  assert.match(AYUDAS_OVERVIEW.cpmi, /costo por mensaje iniciado/i);
  assert.match(AYUDAS_OVERVIEW.cpme, /costo por miembro efectivo/i);
  assert.match(AYUDAS_OVERVIEW.fuga, /bajas ÷ \(bajas \+ miembros finales\)/);
  assert.match(AYUDAS_OVERVIEW.fuga, /segunda carga/);
  assert.match(AYUDAS_OVERVIEW.mi, /Mi/);
  assert.match(AYUDAS_OVERVIEW.mf, /Mf/);
  assert.match(AYUDAS_OVERVIEW.bajas, /\(B\)/);
});

test("ninguna explicación queda vacía y las claves son las que usa Overview", () => {
  const claves = ["inversion", "conversaciones", "cpmi", "entradas", "miembros_efectivos", "cpme", "fuga", "mi", "entradas_tabla", "bajas", "mf", "participacion"];
  assert.deepEqual(Object.keys(AYUDAS_OVERVIEW).sort(), claves.sort());
  for (const c of claves) assert.ok(AYUDAS_OVERVIEW[c].length > 20, c);
});

test("Overview muestra el botón i en las tarjetas y en los encabezados de la tabla", () => {
  assert.match(html, /items\.map\(\(\[v,l,,info\]\)/);
  assert.match(html, /class="info-btn" data-info="\$\{esc\(info\)\}"/);
  for (const k of ["inversion", "conversaciones", "cpmi", "entradas", "miembros_efectivos", "cpme", "fuga"]) assert.ok(html.includes(`AYUDAS_OVERVIEW.${k}]`), "tarjeta " + k);
  for (const k of ["mi", "entradas_tabla", "bajas", "mf", "participacion"]) assert.ok(html.includes(`AYUDAS_OVERVIEW.${k})`), "encabezado " + k);
});

test("la explicación de CPMI en Overview coincide con la de Control_Comunidades", () => {
  const c = html.match(/etiqueta:'CPMI'[^\n]*\n\s*info:'([^']+)'/);
  assert.ok(c, "no se encontró la ayuda de CPMI en Control_Comunidades");
  assert.match(c[1], /costo por mensaje iniciado/i);
  assert.match(c[1], /Inversión ÷ Conversaciones/);
  assert.match(AYUDAS_OVERVIEW.cpmi, /Inversión ÷ conversaciones iniciadas/);
});
