// Pruebas de "Meta en vivo": la lógica de la función del servidor (supabase/functions/meta-en-vivo/ventanas.mjs) y la validación del panel
// (bloque META-VIVO de public/index.html), que tienen que decidir lo mismo. Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { MAX_DIAS, CAMPOS_WINDSOR, validarRango, dividirVentanas, prepararFilas } from "../supabase/functions/meta-en-vivo/ventanas.mjs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const ini = html.indexOf("/* META-VIVO:INICIO */");
const fin = html.indexOf("/* META-VIVO:FIN */");
assert.ok(ini >= 0 && fin > ini, "no se encontró el bloque META-VIVO en public/index.html");
const { validarRangoMetaVivo } = new Function(html.slice(ini, fin) + "\nreturn { validarRangoMetaVivo };")();
const HOY = "2026-10-20";

test("rango: válido hasta 31 días, el máximo cuenta ambos extremos", () => {
  assert.equal(validarRango("2026-10-01", "2026-10-20", HOY).ok, true);
  assert.equal(validarRango("2026-10-20", "2026-10-20", HOY).dias, 1);
  assert.equal(validarRango("2026-09-20", "2026-10-20", HOY).dias, 31);
  assert.equal(validarRango("2026-09-19", "2026-10-20", HOY).ok, false);   // 32 días
  assert.equal(MAX_DIAS, 31);
});

test("rango: rechaza fechas futuras, invertidas, mal escritas o imposibles", () => {
  assert.match(validarRango("2026-10-15", "2026-10-21", HOY).error, /futuras/);
  assert.match(validarRango("2026-10-15", "2026-10-10", HOY).error, /posterior/);
  assert.equal(validarRango("20/10/2026", "2026-10-20", HOY).ok, false);
  assert.equal(validarRango("2026-02-30", "2026-03-01", HOY).ok, false);
  assert.equal(validarRango("", "", HOY).ok, false);
});

test("ventanas: partidas de a 14 días, consecutivas y sin huecos ni solapes", () => {
  assert.deepEqual(dividirVentanas("2026-08-14", "2026-09-12"), [
    { desde: "2026-08-14", hasta: "2026-08-27" }, { desde: "2026-08-28", hasta: "2026-09-10" }, { desde: "2026-09-11", hasta: "2026-09-12" },
  ]);
  assert.deepEqual(dividirVentanas("2026-10-01", "2026-10-01"), [{ desde: "2026-10-01", hasta: "2026-10-01" }]);
  assert.deepEqual(dividirVentanas("2026-10-01", "2026-10-14"), [{ desde: "2026-10-01", hasta: "2026-10-14" }]);
  const v = dividirVentanas("2026-09-20", "2026-10-20");
  assert.equal(v[0].desde, "2026-09-20");
  assert.equal(v.at(-1).hasta, "2026-10-20");
  for (let i = 1; i < v.length; i++) assert.equal(Date.parse(v[i].desde + "T00:00:00Z") - Date.parse(v[i - 1].hasta + "T00:00:00Z"), 86400000);
});

test("filas de Windsor: se preparan con los nombres que espera la base y se descartan las sin fecha", () => {
  const filas = prepararFilas([
    { date: "2026-10-10", account_id: 1669338306456901, campaign: "C1", adset_name: "A1", spend: 123.45, impressions: 100, clicks: 7,
      actions_onsite_conversion_messaging_conversation_started_7d: 3, actions_onsite_conversion_lead_grouped: null },
    { date: "", campaign: "sin fecha" },
    { date: "no-es-fecha", campaign: "mala" },
    { date: "2026-10-11T00:00:00", campaign: "C2" },
  ]);
  assert.equal(filas.length, 2);
  assert.deepEqual(filas[0], { d: "2026-10-10", account_id: "1669338306456901", campaign: "C1", adset_name: "A1", spend: "123.45", impressions: "100", clicks: "7", conv: "3", leads: "0" });
  assert.equal(filas[1].d, "2026-10-11");
  assert.equal(filas[1].spend, "0");
  assert.deepEqual(prepararFilas(undefined), []);
});

test("se piden a Windsor los campos que usa el resto del CRM", () => {
  for (const c of ["date", "account_id", "campaign", "adset_name", "spend", "impressions", "clicks",
    "actions_onsite_conversion_messaging_conversation_started_7d", "actions_onsite_conversion_lead_grouped"]) assert.ok(CAMPOS_WINDSOR.includes(c), c);
});

test("panel: decide igual que la función del servidor para los mismos rangos", () => {
  const casos = [["2026-10-01", "2026-10-20"], ["2026-09-20", "2026-10-20"], ["2026-09-19", "2026-10-20"], ["2026-10-15", "2026-10-21"],
    ["2026-10-15", "2026-10-10"], ["2026-02-30", "2026-03-01"], ["2026-10-20", "2026-10-20"]];
  for (const [d, h] of casos) {
    const a = validarRango(d, h, HOY), b = validarRangoMetaVivo(d, h, HOY);
    assert.equal(b.ok, a.ok, `${d} → ${h}`);
    if (a.ok) assert.equal(b.dias, a.dias);
  }
});

test("panel: sin fechas pide los últimos 7 días hasta ayer; con una sola fecha pide completar", () => {
  const r = validarRangoMetaVivo("", "", HOY);
  assert.deepEqual([r.ok, r.desde, r.hasta, r.dias, r.porDefecto], [true, "2026-10-13", "2026-10-19", 7, true]);
  assert.equal(validarRangoMetaVivo("2026-10-01", "", HOY).ok, false);
  assert.equal(validarRangoMetaVivo(null, "2026-10-01", HOY).ok, false);
  assert.equal(validarRangoMetaVivo("2026-10-01", "2026-10-10", HOY).porDefecto, false);
});
