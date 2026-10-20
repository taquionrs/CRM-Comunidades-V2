// Pruebas del desglose de campañas de Control_Comunidades (bloque DESGLOSE de public/index.html). Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const ini = html.indexOf("/* DESGLOSE:INICIO */");
const fin = html.indexOf("/* DESGLOSE:FIN */");
assert.ok(ini >= 0 && fin > ini, "no se encontró el bloque DESGLOSE en public/index.html");
const { agruparDesglose, cubreDesglose } = new Function(html.slice(ini, fin) + "\nreturn { agruparDesglose, cubreDesglose };")();

const F = (medio, campana, adset, comunidad_nombre, inversion, conversaciones, clics = 0, impresiones = 0) =>
  ({ medio, campana, adset, comunidad_nombre, inversion, conversaciones, clics, impresiones });

test("agrupa por medio y campaña, con los conjuntos adentro y el más caro primero", () => {
  const g = agruparDesglose([
    F("Meta Ads", "TRAFICO", "BOEDO", "Boedo", 71790.46, 45, 100, 5000),
    F("Meta Ads", "TRAFICO", "PALERMO", "Palermo", 75830.97, 8, 90, 4000),
    F("Meta Ads", "TRAFICO", "DEVOTO", "Devoto", 72498.2, 32, 80, 3000),
  ]);
  assert.equal(g.medios.length, 1);
  assert.equal(g.medios[0].medio, "Meta Ads");
  assert.equal(g.medios[0].campanas.length, 1);
  const c = g.medios[0].campanas[0];
  assert.deepEqual(c.conjuntos.map(j => j.adset), ["PALERMO", "DEVOTO", "BOEDO"]);
  assert.equal(Math.round(c.inversion * 100) / 100, 220119.63);
  assert.equal(c.conversaciones, 85);
  assert.equal(c.clics, 270);
});

test("otro medio (por ejemplo Google Ads) aparece como un grupo aparte, sin mezclarse con Meta", () => {
  const g = agruparDesglose([
    F("Meta Ads", "A", "", "General", 100, 1),
    F("Google Ads", "B", "", "General", 300, 3),
  ]);
  assert.deepEqual(g.medios.map(m => m.medio), ["Google Ads", "Meta Ads"]);
  assert.equal(g.total.inversion, 400);
  assert.equal(g.total.conversaciones, 4);
});

test("una campaña repartida en comunidades suma todo en el total de la campaña", () => {
  const g = agruparDesglose([F("Meta Ads", "C", "", "Uno", 10, 1), F("Meta Ads", "C", "", "Dos", 5, 2)]);
  assert.equal(g.medios[0].campanas.length, 1);
  assert.equal(g.medios[0].campanas[0].inversion, 15);
  assert.equal(g.medios[0].campanas[0].conjuntos.length, 2);
});

test("sin filas o con valores nulos no falla", () => {
  assert.deepEqual(agruparDesglose([]).medios, []);
  assert.deepEqual(agruparDesglose(null).medios, []);
  assert.equal(agruparDesglose(null).total.inversion, 0);
  const g = agruparDesglose([F("Meta Ads", "C", null, null, null, null)]);
  assert.equal(g.total.inversion, 0);
  assert.equal(g.medios[0].campanas[0].conjuntos[0].adset, "");
});

test("cubreDesglose: completo si coincide con la tabla (hasta $1 por redondeo); si no, avisa cuánto falta", () => {
  assert.equal(cubreDesglose(220119.63, 220119.63).completo, true);
  assert.equal(cubreDesglose(220119.0, 220119.63).completo, true);
  const falta = cubreDesglose(100, 1000);
  assert.equal(falta.completo, false);
  assert.equal(falta.falta, 900);
  assert.equal(cubreDesglose(0, 500).completo, false);
  assert.equal(cubreDesglose(0, 0).completo, true);
});

test("el panel carga el desglose sin romper la tabla si falla, y lo dibuja debajo de la tabla", () => {
  assert.match(html, /rpc\('desglose_campanas'/);
  assert.match(html, /if \(error\) \{ console\.warn\('desglose_campanas:'[^}]*return null;/);
  assert.match(html, /<\/table><\/div>\s*<\/div>\s*\$\{renderDesglose\(/);
});
