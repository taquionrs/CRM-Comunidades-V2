// Pruebas del lector de la lista de miembros ("Cargar miembros": Fecha y Teléfono). Se extrae el bloque CARGA-MIEMBROS de
// public/index.html (el panel no tiene build) y se evalúa acá. Todos los números son inventados. Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const ini = html.indexOf("/* CARGA-MIEMBROS:INICIO */");
const fin = html.indexOf("/* CARGA-MIEMBROS:FIN */");
assert.ok(ini >= 0 && fin > ini, "no se encontró el bloque CARGA-MIEMBROS en public/index.html");
const { normalizarTelefono, normalizarFecha, parsearListaMiembros } =
  new Function(html.slice(ini, fin) + "\nreturn { normalizarTelefono, normalizarFecha, parsearListaMiembros };")();
const tels = (r) => r.filas.map((x) => x.t);

test("normalizarTelefono: con +, espacios y guiones", () => {
  assert.deepEqual(normalizarTelefono("+54 9 11 5555-1234"), { numero: "5491155551234", completado: false });
  assert.deepEqual(normalizarTelefono("5491155551234"), { numero: "5491155551234", completado: false });
});

test("normalizarTelefono: completa el código de país argentino cuando falta", () => {
  assert.deepEqual(normalizarTelefono("11 5555-1234"), { numero: "5491155551234", completado: true });
  assert.deepEqual(normalizarTelefono("541155551234"), { numero: "5491155551234", completado: true });
});

test("normalizarTelefono: rechaza lo que no es un teléfono", () => {
  for (const x of ["", "hola", "12345", "1234567890123456789", null]) assert.equal(normalizarTelefono(x), null);
});

test("normalizarFecha: formatos habituales (día primero) y fechas imposibles", () => {
  assert.equal(normalizarFecha("2026-10-14"), "2026-10-14");
  assert.equal(normalizarFecha("14/10/2026"), "2026-10-14");
  assert.equal(normalizarFecha("4-3-2026"), "2026-03-04");
  assert.equal(normalizarFecha("14/10/26"), "2026-10-14");
  assert.equal(normalizarFecha("14/10/2026 18:30"), "2026-10-14");
  assert.equal(normalizarFecha("31/02/2026"), null);
  assert.equal(normalizarFecha("2026-13-01"), null);
  assert.equal(normalizarFecha("hola"), null);
  assert.equal(normalizarFecha(""), null);
});

test("un teléfono no se confunde con una fecha", () => {
  assert.equal(normalizarFecha("11 5555-1234"), null);
  assert.equal(normalizarFecha("+54 9 11 5555-1234"), null);
  assert.equal(normalizarFecha("5491155551234"), null);
});

test("filas con fecha y teléfono en cualquier orden", () => {
  const r = parsearListaMiembros("14/10/2026, +54 9 11 5555-0001\n5491155550002, 2026-10-15\n");
  assert.deepEqual(r.filas, [{ f: "2026-10-14", t: "5491155550001" }, { f: "2026-10-15", t: "5491155550002" }]);
  assert.equal(r.sin_fecha, 0);
});

test("solo teléfonos (sin fecha): quedan sin fecha y se cuentan", () => {
  const r = parsearListaMiembros("5491155550001\n11 5555-0002\n");
  assert.deepEqual(r.filas.map((x) => x.f), [null, null]);
  assert.equal(r.sin_fecha, 2);
  assert.equal(r.completados, 1);
});

test("repetidos y no válidos: uno cuenta una vez, con su fecha más antigua", () => {
  const r = parsearListaMiembros("15/10/2026,5491155550001\n01/10/2026,5491155550001\n,5491155550001\nabc\n");
  assert.deepEqual(r.filas, [{ f: "2026-10-01", t: "5491155550001" }]);
  assert.equal(r.repetidos, 2);
  assert.equal(r.invalidos, 1);
  assert.equal(r.filas_leidas, 4);
});

test("CSV con encabezado: usa las columnas Fecha y Teléfono aunque haya otras con números", () => {
  const csv = "Nombre,Edad,Fecha de ingreso,Teléfono\nAna,34,14/10/2026,+5491155550001\nLuis,29,15/10/2026,\"+54 9 11 5555-0002\"\n";
  const r = parsearListaMiembros(csv);
  assert.equal(r.encabezado, true);
  assert.deepEqual(r.filas, [{ f: "2026-10-14", t: "5491155550001" }, { f: "2026-10-15", t: "5491155550002" }]);
});

test("CSV con punto y coma, BOM y finales de línea de Windows", () => {
  const r = parsearListaMiembros("﻿fecha;telefono\r\n2026-10-14;5491155550001\r\n2026-10-15;5491155550002\r\n");
  assert.deepEqual(tels(r), ["5491155550001", "5491155550002"]);
  assert.equal(r.invalidos, 0);
});

test("el CSV que exporta el CRM (Fecha, Hora, Teléfono, Nombre, Cliente) también se lee", () => {
  const csv = "Fecha,Hora,Teléfono,Nombre,Cliente\r\n2026-10-09,13:06:42,+5491155550003,\"\",\"Cortado en Jarrito\"\r\n";
  const r = parsearListaMiembros(csv);
  assert.deepEqual(r.filas, [{ f: "2026-10-09", t: "5491155550003" }]);
});

test("vacío: no falla", () => {
  assert.deepEqual(parsearListaMiembros("").filas, []);
  assert.deepEqual(parsearListaMiembros(null).filas, []);
  assert.deepEqual(parsearListaMiembros("\n \n").filas, []);
});
