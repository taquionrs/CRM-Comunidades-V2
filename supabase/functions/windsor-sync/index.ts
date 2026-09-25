// Sincronización de Meta Ads vía Windsor.ai → meta_ads_metrica.
// Ref: specs/2026-09-25-v2-desde-cero.md, documento de Jaz, Sección 4.A
// ("Windsor.ai MCP Connector (Meta Ads)": consultar spend, impressions y
// messaging_conversation_started_7d agrupado por adset_name, mapear contra
// la comunidad).
//
// Invocación: manual desde el panel (botón en Control_Comunidades) o
// programada vía Supabase Scheduled Functions / pg_cron — no se configura
// un cron acá, queda como decisión de infraestructura post-deploy
// (ver docs/how-to/configurar-windsor-ai.md).
//
// Sin WINDSOR_API_KEY configurada como secret de Supabase, responde 501
// explícito en vez de fallar en silencio o insertar filas vacías — mismo
// patrón que activacion-manychat de V1.
//
// El mapeo adset_name → comunidad es literal: cada fila de Windsor.ai debe
// traer un adset_name que matchee exactamente crm_comunidades_v2.
// comunidad.adset_name (case-sensitive) — filas sin match se reportan pero
// no se insertan (nunca se inventa a qué comunidad pertenecen).
//
// Deploy: `supabase functions deploy windsor-sync`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WINDSOR_API_KEY = Deno.env.get("WINDSOR_API_KEY");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

interface WindsorRow {
  date: string;
  adset_name: string;
  spend: number;
  impressions: number;
  messaging_conversation_started_7d: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  if (!WINDSOR_API_KEY) {
    return json(
      { error: "WINDSOR_API_KEY no configurada — ver docs/how-to/configurar-windsor-ai.md" },
      501,
    );
  }

  // Rango: últimos 7 días por default, o el que venga en el body ({desde, hasta}).
  const body = await req.json().catch(() => ({}));
  const hasta = body?.hasta ?? new Date().toISOString().slice(0, 10);
  const desde = body?.desde ?? new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const fields = "date,adset_name,spend,impressions,messaging_conversation_started_7d";
  const windsorUrl =
    `https://connectors.windsor.ai/facebook?api_key=${WINDSOR_API_KEY}` +
    `&fields=${fields}&date_from=${desde}&date_to=${hasta}&_render=json`;

  let filas: WindsorRow[];
  try {
    const res = await fetch(windsorUrl);
    if (!res.ok) {
      return json({ error: `Windsor.ai respondió ${res.status}: ${await res.text()}` }, 502);
    }
    const data = await res.json();
    filas = data?.data ?? data ?? [];
  } catch (e) {
    return json({ error: `No se pudo consultar Windsor.ai: ${String(e)}` }, 502);
  }

  const { data: comunidades, error: errComunidades } = await admin
    .schema("crm_comunidades_v2")
    .from("comunidad")
    .select("id, adset_name")
    .not("adset_name", "is", null);
  if (errComunidades) return json({ error: errComunidades.message }, 500);

  const porAdset = new Map(comunidades.map((c) => [c.adset_name, c.id]));
  const sinMatch: string[] = [];
  const filasParaInsertar = [];

  for (const fila of filas) {
    const comunidadId = porAdset.get(fila.adset_name);
    if (!comunidadId) {
      sinMatch.push(fila.adset_name);
      continue;
    }
    filasParaInsertar.push({
      comunidad_id: comunidadId,
      fecha: fila.date,
      inversion: fila.spend ?? 0,
      impresiones: fila.impressions ?? 0,
      conversaciones_meta: fila.messaging_conversation_started_7d ?? 0,
    });
  }

  if (!filasParaInsertar.length) {
    return json({
      data: { insertadas: 0 },
      aviso: sinMatch.length
        ? `Ningún adset_name matcheó una comunidad. Sin match: ${[...new Set(sinMatch)].join(", ")}`
        : "Windsor.ai no devolvió filas para ese rango de fechas",
    });
  }

  const { data: insertadas, error: errUpsert } = await admin
    .schema("crm_comunidades_v2")
    .from("meta_ads_metrica")
    .upsert(filasParaInsertar, { onConflict: "comunidad_id,fecha" })
    .select();
  if (errUpsert) return json({ error: errUpsert.message }, 500);

  return json({
    data: { insertadas: insertadas?.length ?? 0 },
    aviso: sinMatch.length ? `Sin match para: ${[...new Set(sinMatch)].join(", ")}` : undefined,
  });
});
