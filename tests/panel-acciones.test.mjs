// Pruebas de la franja "Para completar" (centro de acciones) de Overview y Control_Comunidades (bloque ACCIONES y renderAcciones de public/index.html). Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const bloque = (nombre) => {
  const ini = html.indexOf(`/* ${nombre}:INICIO */`), fin = html.indexOf(`/* ${nombre}:FIN */`);
  assert.ok(ini >= 0 && fin > ini, `no se encontró el bloque ${nombre} en public/index.html`);
  return html.slice(ini, fin);
};
const iniR = html.indexOf("function renderAcciones("), finR = html.indexOf("async function ejecutarAccion(");
assert.ok(iniR >= 0 && finR > iniR, "no se encontró renderAcciones en public/index.html");

const AYUDAS = `
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const fmtInt = (v) => v == null ? '—' : Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 });
`;
const { acotarAcciones, comunidadParaCarga, renderAcciones, MOTIVOS_POSPONER } = new Function(
  AYUDAS + bloque("ACCIONES") + html.slice(iniR, finR) + "\nreturn { acotarAcciones, comunidadParaCarga, renderAcciones, MOTIVOS_POSPONER };",
)();

const A = (o) => ({ codigo: "miembros_sin_carga", prioridad: 1, mensaje: "Cargá la lista de Palermo: hace 22 días que no se actualiza. Sin eso el CRR queda viejo.", boton: "Cargar miembros",
  destino: "cargar_miembros", comunidad_ids: ["uuid-pal"], comunidades: ["Palermo"], dato: 22, ...o });

test("las acciones salen ordenadas por prioridad y no se muestran más de cinco; avisa cuántas quedan", () => {
  const filas = [A({ codigo: "c", prioridad: 3 }), A({ codigo: "a", prioridad: 1 }), A({ codigo: "b", prioridad: 2 }), A({ codigo: "d", prioridad: 1 }),
                 A({ codigo: "e", prioridad: 2 }), A({ codigo: "f", prioridad: 3 }), A({ codigo: "g", prioridad: 3 })];
  const { visibles, ocultas } = acotarAcciones(filas);
  assert.equal(visibles.length, 5);
  assert.equal(ocultas, 2);
  assert.deepEqual(visibles.map((x) => x.prioridad), [1, 1, 2, 2, 3]);
});

test("sin acciones o con pocas, no hay nada oculto", () => {
  assert.deepEqual(acotarAcciones([]), { visibles: [], ocultas: 0 });
  assert.deepEqual(acotarAcciones(null), { visibles: [], ocultas: 0 });
  assert.equal(acotarAcciones([A({}), A({})]).ocultas, 0);
});

test("a la carga de miembros se va con la comunidad elegida si es una sola, y con 'Todas las comunidades' si son varias o ninguna", () => {
  assert.equal(comunidadParaCarga(["uuid-pal"]), "uuid-pal");
  assert.equal(comunidadParaCarga(["uuid-pal", "uuid-dev"]), "");
  assert.equal(comunidadParaCarga([]), "");
  assert.equal(comunidadParaCarga(null), "");
});

test("el mensaje que escribe el CRM se muestra tal cual, con su botón y la opción de posponer", () => {
  const out = renderAcciones([A({})]);
  assert.match(out, /Para completar/);
  assert.match(out, /Cargá la lista de Palermo: hace 22 días que no se actualiza\. Sin eso el CRR queda viejo\./);
  assert.match(out, /data-accion-destino="cargar_miembros" data-accion-ids="uuid-pal">Cargar miembros</);
  assert.match(out, /data-posponer="miembros_sin_carga">Posponer 7 días</);
  assert.match(out, /\(1\)/);
});

test("la franja marca la prioridad de cada acción", () => {
  const out = renderAcciones([A({ prioridad: 1 }), A({ codigo: "x", prioridad: 2, mensaje: "dos" }), A({ codigo: "y", prioridad: 3, mensaje: "tres" })]);
  assert.match(out, /class="acc-p1"/);
  assert.match(out, /class="acc-p2"/);
  assert.match(out, /class="acc-p3"/);
});

test("con varias comunidades el botón lleva todos los ids, para abrir la carga con 'Todas'", () => {
  const out = renderAcciones([A({ comunidad_ids: ["uuid-pal", "uuid-dev"], comunidades: ["Palermo", "Villa Devoto"] })]);
  assert.match(out, /data-accion-ids="uuid-pal,uuid-dev"/);
});

test("una acción sin comunidades (por ejemplo Meta sin sincronizar) no rompe y lleva el ids vacío", () => {
  const out = renderAcciones([A({ codigo: "meta_sin_sincronizar", destino: "traer_meta", boton: "Traer de Meta ahora", comunidad_ids: null, comunidades: null })]);
  assert.match(out, /data-accion-destino="traer_meta" data-accion-ids="">Traer de Meta ahora</);
});

test("se puede posponer con un motivo a elegir", () => {
  assert.deepEqual(MOTIVOS_POSPONER, ["Ya lo estoy haciendo", "Campañas apagadas a propósito", "No aplica por ahora"]);
  const out = renderAcciones([A({})]);
  for (const m of MOTIVOS_POSPONER) assert.ok(out.includes(`<option>${m}</option>`), m);
});

test("sin acciones dice que está todo al día; sin respuesta de la base (no es Marketing o falta la migración) no muestra nada", () => {
  assert.match(renderAcciones([]), /Todo al día/);
  assert.equal(renderAcciones(null), "");
  assert.equal(renderAcciones(undefined), "");
});

test("si hay más de cinco avisa que el resto aparece al resolver estas", () => {
  const filas = Array.from({ length: 7 }, (_, i) => A({ codigo: "k" + i, mensaje: "m" + i }));
  const out = renderAcciones(filas);
  assert.match(out, /Hay 2 más: aparecen cuando resuelvas estas\./);
  assert.match(out, /\(7\)/);
  assert.equal((out.match(/<li /g) || []).length, 5);
});

test("el texto del CRM no puede romper el HTML", () => {
  const out = renderAcciones([A({ mensaje: 'Cargá "X" <b>ya</b>', boton: '<i>botón</i>' })]);
  assert.ok(!out.includes("<b>ya</b>"));
  assert.ok(!out.includes("<i>botón</i>"));
  assert.match(out, /Cargá &quot;X&quot; &lt;b&gt;ya&lt;\/b&gt;/);
});

test("la franja está arriba de Overview y de Control_Comunidades, y se pide solo con rol Marketing", () => {
  assert.match(html, /return renderAcciones\(acciones\) \+ \(filtros \? renderFiltrosPeriodo/);
  assert.match(html, /return `\$\{renderAcciones\(acciones\)\}<div class="filters">\n\s*<label>Comunidad<select id="selFiltroComunidad">\$\{opciones\}/);
  assert.match(html, /async function loadAcciones\(\)\{\n\s*if \(!esMarketing\(\)\) return null;/);
  assert.match(html, /supabase\.rpc\('acciones_pendientes'/);
  assert.match(html, /supabase\.rpc\('posponer_accion'/);
});

test("cada destino de las acciones lleva a algo que existe en el panel", () => {
  for (const f of ["abrirCargaMiembros", "abrirConsultasWindsor", "abrirCampanas", "traerMetaEnVivo"]) assert.match(html, new RegExp(`async function ${f}\\(`), f);
  const m = html.match(/async function ejecutarAccion\(destino, ids\)\{[\s\S]*?\n\}/)[0];
  for (const d of ["cargar_miembros", "consultas", "campanas", "data_cruda", "traer_meta"]) assert.ok(m.includes(`'${d}'`), d);
  assert.match(m, /state\.tab = 'crudo'/);
  assert.match(html, /key:'crudo'/);
});

test("la carga de miembros se abre con la comunidad elegida cuando viene del centro de acciones, y un clic común no la cambia", () => {
  assert.match(html, /async function abrirCargaMiembros\(opciones = \{\}\)/);
  assert.match(html, /typeof opciones\.comunidadId === 'string' \? opciones\.comunidadId : null/);
  assert.match(html, /btnCargar\.onclick = abrirCargaMiembros;/);
});

test("Overview y Control_Comunidades conectan los botones de la franja", () => {
  assert.equal((html.match(/wireAcciones\(\);/g) || []).length, 2);
  assert.ok(!/key:'acciones'/.test(html), "no tiene que haber una pestaña aparte");
});
