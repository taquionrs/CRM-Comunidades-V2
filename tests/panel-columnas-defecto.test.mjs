// Columnas de Control_Comunidades ocultas de fábrica (revisión del 17/11/2026). Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const i = html.indexOf("/* TABLA-METRICAS:INICIO */"), f = html.indexOf("/* ATAJOS-FECHAS:INICIO */");
assert.ok(i >= 0 && f > i);
const esc = (s) => String(s ?? "");
const armar = (almacen) => new Function("esc", "fmtDia", "localStorage", html.slice(i, f) + "\nreturn { leerColumnasControl, COLUMNAS_CONTROL, COLUMNAS_OCULTAS_DE_FABRICA };")(esc, (d) => d, almacen);
const vacio = { getItem: () => null };
const con = (obj) => ({ getItem: () => JSON.stringify(obj) });

test("sin elección guardada: se ocultan de fábrica las 16 columnas repetidas o de detalle, y quedan 20 visibles (17 más los 3 semáforos)", () => {
  const api = armar(vacio);
  const cfg = api.leerColumnasControl();
  assert.equal(cfg.ocultas.length, 16);
  assert.equal(api.COLUMNAS_CONTROL.length - cfg.ocultas.length, 20);
  for (const id of ["inversion", "clics_enlace", "ctr_enlace", "conversaciones", "cpl", "clic_conv", "entradas", "desfasaje", "costo_entrada", "trigger", "clics_me_sumo", "ctr_boton", "cpmn", "cpm_nuevo", "crr_periodo", "crr", "churn", "estado", "cobertura", "frescura"])
    assert.ok(!cfg.ocultas.includes(id), `${id} debe quedar visible`);
});

test("las de fábrica son ids que existen (no se pierde ninguna por un nombre mal escrito)", () => {
  const api = armar(vacio);
  const ids = api.COLUMNAS_CONTROL.map((c) => c.id);
  for (const id of api.COLUMNAS_OCULTAS_DE_FABRICA) assert.ok(ids.includes(id), id);
});

test("quien ya eligió sus columnas conserva su elección (aunque sea mostrar todo)", () => {
  const api = armar(con({ orden: ["crr", "inversion"], ocultas: [] }));
  const cfg = api.leerColumnasControl();
  assert.deepEqual(cfg.ocultas, []);
  assert.equal(cfg.orden[0], "estado");   // la columna nueva se inserta en su lugar natural, no al final
  assert.ok(cfg.orden.indexOf("crr") < cfg.orden.indexOf("inversion"));
  assert.equal(new Set(cfg.orden).size, api.COLUMNAS_CONTROL.length);
  assert.deepEqual(armar(con({ ocultas: ["mi"] })).leerColumnasControl().ocultas, ["mi"]);
});

test("sin almacenamiento disponible también arranca con las de fábrica", () => {
  const api = armar({ getItem: () => { throw new Error("bloqueado"); } });
  assert.equal(api.leerColumnasControl().ocultas.length, 16);
});

test("no se saca ninguna columna: todas siguen existiendo, solo cambia cuáles se ven", () => {
  const api = armar(vacio);
  assert.equal(api.COLUMNAS_CONTROL.length, 36);
});
