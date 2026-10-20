// Lógica pura de la función "meta-en-vivo": validar el rango, partirlo en ventanas y preparar las filas de Windsor para la base.
// Es JavaScript plano (sin TypeScript) para poder probarla con Node: tests/meta-en-vivo.test.mjs. La importa index.ts.

export const MAX_DIAS = 31;      // rango máximo por pedido
export const DIAS_VENTANA = 14;  // Windsor tarda más en ventanas largas: se pide de a 14 días

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const aMs = (f) => Date.parse(f + "T00:00:00Z");
const aTexto = (ms) => new Date(ms).toISOString().slice(0, 10);
const esFechaReal = (f) => FECHA.test(String(f)) && aTexto(aMs(f)) === f;

/** Campos que se piden a Windsor (conector facebook). */
export const CAMPOS_WINDSOR = [
  "date", "account_id", "account_name", "campaign", "adset_name", "spend", "impressions", "clicks",
  "actions_onsite_conversion_messaging_conversation_started_7d", "actions_onsite_conversion_lead_grouped",
];

/** Valida el rango pedido. `hoy` es la fecha de hoy en Argentina (AAAA-MM-DD). */
export function validarRango(desde, hasta, hoy) {
  if (!esFechaReal(desde) || !esFechaReal(hasta)) return { ok: false, error: "Las fechas tienen que ser reales y con el formato AAAA-MM-DD" };
  if (desde > hasta) return { ok: false, error: "La fecha desde no puede ser posterior a la fecha hasta" };
  if (hasta > hoy) return { ok: false, error: "No se pueden pedir fechas futuras" };
  const dias = (aMs(hasta) - aMs(desde)) / 86400000 + 1;
  if (dias > MAX_DIAS) return { ok: false, error: `El rango máximo es de ${MAX_DIAS} días (elegiste ${dias})` };
  return { ok: true, desde, hasta, dias };
}

/** Parte el rango en ventanas consecutivas de hasta `tam` días. */
export function dividirVentanas(desde, hasta, tam = DIAS_VENTANA) {
  const out = [];
  for (let ini = aMs(desde); ini <= aMs(hasta); ini += tam * 86400000) {
    const fin = Math.min(ini + (tam - 1) * 86400000, aMs(hasta));
    out.push({ desde: aTexto(ini), hasta: aTexto(fin) });
  }
  return out;
}

/** Filas de Windsor → filas para meta_en_vivo_aplicar. Descarta las que no tienen una fecha válida. */
export function prepararFilas(datos) {
  const out = [];
  for (const f of datos ?? []) {
    const d = String(f.date ?? "").slice(0, 10);
    if (!esFechaReal(d)) continue;
    out.push({
      d,
      account_id: f.account_id == null ? null : String(f.account_id),
      campaign: f.campaign == null ? "" : String(f.campaign),
      adset_name: f.adset_name == null ? "" : String(f.adset_name),
      spend: f.spend == null ? "0" : String(f.spend),
      impressions: f.impressions == null ? "0" : String(f.impressions),
      clicks: f.clicks == null ? "0" : String(f.clicks),
      conv: f.actions_onsite_conversion_messaging_conversation_started_7d == null ? "0" : String(f.actions_onsite_conversion_messaging_conversation_started_7d),
      leads: f.actions_onsite_conversion_lead_grouped == null ? "0" : String(f.actions_onsite_conversion_lead_grouped),
    });
  }
  return out;
}
