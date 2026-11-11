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
test("canal: solo trigger, clics en Me sumo, CTR del botón, entradas y clic/entradas se dividen por canal", () => {
  assert.deepEqual(COLUMNAS_CONTROL.filter((c) => c.porCanal).map((c) => c.id).sort(), ["clics_me_sumo", "ctr_boton", "entradas", "sin_clasificar", "tasa_me_sumo", "trigger"]);
  // lo que usa Meta, los miembros o la inversión no se divide (incluye el desfasaje y los chats sin registrar, que usan las conversaciones de Meta)
  for (const id of ["inversion", "clics_enlace", "ctr_enlace", "cpc_enlace", "conversaciones", "cpl", "clic_conv", "leads", "costo_lead", "ctr", "desfasaje", "chats_sin_registrar", "mi", "mf", "crecimiento", "bajas", "costo_entrada", "costo_clic", "cpmn", "fuga"]) {
    assert.ok(!col(id).porCanal, id);
  }
});

test("canal: el estado 'No se divide' explica por qué", () => {
  const html2 = api.vacio("no_canal");
  assert.match(html2, /No se divide/);
  assert.match(html2, /data-ayuda="[^"]*canal/);
});

// ---- CTR del botón: clics en "Me sumo" ÷ triggers entregados
const razon = (n, d, f = 1) => (d > 0 ? (n / d) * f : null);

test("CTR del botón: clics ÷ triggers, por comunidad y en el total", () => {
  assert.match(col("ctr_boton").celda({ triggers_entregados: 40, clics_me_sumo: 10 }), /25,0%/);
  assert.match(col("ctr_boton").total({ trig: 80, clicsms: 20, razon }), /25,0%/);
  assert.equal(col("ctr_boton").grupo, "Activación");
  assert.ok(col("ctr_boton").porCanal);
});

test("CTR del botón: sin triggers o sin clics registrados dice 'Sin fuente', no 0 %", () => {
  assert.match(col("ctr_boton").celda({ triggers_entregados: 0, clics_me_sumo: 5 }), /Sin fuente/);
  assert.match(col("ctr_boton").celda({ triggers_entregados: 30, clics_me_sumo: 0 }), /Sin fuente/);
  assert.match(col("ctr_boton").total({ trig: 0, clicsms: 0, razon }), /Sin fuente/);
  assert.match(col("ctr_boton").total({ trig: 50, clicsms: 0, razon }), /Sin fuente/);
});

test("CTR del botón: explica que los clics se registran desde el 09/10", () => {
  assert.match(col("ctr_boton").info, /desde el 09\/10/);
  assert.match(col("ctr_boton").info, /Trigger entregados/);
});

// ---- Orden por etapas del recorrido y métricas del embudo (PR #65, db/036)
test("las columnas van por etapas, cada etapa en un solo tramo y en este orden; la etapa Valor queda para después", () => {
  const etapas = ["Alcanzar", "Intención", "Control del tracking", "Activación", "Ingreso", "Permanencia"];
  assert.deepEqual(api.tramosDeGrupos(COLUMNAS_CONTROL).map((x) => x.grupo), etapas);
  assert.deepEqual(Object.keys(api.GRUPOS_TABLA), etapas);
  assert.ok(!COLUMNAS_CONTROL.some((c) => /valor|k-?factor/i.test(c.grupo + c.id)));
});

test("orden clave del embudo: clics en el enlace → conversaciones → entradas → desfasaje → chats sin registrar → ... → miembros → bajas", () => {
  const ids = COLUMNAS_CONTROL.map((c) => c.id);
  const pos = (id) => ids.indexOf(id);
  for (const [a, b] of [["clics_enlace", "conversaciones"], ["conversaciones", "entradas"], ["entradas", "desfasaje"], ["desfasaje", "chats_sin_registrar"],
    ["chats_sin_registrar", "trigger"], ["trigger", "mi"], ["mi", "bajas"]]) assert.ok(pos(a) >= 0 && pos(a) < pos(b), `${a} antes de ${b}`);
  assert.equal(pos("desfasaje"), pos("entradas") + 1, "el desfasaje va pegado a las entradas");
  assert.equal(new Set(ids).size, ids.length, "ids únicos");
  assert.equal(ids.includes("entradas_conv"), false, "'Entradas / conversaciones' se reemplazó por el desfasaje (100 % − cobertura)");
});

test("clics en el enlace: sin dato dice 'Sin fuente' (no 0) y el costo por clic es columna de plata", () => {
  assert.match(col("clics_enlace").celda({ clics_enlace: null }), /Sin fuente/);
  assert.match(col("clics_enlace").celda({ clics_enlace: 0 }), /^<span class="entero">0<\/span>$/);
  assert.match(col("clics_enlace").celda({ clics_enlace: 1377 }), /1\.377/);
  assert.match(col("clics_enlace").total({ clicsEnlace: null }), /Sin fuente/);
  assert.match(col("clics_enlace").total({ clicsEnlace: 11615 }), /11\.615/);
  assert.match(col("ctr_enlace").celda({ clics_enlace: 100, ctr_enlace_pct: 3.33 }), /3,3%/);
  assert.match(col("ctr_enlace").total({ clicsEnlace: 11615, impEnlace: 635238, razon }), /1,8%/);
  assert.match(col("cpc_enlace").celda({ clics_enlace: 100, cpc_enlace: 79.29 }), /\$79,29/);
  assert.match(col("cpc_enlace").total({ clicsEnlace: 11615, invEnlace: 920911.65, razon }), /\$79,29/);
  assert.match(col("cpc_enlace").celda({ clics_enlace: null }), /Sin fuente/);
  assert.equal(col("cpc_enlace").plata, true);
  assert.ok(!col("clics_enlace").plata && !col("ctr_enlace").plata);
});

test("clic → conversación: solo se calcula si TODOS los días del período traen los clics en el enlace", () => {
  assert.match(col("clic_conv").celda({ clics_enlace: 100, conversaciones_meta: 5, dias_sin_clics_enlace: 0 }), /5,0%/);
  assert.match(col("clic_conv").celda({ clics_enlace: 100, conversaciones_meta: 5, dias_sin_clics_enlace: 2 }), /Sin dato/);
  assert.match(col("clic_conv").celda({ clics_enlace: null, conversaciones_meta: 5 }), /Sin fuente/);
  assert.match(col("clic_conv").total({ clicsEnlace: 11615, conv: 201, diasSinEnlace: 0, razon }), /1,7%/);
  assert.match(col("clic_conv").total({ clicsEnlace: 11615, conv: 201, diasSinEnlace: 3, razon }), /Sin dato/);
  assert.match(col("clic_conv").total({ clicsEnlace: null, conv: 201, diasSinEnlace: 0, razon }), /Sin fuente/);
});

test("desfasaje: (conversaciones − entradas) ÷ conversaciones; con los números del 02 al 10/11 (Boedo 93 → 15) da 83,9 %", () => {
  assert.match(col("desfasaje").celda({ conversaciones_meta: 93, clics_unicos: 15 }), /83,9%/);
  assert.match(col("desfasaje").celda({ conversaciones_meta: 72, clics_unicos: 42 }), /41,7%/);
  assert.match(col("desfasaje").total({ convCom: 201, ent: 62, razon }), /69,2%/);
  assert.match(col("desfasaje").celda({ conversaciones_meta: 50, clics_unicos: 50 }), /0,0%/);
});

test("desfasaje: puede ser negativo (más entradas que conversaciones) y sin conversaciones o en la fila global dice 'Sin dato'", () => {
  assert.match(col("desfasaje").celda({ conversaciones_meta: 21, clics_unicos: 110 }), /-423,8%/);
  assert.match(col("desfasaje").celda({ conversaciones_meta: 0, clics_unicos: 4 }), /Sin dato/);
  assert.match(col("desfasaje").celda({ conversaciones_meta: 8, clics_unicos: 0, es_global: true }), /Sin dato/);
  assert.match(col("desfasaje").total({ convCom: 0, ent: 0, razon }), /Sin dato/);
  assert.match(col("desfasaje").info, /negativo/);
  assert.match(col("desfasaje").info, /no es la tasa de triaje/);
});

test("chats sin registrar: conversaciones − entradas en personas (negativo si hay más entradas); la fila global no se compara", () => {
  assert.match(col("chats_sin_registrar").celda({ conversaciones_meta: 93, clics_unicos: 15 }), />78</);
  assert.match(col("chats_sin_registrar").celda({ conversaciones_meta: 21, clics_unicos: 110 }), />-89</);
  assert.match(col("chats_sin_registrar").celda({ conversaciones_meta: 0, clics_unicos: 0 }), />0</);
  assert.match(col("chats_sin_registrar").celda({ conversaciones_meta: 8, clics_unicos: 0, es_global: true }), /Sin dato/);
  assert.match(col("chats_sin_registrar").total({ convCom: 201, ent: 62 }), />139</);
});

test("sin clasificar: no es de ninguna comunidad (cada fila dice 'Sin comunidad') y el total sale de Overview; sin avisos dice 'Sin fuente'", () => {
  assert.match(col("sin_clasificar").celda({}), /Sin comunidad/);
  assert.match(col("sin_clasificar").total({ sinClas: 7 }), />7</);
  assert.match(col("sin_clasificar").total({ sinClas: 0 }), />0</);
  assert.match(col("sin_clasificar").total({ sinClas: null }), /Sin fuente/);
});

test("el panel guarda el orden en una clave nueva y le pasa a la tabla las personas sin clasificar del cliente", () => {
  assert.match(html, /const CLAVE_COLUMNAS_CONTROL = 'crm_v2_control_comunidades_columnas_v2'/);
  assert.match(html, /loadEntradasFlow\(state\.fechaDesde \|\| null, state\.fechaHasta \|\| null, state\.canalControl\)/);
  assert.match(html, /state\.canalControl, desglose, entradasFlowControl\)/);
});
