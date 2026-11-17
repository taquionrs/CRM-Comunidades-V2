// El panel no muestra las comunidades ocultas (db/047): el canal oficial "(general)" no es una comunidad. Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");

test("la lista de comunidades (selectores, Comunidades, Data) deja afuera las ocultas", () => {
  const f = html.match(/async function loadComunidades\(\)\{[\s\S]*?\n\}/)[0];
  assert.match(f, /\.filter\(c => !c\.oculta\)/);
});

test("campañas y carga de miembros tampoco ofrecen las comunidades ocultas", () => {
  assert.match(html, /select\('id,nombre,cliente_id,oculta'\)[\s\S]{0,120}comunidades = \(data \|\| \[\]\)\.filter\(c => !c\.oculta\)/);
  assert.match(html, /select\('id,nombre,miembros_iniciales,miembros_finales,oculta'\)[\s\S]{0,140}\.filter\(c => !c\.oculta\)/);
});
