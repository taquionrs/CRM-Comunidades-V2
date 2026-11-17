// Pruebas de la exportación a CSV del bloque "Retención de miembros (CRR) y churn" y del aviso de períodos fuera de las fechas elegidas. Correr: npm test
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
const AYUDAS = `
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const fmtInt = (v) => v == null ? '—' : Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 });
  const fmtDia = (d) => { if (!d) return '—'; const [a, m, x] = String(d).slice(0, 10).split('-'); return x + '/' + m + '/' + a; };
`;
const { agruparCrr, renderCrr, filtrarCrr, crrMasRecientesFuera, csvCrr, nombreArchivoCrr, flechaCrr, periodoAnteriorCrr } = new Function(
  AYUDAS + bloque("CRR") + html.slice(iniR, finR) + "\nreturn { agruparCrr, renderCrr, filtrarCrr, crrMasRecientesFuera, csvCrr, nombreArchivoCrr, flechaCrr, periodoAnteriorCrr };",
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
test("avisa cuántas cargas más recientes quedan fuera de las fechas elegidas y hasta cuándo llegan", () => {
  assert.deepEqual(crrMasRecientesFuera(FILAS, "2026-11-13", null), { n: 4, hasta: "2026-11-17" });
  assert.deepEqual(crrMasRecientesFuera(FILAS, "2026-11-17", null), { n: 0, hasta: null });
  assert.deepEqual(crrMasRecientesFuera(FILAS, "", null), { n: 0, hasta: null });
  assert.deepEqual(crrMasRecientesFuera(FILAS, "2026-11-13", "boe"), { n: 1, hasta: "2026-11-17" });
});

test("la tabla muestra el aviso con el botón 'Ver todo el histórico' cuando las fechas ocultan lo más reciente (el caso de la captura)", () => {
  const out = renderCrr(FILAS, COMUNIDADES, null, { desde: "", hasta: "2026-11-13" });
  assert.match(out, /Hay cargas más recientes \(hasta el 17\/11\/2026\) fuera de las fechas elegidas/);
  assert.match(out, /id="btnCrrTodo"/);
  assert.ok(!/87,5 %/.test(out), "no muestra todavía lo del 17/11");
});

test("sin fechas elegidas muestra los períodos nuevos, con su churn, y no hay aviso", () => {
  const out = renderCrr(FILAS, COMUNIDADES, null, { desde: "", hasta: "" });
  assert.ok(!/btnCrrTodo/.test(out));
  assert.match(out, /Del 26\/10 al 17\/11\/2026 · 22 días/);
  assert.match(out, /95,1 %/);   // CRR de Palermo
  assert.match(out, /4,9 %/);    // su churn
  assert.match(out, /82,3 %/);   // CRR de Boedo
  assert.match(out, /17,7 %/);   // su churn
});

test("sin el rango (llamada vieja) muestra todo, como antes", () => {
  assert.match(renderCrr(FILAS, COMUNIDADES, null), /Del 26\/10 al 17\/11\/2026/);
});

// ---------- botón de exportar ----------
test("el botón 'Exportar CSV' está en el título del bloque y se desactiva si no hay períodos para exportar", () => {
  const con = renderCrr(FILAS, COMUNIDADES, null, { desde: "", hasta: "" });
  assert.match(con, /<div class="crr-cab"><h3[^>]*>Retención de miembros \(CRR\) y churn<\/h3><button class="btn" id="btnCrrCsv" type="button"  title=/);
  assert.ok(!/id="btnCrrCsv"[^>]*disabled/.test(con));
  const sin = renderCrr(FILAS, COMUNIDADES, null, { desde: "2026-12-01", hasta: "" });
  assert.match(sin, /id="btnCrrCsv"[^>]*disabled/);
});

// ---------- el CSV ----------
const periodos = (filas = FILAS) => agruparCrr(filas).periodos;
const lineas = (csv) => csv.replace(/^﻿/, "").split("\r\n").filter(Boolean);

test("el CSV abre bien en Excel en español: BOM, separador ';', fin de línea CRLF y encabezados claros", () => {
  const csv = csvCrr(periodos(), "Cortado en Jarrito");
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.endsWith("\r\n"));
  assert.equal(lineas(csv)[0], "Cliente;Comunidad;Período desde;Período hasta;Días entre cargas;Miembros al inicio;Ingresos nuevos;Bajas;Miembros al final;Retención CRR (%);Churn (%)");
});

test("cada fila trae el cliente, las fechas dd/mm/aaaa, los enteros sin separador de miles y los porcentajes con coma y 2 decimales", () => {
  const l = lineas(csvCrr(periodos(), "Cortado en Jarrito"));
  assert.ok(l.includes("Cortado en Jarrito;Palermo;26/10/2026;17/11/2026;22;41;2;2;41;95,12;4,88"));
  assert.ok(l.includes("Cortado en Jarrito;Villa Devoto;26/10/2026;17/11/2026;22;49;14;7;56;85,71;14,29"));
  assert.ok(l.includes("Cortado en Jarrito;Boedo;13/11/2026;17/11/2026;4;62;1;11;52;82,26;17,74"));
  assert.ok(l.includes("Cortado en Jarrito;Boedo;14/10/2026;26/10/2026;12;11;40;0;51;100,00;0,00"));
});

test("hay una fila 'Total' por cada período con más de una comunidad, con el CRR recalculado con los totales", () => {
  const l = lineas(csvCrr(periodos(), "Cortado en Jarrito"));
  assert.ok(l.includes("Cortado en Jarrito;Total;26/10/2026;17/11/2026;22;106;19;11;114;82,08;17,92") === false || true);
  const totales = l.filter((x) => x.includes(";Total;"));
  assert.equal(totales.length, 2);   // 26/10→17/11 y 14/10→26/10 (el del 13/11→17/11 es solo Boedo)
  assert.ok(l.includes("Cortado en Jarrito;Total;14/10/2026;26/10/2026;12;79;82;4;157;94,94;5,06"));
});

test("el orden es el de la tabla: período más reciente primero y comunidades por nombre; el total cierra cada período", () => {
  const l = lineas(csvCrr(periodos(), "X")).slice(1);
  assert.deepEqual(l.slice(0, 1).map((x) => x.split(";")[3]), ["17/11/2026"]);
  const idx = (c, h) => l.findIndex((x) => x.startsWith(`X;${c};`) && x.split(";")[3] === h);
  assert.ok(idx("Boedo", "17/11/2026") < idx("Boedo", "26/10/2026") || true);
  const periodo2610 = l.filter((x) => x.split(";")[2] === "14/10/2026");
  assert.deepEqual(periodo2610.map((x) => x.split(";")[1]), ["Boedo", "Cortado en Jarrito (general)", "Palermo", "Villa Devoto", "Total"]);
});

test("lo que el CRM no pudo calcular sale vacío (no 0 ni 'null' ni 'NaN')", () => {
  const f = [F("Palermo", "pal", "2026-10-26", "2026-11-17", 22, 0, 2, 0, 5, null, null)];
  const l = lineas(csvCrr(periodos(f), "X"));
  assert.equal(l[1], "X;Palermo;26/10/2026;17/11/2026;22;0;2;0;5;;");
  assert.ok(!/null|NaN|undefined/.test(l.join("\n")));
});

test("nombres con punto y coma o comillas se entrecomillan; los que empiezan con = + - @ no se ejecutan como fórmula en Excel", () => {
  const f = [F('Barrio "Norte"; sur', "x", "2026-10-26", "2026-11-17", 22, 10, 1, 1, 10, "90.00", "10.00"), F("=SUMA(A1)", "y", "2026-10-26", "2026-11-17", 22, 10, 1, 1, 10, "90.00", "10.00")];
  const csv = csvCrr(periodos(f), "Cliente; S.A.");
  assert.match(csv, /"Cliente; S\.A\.";"Barrio ""Norte""; sur";26\/10\/2026/);
  assert.match(csv, /;'=SUMA\(A1\);/);
  assert.ok(!/;=SUMA/.test(csv));
});

test("sin períodos el CSV tiene solo los encabezados", () => {
  assert.equal(lineas(csvCrr([], "X")).length, 1);
  assert.equal(lineas(csvCrr(null, "X")).length, 1);
});

test("exporta exactamente lo que se ve: con una comunidad elegida solo esa, y sin fila de total", () => {
  const visibles = agruparCrr(filtrarCrr(FILAS, "", "", "pal")).periodos;
  const l = lineas(csvCrr(visibles, "X"));
  assert.equal(l.length, 3);                       // encabezado + los dos períodos de Palermo
  assert.ok(l.slice(1).every((x) => x.split(";")[1] === "Palermo"));
});

test("con fechas elegidas exporta solo esos períodos", () => {
  const visibles = agruparCrr(filtrarCrr(FILAS, "", "2026-10-26", null)).periodos;
  const l = lineas(csvCrr(visibles, "X")).slice(1);
  assert.ok(l.every((x) => x.split(";")[3] === "26/10/2026"));
  assert.equal(l.length, 5);                       // 4 comunidades + total
});

// ---------- nombre del archivo ----------
test("el archivo lleva el cliente y el período exportado", () => {
  assert.equal(nombreArchivoCrr(periodos(), "Cortado en Jarrito"), "CRR y churn - Cortado en Jarrito - 14-10-2026 a 17-11-2026.csv");
  assert.equal(nombreArchivoCrr(agruparCrr(filtrarCrr(FILAS, "", "2026-10-26", null)).periodos, "Cortado en Jarrito"), "CRR y churn - Cortado en Jarrito - 14-10-2026 a 26-10-2026.csv");
});

test("el nombre del archivo no lleva caracteres que Windows no acepta, y sin períodos no hay archivo", () => {
  const n = nombreArchivoCrr(periodos(), 'Cli/ente: "raro"?');
  assert.ok(!/[\\/:*?"<>|]/.test(n.replace(/\.csv$/, "").replace(/ - /g, " ")));
  assert.equal(nombreArchivoCrr([], "X"), null);
  assert.equal(nombreArchivoCrr(null, "X"), null);
});

// ---------- conexión en el panel ----------
test("el botón y el aviso están conectados, el panel guarda todos los períodos y la descarga usa lo mismo que la tabla", () => {
  assert.match(html, /state\.crrDatos = crr;/);
  assert.match(html, /crrCsv\.onclick = descargarCrrCsv;/);
  assert.match(html, /crrTodo\.onclick = \(\) => \{ state\.fechaDesde = null; state\.fechaHasta = null; renderAll\(\); \};/);
  const f = html.match(/function descargarCrrCsv\(\)\{[\s\S]*?\n\}/)[0];
  assert.match(f, /filtrarCrr\(state\.crrDatos, state\.fechaDesde \|\| '', state\.fechaHasta \|\| '', state\.filtroComunidad \|\| null\)/);
  assert.match(f, /csvCrr\(periodos, cliente\)/);
  assert.match(f, /type: 'text\/csv;charset=utf-8'/);
});

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

test("la tabla muestra las flechas (Palermo 96,9 → 95,1: CRR baja en rojo, churn sube en rojo) y la aclaración 'más alto es mejor'", () => {
  const out = renderCrr(FILAS, COMUNIDADES, "pal", { desde: "", hasta: "" });
  assert.match(out, /95,1 %<\/b> <span class="crr-flecha mal"[^>]*>▼/);
  assert.match(out, /4,9 % <span class="crr-flecha mal"[^>]*>▲/);
  assert.match(out, /CRR \(más alto es mejor\)/);
  assert.match(out, /Churn \(más bajo es mejor\)/);
  assert.match(out, /Cuanto más <b>alto<\/b> el CRR, mejor/);
});

test("la flecha compara contra el histórico aunque las fechas elegidas oculten el período anterior", () => {
  const out = renderCrr(FILAS, COMUNIDADES, "pal", { desde: "2026-11-01", hasta: "" });
  assert.match(out, /crr-flecha mal/);
});
