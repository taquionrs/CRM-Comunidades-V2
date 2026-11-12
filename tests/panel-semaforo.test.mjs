// Pruebas del semáforo de cobertura del tracking de Control_Comunidades (bloque SEMAFORO de public/index.html). Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const ini = html.indexOf("/* SEMAFORO:INICIO */");
const fin = html.indexOf("/* SEMAFORO:FIN */");
assert.ok(ini >= 0 && fin > ini, "no se encontró el bloque SEMAFORO en public/index.html");
const { semaforoCobertura, UMBRALES_COBERTURA } = new Function(html.slice(ini, fin) + "\nreturn { semaforoCobertura, UMBRALES_COBERTURA };")();

test("umbrales de arranque: verde más de 60 %, amarillo de 35 a 60 %, rojo menos de 35 %, mínimo 20 chats", () => {
  assert.deepEqual(UMBRALES_COBERTURA, { verdeMas: 60, amarilloDesde: 35, minChats: 20 });
});

test("las zonas del 02 al 10/11 dan: Devoto amarillo, Boedo y Palermo rojos, total rojo", () => {
  assert.equal(semaforoCobertura(72, 42).estado, "amarillo");   // 58 %
  assert.equal(semaforoCobertura(93, 15).estado, "rojo");       // 16 %
  assert.equal(semaforoCobertura(36, 5).estado, "rojo");        // 14 %
  assert.equal(semaforoCobertura(201, 62).estado, "rojo");      // 31 %
  assert.ok(Math.abs(semaforoCobertura(72, 42).cobertura - 58.33) < 0.01);
});

test("bordes: 60 % exacto es amarillo, 35 % exacto es amarillo, justo por encima del 60 % es verde y justo debajo del 35 % es rojo", () => {
  assert.equal(semaforoCobertura(100, 61).estado, "verde");
  assert.equal(semaforoCobertura(100, 60).estado, "amarillo");
  assert.equal(semaforoCobertura(100, 35).estado, "amarillo");
  assert.equal(semaforoCobertura(100, 34).estado, "rojo");
  assert.equal(semaforoCobertura(100, 100).estado, "verde");
});

test("más de 100 % es 'revisar' y no se pinta verde", () => {
  const s = semaforoCobertura(50, 80);
  assert.equal(s.estado, "revisar");
  assert.equal(s.cobertura, 160);
});

test("con menos de 20 chats (o sin dato) dice 'pocos datos' y no un color", () => {
  assert.deepEqual(semaforoCobertura(19, 19), { estado: "pocos", cobertura: null });
  assert.equal(semaforoCobertura(20, 12).estado, "amarillo");   // con 20 chats ya se pinta (60 %)
  assert.equal(semaforoCobertura(0, 5).estado, "pocos");
  assert.equal(semaforoCobertura(null, null).estado, "pocos");
});

test("la sección va debajo del desglose, sin las campañas globales, y no se divide por canal", () => {
  assert.match(html, /renderDesglose\([^\n]*\)\}\n\s*\$\{renderSemaforoCobertura\(comunidades, t\.convCom, t\.ent, canalActivo\)\}`;/);
  assert.match(html, /comunidades\.filter\(c => !c\.es_global\)\.map\(c => item\(c\.nombre, c\.conversaciones_meta, c\.clics_unicos, false\)\)/);
  assert.match(html, /if \(canalActivo\) return `<div class="card semaforo">/);
});
