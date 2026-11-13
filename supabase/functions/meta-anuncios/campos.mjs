// Lógica pura de la función "meta-anuncios" (PR #71): qué campos se piden a Windsor por anuncio y cómo se preparan las filas para
// la base. JavaScript plano para probarla con Node: tests/meta-anuncios.test.mjs. La importa index.ts.

export const CAMPO_CLICS_ENLACE = "actions_link_click";
export const CAMPO_CONVERSACIONES = "actions_onsite_conversion_messaging_conversation_started_7d";

/** Campos que se piden a Windsor (conector facebook) a nivel anuncio. */
export const CAMPOS_ANUNCIO = [
  "date", "account_id", "campaign", "adset_name", "ad_id", "ad_name", "spend", "impressions", "clicks", CAMPO_CONVERSACIONES, CAMPO_CLICS_ENLACE,
];
/** Los mismos sin los clics en el enlace: solo si Windsor rechaza ese campo, para que el resto se guarde igual. */
export const CAMPOS_ANUNCIO_SIN_ENLACE = CAMPOS_ANUNCIO.filter((c) => c !== CAMPO_CLICS_ENLACE);

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const texto = (v) => (v == null ? "" : String(v));
const numero = (v) => (v == null || v === "" ? "0" : String(v));

/** Filas de Windsor → filas para meta_anuncios_aplicar. Descarta las que no tienen una fecha válida (con ad_id vacío se conservan: la base las cuenta). */
export function prepararFilasAnuncio(datos) {
  const out = [];
  for (const f of datos ?? []) {
    const d = String(f.date ?? "").slice(0, 10);
    if (!FECHA.test(d)) continue;
    out.push({
      d,
      account_id: f.account_id == null ? null : String(f.account_id),
      campaign: texto(f.campaign),
      adset_name: texto(f.adset_name),
      ad_id: texto(f.ad_id).trim(),
      ad_name: texto(f.ad_name),
      spend: numero(f.spend),
      impressions: numero(f.impressions),
      clicks: numero(f.clicks),
      // "" = el dato no llegó (la base lo guarda como NULL, no como 0).
      lc: f[CAMPO_CLICS_ENLACE] == null || f[CAMPO_CLICS_ENLACE] === "" ? "" : String(f[CAMPO_CLICS_ENLACE]),
      conv: numero(f[CAMPO_CONVERSACIONES]),
    });
  }
  return out;
}
