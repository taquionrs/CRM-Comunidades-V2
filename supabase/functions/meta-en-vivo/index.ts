// Meta en vivo: consulta a Windsor.ai, a pedido y para el rango de fechas elegido, y actualiza las métricas de Meta del CRM.
//
// POST { "desde": "AAAA-MM-DD", "hasta": "AAAA-MM-DD" }  (hasta 31 días, sin fechas futuras)
//   1. Pide a Windsor (conector facebook) el rango, en ventanas de 14 días y en paralelo.
//   2. Le pasa las filas a la base (crm_comunidades_v2.meta_en_vivo_aplicar, db/027), que aplica las MISMAS reglas de siempre
//      (qué campañas cuentan y en qué comunidad, db/025) y actualiza meta_ads_metrica.
//   3. Devuelve un resumen: filas de Windsor, registros guardados, gasto que no cuenta, etc.
//
// Secreto necesario: WINDSOR_API_KEY (Supabase → Edge Functions → Secrets). Sin él responde 501 en lugar de fallar en silencio.
// La clave de Windsor NUNCA se devuelve ni se registra: se enmascara en cualquier mensaje de error.
//
// Seguridad: se despliega con --no-verify-jwt (el panel todavía no tiene login) y se protege con un tope de 31 días y una pausa de 45 segundos
// entre consultas (en la base). Ver docs/how-to/meta-en-vivo.md.
//
// Deploy: supabase functions deploy meta-en-vivo --use-api --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CAMPOS_WINDSOR, dividirVentanas, prepararFilas, validarRango } from "./ventanas.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WINDSOR_API_KEY = Deno.env.get("WINDSOR_API_KEY");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const hoyAR = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());

// Una ventana de Windsor, con tiempo límite y un reintento ante 429 o error del servidor. Los mensajes de error no incluyen la URL (lleva la clave).
async function consultarVentana(clave: string, desde: string, hasta: string) {
  const url = `https://connectors.windsor.ai/facebook?api_key=${encodeURIComponent(clave)}&fields=${CAMPOS_WINDSOR.join(",")}&date_from=${desde}&date_to=${hasta}`;
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
  if (!WINDSOR_API_KEY) return json({ error: "Falta cargar la clave de Windsor como secreto de la función (WINDSOR_API_KEY)" }, 501);

  let cuerpo: { desde?: string; hasta?: string };
  try { cuerpo = await req.json(); } catch { return json({ error: "El cuerpo tiene que ser un JSON { desde, hasta }" }, 400); }
  const v = validarRango(String(cuerpo.desde ?? ""), String(cuerpo.hasta ?? ""), hoyAR());
  if (!v.ok) return json({ error: v.error }, 400);

  let datos: unknown[];
  try {
    const ventanas = dividirVentanas(v.desde, v.hasta);
    datos = (await Promise.all(ventanas.map((w) => consultarVentana(WINDSOR_API_KEY, w.desde, w.hasta)))).flat();
  } catch (e) {
    return json({ error: String((e as Error).message ?? e).replaceAll(WINDSOR_API_KEY, "***") }, 502);
  }

  const filas = prepararFilas(datos as Record<string, unknown>[]);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await admin.schema("crm_comunidades_v2").rpc("meta_en_vivo_aplicar", { p_filas: filas, p_desde: v.desde, p_hasta: v.hasta });
  if (error) return json({ error: error.message }, /Esper[aá] un momento/.test(error.message) ? 429 : 400);

  const r = (Array.isArray(data) ? data[0] : data) ?? {};
  // Cuánto gasto quedó fuera por regla (lo que no cuenta): lo deja la base en el registro de esta corrida.
  const { data: log } = await admin.schema("crm_comunidades_v2").from("windsor_sync_log")
    .select("filas_excluidas, gasto_excluido, registros_borrados").like("tabla", "windsor_raw.en_vivo%").order("corrida_en", { ascending: false }).limit(1).maybeSingle();

  return json({
    ok: true, desde: v.desde, hasta: v.hasta, dias: v.dias, filas_windsor: datos.length,
    filas_asignadas: r.filas_asignadas ?? 0, registros_escritos: r.registros_escritos ?? 0,
    filas_sin_comunidad: r.filas_sin_comunidad ?? 0, gasto_sin_comunidad: r.gasto_sin_comunidad ?? 0,
    filas_excluidas: log?.filas_excluidas ?? 0, gasto_excluido: log?.gasto_excluido ?? 0, registros_borrados: log?.registros_borrados ?? 0,
  });
});
