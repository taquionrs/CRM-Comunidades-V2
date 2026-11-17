// Pruebas "listo para producción" de los flujos de n8n del CRM (docs/n8n/*.workflow.json): expresiones bien escritas, aviso de errores y recordatorio.
// No se prueba n8n en sí: se valida la estructura del JSON y se corre la lógica de los nodos de código con datos simulados. Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ARCHIVOS = ["reporte-semanal", "carga-miembros-automatica", "aviso-de-errores", "recordatorio-conteo-miembros"];
const leer = (f) => JSON.parse(fs.readFileSync(new URL(`../docs/n8n/${f}.workflow.json`, import.meta.url), "utf8"));
const flujos = Object.fromEntries(ARCHIVOS.map((f) => [f, leer(f)]));
const nodo = (flujo, nombre) => flujo.nodes.find((n) => n.name === nombre);

// Recorre los parámetros de un nodo y devuelve los textos (menos el código JavaScript y las notas, que llevan llaves a propósito).
function textos(valor, ruta = "", salida = []) {
  if (typeof valor === "string") salida.push([ruta, valor]);
  else if (Array.isArray(valor)) valor.forEach((v, i) => textos(v, `${ruta}[${i}]`, salida));
  else if (valor && typeof valor === "object") for (const [k, v] of Object.entries(valor)) if (k !== "jsCode" && k !== "content") textos(v, ruta ? `${ruta}.${k}` : k, salida);
  return salida;
}

for (const f of ARCHIVOS) {
  test(`${f}: toda expresión {{ ... }} empieza con "=" (si no, n8n busca el texto literal y no la evalúa)`, () => {
    for (const n of flujos[f].nodes) {
      for (const [ruta, texto] of textos(n.parameters)) {
        if (texto.includes("{{")) assert.ok(texto.startsWith("="), `${n.name} → ${ruta}: "${texto.slice(0, 80)}" no empieza con =`);
      }
    }
  });
  test(`${f}: nombres e ids únicos, conexiones a nodos que existen, apagado, con zona horaria de Argentina y sin claves adentro`, () => {
    const flujo = flujos[f];
    const nombres = flujo.nodes.map((n) => n.name);
    assert.equal(new Set(nombres).size, nombres.length);
    assert.equal(new Set(flujo.nodes.map((n) => n.id)).size, nombres.length);
    for (const [origen, c] of Object.entries(flujo.connections)) {
      assert.ok(nombres.includes(origen), origen);
      for (const salida of c.main) for (const d of salida) assert.ok(nombres.includes(d.node), d.node);
    }
    assert.equal(flujo.active, false);
    assert.equal(flujo.settings.timezone, "America/Argentina/Buenos_Aires");
    assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(JSON.stringify(flujo)));
    assert.ok(!/sb_(secret|publishable)_/.test(JSON.stringify(flujo)));
    for (const n of flujo.nodes) for (const c of Object.values(n.credentials || {})) assert.equal(c.id, "REEMPLAZAR");
  });
}

test("el nodo que busca al cliente por su slug usa una expresión de verdad (el error que dejaba al reporte sin cliente)", () => {
  for (const f of ["reporte-semanal", "recordatorio-conteo-miembros"]) {
    const url = nodo(flujos[f], "Supabase: cliente").parameters.url;
    assert.ok(url.startsWith("=https://"), f);
    assert.ok(url.includes("slug=eq.{{ $json.slug }}"), f);
  }
});

// ---------- lógica de los nodos de código ----------
function correr(flujo, nombre, { entrada = [], json = {} } = {}) {
  const js = nodo(flujo, nombre).parameters.jsCode;
  const $input = { all: () => entrada, first: () => entrada[0] };
  return new Function("$", "$input", "$json", js)(() => ({ first: () => undefined, all: () => [] }), $input, json);
}
const it = (json) => ({ json });
// El código de n8n lee $json como si fuera el ítem actual del nodo de aviso de errores.
function correrError(json) {
  const js = nodo(flujos["aviso-de-errores"], "Armar aviso de error").parameters.jsCode;
  return new Function("$json", js)(json);
}

test("aviso de errores: dice qué flujo falló, en qué nodo, qué mensaje dio n8n y el enlace de la ejecución", () => {
  const [r] = correrError({ workflow: { name: "Reporte semanal del CRM" }, execution: { lastNodeExecuted: "Supabase: reporte semanal", url: "https://n8n.ejemplo/execution/1", error: { message: "Request failed with status code 401" } } });
  assert.match(r.json.html, /Reporte semanal del CRM/);
  assert.match(r.json.html, /Supabase: reporte semanal/);
  assert.match(r.json.html, /status code 401/);
  assert.match(r.json.html, /href="https:\/\/n8n\.ejemplo\/execution\/1"/);
  assert.equal(r.json.asunto, "Falló un flujo del CRM: Reporte semanal del CRM");
});

test("aviso de errores: si n8n no manda algún dato, el aviso sale igual y lo dice", () => {
  const [r] = correrError({});
  assert.match(r.json.html, /\(sin nombre\)/);
  assert.match(r.json.html, /un nodo que no se pudo identificar/);
  assert.match(r.json.html, /sin detalle/);
  assert.match(r.json.html, /no mandó el enlace/);
});

test("aviso de errores: arranca con el disparador de errores de n8n", () => {
  assert.equal(nodo(flujos["aviso-de-errores"], "Un flujo falló").type, "n8n-nodes-base.errorTrigger");
});

const ACCION = (o) => ({ codigo: "miembros_sin_carga", prioridad: 1, mensaje: "Cargá la lista de Palermo: hace 22 días que no se actualiza. Sin eso el CRR queda viejo.", boton: "Cargar miembros", ...o });

test("recordatorio: lunes y jueves a las 8:00 y también se puede correr a mano", () => {
  const f = flujos["recordatorio-conteo-miembros"];
  assert.equal(nodo(f, "Lunes y jueves 8:00").parameters.rule.interval[0].expression, "0 8 * * 1,4");
  for (const origen of ["Lunes y jueves 8:00", "Correr a mano"]) assert.equal(f.connections[origen].main[0][0].node, "Definir cliente");
});

test("recordatorio: pide al CRM sus acciones pendientes y no decide nada por su cuenta", () => {
  const n = nodo(flujos["recordatorio-conteo-miembros"], "Supabase: acciones pendientes");
  assert.match(n.parameters.url, /\/rpc\/acciones_pendientes$/);
  assert.match(n.parameters.jsonBody, /p_cliente/);
});

test("recordatorio: sin nada pendiente NO manda correo (devuelve cero ítems)", () => {
  assert.deepEqual(correr(flujos["recordatorio-conteo-miembros"], "Armar recordatorio", { entrada: [] }), []);
  assert.deepEqual(correr(flujos["recordatorio-conteo-miembros"], "Armar recordatorio", { entrada: [it({})] }), []);
});

test("recordatorio: con una acción dice 'una cosa'; con varias, cuántas, y repite el mensaje que escribió el CRM", () => {
  const [uno] = correr(flujos["recordatorio-conteo-miembros"], "Armar recordatorio", { entrada: [it(ACCION({}))] });
  assert.equal(uno.json.asunto, "El CRM necesita 1 cosa de tu parte");
  assert.match(uno.json.html, /Cargá la lista de Palermo: hace 22 días que no se actualiza\./);
  assert.match(uno.json.html, /en el CRM: Cargar miembros/);
  const [dos] = correr(flujos["recordatorio-conteo-miembros"], "Armar recordatorio", { entrada: [it(ACCION({})), it(ACCION({ codigo: "sin_clasificar", prioridad: 3, mensaje: "7 personas escribieron.", boton: "Ver en Data_Cruda" }))] });
  assert.equal(dos.json.asunto, "El CRM necesita 2 cosas de tu parte");
  assert.match(dos.json.html, /7 personas escribieron\./);
});

test("recordatorio: el enlace al CRM sale solo si se completó PANEL_URL", () => {
  const sinUrl = correr(flujos["recordatorio-conteo-miembros"], "Armar recordatorio", { entrada: [it(ACCION({}))] })[0].json.html;
  assert.ok(!/Abrir el CRM/.test(sinUrl));
  const f = JSON.parse(JSON.stringify(flujos["recordatorio-conteo-miembros"]));
  nodo(f, "Armar recordatorio").parameters.jsCode = nodo(f, "Armar recordatorio").parameters.jsCode.replace("const PANEL_URL = '';", "const PANEL_URL = 'https://crm.ejemplo';");
  assert.match(correr(f, "Armar recordatorio", { entrada: [it(ACCION({}))] })[0].json.html, /<a href="https:\/\/crm\.ejemplo">Abrir el CRM<\/a>/);
});

test("el CRM manda los códigos de las acciones y el recordatorio usa solo mensaje y botón: si el CRM agrega una acción nueva, sale sola", () => {
  const nueva = ACCION({ codigo: "accion_que_todavia_no_existe", mensaje: "Algo nuevo.", boton: "Hacerlo" });
  const [r] = correr(flujos["recordatorio-conteo-miembros"], "Armar recordatorio", { entrada: [it(nueva)] });
  assert.match(r.json.html, /Algo nuevo\./);
});
