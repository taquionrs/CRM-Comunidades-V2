// Pruebas de la presentación de la tabla "Métricas por comunidad". Se extrae el bloque marcado TABLA-METRICAS de
// public/index.html (el panel no tiene build) y se evalúa acá. Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const ini = html.indexOf("/* TABLA-METRICAS:INICIO */");
const fin = html.indexOf("/* TABLA-METRICAS:FIN */");
assert.ok(ini >= 0 && fin > ini, "no se encontró el bloque TABLA-METRICAS en public/index.html");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const api = new Function("esc", html.slice(ini, fin) +
  "\nreturn { fmtMonedaTabla, fmtPctTabla, vMoneda, vPct, vEntero, vacio, sinMembresia, tramosDeGrupos, iniciosDeTramo, GRUPOS_TABLA };")(esc);

test("dinero: siempre dos decimales y separadores argentinos", () => {
  assert.equal(api.fmtMonedaTabla(5401.4), "$5.401,40");
  assert.equal(api.fmtMonedaTabla(7844266.43), "$7.844.266,43");
  assert.equal(api.fmtMonedaTabla(0), "$0,00");
});

test("porcentajes: un decimal y coma", () => {
  assert.equal(api.fmtPctTabla(66.666), "66,7%");
  assert.equal(api.fmtPctTabla(100), "100,0%");
});

test("valores vacíos: dicen por qué no hay número", () => {
  assert.match(api.vMoneda(null), /Sin dato/);
  assert.match(api.vPct(undefined), /Sin dato/);
  assert.match(api.vEntero(""), /Sin dato/);
  assert.match(api.vacio("sin_fuente"), /Sin fuente/);
  assert.match(api.vacio("no_disp"), /No disponible/);
});

test("el cero es un dato real, no un vacío", () => {
  assert.match(api.vEntero(0), /^<span class="entero">0<\/span>$/);
  assert.match(api.vMoneda(0), /\$0,00/);
});

test("el texto de ayuda de un estado vacío se escapa", () => {
  assert.ok(!api.vacio("sin_dato", 'dice "hola" <b>').includes("<b>"));
});

test("miembros sin cargar: solo cuando MI y MF están ambos en cero", () => {
  assert.equal(api.sinMembresia(0, 0), true);
  assert.equal(api.sinMembresia("0", "0"), true);
  assert.equal(api.sinMembresia(100, 140), false);
  assert.equal(api.sinMembresia(0, 40), false);
});

test("tramos de grupo: respeta el orden elegido y repite un grupo si queda partido", () => {
  const cols = [{ grupo: "A" }, { grupo: "A" }, { grupo: "B" }, { grupo: "A" }];
  assert.deepEqual(api.tramosDeGrupos(cols), [{ grupo: "A", n: 2 }, { grupo: "B", n: 1 }, { grupo: "A", n: 1 }]);
  assert.deepEqual(api.iniciosDeTramo(cols), [true, false, true, true]);
  assert.deepEqual(api.tramosDeGrupos([]), []);
});

test("cada grupo tiene color e ícono", () => {
  for (const [nombre, g] of Object.entries(api.GRUPOS_TABLA)) {
    assert.match(g.color, /^#[0-9A-Fa-f]{6}$/, nombre);
    assert.match(g.icono, /^<svg /, nombre);
  }
});

// ---- Bajas y fuga reales (db/021): NULL = "No calculable" hasta la segunda carga de lista completa
const finCols = html.indexOf("const COLOR_GRUPO");
const { COLUMNAS_CONTROL } = new Function("esc", html.slice(ini, finCols) + "\nreturn { COLUMNAS_CONTROL };")(esc);
const col = (id) => COLUMNAS_CONTROL.find((c) => c.id === id);

test("bajas y fuga: sin datos (null) dicen 'No calculable', no un número negativo ni cero", () => {
  assert.match(col("bajas").celda({ bajas_estimadas: null }), /No calculable/);
  assert.match(col("fuga").celda({ tasa_fuga_pct: null }), /No calculable/);
  assert.match(col("bajas").total({ bajasMed: 0 }), /No calculable/);
  assert.match(col("fuga").total({ bajasMed: 0 }), /No calculable/);
});

test("bajas y fuga: con datos muestran el valor (0 también es un dato)", () => {
  assert.match(col("bajas").celda({ bajas_estimadas: 0 }), /^<span class="entero">0<\/span>$/);
  assert.match(col("bajas").celda({ bajas_estimadas: 3 }), />3</);
  assert.match(col("fuga").celda({ tasa_fuga_pct: 9.09 }), /9,1%/);
});

test("total de bajas y de fuga: suman solo las comunidades donde se pueden calcular", () => {
  const t = { bajasMed: 2, bajas: 3, mfMed: 27, razon: (n, d, f = 1) => (d > 0 ? (n / d) * f : null) };
  assert.match(col("bajas").total(t), />3</);
  assert.match(col("fuga").total(t), /10,0%/); // 3 / (3 + 27)
});

// ---- Filtro de canal (db/022): solo lo que viene del flow de ManyChat se divide por canal
test("canal: solo trigger, clics en Me sumo, entradas y clic/entradas se dividen por canal", () => {
  assert.deepEqual(COLUMNAS_CONTROL.filter((c) => c.porCanal).map((c) => c.id).sort(), ["clics_me_sumo", "entradas", "tasa_me_sumo", "trigger"]);
  // lo que usa Meta, los miembros o la inversión no se divide (incluye entradas / conversaciones, que usa las conversaciones de Meta)
  for (const id of ["inversion", "conversaciones", "cpl", "leads", "costo_lead", "ctr", "entradas_conv", "mi", "mf", "crecimiento", "bajas", "costo_entrada", "costo_clic", "cpmn", "fuga"]) {
    assert.ok(!col(id).porCanal, id);
  }
});

test("canal: el estado 'No se divide' explica por qué", () => {
  const html2 = api.vacio("no_canal");
  assert.match(html2, /No se divide/);
  assert.match(html2, /data-ayuda="[^"]*canal/);
});
