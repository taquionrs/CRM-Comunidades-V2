// Campanita de novedades del CRM (como la de Pulso). Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const i = html.indexOf("/* NOVEDADES:INICIO */"), f = html.indexOf("/* NOVEDADES:FIN */");
assert.ok(i >= 0 && f > i, "no se encontró el bloque NOVEDADES en public/index.html");
const api = new Function(html.slice(i, f) + "\nreturn { NOVEDADES, NOVEDAD_TIPO, NOVEDAD_AREA, novedadesVisibles, contarNovedadesSinVer, novedadSinVer, fechaNovedad };")();
const { NOVEDADES } = api;

test("cada novedad tiene id único, fecha válida, tipo y área conocidos, título y detalle", () => {
  assert.ok(NOVEDADES.length >= 1);
  assert.equal(new Set(NOVEDADES.map((n) => n.id)).size, NOVEDADES.length, "ids repetidos");
  for (const n of NOVEDADES) {
    assert.match(n.id, /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/, n.id);
    assert.match(n.fecha, /^\d{4}-\d{2}-\d{2}$/, n.id);
    assert.ok(n.id.startsWith(n.fecha), `el id empieza con la fecha: ${n.id}`);
    assert.ok(api.NOVEDAD_TIPO[n.tipo], `${n.id}: tipo ${n.tipo}`);
    assert.ok(api.NOVEDAD_AREA[n.area], `${n.id}: área ${n.area}`);
    assert.ok(n.titulo.length > 5 && n.detalle.length > 20, n.id);
  }
});

test("la lista va de la más nueva a la más vieja (si no, el contador de 'sin ver' da mal)", () => {
  const fechas = NOVEDADES.map((n) => n.fecha);
  assert.deepEqual(fechas, [...fechas].sort().reverse());
});

test("la ruta de una novedad es una pestaña que existe", () => {
  const tabs = [...html.matchAll(/\{ key:'([a-z_]+)', label:/g)].map((m) => m[1]);
  for (const n of NOVEDADES.filter((x) => x.ruta)) assert.ok(tabs.includes(n.ruta), `${n.id}: ruta ${n.ruta}`);
});

test("no hay claves, correos ni teléfonos en las novedades", () => {
  const texto = JSON.stringify(NOVEDADES);
  assert.ok(!/eyJ[A-Za-z0-9_-]{20,}|sb_(secret|publishable)_|@[a-z0-9-]+\.[a-z]{2,}|\b549\d{8,}\b/i.test(texto));
});

test("contador: cuenta las más nuevas que la última vista; sin nada visto, todas; con un id que ya no existe, todas", () => {
  const l = [{ id: "c" }, { id: "b" }, { id: "a" }];
  assert.equal(api.contarNovedadesSinVer(null, l), 3);
  assert.equal(api.contarNovedadesSinVer("c", l), 0);
  assert.equal(api.contarNovedadesSinVer("b", l), 1);
  assert.equal(api.contarNovedadesSinVer("a", l), 2);
  assert.equal(api.contarNovedadesSinVer("zzz", l), 3);
  assert.equal(api.contarNovedadesSinVer("a", []), 0);
});

test("dentro del panel, 'sin ver' marca solo las más nuevas que la última vista al abrir", () => {
  const l = [{ id: "c" }, { id: "b" }, { id: "a" }];
  assert.deepEqual(l.map((n) => api.novedadSinVer(n.id, "b", l)), [true, false, false]);
  assert.deepEqual(l.map((n) => api.novedadSinVer(n.id, null, l)), [true, true, true]);
  assert.deepEqual(l.map((n) => api.novedadSinVer(n.id, "c", l)), [false, false, false]);
});

test("las novedades de Marketing no las ve el rol General", () => {
  const l = [{ id: "a", marketing: true }, { id: "b" }];
  assert.deepEqual(api.novedadesVisibles(l, false).map((n) => n.id), ["b"]);
  assert.deepEqual(api.novedadesVisibles(l, true).map((n) => n.id), ["a", "b"]);
  assert.ok(NOVEDADES.some((n) => n.marketing) && NOVEDADES.some((n) => !n.marketing));
});

test("la fecha sale en palabras", () => {
  assert.equal(api.fechaNovedad("2026-11-18"), "18 de noviembre");
  assert.equal(api.fechaNovedad("2026-01-05"), "5 de enero");
});

test("la campanita está en el encabezado, se monta con la sesión, se oculta sin acceso y recuerda lo visto con tolerancia a que no haya almacenamiento", () => {
  assert.match(html, /<div class="novedades-wrap" id="novedadesWrap" hidden><\/div>/);
  assert.match(html, /function renderSesion\(\)\{[\s\S]*?montarNovedades\(\);\n\}/);
  assert.match(html, /campanita\.hidden = true/);
  assert.match(html, /try \{ return localStorage\.getItem\(CLAVE_NOVEDADES_VISTO\); \} catch \(_\) \{ return null; \}/);
  assert.match(html, /try \{ localStorage\.setItem\(CLAVE_NOVEDADES_VISTO, id\); \} catch/);
  assert.match(html, /e\.key === 'Escape' && novedadesUI\.abierto/);
});

test("al abrir el panel se marcan como vistas y el botón 'Ir a' solo aparece si el rol ve esa pestaña", () => {
  assert.match(html, /if \(lista\[0\]\) guardarNovedadVisto\(lista\[0\]\.id\)/);
  assert.match(html, /tabsVisibles\(\)\.some\(t => t\.key === n\.ruta\)/);
});
