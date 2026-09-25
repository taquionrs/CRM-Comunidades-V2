// Webhook en vivo de ManyChat → Nivel Crudo.
// Ref: specs/2026-09-25-v2-desde-cero.md, documento de Jaz, Sección 4.B
// ("Webhook en Vivo: Cuando el usuario hace clic en el botón del grupo en
// WhatsApp, ManyChat envía un evento HTTP POST al CRM inyectando phone,
// community_id, timestamp").
//
// Cada llamada es un INSERT en evento_crudo — nunca se deduplica ni se
// valida acá; la deduplicación vive en la vista evento_deduplicado
// (db/001_init.sql). Duplicados y reintentos son exactamente lo que pide
// guardar la tab Data_Cruda.
//
// Auth: ManyChat no soporta JWT de Supabase — se valida un secret propio
// compartido, configurado como header "External Request" en el flow de
// ManyChat (Configuración → Automatización → esa acción → Headers).
// Sin MANYCHAT_WEBHOOK_SECRET configurado como secret de Supabase, la
// función responde 501 explícito en vez de aceptar tráfico sin validar.
//
// community_id acepta el uuid real de crm_comunidades_v2.comunidad, o —
// para no depender de que quien configura el flow de ManyChat conozca el
// uuid — el nombre exacto de la comunidad como fallback.
//
// Deploy: `supabase functions deploy manychat-webhook`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("MANYCHAT_WEBHOOK_SECRET");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-webhook-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Método no soportado, usar POST" }, 405);
  }

  if (!WEBHOOK_SECRET) {
    return json(
      { error: "MANYCHAT_WEBHOOK_SECRET no configurada — ver docs/how-to/configurar-webhook-manychat.md" },
      501,
    );
  }

  const secretRecibido = req.headers.get("x-webhook-secret");
  if (secretRecibido !== WEBHOOK_SECRET) {
    return json({ error: "Secret inválido" }, 401);
  }

  const body = await req.json().catch(() => null);
  const phone: string | undefined = body?.phone;
  const communityId: string | undefined = body?.community_id;
  const timestamp: string | undefined = body?.timestamp;
  if (!phone || !communityId) {
    return json({ error: "Faltan campos obligatorios: phone, community_id" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(communityId);
  const { data: comunidad, error: errComunidad } = await admin
    .schema("crm_comunidades_v2")
    .from("comunidad")
    .select("id")
    .eq(esUuid ? "id" : "nombre", communityId)
    .maybeSingle();
  if (errComunidad) return json({ error: errComunidad.message }, 500);
  if (!comunidad) return json({ error: `Comunidad no encontrada: ${communityId}` }, 404);

  const { data: evento, error: errEvento } = await admin
    .schema("crm_comunidades_v2")
    .from("evento_crudo")
    .insert({
      comunidad_id: comunidad.id,
      telefono_id: phone,
      tipo: "webhook_manychat",
      payload: body,
      recibido_en: timestamp ?? new Date().toISOString(),
    })
    .select()
    .maybeSingle();
  if (errEvento) return json({ error: errEvento.message }, 500);

  return json({ data: evento });
});
