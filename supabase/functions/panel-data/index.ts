// Endpoint JSON consolidado — Sección 4.C del documento de Jaz ("Conexión a
// Claude Artifacts (JSON Schema)"): el shape de abajo es una réplica literal
// del ejemplo de esa sección (mismos nombres de campo, mismos tipos).
// Ref: specs/2026-09-25-v2-desde-cero.md, docs/reference/contrato-json-panel-data.md.
//
// No requiere una api_key propia (a diferencia de api-publica en V1) —
// es de solo lectura y de uso interno del panel V2, que lo consume
// directamente. Queda igual de servible para un Claude Artifact externo si
// alguna vez se arma uno (mismo endpoint, mismo contrato).
//
// Deploy: `supabase functions deploy panel-data`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // El CRM es multi-cliente: el JSON siempre es de UN cliente, indicado con
  // ?cliente=<slug o uuid> (GET) o {"cliente": "..."} en el body (POST).
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const ref: string | null = new URL(req.url).searchParams.get("cliente") ?? body?.cliente ?? null;
  if (!ref) return json({ error: "Falta el parámetro cliente (slug o uuid)" }, 400);

  const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
  const { data: cliente, error: errCliente } = await admin
    .schema("crm_comunidades_v2")
    .from("cliente")
    .select("id, nombre, slug")
    .eq(esUuid ? "id" : "slug", ref)
    .maybeSingle();
  if (errCliente) return json({ error: errCliente.message }, 500);
  if (!cliente) return json({ error: `Cliente no encontrado: ${ref}` }, 404);

  const [kpisRes, comunidadesRes, baseLimpiaRes] = await Promise.all([
    admin.schema("crm_comunidades_v2").from("kpis_macro").select("*").eq("cliente_id", cliente.id).maybeSingle(),
    admin.schema("crm_comunidades_v2").from("comunidad_performance").select("*").eq("cliente_id", cliente.id),
    admin.schema("crm_comunidades_v2").from("base_limpia").select("*").eq("cliente_id", cliente.id).order("fecha_primer_contacto", { ascending: false }),
  ]);

  if (kpisRes.error) return json({ error: kpisRes.error.message }, 500);
  if (comunidadesRes.error) return json({ error: comunidadesRes.error.message }, 500);
  if (baseLimpiaRes.error) return json({ error: baseLimpiaRes.error.message }, 500);

  const k = kpisRes.data ?? {
    inversion_total: 0, conversaciones_totales: 0, cpl_global: null,
    clics_unicos_totales: 0, miembros_efectivos_totales: 0, cpme_global: null, tasa_fuga_global_pct: null,
  };

  // El ejemplo de la Sección 4.C expresa la tasa de fuga como fracción
  // (0.26), no como porcentaje (26) — se divide acá; la vista SQL la deja en
  // porcentaje porque es lo que se muestra directo en las tablas del panel.
  const aFraccion = (pct: number | null) => (pct === null || pct === undefined ? null : Math.round((pct / 100) * 10000) / 10000);

  return json({
    timestamp_update: new Date().toISOString(),
    cliente: { id: cliente.id, nombre: cliente.nombre, slug: cliente.slug },
    kpis_macro: {
      inversion_total: k.inversion_total,
      conversaciones_totales: k.conversaciones_totales,
      cpl_global: k.cpl_global,
      clics_unicos_totales: k.clics_unicos_totales,
      miembros_efectivos_totales: k.miembros_efectivos_totales,
      cpme_global: k.cpme_global,
      tasa_fuga_global: aFraccion(k.tasa_fuga_global_pct),
    },
    comunidades_performance: (comunidadesRes.data ?? []).map((c) => ({
      id_comunidad: c.comunidad_id,
      nombre: c.nombre,
      inversion: c.inversion,
      conversaciones_meta: c.conversaciones_meta,
      cpl: c.cpl,
      clics_unicos: c.clics_unicos,
      miembros_iniciales: c.miembros_iniciales,
      miembros_finales: c.miembros_finales,
      cpmn: c.cpmn,
      tasa_fuga: aFraccion(c.tasa_fuga_pct),
    })),
    base_limpia_usuarios: (baseLimpiaRes.data ?? []).map((u) => ({
      phone_id: u.phone_id,
      nombre: u.nombre,
      email: u.email,
      comunidad_atribuida: u.comunidad_atribuida,
      fecha_primer_contacto: u.fecha_primer_contacto,
      estado: u.estado,
    })),
  });
});
