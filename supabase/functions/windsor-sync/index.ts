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
// Nombre del campo de Windsor.ai para "conversaciones iniciadas". El documento de Jaz lo llama
// messaging_conversation_started_7d; el nombre exacto no se pudo confirmar contra la documentación de
// Windsor.ai, así que se puede corregir sin tocar el código: supabase secrets set WINDSOR_CONVERSATIONS_FIELD=...
const CAMPO_CONVERSACIONES = Deno.env.get("WINDSOR_CONVERSATIONS_FIELD") ?? "messaging_conversation_started_7d";

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
  clicks?: number;
  date: string;
  adset_name: string;
  spend: number;
  impressions: number;
  [campo: string]: unknown;
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
  // cliente_id es obligatorio: las comunidades (y su adset_name) son por cliente.
  const body = await req.json().catch(() => ({}));
  const clienteId: string | undefined = body?.cliente_id;
  if (!clienteId) {
    return json({ error: "Falta cliente_id en el body" }, 400);
  }
  const hasta = body?.hasta ?? new Date().toISOString().slice(0, 10);
  const desde = body?.desde ?? new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const fields = `date,adset_name,spend,impressions,clicks,${CAMPO_CONVERSACIONES}`;
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
    .eq("cliente_id", clienteId)
    .not("adset_name", "is", null);
  if (errComunidades) return json({ error: errComunidades.message }, 500);

  const porAdset = new Map(comunidades.map((c) => [c.adset_name, c.id]));
  const sinMatch: string[] = [];

  // Windsor puede devolver más de una fila por (adset, día) — por ejemplo, con desglose por campaña o
  // anuncio. La tabla guarda una fila por (comunidad, fecha): se suman antes de insertar; si no,
  // Postgres rechaza el upsert ("ON CONFLICT DO UPDATE command cannot affect row a second time").
  const acumulado = new Map<string, {
    cliente_id: string; comunidad_id: string; fecha: string;
    inversion: number; impresiones: number; clics: number; conversaciones_meta: number;
  }>();
  let filasConConversaciones = 0;

  for (const fila of filas) {
    const comunidadId = porAdset.get(fila.adset_name);
    if (!comunidadId) {
      sinMatch.push(fila.adset_name);
      continue;
    }
    const conversaciones = Number(fila[CAMPO_CONVERSACIONES] ?? 0) || 0;
    if (fila[CAMPO_CONVERSACIONES] !== undefined && fila[CAMPO_CONVERSACIONES] !== null) filasConConversaciones++;

    const clave = `${comunidadId}|${fila.date}`;
    const actual = acumulado.get(clave) ?? {
      cliente_id: clienteId, comunidad_id: comunidadId, fecha: fila.date,
      inversion: 0, impresiones: 0, clics: 0, conversaciones_meta: 0,
    };
    actual.inversion += Number(fila.spend ?? 0) || 0;
    actual.impresiones += Number(fila.impressions ?? 0) || 0;
    actual.clics += Number(fila.clicks ?? 0) || 0;
    actual.conversaciones_meta += conversaciones;
    acumulado.set(clave, actual);
  }
  const filasParaInsertar = [...acumulado.values()];

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

  const avisos: string[] = [];
  if (sinMatch.length) avisos.push(`Sin match para: ${[...new Set(sinMatch)].join(", ")}`);
  if (!filasConConversaciones) {
    avisos.push(
      `Windsor.ai no devolvió el campo "${CAMPO_CONVERSACIONES}": las conversaciones quedaron en 0. ` +
        "Confirmar el nombre del campo y corregirlo con WINDSOR_CONVERSATIONS_FIELD.",
    );
  }

  return json({
    data: { insertadas: insertadas?.length ?? 0 },
    aviso: avisos.length ? avisos.join(" · ") : undefined,
  });
});
