// Login del CRM con Cloudflare Zero Trust (SSO) y sesión de Supabase. Lo usa index.ts (Deno) y lo prueban
// tests/auth-cloudflare.test.mjs (Node): sin dependencias, solo fetch y WebCrypto.
//
// El CRM es una aplicación "Access for SaaS" (OIDC) de Zero Trust, "CRM Comunidades": la política "CRM Comunidades - Acceso"
// decide quién puede iniciar sesión (cuentas @taquion.com.ar). Acá se implementa el flujo Authorization Code con PKCE y se
// valida el ID token (firma RS256, emisor, audiencia, vencimiento y nonce). Después, SOLO si la persona está dada de alta en
// crm_comunidades_v2.usuario_crm (db/030), se le crea la sesión de Supabase y se vuelve al panel con los tokens en el
// fragmento de la URL (#access_token=…), que supabase-js lee solo. Qué ve cada uno lo decide la base (db/031).
//
//   GET …/auth-cloudflare/login     → redirige al login de Cloudflare
//   GET …/auth-cloudflare/callback  → vuelta de Cloudflare: valida y crea la sesión
//   GET …/auth-cloudflare/logout    → cierra también la sesión de Cloudflare (el panel antes cierra la de Supabase)
//
// Supabase no deja mostrar páginas HTML desde *.supabase.co: los errores vuelven al panel como #sso_error=<código>.

const LOGIN_COOKIE = "crm_sso_login";
const LOGIN_TTL_S = 10 * 60;
const LEEWAY_S = 60;
const JWKS_TTL_MS = 10 * 60 * 1000;
const JWKS_REINTENTO_MS = 30 * 1000;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const enc = new TextEncoder();

export class ErrorSso extends Error {
  constructor(codigo, detalle = "") {
    super(detalle || codigo);
    this.codigo = codigo;
  }
}

const lista = (v) => String(v || "").split(/[\s,;]+/).map((s) => s.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);

export function leerConfig(env) {
  const c = {
    issuer: String(env.OIDC_ISSUER || "").trim().replace(/\/+$/, ""),
    clientId: String(env.OIDC_CLIENT_ID || "").trim(),
    clientSecret: String(env.OIDC_CLIENT_SECRET || ""),
    secreto: String(env.SESSION_SECRET || ""),
    panelUrl: String(env.PANEL_URL || "").trim().replace(/\/+$/, ""),
    supabaseUrl: String(env.SUPABASE_URL || "").trim().replace(/\/+$/, ""),
    anonKey: String(env.SUPABASE_ANON_KEY || ""),
    serviceKey: String(env.SUPABASE_SERVICE_ROLE_KEY || ""),
    dominios: lista(env.ALLOWED_EMAIL_DOMAINS).length ? lista(env.ALLOWED_EMAIL_DOMAINS) : ["taquion.com.ar"],
  };
  const falta = [];
  if (!/^https:\/\/[^/]+\/.+/.test(c.issuer)) falta.push("OIDC_ISSUER");
  if (!c.clientId) falta.push("OIDC_CLIENT_ID");
  if (!c.clientSecret) falta.push("OIDC_CLIENT_SECRET");
  if (c.secreto.length < 32) falta.push("SESSION_SECRET (32+ caracteres)");
  if (!/^https?:\/\//.test(c.panelUrl)) falta.push("PANEL_URL");
  if (!c.supabaseUrl || !c.anonKey || !c.serviceKey) falta.push("SUPABASE_URL / claves de Supabase");
  return { config: c, falta };
}

// ---------------------------------------------------------------------------
// Base64url, cookies firmadas (HMAC-SHA256) y PKCE
// ---------------------------------------------------------------------------
export function b64url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlBytes(s) {
  let b = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  const bin = atob(b);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

export function tokenAlAzar(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64url(a);
}
export async function desafioPkce(verificador) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verificador))));
}
const claveHmac = (secreto) => crypto.subtle.importKey("raw", enc.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export async function firmar(payload, secreto) {
  const cuerpo = b64url(enc.encode(JSON.stringify(payload)));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await claveHmac(secreto), enc.encode(cuerpo)));
  return cuerpo + "." + b64url(mac);
}
export async function verificarFirma(token, secreto, ahoraMs = Date.now()) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const punto = token.lastIndexOf(".");
  const cuerpo = token.slice(0, punto);
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await claveHmac(secreto), b64urlBytes(token.slice(punto + 1)), enc.encode(cuerpo));
  } catch {
    ok = false;
  }
  if (!ok) return null;
  try {
    const p = b64urlJson(cuerpo);
    return p && typeof p.exp === "number" && p.exp * 1000 > ahoraMs ? p : null;
  } catch {
    return null;
  }
}

function leerCookie(req, nombre) {
  for (const parte of (req.headers.get("cookie") || "").split(";")) {
    const i = parte.indexOf("=");
    if (i > 0 && parte.slice(0, i).trim() === nombre) return parte.slice(i + 1).trim();
  }
  return null;
}
const cookie = (valor, maxAge) =>
  `${LOGIN_COOKIE}=${valor}; Path=/functions/v1/auth-cloudflare; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

// ---------------------------------------------------------------------------
// OIDC: descubrimiento, código → tokens y validación del ID token
// ---------------------------------------------------------------------------
export function crearSso({ env, fetchFn = fetch, ahora = () => Date.now() }) {
  const { config: c, falta } = leerConfig(env);
  let descubrimiento = null;
  const jwks = { cargado: 0, intento: 0, claves: new Map() };
  const callbackUrl = `${c.supabaseUrl}/functions/v1/auth-cloudflare/callback`;
  const volver = (fragmento, extra = {}) =>
    new Response(null, { status: 302, headers: { Location: `${c.panelUrl}/#${new URLSearchParams(fragmento)}`, "Cache-Control": "no-store", ...extra } });

  async function configOidc() {
    if (descubrimiento && ahora() - descubrimiento.en < DISCOVERY_TTL_MS) return descubrimiento.config;
    let conf = null;
    try {
      const r = await fetchFn(`${c.issuer}/.well-known/openid-configuration`, { headers: { Accept: "application/json" } });
      if (r.ok) conf = await r.json();
    } catch {
      conf = null;
    }
    if (!conf?.authorization_endpoint || !conf.token_endpoint || !conf.jwks_uri) throw new ErrorSso("cloudflare", "No se pudo leer la configuración OIDC de Cloudflare.");
    if (String(conf.issuer || "").replace(/\/+$/, "") !== c.issuer) throw new ErrorSso("config", "El emisor que publica Cloudflare no coincide con OIDC_ISSUER.");
    descubrimiento = { en: ahora(), config: conf };
    return conf;
  }

  async function claveFirma(jwksUri, kid) {
    const vencido = ahora() - jwks.cargado > JWKS_TTL_MS;
    // Un kid desconocido puede ser una rotación de claves: se recarga, con un mínimo entre intentos.
    if ((vencido || !jwks.claves.has(kid)) && ahora() - jwks.intento > JWKS_REINTENTO_MS) {
      jwks.intento = ahora();
      try {
        const r = await fetchFn(jwksUri, { headers: { Accept: "application/json" } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const claves = new Map();
        for (const jwk of (await r.json())?.keys || []) {
          if (jwk?.kty !== "RSA" || !jwk.kid || !jwk.n || !jwk.e) continue;
          claves.set(jwk.kid, await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
            { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
        }
        jwks.claves = claves;
        jwks.cargado = ahora();
      } catch {
        // Si falla, se sigue con las claves que ya había.
      }
    }
    return jwks.claves.get(kid) || null;
  }

  async function validarIdToken(token, jwksUri, nonce) {
    const invalido = () => new ErrorSso("token", "El token de login no es válido.");
    const partes = String(token).split(".");
    if (partes.length !== 3) throw invalido();
    let cab, claims;
    try {
      cab = b64urlJson(partes[0]);
      claims = b64urlJson(partes[1]);
    } catch {
      throw invalido();
    }
    if (cab?.alg !== "RS256" || typeof cab.kid !== "string" || !claims || typeof claims !== "object") throw invalido();
    const clave = await claveFirma(jwksUri, cab.kid);
    let ok = false;
    if (clave) {
      try {
        ok = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, clave, b64urlBytes(partes[2]), enc.encode(partes[0] + "." + partes[1]));
      } catch {
        ok = false;
      }
    }
    if (!ok) throw invalido();
    const s = Math.floor(ahora() / 1000);
    const auds = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
    if (String(claims.iss || "").replace(/\/+$/, "") !== c.issuer) throw invalido();
    if (!auds.includes(c.clientId) || (auds.length > 1 && claims.azp !== c.clientId)) throw invalido();
    if (typeof claims.exp !== "number" || claims.exp + LEEWAY_S < s) throw new ErrorSso("vencido", "El login venció antes de completarse.");
    if (typeof claims.nbf === "number" && claims.nbf - LEEWAY_S > s) throw invalido();
    if (claims.nonce !== nonce) throw invalido();
    return claims;
  }

  async function canjearCodigo(codigo, verificador, nonce) {
    const conf = await configOidc();
    const cuerpo = new URLSearchParams({ grant_type: "authorization_code", code: codigo, redirect_uri: callbackUrl, code_verifier: verificador });
    const headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
    // Cloudflare publica la lista como "token_endpoint_auth_methods" (sin "_supported").
    const metodos = conf.token_endpoint_auth_methods_supported || conf.token_endpoint_auth_methods;
    if (Array.isArray(metodos) && !metodos.includes("client_secret_basic") && metodos.includes("client_secret_post")) {
      cuerpo.set("client_id", c.clientId);
      cuerpo.set("client_secret", c.clientSecret);
    } else {
      headers.Authorization = "Basic " + btoa(encodeURIComponent(c.clientId) + ":" + encodeURIComponent(c.clientSecret));
    }
    let tokens = null;
    try {
      const r = await fetchFn(conf.token_endpoint, { method: "POST", headers, body: cuerpo.toString() });
      if (r.ok) tokens = await r.json();
    } catch {
      tokens = null;
    }
    if (typeof tokens?.id_token !== "string") throw new ErrorSso("cloudflare", "Cloudflare no aceptó el código de login.");
    return validarIdToken(tokens.id_token, conf.jwks_uri, nonce);
  }

  // -------------------------------------------------------------------------
  // Supabase: ¿está dado de alta? y sesión del usuario (sin mandar ningún mail)
  // -------------------------------------------------------------------------
  const svc = () => ({ apikey: c.serviceKey, Authorization: `Bearer ${c.serviceKey}`, "Content-Type": "application/json" });

  async function estaDadoDeAlta(email) {
    const r = await fetchFn(`${c.supabaseUrl}/rest/v1/usuario_crm?select=email&email=eq.${encodeURIComponent(email)}`,
      { headers: { ...svc(), "Accept-Profile": "crm_comunidades_v2" } });
    if (!r.ok) throw new ErrorSso("supabase", `No se pudo consultar el registro de usuarios (HTTP ${r.status}).`);
    const filas = await r.json();
    return Array.isArray(filas) && filas.length > 0;
  }

  async function crearSesion(email) {
    // 1. El usuario de Supabase (si ya existe, Supabase responde 422/400 y se sigue).
    const alta = await fetchFn(`${c.supabaseUrl}/auth/v1/admin/users`, { method: "POST", headers: svc(), body: JSON.stringify({ email, email_confirm: true }) });
    if (!alta.ok && alta.status !== 422 && alta.status !== 400) throw new ErrorSso("supabase", `No se pudo crear el usuario (HTTP ${alta.status}).`);
    // 2. Un enlace de un solo uso, que NO se manda por mail: se canjea acá mismo por la sesión.
    const enl = await fetchFn(`${c.supabaseUrl}/auth/v1/admin/generate_link`, { method: "POST", headers: svc(), body: JSON.stringify({ type: "magiclink", email }) });
    if (!enl.ok) throw new ErrorSso("supabase", `No se pudo generar la sesión (HTTP ${enl.status}).`);
    const datos = await enl.json();
    const hash = datos?.hashed_token || datos?.properties?.hashed_token;
    if (!hash) throw new ErrorSso("supabase", "Supabase no devolvió el código de la sesión.");
    for (const type of ["email", "magiclink"]) {
      const v = await fetchFn(`${c.supabaseUrl}/auth/v1/verify`, {
        method: "POST", headers: { apikey: c.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ type, token_hash: hash }) });
      if (!v.ok) continue;
      const s = await v.json();
      if (s?.access_token && s?.refresh_token) return s;
    }
    throw new ErrorSso("supabase", "Supabase no aceptó el código de la sesión.");
  }

  // -------------------------------------------------------------------------
  // Rutas
  // -------------------------------------------------------------------------
  async function login() {
    const conf = await configOidc();
    const estado = tokenAlAzar();
    const nonce = tokenAlAzar();
    const verificador = tokenAlAzar(48);
    const tx = await firmar({ estado, nonce, verificador, exp: Math.floor(ahora() / 1000) + LOGIN_TTL_S }, c.secreto);
    const url = new URL(conf.authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", c.clientId);
    url.searchParams.set("redirect_uri", callbackUrl);
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", estado);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("code_challenge", await desafioPkce(verificador));
    url.searchParams.set("code_challenge_method", "S256");
    return new Response(null, { status: 302, headers: { Location: url.toString(), "Set-Cookie": cookie(tx, LOGIN_TTL_S), "Cache-Control": "no-store" } });
  }

  async function callback(url, req) {
    const borrar = { "Set-Cookie": cookie("", 0) };
    const tx = await verificarFirma(leerCookie(req, LOGIN_COOKIE), c.secreto, ahora());
    if (url.searchParams.get("error")) return volver({ sso_error: "cancelado" }, borrar);
    const estado = url.searchParams.get("state");
    const codigo = url.searchParams.get("code");
    if (!tx || !estado || estado !== tx.estado || !codigo) return volver({ sso_error: "vencido" }, borrar);

    const claims = await canjearCodigo(codigo, tx.verificador, tx.nonce);
    const email = String(claims.email || "").trim().toLowerCase();
    if (!email.includes("@") || claims.email_verified === false) return volver({ sso_error: "sin_email" }, borrar);
    if (!c.dominios.includes(email.slice(email.lastIndexOf("@") + 1))) return volver({ sso_error: "dominio", email }, borrar);
    if (!(await estaDadoDeAlta(email))) return volver({ sso_error: "sin_alta", email }, borrar);

    const s = await crearSesion(email);
    return volver({
      access_token: s.access_token,
      refresh_token: s.refresh_token,
      expires_in: String(s.expires_in ?? 3600),
      expires_at: String(s.expires_at ?? Math.floor(ahora() / 1000) + Number(s.expires_in ?? 3600)),
      token_type: s.token_type || "bearer",
      type: "magiclink",
    }, borrar);
  }

  async function manejar(req) {
    const url = new URL(req.url);
    const ruta = url.pathname.replace(/\/+$/, "");
    if (req.method !== "GET") return new Response("Método no permitido", { status: 405 });
    if (falta.length) {
      if (!c.panelUrl) return new Response(`Falta configurar: ${falta.join(", ")}`, { status: 500 });
      return volver({ sso_error: "config" });
    }
    try {
      if (ruta.endsWith("/login")) return await login();
      if (ruta.endsWith("/callback")) return await callback(url, req);
      if (ruta.endsWith("/logout")) {
        return new Response(null, { status: 302, headers: { Location: new URL(c.issuer).origin + "/cdn-cgi/access/logout", "Cache-Control": "no-store" } });
      }
      return new Response("Ruta inexistente", { status: 404 });
    } catch (err) {
      const codigo = err instanceof ErrorSso ? err.codigo : "error";
      console.error("auth-cloudflare:", codigo, err?.message || err);
      return volver({ sso_error: codigo }, { "Set-Cookie": cookie("", 0) });
    }
  }

  return { manejar, callbackUrl };
}
