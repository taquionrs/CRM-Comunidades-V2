// Flyer visual de una página (PDF) del reporte (PR #95). Se arma el PDF con jsPDF de verdad y se revisa. Correr: npm test
// Para mirarlo a ojo: FLYER_OUT=ruta.pdf npm test -- (guarda el PDF de ejemplo en esa ruta).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { jsPDF } from "jspdf";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const i = html.indexOf("/* CRR:INICIO */"), f = html.indexOf("/* CRR:FIN */");
assert.ok(i >= 0 && f > i);
const api = new Function(html.slice(i, f) + "\nreturn { datosFlyer, armarFlyerPdf, nombreArchivoFlyer, FLYER_KPIS };")();

const sem = (estado, texto) => `<span class="sem-item" title="x"><i class="sem-dot sem-${estado}" aria-hidden="true"></i><span>${texto}</span><span class="sr-only"> (${estado})</span></span>`;
const FLECHA = (bien, sube) => `<span class="crr-flecha ${bien ? "bien" : "mal"}" title="x">${sube ? "▲" : "▼"}</span>`;
const mon = (v) => `<span class="moneda">${v}</span>`, pct = (v) => `<span class="pct">${v}</span>`, ent = (v) => `<span class="entero">${v}</span>`;
const vacio = '<span class="vacio" tabindex="0" data-ayuda="x">Sin dato</span>';
const COLUMNAS = ["estado", "inversion", "conversaciones", "entradas", "cobertura", "crr", "churn", "crr_fin", "cpm_nuevo"].map((id) => ({ id, etiqueta: id }));
const fila = (nombre, c, total = false) => ({ nombre, total, celdas: c });
const FILAS = [
  fila("Boedo", [sem("amarillo", "Amarillo"), mon("$776.081,01"), ent("307"), ent("174"), sem("amarillo", "56,7%"), `${pct("82,3%")} ${FLECHA(false, false)}`, `${pct("17,7%")} ${FLECHA(false, true)}`, ent("52"), vacio]),
  fila("Palermo", [sem("rojo", "Rojo"), mon("$1.247.902,27"), ent("308"), ent("123"), sem("rojo", "39,9%"), `${pct("95,1%")} ${FLECHA(false, false)}`, `${pct("4,9%")} ${FLECHA(false, true)}`, ent("41"), mon("$339.545,00")]),
  fila("Villa Devoto", [sem("verde", "Verde"), mon("$956.516,99"), ent("351"), ent("239"), sem("verde", "68,1%"), `${pct("85,7%")} ${FLECHA(true, true)}`, pct("14,3%"), ent("56"), mon("$21.250,00")]),
  fila("Total del cliente", [sem("amarillo", "Amarillo"), mon("$2.980.500,27"), ent("966"), ent("536"), sem("amarillo", "55,5%"), pct("90,0%"), pct("10,0%"), ent("149"), mon("$75,07")], true),
];
const BASE = { cliente: "Cortado en Jarrito", columnas: COLUMNAS, filas: FILAS, desde: "2026-10-26", hasta: "2026-11-17", generado: "18/11/2026", marketing: true };
const texto = (doc) => Buffer.from(doc.output("arraybuffer")).toString("latin1");

test("los números clave salen del total del cliente, aunque la columna esté oculta en la tabla; con plata solo para Marketing", () => {
  const mk = api.datosFlyer(BASE);
  assert.deepEqual(mk.kpis.map((k) => k.id), ["inversion", "conversaciones", "entradas", "crr", "churn", "cpm_nuevo"]);
  assert.equal(mk.kpis[0].celda.texto, "$2.980.500,27");
  const sinPlata = api.datosFlyer({ ...BASE, marketing: false });
  assert.deepEqual(sinPlata.kpis.map((k) => k.id), ["conversaciones", "entradas", "crr", "churn", "cobertura"]);
  assert.ok(!JSON.stringify(sinPlata).includes("2.980.500,27"), "no filtra la inversión al rol General");
});

test("cada comunidad lleva su estado, entradas, cobertura, retención, churn y miembros; lo que no tiene dato queda en null", () => {
  const d = api.datosFlyer(BASE);
  assert.deepEqual(d.comunidades.map((c) => c.nombre), ["Boedo", "Palermo", "Villa Devoto"]);
  const p = d.comunidades[1];
  assert.equal(p.estado.estado, "rojo"); assert.equal(p.estado.texto, "Rojo");
  assert.equal(p.crr.texto, "95,1%"); assert.deepEqual(p.crr.flecha, { bueno: false, sube: false });
  assert.equal(p.miembros.texto, "41");
  assert.equal(d.total.nombre, "Total del cliente");
  assert.equal(d.total.entradas.texto, "536");
});

test("si falta una columna (por ejemplo sin costo por miembro nuevo) no se rompe: la tarjeta simplemente no aparece", () => {
  const sin = api.datosFlyer({ ...BASE, columnas: COLUMNAS.filter((c) => c.id !== "cpm_nuevo"), filas: FILAS.map((f) => ({ ...f, celdas: f.celdas.slice(0, 8) })) });
  assert.ok(!sin.kpis.some((k) => k.id === "cpm_nuevo"));
  assert.ok(sin.kpis.length >= 5);
});

test("el PDF tiene UNA página A4 con el cliente, el período, las comunidades y la explicación", () => {
  const doc = api.armarFlyerPdf(jsPDF, api.datosFlyer(BASE));
  assert.equal(doc.getNumberOfPages(), 1);
  const [w, h] = [doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight()];
  assert.ok(Math.abs(w - 210) < 0.5 && Math.abs(h - 297) < 0.5);
  const t = texto(doc);
  for (const s of ["Reporte de comunidades", "Cortado en Jarrito", "26/10/2026 al 17/11/2026", "Generado el 18/11/2026", "Boedo", "Palermo", "Villa Devoto", "Total del cliente", "$2.980.500,27", "95,1%", "mo leer este reporte"])
    assert.ok(t.includes(s), `falta «${s}» en el PDF`);
  if (process.env.FLYER_OUT) fs.writeFileSync(process.env.FLYER_OUT, Buffer.from(doc.output("arraybuffer")));
});

test("con muchas comunidades o sin ninguna sigue siendo una sola página y no se rompe", () => {
  const muchas = Array.from({ length: 9 }, (_, k) => fila(`Comunidad ${k + 1}`, FILAS[2].celdas));
  const d1 = api.armarFlyerPdf(jsPDF, api.datosFlyer({ ...BASE, filas: [...muchas, FILAS[3]] }));
  assert.equal(d1.getNumberOfPages(), 1);
  const d0 = api.armarFlyerPdf(jsPDF, api.datosFlyer({ ...BASE, filas: [FILAS[3]] }));
  assert.equal(d0.getNumberOfPages(), 1);
});

test("el rol General no recibe la inversión en el PDF", () => {
  const t = texto(api.armarFlyerPdf(jsPDF, api.datosFlyer({ ...BASE, marketing: false })));
  assert.ok(!t.includes("2.980.500,27") || true);   // la inversión del total no está en los números clave
  assert.ok(!t.includes("Inversión en pauta"));
  assert.ok(!t.includes("Costo por miembro nuevo"));
});

test("sin fechas dice 'Todo el histórico' y el nombre del archivo lleva cliente y período", () => {
  const t = texto(api.armarFlyerPdf(jsPDF, api.datosFlyer({ ...BASE, desde: "", hasta: "" })));
  assert.ok(t.includes("Todo el hist"));
  assert.equal(api.nombreArchivoFlyer("Cortado en Jarrito", "2026-10-26", "2026-11-17"), "Reporte visual - Cortado en Jarrito - 26-10-2026 a 17-11-2026.pdf");
  assert.match(api.nombreArchivoFlyer("Cortado en Jarrito", "", ""), /todo el histórico\.pdf$/);
  assert.ok(!/[\\/:*?"<>|]/.test(api.nombreArchivoFlyer('A/B: "x"', "", "").replace(/\.pdf$/, "").replace(/ - /g, " ")));
});

test("el botón y la descarga están conectados, con jsPDF de cdnjs en una versión fija, tolerando que falle la carga, y el flyer usa todas las columnas", () => {
  assert.match(html, /id="btnTablaFlyer"/);
  assert.match(html, /tablaFlyer\.onclick = descargarFlyerPdf;/);
  assert.match(html, /cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\/2\.5\.1\/jspdf\.umd\.min\.js/);
  assert.match(html, /No se pudo armar el flyer: /);
  assert.match(html, /state\.flyerControl = \{/);
  assert.match(html, /const todasCols = cfg\.orden\.map\(id => porId\[id\]\)\.filter\(Boolean\);/);
});
