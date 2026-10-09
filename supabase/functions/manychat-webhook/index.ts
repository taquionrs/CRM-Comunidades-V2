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
// Instagram (PR #4, db/008): un contacto sin teléfono se identifica por contact.ig_id y se guarda como
// "ig:<id>" en la misma columna telefono_id; el canal se deduce del prefijo. Si llega teléfono, manda el
// teléfono. La respuesta incluye `canal` ("whatsapp" | "instagram").
//
// Rechazos (PR #2 y PR #7): si el POST se rechaza, el contenido COMPLETO queda guardado para poder
// recuperarlo. Con cliente identificado (slug existente) va a crm_comunidades_v2.webhook_intento (db/007,
// columna payload en db/009) y se muestra en Data_Cruda con el filtro "Rechazados". Sin cliente identificable
// (headers ausentes o slug inexistente) va a webhook_intento_sin_cliente, que el panel no lee. La respuesta
// HTTP no cambia. Nunca se guarda el secreto: viaja en un header, no en el body. Hay topes de tamaño y de
// cantidad (ver las constantes) para que el ruido de internet no llene la base.
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

// ig_id exacto tomado del texto del body, sea número ("ig_id": 178…) o texto ("ig_id": "178…"), sin pasar
// por el redondeo de JSON.parse. Devuelve null si no está o tiene menos de 5 dígitos.
export function igIdDesdeTexto(texto: string): string | null {
  const m = /"ig_id"\s*:\s*"?(\d{5,})"?/.exec(texto);
  return m ? m[1] : null;
}

// Topes para que los rechazos no llenen la base (ver rechazar / rechazarSinCliente).
const MAX_BODY_GUARDADO = 65536; // bytes; un contacto completo de ManyChat pesa ~2 KB
const TOPE_SIN_CLIENTE_POR_HORA = 300;
const TOPE_401_CADA_10_MIN = 200;

// Contenido de un POST rechazado, listo para guardar como jsonb. Si es JSON válido se guarda tal cual
// (más `_ig_id_exacto`, porque JSON.parse redondea los ids de Instagram de 17 dígitos). Si no es JSON o es
// demasiado grande, se guarda el comienzo del texto con una marca. Nunca incluye headers ni el secreto.
export function payloadDeRechazo(texto: string): unknown {
  if (!texto) return null;
  if (texto.length > MAX_BODY_GUARDADO) return { _truncado: true, _bytes: texto.length, _inicio: texto.slice(0, 4000) };
  let parsed: unknown;
  try { parsed = JSON.parse(texto); } catch { return { _no_es_json: true, _texto: texto.slice(0, 4000) }; }
  const igExacto = igIdDesdeTexto(texto);
  if (igExacto && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return { ...(parsed as Record<string, unknown>), _ig_id_exacto: igExacto };
  }
  return parsed;
}

// Identificador de Instagram de ManyChat → solo dígitos (mínimo 5), o null si no sirve.
export function idInstagram(valor: unknown): string | null {
  if (typeof valor !== "string" && typeof valor !== "number") return null;
  const digitos = String(valor).replace(/\D/g, "");
  return digitos.length >= 5 ? digitos : null;
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

// Tipo de aviso que manda el flow, según el campo "evento" del body:
//   (sin evento)   contacto normal: el POST de entrada al flow (evento_crudo)
//   "trigger"      se entregó el primer mensaje del flow (trigger_entregado, db/011)
//   "clic_me_sumo" la persona tocó el botón "Me sumo" (clic_me_sumo, db/013)
//   otro valor     "desconocido": se rechaza, para que un aviso nuevo mal escrito NO se cuente como entrada.
export type TipoAviso = "contacto" | "trigger" | "clic_me_sumo" | "desconocido";
export function tipoDeAviso(valor: unknown): TipoAviso {
  if (valor === undefined || valor === null) return "contacto";
  if (typeof valor !== "string") return "desconocido";
  const v = valor.trim().toLowerCase();
  if (v === "") return "contacto";
  if (v === "trigger" || v === "trigger_entregado") return "trigger";
  if (v === "clic_me_sumo" || v === "clic-me-sumo") return "clic_me_sumo";
  return "desconocido";
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

  // El texto del body se lee SIEMPRE y primero (PR #7): si el POST se rechaza por cualquier motivo, el
  // contenido completo se guarda para poder recuperarlo. Un error de configuración (cliente, secreto o
  // comunidad mal escritos) no tiene que hacer perder a las personas que entraron mientras tanto.
  const textoCrudo = await req.text().catch(() => "");

  const slug = req.headers.get("x-cliente");
  const secretRecibido = req.headers.get("x-webhook-secret");

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Rechazo SIN cliente identificable (headers ausentes o x-cliente que no existe): no se puede atribuir a
  // ningún cliente, así que va a una tabla aparte que el panel no lee (solo se consulta por SQL). Tiene un
  // tope por hora para que el ruido de internet no llene la base. La respuesta es la de siempre.
  const rechazarSinCliente = async (status: number, error: string, motivo: string) => {
    try {
      const t = admin.schema("crm_comunidades_v2").from("webhook_intento_sin_cliente");
      const { count } = await t.select("id", { count: "exact", head: true })
        .gte("creado_en", new Date(Date.now() - 3600_000).toISOString());
      if ((count ?? 0) < TOPE_SIN_CLIENTE_POR_HORA) {
        await admin.schema("crm_comunidades_v2").from("webhook_intento_sin_cliente").insert({
          slug_recibido: slug ? slug.slice(0, 80) : null,
          estado: status,
          motivo: motivo.slice(0, 300),
          payload: payloadDeRechazo(textoCrudo),
        });
      }
    } catch (_) { /* el registro es secundario */ }
    return json({ error }, status);
  };

  if (!slug || !secretRecibido) {
    return await rechazarSinCliente(
      401,
      "Faltan los headers x-cliente y x-webhook-secret",
      "Faltan los encabezados x-cliente y/o x-webhook-secret",
    );
  }

  const { data: cliente, error: errCliente } = await admin
    .schema("crm_comunidades_v2")
    .from("cliente")
    .select("id, activo, webhook_secret_hash")
    .eq("slug", slug)
    .maybeSingle();
  if (errCliente) return json({ error: errCliente.message }, 500);

  // Mismo mensaje para "no existe" y "secreto incorrecto": no permite enumerar clientes.
  if (!cliente) {
    return await rechazarSinCliente(401, "Cliente o secret inválido", `El cliente indicado en x-cliente no existe`);
  }

  // Rechazo de un cliente conocido: se anota en webhook_intento (para el filtro "Rechazados" de
  // Data_Cruda) con el contenido completo del POST, y se responde igual que antes. Nunca se guarda el
  // secreto (viaja en un header, no en el body), y un fallo al anotar no cambia la respuesta.
  const rechazar = async (
    status: number,
    error: string,
    motivo: string,
    ctx: { comunidad?: string | null; telefono?: string | null } = {},
  ) => {
    try {
      // Con secreto incorrecto cualquiera que conozca el slug puede mandar POST: se limita cuántos se anotan.
      let anotar = true;
      if (status === 401) {
        const { count } = await admin.schema("crm_comunidades_v2").from("webhook_intento")
          .select("id", { count: "exact", head: true })
          .eq("cliente_id", cliente.id).eq("estado", 401)
          .gte("creado_en", new Date(Date.now() - 600_000).toISOString());
        anotar = (count ?? 0) < TOPE_401_CADA_10_MIN;
      }
      if (anotar) {
        await admin.schema("crm_comunidades_v2").from("webhook_intento").insert({
          cliente_id: cliente.id,
          estado: status,
          motivo: motivo.slice(0, 300),
          comunidad_recibida: ctx.comunidad ? ctx.comunidad.slice(0, 200) : null,
          telefono_id: ctx.telefono ?? null,
          payload: payloadDeRechazo(textoCrudo),
        });
      }
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

  // El texto crudo (leído al principio) se usa además del JSON: los ig_id de Instagram tienen 17 dígitos y,
  // si llegan como número JSON, JSON.parse los redondea (…123 → …124). El id exacto se saca del texto original.
  const body = (() => { try { return JSON.parse(textoCrudo); } catch { return null; } })();
  if (!body || typeof body !== "object") {
    return await rechazar(400, "El body tiene que ser un objeto JSON", "El body no es un objeto JSON");
  }

  const tipoAviso = tipoDeAviso(body.evento);
  if (tipoAviso === "desconocido") {
    return await rechazar(
      400,
      'El campo "evento" tiene un valor desconocido: usar "trigger", "clic_me_sumo" o no mandarlo',
      `Tipo de aviso desconocido: evento = ${JSON.stringify(body.evento)?.slice(0, 60)}`,
    );
  }

  // Forma nueva: { community_id, contact: <Full Contact Data> }. Forma plana anterior: { phone, community_id }.
  const contact: Record<string, unknown> | null =
    body.contact && typeof body.contact === "object" ? body.contact : null;

  const telefono = normalizarTelefono(contact?.whatsapp_phone) ??
    normalizarTelefono(contact?.phone) ??
    normalizarTelefono(body.phone);
  const communityId: string | null = textoLimpio(body.community_id) ?? comunidadDesdeCamposPersonalizados(contact);
  // Instagram (db/008): un contacto sin teléfono se identifica por contact.ig_id como "ig:<id>".
  // El teléfono, si llega, tiene prioridad (la persona es de WhatsApp).
  const igId = igIdDesdeTexto(textoCrudo) ?? idInstagram(contact?.ig_id);
  const identificador: string | null = telefono ?? (igId ? `ig:${igId}` : null);
  const canal = telefono ? "whatsapp" : "instagram";
  if (!identificador) {
    // Solo los NOMBRES de los campos con valor (nunca los valores), para poder diagnosticar qué manda ManyChat.
    const camposConValor = Object.entries(contact ?? {})
      .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))
      .map(([k]) => k)
      .join(", ");
    return await rechazar(
      400,
      "No llegó un identificador usable: se esperaba contact.whatsapp_phone (WhatsApp) o contact.ig_id (Instagram)",
      `No llegó teléfono ni ig_id usable. Campos del contacto con valor: ${camposConValor || "ninguno"}`,
      { comunidad: communityId },
    );
  }

  if (!communityId) {
    return await rechazar(
      400,
      "Falta la comunidad: mandar community_id, o un campo personalizado Localidad* con valor en contact.custom_fields",
      "Falta la comunidad: community_id llegó vacío",
      { telefono: identificador },
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
  if (errComunidad) return await rechazar(500, errComunidad.message, `Error al buscar la comunidad: ${errComunidad.message}`, { comunidad: communityId, telefono: identificador });
  if (!comunidad) {
    return await rechazar(
      404,
      `Comunidad no encontrada en este cliente: ${communityId}`,
      "Comunidad no encontrada: el nombre que llegó no existe en este cliente",
      { comunidad: communityId, telefono: identificador },
    );
  }

  // Aviso de "se entregó el primer mensaje del flow" (db/011): "evento": "trigger" en el body. No es un contacto:
  // va a trigger_entregado, nunca a evento_crudo, así no toca clics únicos, atribución ni Base_Limpia.
  // Lo mismo para "clic_me_sumo" (db/013): la persona tocó el botón. Tampoco es un contacto nuevo.
  if (tipoAviso === "trigger" || tipoAviso === "clic_me_sumo") {
    const tabla = tipoAviso === "trigger" ? "trigger_entregado" : "clic_me_sumo";
    const { error: errAviso } = await admin
      .schema("crm_comunidades_v2")
      .from(tabla)
      .insert({ cliente_id: cliente.id, comunidad_id: comunidad.id, telefono_id: identificador });
    if (errAviso) return await rechazar(500, errAviso.message, `Error al guardar el aviso (${tipoAviso}): ${errAviso.message}`, { comunidad: communityId, telefono: identificador });
    return json({ ok: true, evento: tipoAviso, telefono_normalizado: identificador, canal });
  }

  // recibido_en: hora del servidor (default de la tabla). El payload completo queda tal cual llegó.
  const { data: evento, error: errEvento } = await admin
    .schema("crm_comunidades_v2")
    .from("evento_crudo")
    .insert({
      cliente_id: cliente.id,
      comunidad_id: comunidad.id,
      telefono_id: identificador,
      tipo: "webhook_manychat",
      payload: body,
    })
    .select()
    .maybeSingle();
  if (errEvento) return await rechazar(500, errEvento.message, `Error al guardar el evento: ${errEvento.message}`, { comunidad: communityId, telefono: identificador });

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
      .eq("telefono_id", identificador)
      .is("nombre", null);
    if (error) avisos.push(`No se pudo guardar el nombre: ${error.message}`);
  }
  if (email) {
    const { error } = await admin
      .schema("crm_comunidades_v2")
      .from("usuario_curado")
      .update({ email })
      .eq("cliente_id", cliente.id)
      .eq("telefono_id", identificador)
      .is("email", null);
    if (error) avisos.push(`No se pudo guardar el email: ${error.message}`);
  }

  return json({ data: evento, telefono_normalizado: identificador, canal, aviso: avisos.length ? avisos.join(" · ") : undefined });
});
