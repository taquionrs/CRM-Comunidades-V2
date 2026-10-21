// Control de acceso de las Edge Functions que llama el panel (db/030): exige la sesión de un usuario del CRM con rol
// Marketing. Sin dependencias (lo prueba tests/auth-cloudflare.test.mjs con Node).
//
// La sesión se valida en la base, con crm_comunidades_v2.mi_acceso(): la misma regla que usa la RLS (24 h desde el login,
// sesión no cerrada, usuario dado de alta). Con `aceptarServicio`, la clave de servicio también pasa (llamadas internas).

export async function exigirMarketing(req, { supabaseUrl, anonKey, serviceKey = "", aceptarServicio = false, fetchFn = fetch }) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "Falta iniciar sesión en el CRM." };
  if (aceptarServicio && serviceKey && token === serviceKey) return { ok: true, servicio: true };

  let filas = null;
  try {
    const r = await fetchFn(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/mi_acceso`, {
      method: "POST",
      headers: { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Profile": "crm_comunidades_v2", "Content-Type": "application/json" },
      body: "{}",
    });
    if (r.status === 401 || r.status === 403) return { ok: false, status: 401, error: "La sesión no es válida o venció. Volvé a entrar al CRM." };
    if (!r.ok) return { ok: false, status: 503, error: `No se pudo verificar el acceso (HTTP ${r.status}).` };
    filas = await r.json();
  } catch {
    return { ok: false, status: 503, error: "No se pudo verificar el acceso." };
  }
  const acceso = Array.isArray(filas) ? filas[0] : null;
  if (!acceso) return { ok: false, status: 403, error: "Tu usuario no tiene acceso al CRM o la sesión venció." };
  if (acceso.rol !== "marketing") return { ok: false, status: 403, error: "Necesitás el rol Marketing para esta acción." };
  return { ok: true, acceso };
}
