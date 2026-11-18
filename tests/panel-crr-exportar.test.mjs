// Pruebas de la exportación a CSV del filtro de períodos y de las flechitas del CRR. Correr: npm test
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
const { agruparCrr, filtrarCrr, flechaCrr, periodoAnteriorCrr } = new Function(
  AYUDAS + bloque("CRR") + "\nreturn { agruparCrr, filtrarCrr, flechaCrr, periodoAnteriorCrr };",
)();

// Los períodos reales de Cortado en Jarrito al 17/11/2026 (los que devuelve el CRM).
const F = (c, id, desde, hasta, dias, ini, nue, baj, fin, crr, churn) => ({ comunidad_id: id, comunidad: c, desde, hasta, dias, miembros_inicio: ini, nuevos: nue, bajas: baj, miembros_fin: fin, crr_pct: crr, churn_pct: churn, cuadra: true });
const FILAS = [
  F("Boedo", "boe", "2026-11-13", "2026-11-17", 4, 62, 1, 11, 52, "82.26", "17.74"),
  F("Cortado en Jarrito (general)", "gen", "2026-10-26", "2026-11-17", 22, 16, 3, 2, 17, "87.50", "12.50"),
  F("Palermo", "pal", "2026-10-26", "2026-11-17", 22, 41, 2, 2, 41, "95.12", "4.88"),
  F("Villa Devoto", "dev", "2026-10-26", "2026-11-17", 22, 49, 14, 7, 56, "85.71", "14.29"),
  F("Boedo", "boe", "2026-10-26", "2026-11-13", 18, 51, 11, 0, 62, "100.00", "0.00"),
  F("Boedo", "boe", "2026-10-14", "2026-10-26", 12, 11, 40, 0, 51, "100.00", "0.00"),
  F("Cortado en Jarrito (general)", "gen", "2026-10-14", "2026-10-26", 12, 10, 7, 1, 16, "90.00", "10.00"),
  F("Palermo", "pal", "2026-10-14", "2026-10-26", 12, 32, 10, 1, 41, "96.88", "3.12"),
  F("Villa Devoto", "dev", "2026-10-14", "2026-10-26", 12, 26, 25, 2, 49, "92.31", "7.69"),
];
const COMUNIDADES = [{ id: "boe", nombre: "Boedo" }, { id: "gen", nombre: "Cortado en Jarrito (general)" }, { id: "pal", nombre: "Palermo" }, { id: "dev", nombre: "Villa Devoto" }];

// ---------- filtro por fechas y comunidad ----------
test("sin fechas trae todo; con fechas, los períodos cuya carga de cierre cae adentro (inclusive)", () => {
  assert.equal(filtrarCrr(FILAS, "", "", null).length, 9);
  assert.equal(filtrarCrr(FILAS, "2026-10-26", "2026-10-26", null).length, 4);     // cierran el 26/10
  assert.equal(filtrarCrr(FILAS, "", "2026-11-13", null).length, 5);               // hasta el 13/11 no entran los del 17/11
  assert.equal(filtrarCrr(FILAS, "2026-11-14", "", null).length, 4);               // solo los del 17/11
  assert.equal(filtrarCrr(FILAS, "2026-11-18", "", null).length, 0);
});

test("con una comunidad elegida solo esa, y las dos condiciones se combinan", () => {
  assert.deepEqual(filtrarCrr(FILAS, "", "", "pal").map((f) => f.hasta), ["2026-11-17", "2026-10-26"]);
  assert.equal(filtrarCrr(FILAS, "", "2026-10-26", "boe").length, 1);
});

test("las fechas pueden venir con hora o como Date serializado", () => {
  const f = [F("Palermo", "pal", "2026-10-26", "2026-11-17T03:00:00.000Z", 22, 41, 2, 2, 41, "95.12", "4.88")];
  assert.equal(filtrarCrr(f, "", "2026-11-17", null).length, 1);
  assert.equal(filtrarCrr(f, "", "2026-11-16", null).length, 0);
});

// ---------- aviso de períodos más recientes fuera de las fechas ----------
// ---------- flechitas de tendencia ----------
test("CRR: sube y es verde si mejoró, baja y es roja si empeoró; churn al revés (bajar es bueno)", () => {
  assert.match(flechaCrr(95, 90, true), /crr-flecha bien[^>]*>▲/);
  assert.match(flechaCrr(85, 90, true), /crr-flecha mal[^>]*>▼/);
  assert.match(flechaCrr(5, 10, false), /crr-flecha bien[^>]*>▼/);
  assert.match(flechaCrr(14, 8, false), /crr-flecha mal[^>]*>▲/);
});

test("sin dato anterior o sin cambio no hay flechita, y dice contra qué compara", () => {
  assert.equal(flechaCrr(90, null, true), "");
  assert.equal(flechaCrr(null, 90, true), "");
  assert.equal(flechaCrr(90, 90.004, true), "");
  assert.match(flechaCrr(95.12, 90, true), /Mejoró respecto del período anterior \(90,0 %\)/);
});

test("compara con el período anterior de la misma comunidad (aunque otro período lo separe) y el total con el total", () => {
  const ps = agruparCrr(FILAS).periodos;
  const p = ps.find((x) => x.hasta === "2026-11-17" && x.filas.length === 3);
  assert.equal(periodoAnteriorCrr(ps, p, "pal").hasta, "2026-10-26");
  const pb = ps.find((x) => x.desde === "2026-11-13");
  assert.equal(periodoAnteriorCrr(ps, pb, "boe").hasta, "2026-11-13");
  assert.equal(periodoAnteriorCrr(ps, p, null).crr, 94.94);
  const primero = ps[ps.length - 1];
  assert.equal(periodoAnteriorCrr(ps, primero, "pal"), null);
});

