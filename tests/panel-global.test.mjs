// Pruebas de la fila de "Campañas globales (sin comunidad)" (bloque GLOBAL-CLIENTE de public/index.html, db/034). Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const ini = html.indexOf("/* GLOBAL-CLIENTE:INICIO */");
const fin = html.indexOf("/* GLOBAL-CLIENTE:FIN */");
assert.ok(ini >= 0 && fin > ini, "no se encontró el bloque GLOBAL-CLIENTE en public/index.html");
const { filaGlobalCliente, NOMBRE_FILA_GLOBAL } = new Function(html.slice(ini, fin) + "\nreturn { filaGlobalCliente, NOMBRE_FILA_GLOBAL };")();

test("la fila global lleva las columnas de una comunidad y deja vacías las de miembros y entradas", () => {
  const f = filaGlobalCliente({ inversion: "1800.00", conversaciones_meta: "8", impresiones: "180", clics: "18", leads_meta: "2" });
  assert.equal(f.nombre, NOMBRE_FILA_GLOBAL);
  assert.equal(f.nombre, "Campañas globales (sin comunidad)");
  assert.equal(f.es_global, true);
  assert.equal(f.id, "__global__");
  assert.equal(f.comunidad_id, null);
  assert.deepEqual([f.inversion, f.conversaciones_meta, f.impresiones, f.clics, f.leads_meta], [1800, 8, 180, 18, 2]);
  assert.deepEqual([f.clics_unicos, f.triggers_entregados, f.clics_me_sumo, f.miembros_iniciales, f.miembros_finales], [0, 0, 0, 0, 0]);
  assert.equal(f.bajas_estimadas, null);
  assert.equal(f.cpl, 225);              // 1800 ÷ 8
  assert.equal(f.costo_por_lead, 900);   // 1800 ÷ 2
  assert.equal(f.ctr_anuncio_pct, 10);   // 18 ÷ 180
  assert.equal(f.cpcu, null);            // sin entradas propias: no hay costo por entrada de esta fila
});

test("sin datos no hay fila; sin plata (rol General) la inversión queda vacía pero los conteos se ven", () => {
  assert.equal(filaGlobalCliente(null), null);
  assert.equal(filaGlobalCliente({ inversion: 0, conversaciones_meta: 0, impresiones: 0, clics: 0, leads_meta: 0 }), null);
  const g = filaGlobalCliente({ inversion: null, conversaciones_meta: 8, impresiones: 100, clics: 10, leads_meta: 0 });
  assert.equal(g.inversion, null);
  assert.equal(g.cpl, null);
  assert.equal(g.conversaciones_meta, 8);
});

test("Control_Comunidades suma la fila global al total pero no la ofrece como comunidad ni la muestra con una comunidad elegida", () => {
  assert.match(html, /\[\.\.\.comunidadesRango, global\]/);
  assert.match(html, /comunidades\.filter\(c => !c\.es_global\)\.map\(c =>/);
  assert.match(html, /porComunidad = filtroComunidad \? comunidades\.filter\(c => c\.id === filtroComunidad\)/);
});

test("Overview incluye el gasto global en los KPIs y no en la tabla de comunidades", () => {
  assert.match(html, /const paraKpis = global && !state\.filtroComunidad \? \[\.\.\.visibles, global\] : visibles;/);
  assert.match(html, /renderOverview\(kpisDesdeComunidades\(paraKpis\), visibles,/);
});
