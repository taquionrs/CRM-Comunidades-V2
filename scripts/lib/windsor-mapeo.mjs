// Lógica pura de la importación de Meta Ads (Windsor.ai) a meta_ads_metrica, por comunidad. Sin red ni base:
// recibe filas ya leídas y devuelve qué registros guardar. Probada en tests/windsor-mapeo.test.mjs.
//
// Reglas (decisión 2026-10-08, specs 3 septendecies):
//   * El cliente se distingue por la CAMPAÑA y la comunidad por el CONJUNTO DE ANUNCIOS (adset). Una fila de mapeo
//     puede apuntar a "toda la campaña" (adset vacío): es la comunidad "general" de un cliente.
//   * Los nombres se comparan normalizados (sin tildes, espacios colapsados, minúsculas): Meta no es prolijo.
//   * Una campaña que no está en el mapeo se IGNORA (es de otro cliente). Una campaña que sí está pero trae un
//     conjunto que no figura se reporta como DESCONOCIDO y su gasto NO se asigna (nunca se inventa a quién pertenece).

const CAMPO_CONVERSACIONES = "actions_onsite_conversion_messaging_conversation_started_7d";
// "Cliente potencial de Meta" de Ads Manager (verificado 2026-10-08: 158 en Todo un País, 0 en Cortado WhatsApp, 6–7/10).
const CAMPO_LEADS = "actions_onsite_conversion_lead_grouped";

/** Igual a crm_comunidades_v2.normalizar_nombre() de db/010: recorta, quita tildes, colapsa espacios, minúsculas. */
export function normalizarNombre(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** CSV con comillas (RFC 4180): campos con coma o comillas escapadas, y saltos de línea CRLF o LF. */
export function parsearCsv(texto) {
  const filas = [];
  let fila = [], campo = "", comillas = false;
  const s = String(texto).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (comillas) {
      if (c === '"') { if (s[i + 1] === '"') { campo += '"'; i++; } else comillas = false; }
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      fila.push(campo); campo = "";
      if (fila.length > 1 || fila[0] !== "") filas.push(fila);
      fila = [];
    } else campo += c;
  }
  if (campo !== "" || fila.length) { fila.push(campo); if (fila.length > 1 || fila[0] !== "") filas.push(fila); }
  if (!filas.length) return [];
  const cab = filas[0].map((x) => x.trim());
  return filas.slice(1).map((f) => Object.fromEntries(cab.map((k, i) => [k, f[i] ?? ""])));
}

const numero = (v) => { const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : 0; };
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Filas de Windsor (CSV o API) → filas con nombres y tipos propios. Descarta las que no tienen fecha válida. */
export function normalizarFilasWindsor(filas) {
  const out = [];
  let sinFecha = 0;
  for (const f of filas) {
    const fecha = String(f.date ?? "").slice(0, 10);
    if (!FECHA.test(fecha)) { sinFecha++; continue; }
    out.push({
      fecha,
      cuentaId: String(f.account_id ?? "").trim(),
      cuentaNombre: String(f.account_name ?? "").trim(),
      campana: String(f.campaign ?? "").trim(),
      adset: String(f.adset_name ?? "").trim(),
      inversion: numero(f.spend),
      impresiones: Math.round(numero(f.impressions)),
      clics: Math.round(numero(f.clicks)),
      conversaciones: Math.round(numero(f[CAMPO_CONVERSACIONES] ?? f.messaging_conversation_started_7d)),
      leads: Math.round(numero(f[CAMPO_LEADS])),
    });
  }
  return { filas: out, sinFecha };
}

/**
 * mapeo: [{cliente_id, cliente_slug, comunidad_id, comunidad_nombre, campana_nombre, adset_nombre|null, meta_cuenta_id|null}]
 * opciones.cuentaNombre: si el CSV no trae account_id, solo se aceptan filas de esa cuenta (sin distinguir mayúsculas).
 */
export function mapearFilas(filas, mapeo, opciones = {}) {
  const indice = new Map(); // campaña normalizada → { porAdset: Map, completa: entrada|null }
  for (const m of mapeo) {
    const k = normalizarNombre(m.campana_nombre);
    const e = indice.get(k) ?? { porAdset: new Map(), completa: null };
    if (m.adset_nombre == null || m.adset_nombre === "") e.completa = m;
    else e.porAdset.set(normalizarNombre(m.adset_nombre), m);
    indice.set(k, e);
  }

  const acumulado = new Map();
  const ignoradas = new Map();   // campaña → cantidad de filas
  const desconocidos = new Map(); // "campaña | conjunto" → { filas, inversion }
  const descartadasPorCuenta = new Map();
  const cuentaPedida = opciones.cuentaNombre ? normalizarNombre(opciones.cuentaNombre) : null;

  for (const f of filas) {
    const e = indice.get(normalizarNombre(f.campana));
    if (!e) { ignoradas.set(f.campana || "(sin campaña)", (ignoradas.get(f.campana || "(sin campaña)") ?? 0) + 1); continue; }

    const m = e.porAdset.get(normalizarNombre(f.adset)) ?? e.completa;
    if (!m) {
      const k = `${f.campana} | ${f.adset || "(sin conjunto)"}`;
      const d = desconocidos.get(k) ?? { filas: 0, inversion: 0 };
      d.filas++; d.inversion += f.inversion; desconocidos.set(k, d);
      continue;
    }

    // Cuenta: si el cliente tiene meta_cuenta_id y la fila trae account_id, tienen que coincidir; si no hay IDs,
    // se usa el nombre de cuenta pedido. Evita sumar la misma campaña de otra cuenta ("Cuenta Todo un País").
    let cuentaOk = true;
    if (m.meta_cuenta_id && f.cuentaId) cuentaOk = String(m.meta_cuenta_id) === f.cuentaId;
    else if (cuentaPedida && f.cuentaNombre) cuentaOk = normalizarNombre(f.cuentaNombre) === cuentaPedida;
    if (!cuentaOk) { const k = f.cuentaNombre || f.cuentaId; descartadasPorCuenta.set(k, (descartadasPorCuenta.get(k) ?? 0) + 1); continue; }

    const clave = `${m.comunidad_id}|${f.fecha}`;
    const a = acumulado.get(clave) ?? {
      cliente_id: m.cliente_id, cliente_slug: m.cliente_slug, comunidad_id: m.comunidad_id, comunidad_nombre: m.comunidad_nombre,
      fecha: f.fecha, inversion: 0, impresiones: 0, clics: 0, conversaciones: 0, leads: 0,
    };
    a.inversion += f.inversion; a.impresiones += f.impresiones; a.clics += f.clics; a.conversaciones += f.conversaciones; a.leads += f.leads;
    acumulado.set(clave, a);
  }

  const registros = [...acumulado.values()]
    .map((r) => ({ ...r, inversion: Math.round(r.inversion * 100) / 100 }))
    .sort((a, b) => a.cliente_slug.localeCompare(b.cliente_slug) || a.comunidad_nombre.localeCompare(b.comunidad_nombre) || a.fecha.localeCompare(b.fecha));

  const advertencias = [];
  for (const [k, d] of desconocidos) {
    advertencias.push(`Conjunto de anuncios SIN comunidad en una campaña mapeada: ${k} (${d.filas} filas, gasto ${d.inversion.toFixed(2)}). No se importó; agregarlo a comunidad_meta_origen.`);
  }
  for (const [k, n] of descartadasPorCuenta) advertencias.push(`Filas descartadas por ser de otra cuenta publicitaria (${k}): ${n}.`);

  return { registros, ignoradas: Object.fromEntries(ignoradas), desconocidos: Object.fromEntries(desconocidos), advertencias };
}

/** Resumen por comunidad para mostrar antes de aplicar. */
export function resumirPorComunidad(registros) {
  const m = new Map();
  for (const r of registros) {
    const k = `${r.cliente_slug} | ${r.comunidad_nombre}`;
    const x = m.get(k) ?? { comunidad: k, dias: 0, desde: r.fecha, hasta: r.fecha, inversion: 0, impresiones: 0, clics: 0, conversaciones: 0, leads: 0 };
    x.dias++; x.inversion += r.inversion; x.impresiones += r.impresiones; x.clics += r.clics; x.conversaciones += r.conversaciones; x.leads += r.leads;
    if (r.fecha < x.desde) x.desde = r.fecha; if (r.fecha > x.hasta) x.hasta = r.fecha;
    m.set(k, x);
  }
  return [...m.values()].map((x) => ({ ...x, inversion: Math.round(x.inversion * 100) / 100 }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SQL de carga: upsert por (comunidad, fecha). Valida cada valor: todo sale de nuestro propio procesamiento, no se interpola texto libre. */
export function construirSqlUpsert(registros, tamanoLote = 400) {
  const sentencias = [];
  for (let i = 0; i < registros.length; i += tamanoLote) {
    const valores = registros.slice(i, i + tamanoLote).map((r) => {
      if (!UUID.test(r.cliente_id) || !UUID.test(r.comunidad_id)) throw new Error("UUID inválido en un registro");
      if (!FECHA.test(r.fecha)) throw new Error(`Fecha inválida: ${r.fecha}`);
      for (const k of ["inversion", "impresiones", "clics", "conversaciones", "leads"]) {
        if (!Number.isFinite(r[k]) || r[k] < 0) throw new Error(`Valor inválido en ${k}: ${r[k]}`);
      }
      return `('${r.cliente_id}','${r.comunidad_id}','${r.fecha}',${r.inversion.toFixed(2)},${r.conversaciones},${r.impresiones},${r.clics},${r.leads})`;
    });
    sentencias.push(
      "insert into crm_comunidades_v2.meta_ads_metrica (cliente_id, comunidad_id, fecha, inversion, conversaciones_meta, impresiones, clics, leads_meta) values\n" +
      valores.join(",\n") +
      "\non conflict (comunidad_id, fecha) do update set inversion = excluded.inversion, conversaciones_meta = excluded.conversaciones_meta, impresiones = excluded.impresiones, clics = excluded.clics, leads_meta = excluded.leads_meta;",
    );
  }
  return sentencias;
}

export { CAMPO_CONVERSACIONES, CAMPO_LEADS };
