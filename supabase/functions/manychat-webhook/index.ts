// Webhook en vivo de ManyChat → Nivel Crudo.
// Ref: specs/2026-09-25-v2-desde-cero.md, documento de Jaz, Sección 4.B
// ("Webhook en Vivo: Cuando el usuario hace clic en el botón del grupo en
// WhatsApp, ManyChat envía un evento HTTP POST al CRM"), y
// specs/2026-09-29-estado-hacia-spec-final.md (secciones 3 ter y 3 quater).
//
// Cada llamada es un INSERT en evento_crudo — nunca se deduplica ni se
// valida acá; la deduplicación vive en la vista evento_deduplicado
// (db/004_cliente.sql). Duplicados y reintentos son exactamente lo que pide
// guardar la tab Data_Cruda.
//
// Multi-cliente: cada cuenta de ManyChat manda dos headers —
//   x-cliente:         slug del cliente (crm_comunidades_v2.cliente.slug)
//   x-webhook-secret:  secreto de ESE cliente; acá se compara su sha256 contra
//                      cliente.webhook_secret_hash (el secreto en claro nunca
//                      se guarda en la base).
// Si el cliente no tiene webhook_secret_hash cargado, responde 501 explícito
// en vez de aceptar tráfico sin validar.
//
// Forma del body (verificada en el editor de ManyChat, 2026-09-29):
//   { "community_id": "<nombre o uuid>", "contact": <Full Contact Data> }
// "Full Contact Data" es el objeto completo del contacto que arma ManyChat.
// Datos que se usan de él:
//   - teléfono:  contact.whatsapp_phone (formato "+549…"). Los campos `phone` y
//                el de sistema "Teléfono" llegan null en contactos de WhatsApp.
//                Se normaliza a solo dígitos.
//   - nombre:    contact.first_name + contact.last_name → usuario_curado.nombre,
//                salvo que esté vacío o sea solo dígitos (contacto que no reveló
//                su nombre: ManyChat muestra el teléfono como nombre).
//   - email:     contact.email, si viene.
//   - comunidad: body.community_id; si falta, el primer campo personalizado
//                "Localidad*" con valor (contact.custom_fields).
// Compatibilidad: sigue aceptando el formato plano anterior
//   { "phone": "…", "community_id": "…" }.
//
// El momento del evento (recibido_en) es SIEMPRE la hora de recepción del
// servidor: la atribución First-Contact se decide por ese campo y no debe
// depender de un timestamp del emisor (last_interaction viene null en varios
// contactos). Cualquier timestamp que mande ManyChat queda solo en el payload.
//
// community_id acepta el uuid real de la comunidad, o el nombre exacto de la
// comunidad DENTRO de ese cliente. Una comunidad de otro cliente nunca matchea.
//
// Rechazos (PR #2): si el cliente está identificado (slug existente) y el POST se rechaza, la
// causa queda en crm_comunidades_v2.webhook_intento (db/007) y se muestra en Data_Cruda con el
// filtro "Rechazados". La respuesta HTTP no cambia. No se anotan los intentos sin cliente
// identificable (headers ausentes o slug inexistente) ni se guarda nunca el secreto recibido.
//
// Deploy: `supabase functions deploy manychat-webhook`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-webhook-secret, x-cliente",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function sha256Hex(texto: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// "+54 9 383 4290210" → "5493834290210". Devuelve null si no queda nada usable.
export function normalizarTelefono(valor: unknown): string | null {
  if (typeof valor !== "string" && typeof valor !== "number") return null;
  const digitos = String(valor).replace(/\D/g, "");
  return digitos.length >= 8 ? digitos : null;
}

function textoLimpio(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const t = valor.trim();
  return t.length ? t : null;
}

// Nombre real del contacto, o null si no lo reveló (vacío o solo dígitos/símbolos de teléfono).
export function nombreDeContacto(contact: Record<string, unknown> | null): string | null {
  if (!contact) return null;
  const nombre = [textoLimpio(contact.first_name), textoLimpio(contact.last_name)].filter(Boolean).join(" ") ||
    textoLimpio(contact.name);
  if (!nombre) return null;
  if (/^[\d\s+()-]+$/.test(nombre)) return null;
  return nombre;
}

// Primer campo personalizado "Localidad*" con valor (fallback si el flow no manda community_id).
function comunidadDesdeCamposPersonalizados(contact: Record<string, unknown> | null): string | null {
  const campos = contact?.custom_fields;
  if (!campos || typeof campos !== "object") return null;
  for (const [clave, valor] of Object.entries(campos as Record<string, unknown>)) {
    if (/^localidad/i.test(clave)) {
      const v = textoLimpio(valor);
      if (v) return v;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Método no soportado, usar POST" }, 405);
  }

  const slug = req.headers.get("x-cliente");
  const secretRecibido = req.headers.get("x-webhook-secret");
  if (!slug || !secretRecibido) {
    return json({ error: "Faltan los headers x-cliente y x-webhook-secret" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: cliente, error: errCliente } = await admin
    .schema("crm_comunidades_v2")
    .from("cliente")
    .select("id, activo, webhook_secret_hash")
    .eq("slug", slug)
    .maybeSingle();
  if (errCliente) return json({ error: errCliente.message }, 500);

  // Mismo mensaje para "no existe" y "secreto incorrecto": no permite enumerar clientes.
  // Si el slug no corresponde a ningún cliente no se registra nada (no hay a quién atribuirlo).
  if (!cliente) return json({ error: "Cliente o secret inválido" }, 401);

  // Rechazo de un cliente conocido: se anota en webhook_intento (para el filtro "Rechazados" de
  // Data_Cruda) y se responde igual que antes. Nunca se guarda el secreto ni el body completo, y un
  // fallo al anotar no cambia la respuesta.
  const rechazar = async (
    status: number,
    error: string,
    motivo: string,
    ctx: { comunidad?: string | null; telefono?: string | null } = {},
  ) => {
    try {
      await admin.schema("crm_comunidades_v2").from("webhook_intento").insert({
        cliente_id: cliente.id,
        estado: status,
        motivo: motivo.slice(0, 300),
        comunidad_recibida: ctx.comunidad ? ctx.comunidad.slice(0, 200) : null,
        telefono_id: ctx.telefono ?? null,
      });
    } catch (_) { /* el registro es secundario */ }
    return json({ error }, status);
  };

  if (!cliente.activo) return await rechazar(401, "Cliente o secret inválido", "Cliente inactivo");
  if (!cliente.webhook_secret_hash) {
    return await rechazar(
      501,
      "El cliente no tiene webhook_secret_hash configurado — ver docs/how-to/configurar-webhook-manychat.md",
      "El cliente no tiene secreto cargado",
    );
  }
  if (!iguales(await sha256Hex(secretRecibido), cliente.webhook_secret_hash)) {
    return await rechazar(401, "Cliente o secret inválido", "Secreto incorrecto");
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return await rechazar(400, "El body tiene que ser un objeto JSON", "El body no es un objeto JSON");
  }

  // Forma nueva: { community_id, contact: <Full Contact Data> }. Forma plana anterior: { phone, community_id }.
  const contact: Record<string, unknown> | null =
    body.contact && typeof body.contact === "object" ? body.contact : null;

  const telefono = normalizarTelefono(contact?.whatsapp_phone) ??
    normalizarTelefono(contact?.phone) ??
    normalizarTelefono(body.phone);
  const communityId: string | null = textoLimpio(body.community_id) ?? comunidadDesdeCamposPersonalizados(contact);
  if (!telefono) {
    return await rechazar(
      400,
      "No llegó un teléfono usable: se esperaba contact.whatsapp_phone (o phone en el formato plano)",
      "No llegó un teléfono usable (el contacto no es de WhatsApp o el campo vino vacío)",
      { comunidad: communityId },
    );
  }

  if (!communityId) {
    return await rechazar(
      400,
      "Falta la comunidad: mandar community_id, o un campo personalizado Localidad* con valor en contact.custom_fields",
      "Falta la comunidad: community_id llegó vacío",
      { telefono },
    );
  }

  const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(communityId);
  const { data: comunidad, error: errComunidad } = await admin
    .schema("crm_comunidades_v2")
    .from("comunidad")
    .select("id")
    .eq("cliente_id", cliente.id)
    .eq(esUuid ? "id" : "nombre", communityId)
    .maybeSingle();
  if (errComunidad) return await rechazar(500, errComunidad.message, `Error al buscar la comunidad: ${errComunidad.message}`, { comunidad: communityId, telefono });
  if (!comunidad) {
    return await rechazar(
      404,
      `Comunidad no encontrada en este cliente: ${communityId}`,
      "Comunidad no encontrada: el nombre que llegó no existe en este cliente",
      { comunidad: communityId, telefono },
    );
  }

  // recibido_en: hora del servidor (default de la tabla). El payload completo queda tal cual llegó.
  const { data: evento, error: errEvento } = await admin
    .schema("crm_comunidades_v2")
    .from("evento_crudo")
    .insert({
      cliente_id: cliente.id,
      comunidad_id: comunidad.id,
      telefono_id: telefono,
      tipo: "webhook_manychat",
      payload: body,
    })
    .select()
    .maybeSingle();
  if (errEvento) return await rechazar(500, errEvento.message, `Error al guardar el evento: ${errEvento.message}`, { comunidad: communityId, telefono });

  // Enriquecimiento: el trigger de evento_crudo ya creó la fila de usuario_curado. Solo se completan
  // los datos que todavía están vacíos — nunca se pisa un nombre/email que ya estaba cargado.
  const avisos: string[] = [];
  const nombre = nombreDeContacto(contact);
  const email = textoLimpio(contact?.email);
  if (nombre) {
    const { error } = await admin
      .schema("crm_comunidades_v2")
      .from("usuario_curado")
      .update({ nombre })
      .eq("cliente_id", cliente.id)
      .eq("telefono_id", telefono)
      .is("nombre", null);
    if (error) avisos.push(`No se pudo guardar el nombre: ${error.message}`);
  }
  if (email) {
    const { error } = await admin
      .schema("crm_comunidades_v2")
      .from("usuario_curado")
      .update({ email })
      .eq("cliente_id", cliente.id)
      .eq("telefono_id", telefono)
      .is("email", null);
    if (error) avisos.push(`No se pudo guardar el email: ${error.message}`);
  }

  return json({ data: evento, telefono_normalizado: telefono, aviso: avisos.length ? avisos.join(" · ") : undefined });
});
