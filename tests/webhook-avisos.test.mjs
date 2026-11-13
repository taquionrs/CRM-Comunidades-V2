// Pruebas de los tipos de aviso del webhook de ManyChat (supabase/functions/manychat-webhook/avisos.mjs). Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { tipoDeAviso, mensajeDeContacto } from "../supabase/functions/manychat-webhook/avisos.mjs";

test("sin campo evento (o vacío) es un contacto normal", () => {
  for (const v of [undefined, null, "", "   "]) assert.equal(tipoDeAviso(v), "contacto", JSON.stringify(v));
});

test("trigger y clic_me_sumo siguen igual, con mayúsculas y espacios", () => {
  assert.equal(tipoDeAviso("trigger"), "trigger");
  assert.equal(tipoDeAviso(" Trigger_Entregado "), "trigger");
  assert.equal(tipoDeAviso("clic_me_sumo"), "clic_me_sumo");
  assert.equal(tipoDeAviso("CLIC-ME-SUMO"), "clic_me_sumo");
});

test("sin_clasificar se reconoce, con guion y en mayúsculas", () => {
  assert.equal(tipoDeAviso("sin_clasificar"), "sin_clasificar");
  assert.equal(tipoDeAviso(" Sin-Clasificar "), "sin_clasificar");
});

test("cualquier otro valor se rechaza como desconocido (no se cuenta como entrada)", () => {
  for (const v of ["sin clasificar", "sinclasificar", "contacto", "triger", 1, true, {}, []]) {
    assert.equal(tipoDeAviso(v), "desconocido", JSON.stringify(v));
  }
});

test("el mensaje de la persona sale de contact.last_input_text, recortado", () => {
  assert.equal(mensajeDeContacto({ last_input_text: "  ¡Hola! Quiero más información  " }), "¡Hola! Quiero más información");
  assert.equal(mensajeDeContacto({ last_input_text: "a".repeat(800) }).length, 500);
  assert.equal(mensajeDeContacto({ last_input_text: "x".repeat(20) }, 5), "xxxxx");
});

test("sin mensaje usable devuelve null", () => {
  for (const c of [null, undefined, {}, { last_input_text: null }, { last_input_text: "   " }, { last_input_text: 5 }, "texto", []]) {
    assert.equal(mensajeDeContacto(c), null, JSON.stringify(c));
  }
});

test("los códigos de anuncio salen del mensaje como palabra suelta, en mayúsculas y sin repetir", async () => {
  const { codigosCandidatos } = await import("../supabase/functions/manychat-webhook/avisos.mjs");
  assert.deepEqual(codigosCandidatos("Hola! Quiero sumarme a la comunidad de Palermo P1"), ["P1"]);
  assert.deepEqual(codigosCandidatos("quiero unirme (p2)"), ["P2"]);
  assert.deepEqual(codigosCandidatos("P1 y p1 y P3"), ["P1", "P3"]);
  assert.deepEqual(codigosCandidatos("calle 9 de julio 1234"), []);
  assert.deepEqual(codigosCandidatos("ABCD1 P1x 1P1"), []);
  for (const v of [null, undefined, 5, {}]) assert.deepEqual(codigosCandidatos(v), []);
});

test("solo cuenta el código que existe y está activo en el catálogo del cliente", async () => {
  const { codigoDeAnuncio } = await import("../supabase/functions/manychat-webhook/avisos.mjs");
  assert.equal(codigoDeAnuncio("Palermo P2", ["P1", "P2"]), "P2");
  assert.equal(codigoDeAnuncio("Palermo P9", ["P1", "P2"]), null);
  assert.equal(codigoDeAnuncio("A1 Palermo P1", ["P1"]), "P1");
  assert.equal(codigoDeAnuncio("Palermo", ["P1"]), null);
  assert.equal(codigoDeAnuncio("Palermo P1", []), null);
  assert.equal(codigoDeAnuncio("Palermo p1", ["p1"]), "P1");
});
