// Pruebas de los filtros de fecha y comunidad (bloque FILTROS-DATOS de public/index.html). Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const ini = html.indexOf("/* FILTROS-DATOS:INICIO */");
const fin = html.indexOf("/* FILTROS-DATOS:FIN */");
assert.ok(ini >= 0 && fin > ini, "no se encontró el bloque FILTROS-DATOS en public/index.html");
const { limitesFecha, aplicarFiltrosDatos, hayFiltroDatos, kpisDesdeComunidades } =
  new Function(html.slice(ini, fin) + "\nreturn { limitesFecha, aplicarFiltrosDatos, hayFiltroDatos, kpisDesdeComunidades };")();

// Una consulta falsa que anota cada llamada, como la de supabase-js.
const consulta = () => { const llamadas = []; const q = new Proxy({}, { get: (_, m) => (...a) => { llamadas.push([m, ...a]); return q; } }); return { q, llamadas }; };

test("el período se toma en hora de Buenos Aires y el día hasta queda incluido", () => {
  assert.deepEqual(limitesFecha("2026-10-01", "2026-10-31"), { gte: "2026-10-01T00:00:00-03:00", lt: "2026-11-01T00:00:00-03:00" });
  assert.equal(limitesFecha("2026-12-31", "2026-12-31").lt, "2027-01-01T00:00:00-03:00");
  assert.equal(limitesFecha("2026-02-28", "2026-02-28").lt, "2026-03-01T00:00:00-03:00");
  assert.deepEqual(limitesFecha("", null), { gte: null, lt: null });
  assert.deepEqual(limitesFecha("20/10/2026", "no"), { gte: null, lt: null });
});

test("aplicarFiltrosDatos agrega solo los filtros que hay, con las columnas de cada tabla", () => {
  let { q, llamadas } = consulta();
  aplicarFiltrosDatos(q, { desde: "2026-10-01", hasta: "2026-10-02", comunidad: "c1" }, "recibido_en", "comunidad_id");
  assert.deepEqual(llamadas, [["gte", "recibido_en", "2026-10-01T00:00:00-03:00"], ["lt", "recibido_en", "2026-10-03T00:00:00-03:00"], ["eq", "comunidad_id", "c1"]]);
  ({ q, llamadas } = consulta());
  aplicarFiltrosDatos(q, { desde: "", hasta: "", comunidad: "" }, "recibido_en", "comunidad_id");
  assert.deepEqual(llamadas, []);
  ({ q, llamadas } = consulta());
  aplicarFiltrosDatos(q, { comunidad: "c1" }, "fecha", null);   // una tabla sin columna de comunidad
  assert.deepEqual(llamadas, []);
  ({ q, llamadas } = consulta());
  assert.equal(aplicarFiltrosDatos(q, null, "fecha", "com"), q);
});

test("hayFiltroDatos", () => {
  assert.equal(hayFiltroDatos({ comunidad: "", desde: "", hasta: "" }), false);
  assert.equal(hayFiltroDatos({ comunidad: "", desde: "2026-10-01", hasta: "" }), true);
  assert.equal(hayFiltroDatos({ comunidad: "c1" }), true);
  assert.equal(hayFiltroDatos(null), false);
});

const C = (o) => ({ inversion: 0, conversaciones_meta: 0, clics_unicos: 0, miembros_iniciales: 0, miembros_finales: 0, bajas_estimadas: null, ...o });

test("totales de Overview a partir de las filas por comunidad (las mismas de Control_Comunidades)", () => {
  const k = kpisDesdeComunidades([
    C({ inversion: 1000, conversaciones_meta: 10, clics_unicos: 12, miembros_iniciales: 5, miembros_finales: 15, bajas_estimadas: 2 }),
    C({ inversion: 500, conversaciones_meta: 5, clics_unicos: 6, miembros_iniciales: 5, miembros_finales: 10, bajas_estimadas: null }),
  ]);
  assert.equal(k.inversion_total, 1500);
  assert.equal(k.conversaciones_totales, 15);
  assert.equal(k.cpl_global, 100);
  assert.equal(k.clics_unicos_totales, 18);
  assert.equal(k.miembros_efectivos_totales, 25);
  assert.equal(k.cpme_global, 100);                 // 1500 / (25 − 10)
  assert.equal(k.tasa_fuga_global_pct, 11.76);      // 2 / (2 + 15): solo cuentan las comunidades con bajas medidas
});

test("totales: sin plata (rol General), sin conversaciones o sin bajas medidas quedan vacíos, no en cero", () => {
  const g = kpisDesdeComunidades([C({ inversion: null, conversaciones_meta: 10, miembros_finales: 5 })]);
  assert.equal(g.inversion_total, null);
  assert.equal(g.cpl_global, null);
  assert.equal(g.cpme_global, null);
  assert.equal(g.conversaciones_totales, 10);
  const v = kpisDesdeComunidades([C({ inversion: 100, miembros_iniciales: 5, miembros_finales: 5 })]);
  assert.equal(v.cpl_global, null);                 // sin conversaciones
  assert.equal(v.cpme_global, null);                // MF − MI no es positivo
  assert.equal(v.tasa_fuga_global_pct, null);       // ninguna comunidad con bajas medidas
  assert.deepEqual([kpisDesdeComunidades([]).conversaciones_totales, kpisDesdeComunidades(null).inversion_total], [0, null]);
});

test("las vistas devuelven comunidad_id: el panel les agrega id para que los selectores y filtros funcionen", () => {
  assert.match(html, /const conIdComunidad = \(filas\) => \(filas \|\| \[\]\)\.map\(\(r\) => \(\{ \.\.\.r, id: r\.id \?\? r\.comunidad_id \}\)\)/);
  assert.match(html, /return conIdComunidad\(data\);[\s\S]{0,200}\/\/ Matriz de Control_Comunidades/);
  assert.equal((html.match(/return conIdComunidad\(data\);/g) || []).length, 2);
});

test("las cuatro pestañas usan los filtros: Overview, Base_Limpia, Data_Deduplicada y Data_Cruda", () => {
  assert.match(html, /loadComunidadesRango\(state\.fechaDesde \|\| null, state\.fechaHasta \|\| null, 'todos'\)/);
  assert.match(html, /loadBaseLimpia\(filtroDatos\(\)\)/);
  assert.match(html, /loadEventoDeduplicado\(filtroDatos\(\)\)/);
  assert.match(html, /loadEventoCrudo\(fd\), loadIntentosRechazados\(fd\), loadComunidades\(\), loadEnviosPlanilla\(\), loadContactosRepetidos\(fd\)/);
  assert.match(html, /traerTodo\('evento_crudo', 'recibido_en', filtroDatos\(\), 'comunidad_id'\)/);
});
