// Meta por anuncio: consulta a Windsor.ai, a pedido y para el rango de fechas elegido, las métricas de CADA ANUNCIO y las guarda en
// meta_ads_anuncio_metrica (db/040). No toca meta_ads_metrica: es el detalle por anuncio de lo mismo.
//
// POST { "desde": "AAAA-MM-DD", "hasta": "AAAA-MM-DD" }  (hasta 31 días, sin fechas futuras)
//   1. Pide a Windsor (conector facebook) el rango a nivel anuncio, en ventanas de 14 días y en paralelo.
//   2. Le pasa las filas a la base (crm_comunidades_v2.meta_anuncios_aplicar), que aplica las MISMAS reglas de comunidad y de
//      "campañas que cuentan" de siempre y reemplaza los días del rango.
//   3. Devuelve un resumen: filas de Windsor, registros guardados, gasto sin comunidad, filas sin ad_id.
//
// Secreto necesario: WINDSOR_API_KEY (el mismo de meta-en-vivo). Sin él responde 501. La clave nunca se devuelve ni se registra.
// Seguridad: exige la sesión de un usuario Marketing (_shared/acceso.mjs) o la clave de servicio (llamadas internas / programadas).
//
// Deploy: supabase functions deploy meta-anuncios --use-api --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { exigirMarketing } from "../_shared/acceso.mjs";
import { dividirVentanas, validarRango } from "../meta-en-vivo/ventanas.mjs";
import { CAMPOS_ANUNCIO, CAMPOS_ANUNCIO_SIN_ENLACE, prepararFilasAnuncio } from "./campos.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WINDSOR_API_KEY = Deno.env.get("WINDSOR_API_KEY");
const ACCESO = { supabaseUrl: SUPABASE_URL, anonKey: Deno.env.get("SUPABASE_ANON_KEY")!, serviceKey: SERVICE_ROLE_KEY, aceptarServicio: true };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const hoyAR = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());

// Una ventana de Windsor, con tiempo límite y un reintento ante 429 o error del servidor. Los mensajes de error no incluyen la URL (lleva la clave).
async function consultarVentana(clave: string, desde: string, hasta: string, campos: string[]) {
  const url = `https://connectors.windsor.ai/facebook?api_key=${encodeURIComponent(clave)}&fields=${campos.join(",")}&date_from=${desde}&date_to=${hasta}`;
  let ultimo: Error | null = null;
  for (let intento = 0; intento < 2; intento++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(100_000) });
      if (!r.ok) {
        ultimo = new Error(`Windsor respondió HTTP ${r.status}`);
        if (r.status === 429 || r.status >= 500) { await new Promise((x) => setTimeout(x, 1500)); continue; }
        throw ultimo;
      }
      const j = await r.json();
      const datos = Array.isArray(j) ? j : j?.data;
      if (!Array.isArray(datos)) throw new Error("Respuesta inesperada de Windsor (ni lista ni { data: [...] })");
      return datos;
    } catch (e) {
      ultimo = new Error(String((e as Error).message ?? e).replaceAll(clave, "***"));
      if ((e as Error).name === "TimeoutError") break;
    }
  }
  throw ultimo ?? new Error("No se pudo consultar a Windsor");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no soportado, usar POST" }, 405);
  const acceso = await exigirMarketing(req, ACCESO);
  if (!acceso.ok) return json({ error: acceso.error }, acceso.status);
  if (!WINDSOR_API_KEY) return json({ error: "Falta cargar la clave de Windsor como secreto de la función (WINDSOR_API_KEY)" }, 501);

  let cuerpo: { desde?: string; hasta?: string };
  try { cuerpo = await req.json(); } catch { return json({ error: "El cuerpo tiene que ser un JSON { desde, hasta }" }, 400); }
  const v = validarRango(String(cuerpo.desde ?? ""), String(cuerpo.hasta ?? ""), hoyAR());
  if (!v.ok) return json({ error: v.error }, 400);

  let datos: unknown[];
  let sinEnlace = false;   // true si Windsor rechazó el campo de clics en el enlace y se pidió sin él
  const ventanas = dividirVentanas(v.desde, v.hasta);
  const pedir = (campos: string[]) => Promise.all(ventanas.map((w) => consultarVentana(WINDSOR_API_KEY, w.desde, w.hasta, campos))).then((x) => x.flat());
  try {
    try {
      datos = await pedir(CAMPOS_ANUNCIO);
    } catch (e) {
      if (!/HTTP (400|422)/.test(String((e as Error).message ?? e))) throw e;
      datos = await pedir(CAMPOS_ANUNCIO_SIN_ENLACE);
      sinEnlace = true;
    }
  } catch (e) {
    return json({ error: String((e as Error).message ?? e).replaceAll(WINDSOR_API_KEY, "***") }, 502);
  }

  const filas = prepararFilasAnuncio(datos as Record<string, unknown>[]);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await admin.schema("crm_comunidades_v2").rpc("meta_anuncios_aplicar", { p_filas: filas, p_desde: v.desde, p_hasta: v.hasta });
  if (error) return json({ error: error.message }, /Esper[aá] un momento/.test(error.message) ? 429 : 400);

  const r = (Array.isArray(data) ? data[0] : data) ?? {};
  return json({
    ok: true, desde: v.desde, hasta: v.hasta, dias: v.dias, filas_windsor: datos.length,
    filas_asignadas: r.filas_asignadas ?? 0, registros_escritos: r.registros_escritos ?? 0,
    filas_sin_comunidad: r.filas_sin_comunidad ?? 0, gasto_sin_comunidad: r.gasto_sin_comunidad ?? 0,
    filas_sin_anuncio: r.filas_sin_anuncio ?? 0,
    // true = Windsor no devolvió los clics en el enlace en esta consulta (el resto se guardó igual).
    clics_enlace_omitidos: sinEnlace,
  });
});
