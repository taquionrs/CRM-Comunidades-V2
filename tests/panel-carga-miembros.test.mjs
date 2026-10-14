// Pruebas del lector de la lista de miembros ("Cargar miembros"). Se extrae el bloque CARGA-MIEMBROS de public/index.html
// (el panel no tiene build) y se evalúa acá. Todos los números son inventados. Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const ini = html.indexOf("/* CARGA-MIEMBROS:INICIO */");
const fin = html.indexOf("/* CARGA-MIEMBROS:FIN */");
assert.ok(ini >= 0 && fin > ini, "no se encontró el bloque CARGA-MIEMBROS en public/index.html");
const { normalizarTelefono, parsearListaMiembros } = new Function(html.slice(ini, fin) + "\nreturn { normalizarTelefono, parsearListaMiembros };")();

test("normalizarTelefono: con +, espacios y guiones", () => {
  assert.deepEqual(normalizarTelefono("+54 9 11 5555-1234"), { numero: "5491155551234", completado: false });
  assert.deepEqual(normalizarTelefono("5491155551234"), { numero: "5491155551234", completado: false });
});

test("normalizarTelefono: completa el código de país argentino cuando falta", () => {
  assert.deepEqual(normalizarTelefono("11 5555-1234"), { numero: "5491155551234", completado: true });
  assert.deepEqual(normalizarTelefono("541155551234"), { numero: "5491155551234", completado: true });
});

test("normalizarTelefono: rechaza lo que no es un teléfono", () => {
  assert.equal(normalizarTelefono(""), null);
  assert.equal(normalizarTelefono("hola"), null);
  assert.equal(normalizarTelefono("12345"), null);
  assert.equal(normalizarTelefono("1234567890123456789"), null);
  assert.equal(normalizarTelefono(null), null);
});

test("lista pegada: un número por línea, con repetidos e inválidos", () => {
  const r = parsearListaMiembros("+54 9 11 5555-0001\n5491155550002\n\n5491155550001\nabc\n");
  assert.deepEqual(r.numeros, ["5491155550001", "5491155550002"]);
  assert.equal(r.filas_leidas, 4);
  assert.equal(r.repetidos, 1);
  assert.equal(r.invalidos, 1);
});

test("CSV con encabezado: usa la columna de teléfono aunque haya otras con números", () => {
  const csv = "Nombre,Edad,Teléfono\nAna,34,+5491155550001\nLuis,29,\"+54 9 11 5555-0002\"\n";
  const r = parsearListaMiembros(csv);
  assert.equal(r.encabezado, true);
  assert.deepEqual(r.numeros, ["5491155550001", "5491155550002"]);
});

test("CSV con punto y coma, BOM y finales de línea de Windows", () => {
  const r = parsearListaMiembros("﻿numero;nombre\r\n5491155550001;Ana\r\n5491155550002;Luis\r\n");
  assert.deepEqual(r.numeros, ["5491155550001", "5491155550002"]);
  assert.equal(r.invalidos, 0);
});

test("CSV sin encabezado: toma el primer número válido de cada fila", () => {
  const r = parsearListaMiembros("Ana,5491155550001\nLuis,5491155550002\n");
  assert.deepEqual(r.numeros, ["5491155550001", "5491155550002"]);
});

test("cuenta los números completados y no pierde filas vacías ni vacío total", () => {
  const r = parsearListaMiembros("11 5555-0001\n\n  \n11 5555-0002\n");
  assert.equal(r.completados, 2);
  assert.equal(r.filas_leidas, 2);
  assert.deepEqual(parsearListaMiembros("").numeros, []);
  assert.deepEqual(parsearListaMiembros(null).numeros, []);
});

test("el CSV que exporta el CRM (Fecha, Hora, Teléfono, Nombre, Cliente) también se lee", () => {
  const csv = "Fecha,Hora,Teléfono,Nombre,Cliente\r\n2026-10-09,13:06:42,+5491155550003,\"\",\"Cortado en Jarrito\"\r\n";
  const r = parsearListaMiembros(csv);
  assert.deepEqual(r.numeros, ["5491155550003"]);
});
