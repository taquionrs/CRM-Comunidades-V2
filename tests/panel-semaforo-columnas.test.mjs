// Semáforos en columna de "Métricas por comunidad" (PR #89): Estado, Cobertura del tracking y Frescura de la lista. Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const corte = (a, b) => { const i = html.indexOf(a), f = html.indexOf(b); assert.ok(i >= 0 && f > i, `falta ${a}`); return html.slice(i, f); };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDia = (d) => { if (!d) return "—"; const [a, m, x] = String(d).slice(0, 10).split("-"); return `${x}/${m}/${a}`; };
const api = new Function("esc", "fmtDia",
  corte("/* SEMAFORO:INICIO */", "/* SEMAFORO:FIN */") + corte("/* TABLA-METRICAS:INICIO */", "const COLOR_GRUPO") +
  "\nreturn { COLUMNAS_CONTROL, semaforoFrescura, peorSemaforo, celdaCobertura, celdaFrescura, celdaEstado, celdaEstadoTotal, GRUPOS_TABLA, tramosDeGrupos };")(esc, fmtDia);
const col = (id) => api.COLUMNAS_CONTROL.find((c) => c.id === id);
const estadoDe = (h) => (h.match(/sem-dot sem-([a-z]+)/) || [])[1];

test("frescura: hasta 7 días verde, 8 a 14 amarillo, más de 14 rojo, sin cargas gris", () => {
  for (const [d, e] of [[0, "verde"], [7, "verde"], [8, "amarillo"], [14, "amarillo"], [15, "rojo"], [60, "rojo"], [null, "pocos"], [undefined, "pocos"]])
    assert.equal(api.semaforoFrescura(d).estado, e, String(d));
});

test("el peor semáforo gana; el gris no cuenta salvo que todos sean grises", () => {
  assert.equal(api.peorSemaforo(["verde", "amarillo"]), "amarillo");
  assert.equal(api.peorSemaforo(["verde", "rojo", "amarillo"]), "rojo");
  assert.equal(api.peorSemaforo(["verde", "pocos"]), "verde");
  assert.equal(api.peorSemaforo(["pocos", "pocos"]), "pocos");
  assert.equal(api.peorSemaforo([]), "pocos");
  assert.equal(api.peorSemaforo(["verde", "revisar"]), "revisar");
});

test("cobertura: punto de color, porcentaje y explicación al pasar el mouse", () => {
  const rojo = api.celdaCobertura(307, 41);   // 13,4 %
  assert.equal(estadoDe(rojo), "rojo");
  assert.match(rojo, /13,4%/);
  assert.match(rojo, /title="Cobertura 13,4%: menos de 35 % \(41 entradas de 307 chats\)\./);
  assert.equal(estadoDe(api.celdaCobertura(100, 80)), "verde");
  assert.equal(estadoDe(api.celdaCobertura(100, 50)), "amarillo");
  assert.equal(estadoDe(api.celdaCobertura(100, 130)), "revisar");
  const pocos = api.celdaCobertura(10, 5);
  assert.equal(estadoDe(pocos), "pocos");
  assert.match(pocos, /10 chats/);
  assert.match(pocos, /Menos de 20 chats/);
});

test("frescura: muestra los días y explica el rango; sin cargas lo dice; sin la función aplicada avisa que falta db/049", () => {
  const v = api.celdaFrescura({ dias: 3 });
  assert.equal(estadoDe(v), "verde"); assert.match(v, /3 días/); assert.match(v, /hace 3 días: hasta 7 días/);
  assert.match(api.celdaFrescura({ dias: 1 }), /1 día</);
  assert.equal(estadoDe(api.celdaFrescura({ dias: 22 })), "rojo");
  const s = api.celdaFrescura({ dias: null });
  assert.equal(estadoDe(s), "pocos"); assert.match(s, /Sin cargas/);
  assert.match(api.celdaFrescura(undefined), /db\/049/);
});

test("estado = el peor entre cobertura y frescura, con el detalle de los dos en el mouse", () => {
  const c = { conversaciones_meta: 100, clics_unicos: 80, _frescura: { dias: 22 } };   // cobertura verde, lista roja
  const h = api.celdaEstado(c);
  assert.equal(estadoDe(h), "rojo");
  assert.match(h, />Rojo</);
  assert.match(h, /Cobertura 80,0%/); assert.match(h, /hace 22 días/);
  assert.equal(estadoDe(api.celdaEstado({ conversaciones_meta: 100, clics_unicos: 80, _frescura: { dias: 2 } })), "verde");
  assert.equal(estadoDe(api.celdaEstado({ conversaciones_meta: 5, clics_unicos: 5, _frescura: { dias: null } })), "pocos");
  assert.match(api.celdaEstado({ es_global: true }), /Sin comunidad/);
});

test("estado del total: usa la cobertura total y la lista más vieja", () => {
  const h = api.celdaEstadoTotal({ convCom: 965, ent: 400, frescuraPeor: { dias: 10 } });   // 41,5 % amarillo, lista amarilla
  assert.equal(estadoDe(h), "amarillo");
});

test("las columnas nuevas existen, no sacan ninguna de las anteriores y respetan su etapa", () => {
  assert.equal(col("estado").grupo, "Estado");
  assert.equal(api.COLUMNAS_CONTROL[0].id, "estado");   // "al principio"
  assert.equal(col("cobertura").grupo, "Control del tracking");
  assert.equal(col("frescura").grupo, "Permanencia");
  for (const id of ["desfasaje", "chats_sin_registrar", "bajas", "fuga", "crr", "churn", "cpmn"]) assert.ok(col(id), id);
  assert.ok(api.GRUPOS_TABLA["Estado"]);
});

test("en la fila de campañas globales la cobertura dice por qué no aplica", () => {
  assert.match(col("cobertura").celda({ es_global: true }), /campañas globales/i);
});

test("el panel pide la frescura, se la pasa a la tabla y tolera que db/049 no esté aplicada", () => {
  assert.match(html, /supabase\.rpc\('frescura_miembros', \{ p_cliente: state\.clienteId \}\)/);
  assert.match(html, /loadFrescura\(\),\n      \]\);/);
  assert.match(html, /filaFrescura = \(c\) => \(frescura \?/);
  assert.match(html, /\.tabla-metricas \.sem-dot\{/);
});
