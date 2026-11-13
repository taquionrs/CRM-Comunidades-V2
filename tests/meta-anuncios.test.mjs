// Pruebas de la función "meta-anuncios" (supabase/functions/meta-anuncios/campos.mjs). Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { CAMPOS_ANUNCIO, CAMPOS_ANUNCIO_SIN_ENLACE, CAMPO_CLICS_ENLACE, CAMPO_CONVERSACIONES, prepararFilasAnuncio } from "../supabase/functions/meta-anuncios/campos.mjs";

test("se piden a Windsor el id y el nombre del anuncio, además de lo que ya se pedía por conjunto", () => {
  for (const c of ["date", "account_id", "campaign", "adset_name", "ad_id", "ad_name", "spend", "impressions", "clicks", CAMPO_CONVERSACIONES, CAMPO_CLICS_ENLACE]) {
    assert.ok(CAMPOS_ANUNCIO.includes(c), c);
  }
  assert.equal(new Set(CAMPOS_ANUNCIO).size, CAMPOS_ANUNCIO.length, "sin campos repetidos");
});

test("la versión de emergencia es la misma lista sin los clics en el enlace", () => {
  assert.ok(!CAMPOS_ANUNCIO_SIN_ENLACE.includes(CAMPO_CLICS_ENLACE));
  assert.equal(CAMPOS_ANUNCIO_SIN_ENLACE.length, CAMPOS_ANUNCIO.length - 1);
  assert.ok(CAMPOS_ANUNCIO_SIN_ENLACE.includes("ad_id") && CAMPOS_ANUNCIO_SIN_ENLACE.includes("ad_name"));
});

test("una fila completa se prepara como texto, con los nombres que espera la base", () => {
  const [f] = prepararFilasAnuncio([{
    date: "2026-11-10T00:00:00", account_id: 1669338306456901, campaign: "C", adset_name: "A", ad_id: 123456789, ad_name: "PALERMO_01",
    spend: 12.5, impressions: 1000, clicks: 40, [CAMPO_CLICS_ENLACE]: 30, [CAMPO_CONVERSACIONES]: 3,
  }]);
  assert.deepEqual(f, {
    d: "2026-11-10", account_id: "1669338306456901", campaign: "C", adset_name: "A", ad_id: "123456789", ad_name: "PALERMO_01",
    spend: "12.5", impressions: "1000", clicks: "40", lc: "30", conv: "3",
  });
});

test("clics en el enlace ausente o vacío llegan como '' (la base lo guarda como NULL), pero 0 es 0", () => {
  const [a, b, c] = prepararFilasAnuncio([
    { date: "2026-11-10", ad_id: "1" },
    { date: "2026-11-10", ad_id: "2", [CAMPO_CLICS_ENLACE]: "" },
    { date: "2026-11-10", ad_id: "3", [CAMPO_CLICS_ENLACE]: 0 },
  ]);
  assert.equal(a.lc, "");
  assert.equal(b.lc, "");
  assert.equal(c.lc, "0");
});

test("las filas sin fecha válida se descartan; sin ad_id se conservan para que la base las cuente", () => {
  const filas = prepararFilasAnuncio([
    { date: "", ad_id: "1" }, { date: "10/11/2026", ad_id: "2" }, { ad_id: "3" },
    { date: "2026-11-10" }, { date: "2026-11-10", ad_id: "  9  " },
  ]);
  assert.deepEqual(filas.map((f) => f.ad_id), ["", "9"]);
});

test("valores nulos o ausentes se vuelven 0 / vacío, y nada de entrada rompe", () => {
  const [f] = prepararFilasAnuncio([{ date: "2026-11-10", ad_id: "1", spend: null }]);
  assert.equal(f.spend, "0");
  assert.equal(f.impressions, "0");
  assert.equal(f.conv, "0");
  assert.equal(f.campaign, "");
  assert.equal(f.account_id, null);
  assert.deepEqual(prepararFilasAnuncio(null), []);
  assert.deepEqual(prepararFilasAnuncio(undefined), []);
});
