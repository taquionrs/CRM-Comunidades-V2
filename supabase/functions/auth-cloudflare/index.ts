// Login del CRM con Cloudflare Zero Trust (SSO). La lógica está en flujo.mjs (probada con npm test).
//
// Secretos (Supabase → Edge Functions → Secrets): OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, SESSION_SECRET (32+
// caracteres) y PANEL_URL (https://crm-comunidades-v2.vercel.app). Opcional: ALLOWED_EMAIL_DOMAINS (por omisión taquion.com.ar).
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY los pone Supabase solo.
//
// Deploy: supabase functions deploy auth-cloudflare --use-api --no-verify-jwt
// (sin verificar JWT: la abre el navegador antes de tener sesión). Paso a paso: docs/how-to/configurar-sso-cloudflare.md

import { crearSso } from "./flujo.mjs";

const sso = crearSso({ env: Deno.env.toObject() });

Deno.serve((req) => sso.manejar(req));
