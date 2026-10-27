// Pruebas de la sección Objetivos del puesto (bloque OBJETIVOS de public/index.html, db/033). Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const ini = html.indexOf("/* OBJETIVOS:INICIO */");
const fin = html.indexOf("/* OBJETIVOS:FIN */");
assert.ok(ini >= 0 && fin > ini, "no se encontró el bloque OBJETIVOS en public/index.html");
const { formatoMinutos, resumenHoras, trgGrupo, trgTotal, cpmeTotal, resumenChequeos, DIAS_LINEA_BASE } =
  new Function(html.slice(ini, fin) + "\nreturn { formatoMinutos, resumenHoras, trgGrupo, trgTotal, cpmeTotal, resumenChequeos, DIAS_LINEA_BASE };")();

test("minutos en palabras", () => {
  assert.equal(formatoMinutos(0), "0 min");
  assert.equal(formatoMinutos(45), "45 min");
  assert.equal(formatoMinutos(60), "1 h");
  assert.equal(formatoMinutos(135), "2 h 15 min");
  assert.equal(formatoMinutos(null), "0 min");
});

test("la línea de base de horas manuales necesita 5 días de registro", () => {
  assert.equal(DIAS_LINEA_BASE, 5);
  assert.deepEqual(resumenHoras({ minutos: 90, dias_con_registro: 2 }), { texto: "1 h 30 min", dias: 2, faltan: 3, completa: false });
  assert.deepEqual(resumenHoras({ minutos: 600, dias_con_registro: 5 }), { texto: "10 h", dias: 5, faltan: 0, completa: true });
  assert.equal(resumenHoras(null).dias, 0);
});

test("TRG por grupo: siguen ÷ (siguen + bajas); sin bajas medidas no se calcula", () => {
  assert.equal(trgGrupo({ miembros_finales: 49, bajas_estimadas: 2 }), 96.1);
  assert.equal(trgGrupo({ miembros_finales: 51, bajas_estimadas: 0 }), 100);
  assert.equal(trgGrupo({ miembros_finales: 51, bajas_estimadas: null }), null);
  assert.equal(trgGrupo({ miembros_finales: 0, bajas_estimadas: 0 }), null);
});

test("TRG del total no promedia: suma miembros y bajas de las comunidades con bajas medidas", () => {
  const cs = [{ miembros_finales: 16, bajas_estimadas: 1 }, { miembros_finales: 51, bajas_estimadas: 0 }, { miembros_finales: 41, bajas_estimadas: 1 }, { miembros_finales: 49, bajas_estimadas: 2 }, { miembros_finales: 99, bajas_estimadas: null }];
  assert.equal(trgTotal(cs), 97.5);   // 157 / (157 + 4)
  assert.equal(trgTotal([{ miembros_finales: 5, bajas_estimadas: null }]), null);
});

test("CPME total: inversión ÷ (MF − MI); sin plata (rol General) o sin crecimiento queda vacío", () => {
  const cs = [{ inversion: 400, miembros_iniciales: 10, miembros_finales: 30 }, { inversion: 600, miembros_iniciales: 20, miembros_finales: 40 }];
  assert.equal(cpmeTotal(cs), 25);   // 1000 / 40
  assert.equal(cpmeTotal([{ inversion: null, miembros_iniciales: 1, miembros_finales: 9 }]), null);
  assert.equal(cpmeTotal([{ inversion: 100, miembros_iniciales: 9, miembros_finales: 9 }]), null);
  assert.equal(cpmeTotal(null), null);
});

test("resumen de chequeos", () => {
  assert.deepEqual(resumenChequeos([{ estado: "ok" }, { estado: "aviso" }, { estado: "ok" }]), { total: 3, avisos: 1, ok: 2 });
  assert.deepEqual(resumenChequeos(undefined), { total: 0, avisos: 0, ok: 0 });
});

test("el CPME de Objetivos incluye el gasto de las campañas globales", () => {
  assert.match(html, /renderObjetivos\(datos, global \? \[\.\.\.rango, global\] : rango,/);
});

test("la pestaña Objetivos existe, es solo para Marketing y pide los datos a la base", () => {
  assert.match(html, /\{ key:'objetivos', label:'Objetivos' \}/);
  assert.match(html, /const TABS_SOLO_MARKETING = \['objetivos', /);
  assert.match(html, /rpc\('objetivos_puesto'/);
  assert.match(html, /from\('registro_horas_manuales'\)\.insert\(/);
  assert.match(html, /state\.tab === 'objetivos'/);
});

test("el panel dice cuáles son los números del mes 3, que el KPI principal es la entrada al flow y que las conversaciones son contexto", () => {
  assert.match(html, /Ingresos sin toque humano/);
  assert.match(html, /Entradas al flow de ManyChat \(KPI principal\)/);
  assert.match(html, /Tasa de triaje: ingresos al grupo ÷ entradas al flow/);
  assert.match(html, /Las conversaciones de Meta son un dato de contexto, no el KPI/);
  assert.match(html, /Carga manual registrada/);
});
