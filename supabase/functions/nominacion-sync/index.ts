// Módulo de Nominación → enriquece usuario_curado con nombre/email real.
// Ref: specs/2026-09-25-v2-desde-cero.md, documento de Jaz, Sección 4.B
// ("Módulo de Nominación (Importador/API): el CRM debe incluir un botón o
// endpoint para sincronizar el Reporte de Suscriptores de ManyChat... hace
// match por el número de teléfono y reemplaza los nombres anonimizados por
// los nombres y correos reales guardados por ManyChat").
//
// Invocación: botón "Sincronizar nombres" en la tab Base_Limpia, para el cliente elegido
// en el selector (body {cliente_id}, obligatorio). Con el webhook ya copiando el nombre de
// ManyChat, esta función es opcional (decisión 4 del spec). Recorre
// usuario_curado donde nombre is null, busca el perfil en ManyChat por
// teléfono y actualiza nombre/email.
//
// ⚠️ Sin credenciales reales de ManyChat para probar contra la API en este
// entorno — el endpoint usado abajo (GET /wa/subscriber/getInfo) es el que
// documenta ManyChat para integraciones de WhatsApp al momento de escribir
// esto, pero conviene confirmarlo contra la documentación oficial vigente
// antes del primer uso real (puede haber cambiado de nombre/forma).
//
// Alternativa que menciona el documento si la API no alcanza: carga manual
// semanal de un .csv exportado de ManyChat — no se implementa en esta
// primera vuelta (no es una integración, es una tarea operativa aparte),
// queda como nota en docs/how-to/configurar-webhook-manychat.md.
//
// Sin MANYCHAT_API_KEY configurada como secret de Supabase, responde 501
// explícito.
//
// Deploy: `supabase functions deploy nominacion-sync`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MANYCHAT_API_KEY = Deno.env.get("MANYCHAT_API_KEY");

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (!MANYCHAT_API_KEY) {
    return json(
      { error: "MANYCHAT_API_KEY no configurada — ver docs/how-to/configurar-webhook-manychat.md" },
      501,
    );
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // cliente_id obligatorio: usuario_curado es por (cliente, teléfono) y una misma persona puede estar en
  // más de un cliente. Nunca se completan datos de un cliente con una consulta hecha para otro.
  const body = await req.json().catch(() => ({}));
  const clienteId: string | undefined = body?.cliente_id;
  if (!clienteId) return json({ error: "Falta cliente_id en el body" }, 400);

  const { data: pendientes, error: errPendientes } = await admin
    .schema("crm_comunidades_v2")
    .from("usuario_curado")
    .select("telefono_id")
    .eq("cliente_id", clienteId)
    .is("nombre", null);
  if (errPendientes) return json({ error: errPendientes.message }, 500);

  if (!pendientes?.length) {
    return json({ data: { actualizados: 0, sin_match: 0 }, aviso: "Nada pendiente de nominar" });
  }

  let actualizados = 0;
  const sinMatch: string[] = [];

  for (const { telefono_id } of pendientes) {
    try {
      const res = await fetch(
        `https://api.manychat.com/wa/subscriber/getInfo?whatsapp_phone=${encodeURIComponent(telefono_id)}`,
        { headers: { Authorization: `Bearer ${MANYCHAT_API_KEY}` } },
      );
      if (!res.ok) {
        sinMatch.push(telefono_id);
        continue;
      }
      const perfil = await res.json();
      const nombre = [perfil?.data?.first_name, perfil?.data?.last_name].filter(Boolean).join(" ") || null;
      const email = perfil?.data?.email ?? null;
      if (!nombre && !email) {
        sinMatch.push(telefono_id);
        continue;
      }
      const { error: errUpdate } = await admin
        .schema("crm_comunidades_v2")
        .from("usuario_curado")
        .update({ nombre, email })
        .eq("cliente_id", clienteId)
        .eq("telefono_id", telefono_id);
      if (errUpdate) throw errUpdate;
      actualizados++;
    } catch {
      sinMatch.push(telefono_id);
    }
  }

  return json({ data: { actualizados, sin_match: sinMatch.length }, telefonos_sin_match: sinMatch });
});
