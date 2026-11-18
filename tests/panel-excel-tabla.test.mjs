// Excel con formato de "Métricas por comunidad" (PR #94). Se arma el libro con ExcelJS de verdad, se lee de vuelta y se revisa. Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ExcelJS from "exceljs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const i = html.indexOf("/* CRR:INICIO */"), f = html.indexOf("/* CRR:FIN */");
assert.ok(i >= 0 && f > i);
const api = new Function(html.slice(i, f) + "\nreturn { textoDeCelda, celdaParaExcel, armarLibroTabla, mezclarColor, nombreArchivoTabla, csvTabla };")();

const sem = (estado, texto, extra = "") => `<span class="sem-item" title="x"><i class="sem-dot sem-${estado}" aria-hidden="true"></i><span>${texto}</span><span class="sr-only"> (${estado})</span></span>${extra}`;
const FLECHA = (bien, sube) => `<span class="crr-flecha ${bien ? "bien" : "mal"}" title="x">${sube ? "▲" : "▼"}</span>`;
const COLUMNAS = [
  { grupo: "Estado", etiqueta: "Estado", color: "#9AA3B5" },
  { grupo: "Alcanzar", etiqueta: "Inversión", color: "#6E9BFF" },
  { grupo: "Alcanzar", etiqueta: "CTR del enlace", color: "#6E9BFF" },
  { grupo: "Intención", etiqueta: "Conversaciones", color: "#4DC3E8" },
  { grupo: "Control del tracking", etiqueta: "Cobertura del tracking", color: "#4FD39A" },
  { grupo: "Permanencia", etiqueta: "Período entre cargas (CRR)", color: "#F58FB8" },
  { grupo: "Permanencia", etiqueta: "Retención (CRR)", color: "#F58FB8" },
  { grupo: "Permanencia", etiqueta: "Churn", color: "#F58FB8" },
  { grupo: "Ingreso", etiqueta: "Costo por miembro neto", color: "#B79CFF" },
];
const FILAS = [
  { nombre: "Palermo", celdas: [sem("amarillo", "Amarillo"), '<span class="moneda">$1.247.902,27</span>', '<span class="pct">1,8%</span>', '<span class="entero">308</span>', sem("rojo", "13,4%"),
    '<span class="entero">26/10 → 17/11</span>', `<span class="pct">95,1%</span> ${FLECHA(false, false)}`, `<span class="pct">4,9%</span> ${FLECHA(false, true)}`, '<span class="vacio" tabindex="0" data-ayuda="x">Sin dato</span>'] },
  { nombre: "Villa Devoto", celdas: [sem("verde", "Verde"), '<span class="moneda">$956.516,99</span>', '<span class="pct">2,2%</span>', '<span class="entero">351</span>', sem("verde", "68,1%"),
    '<span class="entero">26/10 → 17/11</span>', `<span class="pct">85,7%</span> ${FLECHA(true, true)}`, `<span class="pct">14,3%</span>`, '<span class="moneda">$70.897,77</span>'] },
  { nombre: "Total del cliente", total: true, celdas: [sem("amarillo", "Amarillo"), '<span class="moneda">$2.980.500,27</span>', '<span class="pct">2,0%</span>', '<span class="entero">966</span>', sem("amarillo", "55,5%"),
    '<span class="entero">26/10 → 17/11</span>', '<span class="pct">90,0%</span>', '<span class="pct">10,0%</span>', '<span class="moneda">$75,07</span>'] },
];
const DATOS = { cliente: "Cortado en Jarrito", columnas: COLUMNAS, filas: FILAS, desde: "2026-10-26", hasta: "2026-11-17", comunidad: "", canal: "todos", generado: "18/11/2026" };
const leer = async (datos = DATOS) => { const wb = api.armarLibroTabla(ExcelJS, datos); const b = await wb.xlsx.writeBuffer(); const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(b); return wb2.getWorksheet("Métricas por comunidad"); };

test("las celdas se leen como número, moneda, porcentaje o texto con formato argentino", () => {
  const c = api.celdaParaExcel;
  assert.deepEqual([c('<span class="moneda">$1.247.902,27</span>').tipo, c('<span class="moneda">$1.247.902,27</span>').valor], ["moneda", 1247902.27]);
  assert.deepEqual([c('<span class="pct">2,2%</span>').tipo, c('<span class="pct">2,2%</span>').valor], ["pct", 0.022]);
  assert.deepEqual([c('<span class="entero">10.175</span>').tipo, c('<span class="entero">10.175</span>').valor], ["num", 10175]);
  assert.equal(c('<span class="entero">-3</span>').valor, -3);
  assert.equal(c('<span class="moneda">-$10,00</span>').valor, -10);
  assert.equal(c('<span class="entero">26/10 → 17/11</span>').tipo, "texto");
  assert.equal(c('<span class="entero">3 días</span>').tipo, "texto");
  assert.equal(c('<span class="vacio" data-ayuda="x">Sin dato</span>').tipo, "vacio");
});

test("el semáforo y la flechita se conservan; el texto para lectores de pantalla no se duplica (era 'Amarillo (Amarillo)')", () => {
  const x = api.celdaParaExcel(sem("amarillo", "Amarillo"));
  assert.equal(x.valor, "Amarillo"); assert.equal(x.estado, "amarillo");
  const y = api.celdaParaExcel(`<span class="pct">95,1%</span> ${FLECHA(false, false)}`);
  assert.deepEqual(y.flecha, { bueno: false, sube: false });
  assert.equal(y.valor, 0.951);
  assert.ok(!/\(Amarillo\)/.test(api.csvTabla(["x"], [{ nombre: "P", celdas: [sem("amarillo", "Amarillo")] }], "C")));
});

test("el libro tiene título, subtítulo con el período y la fecha, etapas combinadas, encabezados y filtros", async () => {
  const h = await leer();
  assert.equal(h.getCell("A1").value, "Métricas por comunidad · Cortado en Jarrito");
  assert.match(h.getCell("A2").value, /Período: 26\/10\/2026 a 17\/11\/2026/);
  assert.match(h.getCell("A2").value, /Generado el 18\/11\/2026/);
  assert.equal(h.getCell("A4").value, "Comunidad");
  assert.equal(h.getCell("B4").value, "Estado");
  assert.equal(h.getCell("C4").value, "Alcanzar");
  assert.equal(h.getCell("E4").value, "Intención");
  assert.equal(h.getCell("G4").value, "Permanencia");
  assert.ok(Object.keys(h._merges).length >= 6);   // título, subtítulo, Comunidad y los tramos Alcanzar y Permanencia, más la nota
  assert.equal(h.getCell("D5").value, "CTR del enlace");
  assert.equal(h.autoFilter, "A5:J5");
});

test("congela el encabezado y la columna de comunidad, sin cuadrícula, apaisado y a un ancho de página", async () => {
  const h = await leer();
  const v = h.views[0];
  assert.equal(v.state, "frozen"); assert.equal(v.xSplit, 1); assert.equal(v.ySplit, 5); assert.equal(v.showGridLines, false);
  assert.equal(h.pageSetup.orientation, "landscape"); assert.equal(h.pageSetup.fitToWidth, 1);
});

test("los números son números de verdad con su formato: moneda, porcentaje y enteros (no texto)", async () => {
  const h = await leer();
  const inv = h.getCell("C6");     // Inversión de Palermo
  assert.equal(inv.value, 1247902.27); assert.match(inv.numFmt, /\$/); assert.match(inv.numFmt, /0\.00/);
  const ctr = h.getCell("D6");
  assert.equal(ctr.value, 0.018); assert.match(ctr.numFmt, /%/);
  const conv = h.getCell("E6");
  assert.equal(conv.value, 308); assert.match(conv.numFmt, /#,##0/);
});

test("el semáforo se pinta: rojo, verde y amarillo con su fondo y su letra", async () => {
  const h = await leer();
  assert.equal(h.getCell("B6").fill.fgColor.argb, "FFFFF0D0");   // Palermo: estado amarillo
  assert.equal(h.getCell("F6").fill.fgColor.argb, "FFFBD9DE");   // cobertura 13,4 % rojo
  assert.equal(h.getCell("B7").fill.fgColor.argb, "FFD6F5E6");   // Villa Devoto: verde
  assert.equal(h.getCell("F7").font.color.argb, "FF157A4B");
});

test("las flechitas van en el formato del número y con color: roja si empeoró, verde si mejoró", async () => {
  const h = await leer();
  const crr = h.getCell("H6"), churn = h.getCell("I6"), mejor = h.getCell("H7");
  assert.equal(crr.value, 0.951); assert.match(crr.numFmt, /▼/); assert.equal(crr.font.color.argb, "FFB0243C");
  assert.equal(churn.value, 0.049); assert.match(churn.numFmt, /▲/); assert.equal(churn.font.color.argb, "FFB0243C");
  assert.match(mejor.numFmt, /▲/); assert.equal(mejor.font.color.argb, "FF157A4B");
});

test("lo que no tiene dato dice «—» y no queda en blanco ni en cero", async () => {
  const h = await leer();
  assert.equal(h.getCell("J6").value, "—");
});

test("la fila del total se destaca (negrita, fondo y borde superior marcado)", async () => {
  const h = await leer();
  const t = h.getCell("A8");
  assert.equal(t.value, "Total del cliente");
  assert.equal(t.font.bold, true);
  assert.equal(t.fill.fgColor.argb, "FFE3EAF8");
  assert.equal(t.border.top.style, "medium");
  assert.equal(h.getCell("C8").font.bold, true);
});

test("los colores de las etapas salen de los de la tabla (más oscuro arriba, más claro en el nombre de la columna)", () => {
  assert.equal(api.mezclarColor("#FFFFFF", 0.5, 0), "FF808080");
  assert.equal(api.mezclarColor("#000000", 0.5, 255), "FF808080");
  assert.match(api.mezclarColor("#6E9BFF", 0.45, 0), /^FF[0-9A-F]{6}$/);
});

test("lleva el nombre de la comunidad y el canal en el subtítulo cuando están elegidos, y una nota al pie", async () => {
  const h = await leer({ ...DATOS, desde: "", hasta: "", comunidad: "Palermo", canal: "whatsapp" });
  assert.match(h.getCell("A2").value, /Período: todo el histórico/);
  assert.match(h.getCell("A2").value, /Comunidad: Palermo/);
  assert.match(h.getCell("A2").value, /Canal: WhatsApp/);
  assert.match(h.getCell("A10").value, /Fuente: CRM de Comunidades/);
});

test("el nombre del archivo lleva la extensión pedida", () => {
  assert.match(api.nombreArchivoTabla("Cortado en Jarrito", "", "", "xlsx"), /todo el histórico\.xlsx$/);
  assert.match(api.nombreArchivoTabla("Cortado en Jarrito", "", ""), /\.csv$/);
});

test("el botón y la descarga están conectados, con ExcelJS de cdnjs en una versión fija y tolerando que falle la carga", () => {
  assert.match(html, /id="btnTablaXlsx"/);
  assert.match(html, /tablaXlsx\.onclick = descargarTablaXlsx;/);
  assert.match(html, /cdnjs\.cloudflare\.com\/ajax\/libs\/exceljs\/4\.4\.0\/exceljs\.min\.js/);
  assert.match(html, /No se pudo armar el Excel: /);
  assert.match(html, /id="btnTablaCsv"/);   // el CSV sigue estando
});
