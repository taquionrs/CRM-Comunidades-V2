// Pruebas del login con Cloudflare (supabase/functions/auth-cloudflare/flujo.mjs) y del control de acceso de las
// Edge Functions (supabase/functions/_shared/acceso.mjs). Cloudflare y Supabase se simulan con un fetch falso; los
// tokens se firman de verdad (RS256). Correr: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { crearSso, b64url, desafioPkce } from "../supabase/functions/auth-cloudflare/flujo.mjs";
import { exigirMarketing } from "../supabase/functions/_shared/acceso.mjs";

const ISS = "https://equipo.cloudflareaccess.com/cdn-cgi/access/sso/oidc/cliente-crm";
const SB = "https://proyecto.supabase.co";
const PANEL = "https://crm.example.app";
const ENV = {
  OIDC_ISSUER: ISS, OIDC_CLIENT_ID: "cliente-crm", OIDC_CLIENT_SECRET: "secreto-cliente", SESSION_SECRET: "x".repeat(40),
  PANEL_URL: PANEL, SUPABASE_URL: SB, SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key",
};
const enc = new TextEncoder();

async function claves() {
  const par = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", par.publicKey);
  return { privada: par.privateKey, jwk: { ...jwk, kid: "k1", alg: "RS256", use: "sig" } };
}
const CLAVES = await claves();
const OTRAS = await claves();

async function idToken(claims, privada = CLAVES.privada) {
  const s = Math.floor(Date.now() / 1000);
  const cab = b64url(enc.encode(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })));
  const cuerpo = b64url(enc.encode(JSON.stringify({ iss: ISS, aud: "cliente-crm", iat: s, exp: s + 300, email_verified: true, ...claims })));
  const firma = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privada, enc.encode(cab + "." + cuerpo)));
  return `${cab}.${cuerpo}.${b64url(firma)}`;
}

/** Cloudflare + Supabase simulados. `opciones` cambia cómo responde cada uno; `llamadas` registra lo pedido. */
function mundo(opciones = {}) {
  const llamadas = [];
  const estado = { desafio: null, nonce: null };
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    llamadas.push(u.pathname);
    const json = (c, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { "Content-Type": "application/json" } });
    if (url === `${ISS}/.well-known/openid-configuration`) {
      return json({ issuer: ISS, authorization_endpoint: `${ISS}/authorization`, token_endpoint: `${ISS}/token`, jwks_uri: `${ISS}/jwks`, token_endpoint_auth_methods: ["client_secret_basic", "client_secret_post"] });
    }
    if (url === `${ISS}/jwks`) return json({ keys: [CLAVES.jwk] });
    if (url === `${ISS}/token`) {
      const f = new URLSearchParams(init.body);
      const basic = "Basic " + btoa("cliente-crm:secreto-cliente");
      if (init.headers.Authorization !== basic) return json({ error: "invalid_client" }, 401);
      if (f.get("code") !== "codigo-ok" || (await desafioPkce(f.get("code_verifier"))) !== estado.desafio) return json({ error: "invalid_grant" }, 400);
      if (f.get("redirect_uri") !== `${SB}/functions/v1/auth-cloudflare/callback`) return json({ error: "invalid_grant" }, 400);
      return json({ id_token: await idToken({ email: opciones.email ?? "ana@taquion.com.ar", nonce: opciones.nonce ?? estado.nonce, ...(opciones.claims || {}) }, opciones.privada) });
    }
    if (u.pathname === "/rest/v1/usuario_crm") {
      assert.equal(init.headers["Accept-Profile"], "crm_comunidades_v2");
      return json(opciones.dadoDeAlta === false ? [] : [{ email: u.searchParams.get("email").slice(3) }]);
    }
    if (u.pathname === "/auth/v1/admin/users") return json({ msg: "A user with this email address has already been registered" }, 422);
    if (u.pathname === "/auth/v1/admin/generate_link") return json({ hashed_token: "hash-123", verification_type: "magiclink" });
    if (u.pathname === "/auth/v1/verify") {
      const b = JSON.parse(init.body);
      if (b.token_hash !== "hash-123") return json({ error: "otp_expired" }, 403);
      return json({ access_token: "acceso.jwt", refresh_token: "renovacion", expires_in: 3600, expires_at: 2000000000, token_type: "bearer" });
    }
    return json({ error: "no simulado: " + url }, 599);
  };
  return { fetchFn, llamadas, estado };
}

/** Recorre login → Cloudflare → callback como lo haría el navegador. Devuelve la redirección final al panel. */
async function recorrer(opciones = {}, { manipularCookie, manipularEstado } = {}) {
  const m = mundo(opciones);
  const sso = crearSso({ env: { ...ENV, ...(opciones.env || {}) }, fetchFn: m.fetchFn });
  const login = await sso.manejar(new Request(`${SB}/functions/v1/auth-cloudflare/login`));
  assert.equal(login.status, 302);
  const destino = new URL(login.headers.get("location"));
  m.estado.desafio = destino.searchParams.get("code_challenge");
  m.estado.nonce = destino.searchParams.get("nonce");
  let galleta = login.headers.get("set-cookie").split(";")[0];
  if (manipularCookie) galleta = manipularCookie(galleta);
  const state = manipularEstado ? manipularEstado(destino.searchParams.get("state")) : destino.searchParams.get("state");
  const vuelta = opciones.errorProveedor ? `error=${opciones.errorProveedor}&state=${state}` : `code=codigo-ok&state=${state}`;
  const cb = await sso.manejar(new Request(`${SB}/functions/v1/auth-cloudflare/callback?${vuelta}`, { headers: { cookie: galleta } }));
  const loc = new URL(cb.headers.get("location"));
  return { login, destino, cb, fragmento: new URLSearchParams(loc.hash.slice(1)), loc, llamadas: m.llamadas };
}

test("login: redirige a Cloudflare con PKCE S256, state, nonce y la vuelta a Supabase; la cookie es segura", async () => {
  const { destino, login } = await recorrer();
  assert.equal(destino.origin + destino.pathname, `${ISS}/authorization`);
  assert.equal(destino.searchParams.get("code_challenge_method"), "S256");
  assert.equal(destino.searchParams.get("redirect_uri"), `${SB}/functions/v1/auth-cloudflare/callback`);
  assert.equal(destino.searchParams.get("scope"), "openid email profile");
  assert.ok(destino.searchParams.get("state") && destino.searchParams.get("nonce"));
  const c = login.headers.get("set-cookie");
  assert.match(c, /HttpOnly/);
  assert.match(c, /Secure/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Path=\/functions\/v1\/auth-cloudflare/);
});

test("callback correcto: vuelve al panel con la sesión de Supabase en el fragmento", async () => {
  const { cb, loc, fragmento, llamadas } = await recorrer();
  assert.equal(cb.status, 302);
  assert.equal(loc.origin, PANEL);
  assert.equal(fragmento.get("access_token"), "acceso.jwt");
  assert.equal(fragmento.get("refresh_token"), "renovacion");
  assert.equal(fragmento.get("token_type"), "bearer");
  assert.equal(fragmento.get("expires_in"), "3600");
  assert.equal(loc.search, "", "los tokens nunca van en la query (llegarían a los logs del servidor)");
  assert.match(cb.headers.get("set-cookie"), /Max-Age=0/);
  assert.ok(llamadas.includes("/auth/v1/admin/generate_link"));
});

test("sin alta en el CRM: no se crea usuario en Supabase y vuelve con sin_alta", async () => {
  const { fragmento, llamadas } = await recorrer({ dadoDeAlta: false });
  assert.equal(fragmento.get("sso_error"), "sin_alta");
  assert.equal(fragmento.get("email"), "ana@taquion.com.ar");
  assert.equal(fragmento.get("access_token"), null);
  assert.ok(!llamadas.some((p) => p.startsWith("/auth/v1/")), "no toca auth de Supabase");
});

test("otro dominio: vuelve con dominio, sin consultar Supabase", async () => {
  const { fragmento, llamadas } = await recorrer({ email: "alguien@gmail.com" });
  assert.equal(fragmento.get("sso_error"), "dominio");
  assert.ok(!llamadas.some((p) => p.startsWith("/rest/") || p.startsWith("/auth/")));
});

test("token falsificado, de otra audiencia, con otro nonce o email no verificado: no entra", async () => {
  assert.equal((await recorrer({ privada: OTRAS.privada })).fragmento.get("sso_error"), "token");
  assert.equal((await recorrer({ claims: { aud: "otra-app" } })).fragmento.get("sso_error"), "token");
  assert.equal((await recorrer({ nonce: "otro" })).fragmento.get("sso_error"), "token");
  assert.equal((await recorrer({ claims: { iss: "https://otro.example" } })).fragmento.get("sso_error"), "token");
  assert.equal((await recorrer({ claims: { exp: Math.floor(Date.now() / 1000) - 3600 } })).fragmento.get("sso_error"), "vencido");
  assert.equal((await recorrer({ claims: { email_verified: false } })).fragmento.get("sso_error"), "sin_email");
});

test("state distinto, cookie adulterada o sin cookie: el intento se descarta", async () => {
  assert.equal((await recorrer({}, { manipularEstado: () => "otro" })).fragmento.get("sso_error"), "vencido");
  assert.equal((await recorrer({}, { manipularCookie: (c) => c.slice(0, -3) + "AAA" })).fragmento.get("sso_error"), "vencido");
  assert.equal((await recorrer({}, { manipularCookie: () => "otra=1" })).fragmento.get("sso_error"), "vencido");
});

test("Cloudflare rechaza (no pasa la política): vuelve con cancelado", async () => {
  assert.equal((await recorrer({ errorProveedor: "access_denied" })).fragmento.get("sso_error"), "cancelado");
});

test("sin configuración no abre nada; logout cierra la sesión de Cloudflare", async () => {
  const sin = crearSso({ env: { ...ENV, OIDC_CLIENT_SECRET: "" }, fetchFn: mundo().fetchFn });
  const r = await sin.manejar(new Request(`${SB}/functions/v1/auth-cloudflare/login`));
  assert.equal(new URLSearchParams(new URL(r.headers.get("location")).hash.slice(1)).get("sso_error"), "config");
  const sso = crearSso({ env: ENV, fetchFn: mundo().fetchFn });
  const salir = await sso.manejar(new Request(`${SB}/functions/v1/auth-cloudflare/logout`));
  assert.equal(salir.headers.get("location"), "https://equipo.cloudflareaccess.com/cdn-cgi/access/logout");
  assert.equal((await sso.manejar(new Request(`${SB}/functions/v1/auth-cloudflare/login`, { method: "POST" }))).status, 405);
});

// ---------------------------------------------------------------------------
// _shared/acceso.mjs
// ---------------------------------------------------------------------------
function rpcFalso(respuesta, status = 200) {
  const vistos = [];
  const fetchFn = async (url, init) => {
    vistos.push({ url, init });
    return new Response(JSON.stringify(respuesta), { status, headers: { "Content-Type": "application/json" } });
  };
  return { fetchFn, vistos };
}
const req = (token) => new Request("https://x/functions/v1/meta-en-vivo", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} });
const base = { supabaseUrl: SB, anonKey: "anon-key", serviceKey: "service-key" };

test("acceso: sin sesión 401; sin alta o rol General 403; Marketing pasa", async () => {
  assert.equal((await exigirMarketing(req(null), { ...base, fetchFn: rpcFalso([]).fetchFn })).status, 401);
  assert.equal((await exigirMarketing(req("t"), { ...base, fetchFn: rpcFalso([]).fetchFn })).status, 403);
  const general = await exigirMarketing(req("t"), { ...base, fetchFn: rpcFalso([{ email: "g@taquion.com.ar", rol: "general", admin: false }]).fetchFn });
  assert.equal(general.status, 403);
  assert.match(general.error, /rol Marketing/);
  const r = rpcFalso([{ email: "m@taquion.com.ar", rol: "marketing", admin: false }]);
  const mk = await exigirMarketing(req("token-usuario"), { ...base, fetchFn: r.fetchFn });
  assert.equal(mk.ok, true);
  assert.equal(r.vistos[0].url, `${SB}/rest/v1/rpc/mi_acceso`);
  assert.equal(r.vistos[0].init.headers.Authorization, "Bearer token-usuario");
  assert.equal(r.vistos[0].init.headers["Content-Profile"], "crm_comunidades_v2");
});

test("acceso: la clave anon (PostgREST responde 401) no pasa; la de servicio solo donde se acepta", async () => {
  assert.equal((await exigirMarketing(req("anon-key"), { ...base, fetchFn: rpcFalso({ message: "permission denied" }, 401).fetchFn })).status, 401);
  assert.equal((await exigirMarketing(req("service-key"), { ...base, aceptarServicio: true, fetchFn: rpcFalso([]).fetchFn })).ok, true);
  assert.equal((await exigirMarketing(req("service-key"), { ...base, fetchFn: rpcFalso([]).fetchFn })).ok, false);
});
