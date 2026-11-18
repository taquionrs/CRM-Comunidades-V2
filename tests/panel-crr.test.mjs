// Pruebas del cálculo y la agrupación del CRR (bloque CRR de public/index.html). Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const bloque = (nombre) => {
  const ini = html.indexOf(`/* ${nombre}:INICIO */`), fin = html.indexOf(`/* ${nombre}:FIN */`);
  assert.ok(ini >= 0 && fin > ini, `no se encontró el bloque ${nombre} en public/index.html`);
  return html.slice(ini, fin);
};

const AYUDAS = `
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const fmtInt = (v) => v == null ? '—' : Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 });
  const fmtDia = (d) => { if (!d) return '—'; const [a, m, x] = String(d).slice(0, 10).split('-'); return x + '/' + m + '/' + a; };
`;
const { calcularCrr, agruparCrr } = new Function(AYUDAS + bloque("CRR") + "\nreturn { calcularCrr, agruparCrr };")();

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
