// Pruebas del bloque "Contactos repetidos" de Data_Cruda (bloque REPETIDOS de public/index.html, db/032). Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const ini = html.indexOf("/* REPETIDOS:INICIO */");
const fin = html.indexOf("/* REPETIDOS:FIN */");
assert.ok(ini >= 0 && fin > ini, "no se encontró el bloque REPETIDOS en public/index.html");
const { filtrarRepetidos, intervaloRepetido, TIPOS_REPETIDO } = new Function(html.slice(ini, fin) + "\nreturn { filtrarRepetidos, intervaloRepetido, TIPOS_REPETIDO };")();

const F = (id, veces, n) => ({ telefono_id: id, veces, n_comunidades: n });

test("filtro por tipo: todos, misma comunidad y más de una comunidad", () => {
  const filas = [F("a", 3, 1), F("b", 2, 2), F("c", 5, 1), F("d", 2, 3)];
  assert.deepEqual(filtrarRepetidos(filas, "todos").map(x => x.telefono_id), ["a", "b", "c", "d"]);
  assert.deepEqual(filtrarRepetidos(filas, "misma").map(x => x.telefono_id), ["a", "c"]);
  assert.deepEqual(filtrarRepetidos(filas, "varias").map(x => x.telefono_id), ["b", "d"]);
  assert.deepEqual(TIPOS_REPETIDO.map(t => t[0]), ["todos", "misma", "varias"]);
});

test("filtro: entradas inválidas devuelven lista vacía y n_comunidades llega como texto o número", () => {
  assert.deepEqual(filtrarRepetidos(null, "misma"), []);
  assert.deepEqual(filtrarRepetidos(undefined, "todos"), []);
  assert.equal(filtrarRepetidos([{ n_comunidades: "1" }], "misma").length, 1);
});

test("intervalo entre el primer y el último registro, en palabras", () => {
  const d = (a, b) => intervaloRepetido({ primera: a, ultima: b });
  assert.equal(d("2026-10-01T10:00:00Z", "2026-10-01T10:20:00Z"), "menos de 1 h");
  assert.equal(d("2026-10-01T10:00:00Z", "2026-10-01T15:00:00Z"), "5 h");
  assert.equal(d("2026-10-01T10:00:00Z", "2026-10-02T10:00:00Z"), "1 día");
  assert.equal(d("2026-10-01T10:00:00Z", "2026-10-21T10:00:00Z"), "20 días");
  assert.equal(d("2026-10-02T10:00:00Z", "2026-10-01T10:00:00Z"), "—");
});

test("el panel pide el conteo a la base, muestra el resumen arriba del registro y no rompe Data_Cruda si falla", () => {
  assert.match(html, /rpc\('contactos_repetidos'/);
  assert.match(html, /if \(error\) \{ console\.warn\('contactos_repetidos:'[^}]*return null;/);
  assert.match(html, /renderRepetidos\(repetidos, comunidades, state\.repetidos\) \+ renderCrudo\(/);
});
