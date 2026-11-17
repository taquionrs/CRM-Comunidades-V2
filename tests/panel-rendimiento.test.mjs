// Pruebas del bloque "Rendimiento por anuncio" de Control_Comunidades (bloque RENDIMIENTO y renderRendimiento de public/index.html). Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const bloque = (nombre) => {
  const ini = html.indexOf(`/* ${nombre}:INICIO */`), fin = html.indexOf(`/* ${nombre}:FIN */`);
  assert.ok(ini >= 0 && fin > ini, `no se encontró el bloque ${nombre} en public/index.html`);
  return html.slice(ini, fin);
};
const iniR = html.indexOf("function renderRendimiento("), finR = html.indexOf("function renderDesglose(");
assert.ok(iniR >= 0 && finR > iniR, "no se encontró renderRendimiento en public/index.html");

// Ayudantes mínimos del panel (mismos formatos que public/index.html) para poder correr el render sin navegador.
const AYUDAS = `
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const fmtInt = (v) => v == null ? '—' : Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 });
  const fmtMoney = (v) => v == null ? '—' : '$' + Number(v).toLocaleString('es-AR', { maximumFractionDigits: 2 });
  const fmtPct = (v) => v == null ? '—' : Math.round(v*10)/10 + '%';
  const fmtDia = (d) => { if (!d) return '—'; const [a, m, x] = String(d).slice(0, 10).split('-'); return x + '/' + m + '/' + a; };
  const state = {};
`;
const { etiquetaAnuncio, agruparRendimiento, renderRendimiento } = new Function(
  AYUDAS + bloque("SEMAFORO") + bloque("DESGLOSE") + bloque("RENDIMIENTO") + html.slice(iniR, finR) +
  "\nreturn { etiquetaAnuncio, agruparRendimiento, renderRendimiento };",
)();

const P = "TQN_AON_META_CON_TRAFICO_MANUAL_CORTADO_EN_JARRITO_WHATSAPP_";
const f = (o) => ({ comunidad_id: "pal", comunidad: "Palermo", codigo: "PAL-01", ad_id: "120252390208400568", ad_nombre: P + "PALERMO_01", campana_nombre: "CAMP", adset_nombre: "ADS_PAL", instrumentado: true, dias: 10, ultimo_dia: "2026-11-13",
  inversion: "100", impresiones: "1000", clics_enlace: "40", impresiones_enlace: "1000", conversaciones: "10", entradas: "4", sin_clasificar: "1", ...o });
const sinCod = (o) => ({ comunidad_id: "pal", comunidad: "Palermo", codigo: null, ad_nombre: null, campana_nombre: null, instrumentado: false, dias: 0, ultimo_dia: null,
  inversion: "0", impresiones: "0", clics_enlace: null, impresiones_enlace: null, conversaciones: "0", entradas: "6", sin_clasificar: "0", ...o });
const boedo = (o) => f({ comunidad_id: "boe", comunidad: "Boedo", codigo: null, ad_id: "999", ad_nombre: P + "BOEDO_01", instrumentado: false, entradas: null, sin_clasificar: null, inversion: "300", conversaciones: "50", ...o });

test("etiqueta corta: los dos últimos tramos del nombre de Meta; nombres cortos quedan como están", () => {
  assert.equal(etiquetaAnuncio(P + "PALERMO_01"), "PALERMO_01");
  assert.equal(etiquetaAnuncio("Anuncio A"), "Anuncio A");
  assert.equal(etiquetaAnuncio("A_B"), "A_B");
  assert.equal(etiquetaAnuncio(null), "");
});

test("agrupa por comunidad: la zona suma los anuncios y las entradas sin código (igual que 'Entradas únicas')", () => {
  const g = agruparRendimiento([f({}), f({ codigo: "PAL-02", ad_nombre: P + "PALERMO_02", inversion: "50", entradas: "1", sin_clasificar: "0", conversaciones: "5" }), sinCod({}), boedo()]);
  assert.deepEqual(g.zonas.map((z) => z.comunidad), ["Boedo", "Palermo"]);
  const pal = g.zonas[1];
  assert.equal(pal.anuncios.length, 2);
  assert.equal(pal.total.inversion, 150);
  assert.equal(pal.total.conversaciones, 15);
  assert.equal(pal.total.entradas, 4 + 1 + 6);   // dos anuncios con código + las entradas sin código
  assert.equal(pal.anuncios[0].etiqueta, "PALERMO_01");   // el de más gasto primero
});

test("un anuncio sin código no tiene entradas (null, no 0) y no cuenta como instrumentado", () => {
  const g = agruparRendimiento([boedo()]);
  const a = g.zonas[0].anuncios[0];
  assert.equal(a.instrumentado, false);
  assert.equal(a.entradas, null);
  assert.equal(a.sinClasificar, null);
  assert.equal(g.zonas[0].tiene, false);
});

test("el piloto mide cuántas entradas traen código solo en las zonas que tienen códigos", () => {
  const g = agruparRendimiento([f({ entradas: "3" }), sinCod({ entradas: "7" }), boedo(), { ...sinCod({ entradas: "100" }), comunidad_id: "boe", comunidad: "Boedo" }]);
  assert.deepEqual(g.codigo.zonas, ["Palermo"]);
  assert.equal(g.codigo.conCodigo, 3);
  assert.equal(g.codigo.sinCodigo, 7);
  assert.equal(g.codigo.pct, 30);
});

test("sin entradas en el período el porcentaje del piloto es null, no 0 ni NaN", () => {
  const g = agruparRendimiento([f({ entradas: "0", sin_clasificar: "0" })]);
  assert.equal(g.codigo.pct, null);
});

test("clics en el enlace: null en la base = sin dato (conEnlace false), no 0", () => {
  const g = agruparRendimiento([f({ clics_enlace: null, impresiones_enlace: null })]);
  assert.equal(g.zonas[0].anuncios[0].conEnlace, false);
  assert.equal(g.total.conEnlace, false);
});

test("último día con datos: el más reciente de todos los anuncios", () => {
  const g = agruparRendimiento([f({ ultimo_dia: "2026-11-10" }), f({ codigo: "PAL-02", ultimo_dia: "2026-11-13" })]);
  assert.equal(g.ultimoDia, "2026-11-13");
  assert.equal(agruparRendimiento([]).ultimoDia, null);
});

test("lista vacía o nula no rompe", () => {
  for (const x of [[], null, undefined]) {
    const g = agruparRendimiento(x);
    assert.equal(g.zonas.length, 0);
    assert.equal(g.total.inversion, 0);
  }
});

test("el bloque muestra los anuncios, el código, 'sin código' donde falta y el piloto", () => {
  const out = renderRendimiento([f({}), sinCod({}), boedo()], 400, "", false);
  assert.match(out, /Rendimiento por anuncio/);
  assert.match(out, /PALERMO_01/);
  assert.match(out, /<b>PAL-01<\/b>/);
  assert.match(out, /BOEDO_01/);
  assert.match(out, /sin código/);
  assert.match(out, /Entradas sin código/);
  assert.match(out, /Total Palermo/);
  assert.match(out, /Piloto del código por anuncio/);
  assert.match(out, /id="btnAnuncios"/);
});

test("el nombre completo del anuncio queda en el título de la fila (sin romper el HTML con comillas)", () => {
  const out = renderRendimiento([f({ ad_nombre: 'Raro "A" <b>' })], 100, "", false);
  assert.ok(!out.includes('<b>"A"'));
  assert.match(out, /title="Raro &quot;A&quot; &lt;b&gt;"/);
});

test("avisa cuando los anuncios no suman lo que la tabla de arriba, y calla cuando coincide", () => {
  const conAviso = renderRendimiento([f({ inversion: "100" })], 500, "", false);
  assert.match(conAviso, /faltan \$400 de días sin detalle por anuncio/);
  const sinAviso = renderRendimiento([f({ inversion: "100" })], 100.5, "", false);
  assert.ok(!/faltan/.test(sinAviso));
});

test("sin datos por anuncio explica qué hacer; sin respuesta de la base lo dice sin romper la página", () => {
  assert.match(renderRendimiento([], 0, "", false), /Todavía no hay datos por anuncio en este período/);
  assert.match(renderRendimiento(null, 0, "", false), /No se pudo cargar el rendimiento por anuncio/);
  assert.match(renderRendimiento(null, 0, "", false), /id="btnAnuncios"/);
});

test("con un canal elegido avisa que las entradas cuentan todos los canales", () => {
  assert.match(renderRendimiento([f({})], 100, "", true), /no se divide por canal/);
  assert.ok(!/no se divide por canal/.test(renderRendimiento([f({})], 100, "", false)));
});

test("si ningún código se vio todavía en una entrada lo dice y manda a la guía", () => {
  assert.match(renderRendimiento([f({ instrumentado: false, entradas: null, sin_clasificar: null })], 300, "", false), /Todavía no llegó ninguna entrada con código de anuncio/);
});

test("las columnas Nombre (completo) e ID se ven en cada fila y en el encabezado", () => {
  const out = renderRendimiento([f({})], 100, "", false);
  assert.match(out, />Nombre</);
  assert.match(out, />ID</);
  assert.ok(out.includes(">" + P + "PALERMO_01</th>"), "el nombre completo es el texto de la fila, no solo el título");
  assert.ok(out.includes(">120252390208400568</td>"));
});

test("un anuncio con código que todavía no se vio muestra 'aún no se vio' y sus entradas del CRM en '—'; uno ya visto no", () => {
  const sinVer = renderRendimiento([f({ instrumentado: false, entradas: null, sin_clasificar: null })], 100, "", false);
  assert.match(sinVer, /<b>PAL-01<\/b> <span class="vacio-tenue"[^>]*>aún no se vio<\/span>/);
  assert.ok(!/aún no se vio/.test(renderRendimiento([f({ instrumentado: true })], 100, "", false)));
});

test("un anuncio de Meta sin código en el catálogo (todavía no se trajo) muestra 'sin código'", () => {
  assert.match(renderRendimiento([boedo()], 300, "", false), /sin código/);
});

test("agrupa guardando el ID y el conjunto del anuncio", () => {
  const a = agruparRendimiento([f({})]).zonas[0].anuncios[0];
  assert.equal(a.adId, "120252390208400568");
  assert.equal(a.adset, "ADS_PAL");
  assert.equal(a.nombre, P + "PALERMO_01");
});

test("el bloque queda dentro de Control_Comunidades, solo para Marketing, y la sección del menú no cambia", () => {
  assert.match(html, /renderRendimiento\(rendimiento,/);
  assert.match(html, /!esMarketing\(\) \? '' : renderRendimiento/);
  assert.match(html, /esMarketing\(\) \? loadRendimientoAnuncios/);
  assert.ok(!/key:'rendimiento'/.test(html), "no tiene que haber una pestaña aparte");
});
