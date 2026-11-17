// Pruebas del bloque "Retención de miembros (CRR)" de Control_Comunidades (bloque CRR y renderCrr de public/index.html). Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const bloque = (nombre) => {
  const ini = html.indexOf(`/* ${nombre}:INICIO */`), fin = html.indexOf(`/* ${nombre}:FIN */`);
  assert.ok(ini >= 0 && fin > ini, `no se encontró el bloque ${nombre} en public/index.html`);
  return html.slice(ini, fin);
};
const iniR = html.indexOf("function renderCrr("), finR = html.indexOf("function renderRendimiento(");
assert.ok(iniR >= 0 && finR > iniR, "no se encontró renderCrr en public/index.html");

const AYUDAS = `
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const fmtInt = (v) => v == null ? '—' : Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 });
  const fmtDia = (d) => { if (!d) return '—'; const [a, m, x] = String(d).slice(0, 10).split('-'); return x + '/' + m + '/' + a; };
`;
const { calcularCrr, agruparCrr, renderCrr, filtrarCrr, crrMasRecientesFuera, csvCrr, nombreArchivoCrr } = new Function(AYUDAS + bloque("CRR") + html.slice(iniR, finR) + "\nreturn { calcularCrr, agruparCrr, renderCrr, filtrarCrr, crrMasRecientesFuera, csvCrr, nombreArchivoCrr };")();

// Las filas reales de Cortado en Jarrito (cargas del 14/10, 26/10 y 13/11).
const fila = (o) => ({ comunidad_id: "boe", comunidad: "Boedo", desde: "2026-10-14", hasta: "2026-10-26", dias: 12, miembros_inicio: 11, nuevos: 40, bajas: 0, miembros_fin: 51, crr_pct: 100, churn_pct: 0, cuadra: true, ...o });
const PAL = fila({ comunidad_id: "pal", comunidad: "Palermo", miembros_inicio: 32, nuevos: 10, bajas: 1, miembros_fin: 41, crr_pct: 96.88, churn_pct: 3.12 });
const DEV = fila({ comunidad_id: "dev", comunidad: "Villa Devoto", miembros_inicio: 26, nuevos: 25, bajas: 2, miembros_fin: 49, crr_pct: 92.31, churn_pct: 7.69 });
const BOE2 = fila({ desde: "2026-10-26", hasta: "2026-11-13", dias: 18, miembros_inicio: 51, nuevos: 11, miembros_fin: 62 });
const COMUNIDADES = [{ id: "boe", nombre: "Boedo" }, { id: "pal", nombre: "Palermo" }, { id: "dev", nombre: "Villa Devoto" }, { id: "gen", nombre: "Cortado en Jarrito (general)" }, { id: "glob", nombre: "Campañas globales", es_global: true }];

test("CRR = (final − nuevos) ÷ inicio × 100 y churn = 100 − CRR", () => {
  assert.deepEqual(calcularCrr(32, 10, 41), { crr: 96.88, churn: 3.12 });
  assert.deepEqual(calcularCrr(26, 25, 49), { crr: 92.31, churn: 7.69 });
  assert.deepEqual(calcularCrr(11, 40, 51), { crr: 100, churn: 0 });
});

test("sin miembros al inicio no hay CRR (null, no NaN ni infinito)", () => {
  assert.deepEqual(calcularCrr(0, 5, 5), { crr: null, churn: null });
  assert.deepEqual(calcularCrr(null, null, null), { crr: null, churn: null });
});

test("agrupa por período y suma el total solo cuando hay más de una comunidad", () => {
  const g = agruparCrr([fila({}), PAL, DEV, BOE2]);
  assert.equal(g.periodos.length, 2);
  assert.equal(g.periodos[0].hasta, "2026-11-13");   // el más reciente primero
  assert.equal(g.periodos[0].total, null);           // Boedo sola: no hay total
  const p = g.periodos[1];
  assert.deepEqual(p.filas.map((x) => x.comunidad), ["Boedo", "Palermo", "Villa Devoto"]);
  assert.deepEqual([p.total.inicio, p.total.nuevos, p.total.bajas, p.total.fin], [69, 75, 3, 141]);
  assert.equal(p.total.crr, 95.65);
  assert.equal(p.total.churn, 4.35);
});

test("el total es el mismo con la fórmula del CRR y con 1 − bajas ÷ inicio cuando las cargas cuadran", () => {
  const p = agruparCrr([fila({}), PAL, DEV]).periodos[0];
  assert.equal(p.total.crr, Math.round((1 - p.total.bajas / p.total.inicio) * 10000) / 100);
});

test("las fechas vienen como Date o como texto y se normalizan a AAAA-MM-DD", () => {
  const g = agruparCrr([fila({ desde: new Date("2026-10-14T00:00:00Z").toISOString(), hasta: "2026-10-26T03:00:00.000Z" })]);
  assert.equal(g.periodos[0].desde, "2026-10-14");
  assert.equal(g.periodos[0].hasta, "2026-10-26");
});

test("lista vacía o nula no rompe", () => {
  for (const x of [[], null, undefined]) assert.equal(agruparCrr(x).periodos.length, 0);
});

test("el bloque muestra el período, las cifras y el total", () => {
  const out = renderCrr([fila({}), PAL, DEV], COMUNIDADES, null);
  assert.match(out, /Retención de miembros \(CRR\) y churn/);
  assert.match(out, /Del 14\/10 al 26\/10\/2026 · 12 días/);
  assert.match(out, /96,9 %/);        // Palermo 96,88 → 96,9 %
  assert.match(out, /92,3 %/);        // Devoto
  assert.match(out, />Total</);
  assert.match(out, /95,7 %/);        // total 95,65 → 95,7 %
});

test("avisa qué comunidades no tienen CRR en las fechas elegidas", () => {
  const out = renderCrr([BOE2], COMUNIDADES, null);
  assert.match(out, /Sin CRR en estas fechas: Palermo, Villa Devoto, Cortado en Jarrito \(general\)/);
  assert.ok(!/Campañas globales/.test(out), "las campañas globales no son una comunidad");
});

test("con una comunidad elegida muestra solo esa", () => {
  const out = renderCrr([fila({}), PAL, DEV], COMUNIDADES, "pal");
  assert.match(out, /Palermo/);
  assert.ok(!/Villa Devoto/.test(out));
  assert.ok(!/>Total</.test(out));
});

test("si las cargas no cuadran lo marca en la fila", () => {
  const out = renderCrr([fila({ cuadra: false })], COMUNIDADES, null);
  assert.match(out, /no cuadra/);
  assert.ok(!/no cuadra/.test(renderCrr([fila({})], COMUNIDADES, null)));
});

test("sin períodos explica qué falta; sin respuesta de la base lo dice sin romper la página", () => {
  assert.match(renderCrr([], COMUNIDADES, null), /Ninguna comunidad tiene dos cargas de lista completa/);
  assert.match(renderCrr(null, COMUNIDADES, null), /No se pudo cargar el CRR/);
});

test("un CRR sin base (null) se muestra como guion", () => {
  const out = renderCrr([fila({ miembros_inicio: 0, crr_pct: null, churn_pct: null })], COMUNIDADES, null);
  assert.match(out, /<b>—<\/b>/);
});

test("el nombre de la comunidad no rompe el HTML", () => {
  const out = renderCrr([fila({ comunidad: 'A "B" <i>' })], COMUNIDADES, null);
  assert.ok(!out.includes("<i>"));
  assert.match(out, /A &quot;B&quot; &lt;i&gt;/);
});

test("el bloque queda dentro de Control_Comunidades, lo ven todos los roles y va antes del rendimiento por anuncio", () => {
  assert.match(html, /\$\{renderCrr\(crr, comunidades, filtroComunidad, \{ desde, hasta \}\)\}\n\s*\$\{!esMarketing\(\) \? '' : renderRendimiento\(/);
  assert.match(html, /loadCrr\(null, null\)/);
  assert.ok(!/key:'crr'/.test(html), "no tiene que haber una pestaña aparte");
});
