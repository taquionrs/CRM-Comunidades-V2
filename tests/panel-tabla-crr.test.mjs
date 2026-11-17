// Pruebas del CRR y churn dentro de la tabla principal "Métricas por comunidad" y de su botón "Exportar CSV". Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const corte = (a, b) => { const i = html.indexOf(a), f = html.indexOf(b); assert.ok(i >= 0 && f > i, `falta ${a}`); return html.slice(i, f); };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDia = (d) => { if (!d) return "—"; const [a, m, x] = String(d).slice(0, 10).split("-"); return `${x}/${m}/${a}`; };
const api = new Function("esc", "fmtDia",
  corte("/* TABLA-METRICAS:INICIO */", "const COLOR_GRUPO") + corte("/* CRR:INICIO */", "/* CRR:FIN */") +
  "\nreturn { COLUMNAS_CONTROL, crrVigente, crrTotalVigente, textoDeCelda, csvTabla, nombreArchivoTabla, flechaCrr };")(esc, fmtDia);
const col = (id) => api.COLUMNAS_CONTROL.find((c) => c.id === id);

const F = (c, id, desde, hasta, dias, ini, nue, baj, fin, crr, churn) => ({ comunidad_id: id, comunidad: c, desde, hasta, dias, miembros_inicio: ini, nuevos: nue, bajas: baj, miembros_fin: fin, crr_pct: crr, churn_pct: churn, cuadra: true });
const FILAS = [
  F("Palermo", "pal", "2026-10-26", "2026-11-17", 22, 41, 2, 2, 41, "95.12", "4.88"),
  F("Villa Devoto", "dev", "2026-10-26", "2026-11-17", 22, 49, 14, 7, 56, "85.71", "14.29"),
  F("Palermo", "pal", "2026-10-14", "2026-10-26", 12, 32, 10, 1, 41, "96.88", "3.12"),
  F("Villa Devoto", "dev", "2026-10-14", "2026-10-26", 12, 26, 25, 2, 49, "92.31", "7.69"),
];
const COMS = [{ id: "pal", nombre: "Palermo" }, { id: "dev", nombre: "Villa Devoto" }, { id: "glob", nombre: "Global", es_global: true }];

test("las columnas de CRR están en la tabla principal, dentro de Permanencia, y no se sacó ninguna de las que había", () => {
  const nuevas = ["crr_periodo", "crr_inicio", "crr_nuevos", "crr_bajas", "crr_fin", "crr", "churn"];
  for (const id of nuevas) assert.equal(col(id).grupo, "Permanencia", id);
  for (const id of ["inversion", "entradas", "trigger", "mi", "mf", "bajas", "fuga", "cpmn", "sin_clasificar"]) assert.ok(col(id), id);
  const ids = api.COLUMNAS_CONTROL.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("de cada comunidad toma el último período dentro de las fechas y trae el anterior para la flechita", () => {
  const v = api.crrVigente(FILAS, "", "", "pal");
  assert.equal(v.hasta, "2026-11-17"); assert.equal(v.crr, 95.12); assert.equal(v.anterior.crr, 96.88);
  const w = api.crrVigente(FILAS, "", "2026-10-31", "pal");
  assert.equal(w.hasta, "2026-10-26"); assert.equal(w.anterior, null);
  assert.equal(api.crrVigente(FILAS, "2026-12-01", "", "pal"), null);
  assert.equal(api.crrVigente(FILAS, "", "", "glob"), null);
});

test("el total suma las comunidades y recalcula el CRR con los totales (sin la global)", () => {
  const t = api.crrTotalVigente(FILAS, "", "", COMS);
  assert.deepEqual([t.inicio, t.nuevos, t.bajas, t.fin], [90, 16, 9, 97]);
  assert.equal(t.crr, 90);      // (97-16)/90
  assert.equal(t.churn, 10);
  assert.equal(t.desde, "2026-10-26"); assert.equal(t.hasta, "2026-11-17");
  assert.equal(t.comparacion.crrAntes, 94.83);   // (90-35)/58
  assert.equal(api.crrTotalVigente(FILAS, "2026-12-01", "", COMS), null);
});

test("celdas: CRR con flecha (Palermo bajó de 96,9 a 95,1: roja), churn con flecha, enteros y período", () => {
  const c = { _crr: api.crrVigente(FILAS, "", "", "pal") };
  assert.match(col("crr").celda(c), /95,1%.*crr-flecha mal[^>]*>▼/);
  assert.match(col("churn").celda(c), /4,9%.*crr-flecha mal[^>]*>▲/);
  assert.match(col("crr_inicio").celda(c), />41</);
  assert.match(col("crr_nuevos").celda(c), />2</);
  assert.match(col("crr_bajas").celda(c), />2</);
  assert.match(col("crr_fin").celda(c), />41</);
  assert.match(col("crr_periodo").celda(c), /26\/10 → 17\/11/);
});

test("sin dos cargas la celda dice por qué no hay número (no 0)", () => {
  for (const id of ["crr", "churn", "crr_inicio", "crr_periodo"]) assert.match(col(id).celda({ _crr: null }), /Sin dato/);
  assert.match(col("crr").total({ crrTotal: null }), /Sin dato/);
});

test("el total del cliente muestra su CRR", () => {
  const t = { crrTotal: api.crrTotalVigente(FILAS, "", "", COMS) };
  assert.match(col("crr").total(t), /90,0%/);
  assert.match(col("churn").total(t), /10,0%/);
});

test("CSV: encabezados con la etapa, BOM, ';', texto sin HTML, vacíos en blanco y sin flechas", () => {
  const c = { _crr: api.crrVigente(FILAS, "", "", "pal") };
  const filas = [{ nombre: "Palermo", celdas: [col("crr").celda(c), col("churn").celda(c), col("crr_periodo").celda(c), col("crr").celda({ _crr: null })] }];
  const csv = api.csvTabla(["Permanencia - Retención (CRR)", "Permanencia - Churn", "Permanencia - Período entre cargas (CRR)", "Permanencia - X"], filas, "Cortado en Jarrito");
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const l = csv.replace(/^﻿/, "").split("\r\n").filter(Boolean);
  assert.equal(l[0], "Cliente;Comunidad;Permanencia - Retención (CRR);Permanencia - Churn;Permanencia - Período entre cargas (CRR);Permanencia - X");
  assert.equal(l[1], "Cortado en Jarrito;Palermo;95,1%;4,9%;26/10 → 17/11;");
  assert.ok(!/[▲▼<>]|Sin dato/.test(csv.replace(/^﻿/, "")));
});

test("CSV: números negativos quedan como números, y lo que parece fórmula no se ejecuta", () => {
  const csv = api.csvTabla(["a", "b", "c"], [{ nombre: "=SUMA(1)", celdas: ['<span class="entero">-3</span>', '<span class="moneda">-$10,00</span>', "-abc"] }], "X");
  assert.match(csv, /X;'=SUMA\(1\);-3;-\$10,00;'-abc/);
});

test("el nombre del archivo lleva cliente y fechas, o 'todo el histórico'", () => {
  assert.equal(api.nombreArchivoTabla("Cortado en Jarrito", "2026-10-26", "2026-11-17"), "Métricas por comunidad - Cortado en Jarrito - 26-10-2026 a 17-11-2026.csv");
  assert.equal(api.nombreArchivoTabla("Cortado en Jarrito", "", ""), "Métricas por comunidad - Cortado en Jarrito - todo el histórico.csv");
  assert.ok(!/[\/:*?"<>|]/.test(api.nombreArchivoTabla('A/B: "x"', "", "").replace(/\.csv$/, "").replace(/ - /g, " ")));
});

test("el panel arma el botón y lo conecta; la tabla de CRR de abajo sigue existiendo", () => {
  assert.match(html, /id="btnTablaCsv"/);
  assert.match(html, /tablaCsv\.onclick = descargarTablaCsv;/);
  assert.match(html, /crrTotal: crr \? crrTotalVigente\(crr, desde, hasta, comunidades\) : null/);
  assert.match(html, /\$\{renderCrr\(crr, comunidades, filtroComunidad, \{ desde, hasta \}\)\}/);
  assert.match(html, /id="btnCrrCsv"/);
});
