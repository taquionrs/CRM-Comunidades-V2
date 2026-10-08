#!/usr/bin/env node
// Importa la inversión de Meta Ads (Windsor.ai) a crm_comunidades_v2.meta_ads_metrica, por comunidad, DESDE TU COMPUTADORA.
// No usa Edge Functions ni deja la clave de Windsor en la nube: la clave (solo en modo API) se lee de la variable de
// entorno WINDSOR_API_KEY y nunca se imprime. Escribe en la base con el Supabase CLI ya logueado (supabase login).
//
//   node scripts/windsor-importar.mjs --csv C:\ruta\data.csv                     (ensayo: muestra qué haría, no guarda)
//   node scripts/windsor-importar.mjs --csv C:\ruta\data.csv --aplicar            (guarda)
//   node scripts/windsor-importar.mjs --windsor --desde 2026-10-01 --hasta 2026-10-07 [--aplicar]
//
// Opciones: --cliente <slug> (solo ese cliente) · --cuenta "<nombre de cuenta>" (si el CSV no trae account_id)
//           --cli <ruta del supabase.exe> · --ayuda
// El mapeo campaña/conjunto → comunidad vive en la tabla comunidad_meta_origen (db/010). Lógica en scripts/lib/windsor-mapeo.mjs.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  parsearCsv, normalizarFilasWindsor, mapearFilas, resumirPorComunidad, construirSqlUpsert, CAMPO_CONVERSACIONES, CAMPO_LEADS,
} from "./lib/windsor-mapeo.mjs";

const AYUDA = `Uso:
  node scripts/windsor-importar.mjs --csv <archivo.csv> [--aplicar]
  node scripts/windsor-importar.mjs --windsor --desde AAAA-MM-DD --hasta AAAA-MM-DD [--aplicar]
Sin --aplicar es un ensayo: no escribe nada. Opciones: --cliente <slug>, --cuenta "<nombre>", --cli <supabase.exe>`;

function leerArgumentos(argv) {
  const a = { aplicar: false, windsor: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--aplicar") a.aplicar = true;
    else if (k === "--windsor") a.windsor = true;
    else if (k === "--ayuda" || k === "-h") a.ayuda = true;
    else if (["--csv", "--desde", "--hasta", "--cliente", "--cuenta", "--cli"].includes(k)) a[k.slice(2)] = argv[++i];
    else throw new Error(`Opción desconocida: ${k}\n${AYUDA}`);
  }
  return a;
}

function rutaCli(a) {
  const candidatas = [a.cli, process.env.SUPABASE_CLI, path.join(process.env.LOCALAPPDATA ?? "", "supabase-cli", "supabase.exe")].filter(Boolean);
  return candidatas.find((p) => fs.existsSync(p)) ?? "supabase";
}

function ejecutarSql(cli, sql) {
  const archivo = path.join(os.tmpdir(), `windsor-importar-${process.pid}-${Date.now()}.sql`);
  fs.writeFileSync(archivo, sql, "utf8");
  try {
    const salida = execFileSync(cli, ["db", "query", "--linked", "-f", archivo], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
    const m = salida.match(/\{[\s\S]*\}/);
    if (!m) return [];
    return JSON.parse(m[0]).rows ?? [];
  } catch (e) {
    const detalle = String(e.stderr || e.stdout || e.message || e).split("\n").filter((l) => /error|message/i.test(l)).slice(0, 3).join(" | ");
    throw new Error(`Falló la consulta a la base (¿hiciste "supabase login"?). ${detalle}`.trim());
  } finally {
    try { fs.unlinkSync(archivo); } catch { /* temporal */ }
  }
}

function leerMapeo(cli, slug) {
  if (slug && !/^[a-z0-9-]+$/.test(slug)) throw new Error("--cliente solo admite minúsculas, números y guiones");
  const filtro = slug ? `and c.slug = '${slug}'` : "";
  return ejecutarSql(cli, `
    select c.id as cliente_id, c.slug as cliente_slug, c.meta_cuenta_id, m.id as comunidad_id, m.nombre as comunidad_nombre,
           o.campana_nombre, o.adset_nombre
    from crm_comunidades_v2.comunidad_meta_origen o
    join crm_comunidades_v2.comunidad m on m.id = o.comunidad_id and m.cliente_id = o.cliente_id
    join crm_comunidades_v2.cliente c on c.id = o.cliente_id
    where c.activo ${filtro}
    order by c.slug, m.nombre, o.campana_nombre, o.adset_nombre;`);
}

// Consulta a Windsor con tiempo límite y un reintento ante 429/5xx. Los mensajes de error NO incluyen la URL (lleva la clave).
async function consultarWindsor(desde, hasta) {
  const clave = process.env.WINDSOR_API_KEY;
  if (!clave) throw new Error("Falta la variable de entorno WINDSOR_API_KEY (modo --windsor). Alternativa: exportar el CSV desde Windsor y usar --csv.");
  const campos = ["date", "account_id", "account_name", "campaign", "adset_name", "spend", "impressions", "clicks", CAMPO_CONVERSACIONES, CAMPO_LEADS].join(",");
  const filas = [];
  // Ventanas de 14 días: Windsor tarda más en ventanas largas y nuevas (Pulso midió > 20 s).
  for (let ini = new Date(desde + "T00:00:00Z"); ini <= new Date(hasta + "T00:00:00Z"); ini = new Date(ini.getTime() + 14 * 86400000)) {
    const fin = new Date(Math.min(ini.getTime() + 13 * 86400000, new Date(hasta + "T00:00:00Z").getTime()));
    const url = `https://connectors.windsor.ai/facebook?api_key=${encodeURIComponent(clave)}&fields=${campos}&date_from=${ini.toISOString().slice(0, 10)}&date_to=${fin.toISOString().slice(0, 10)}`;
    let ultimo;
    for (let intento = 0; intento < 2; intento++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(90000) });
        if (!r.ok) { ultimo = new Error(`Windsor respondió HTTP ${r.status}`); if (r.status === 429 || r.status >= 500) { await new Promise((x) => setTimeout(x, 1500)); continue; } throw ultimo; }
        const j = await r.json();
        const datos = Array.isArray(j) ? j : j?.data;
        if (!Array.isArray(datos)) throw new Error("Respuesta inesperada de Windsor (ni lista ni { data: [...] })");
        filas.push(...datos); ultimo = null; break;
      } catch (e) {
        ultimo = new Error(String(e.message ?? e).replaceAll(clave, "***"));
        if (e.name === "TimeoutError") break;
      }
    }
    if (ultimo) throw ultimo;
  }
  return filas;
}

const fmt = (n) => Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });

async function main() {
  const a = leerArgumentos(process.argv.slice(2));
  if (a.ayuda || (!a.csv && !a.windsor)) { console.log(AYUDA); return; }
  const FECHA = /^\d{4}-\d{2}-\d{2}$/;

  let crudas;
  if (a.csv) {
    crudas = parsearCsv(fs.readFileSync(a.csv, "utf8"));
    console.log(`CSV leído: ${crudas.length} filas (${a.csv})`);
  } else {
    const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const hasta = a.hasta ?? ayer;
    const desde = a.desde ?? new Date(Date.parse(hasta) - 6 * 86400000).toISOString().slice(0, 10);
    if (!FECHA.test(desde) || !FECHA.test(hasta) || desde > hasta) throw new Error("--desde y --hasta tienen que ser AAAA-MM-DD y desde <= hasta");
    console.log(`Consultando Windsor (facebook) del ${desde} al ${hasta}…`);
    crudas = await consultarWindsor(desde, hasta);
    console.log(`Windsor devolvió ${crudas.length} filas.`);
  }

  const { filas, sinFecha } = normalizarFilasWindsor(crudas);
  if (sinFecha) console.log(`Filas sin fecha válida (descartadas): ${sinFecha}`);
  if (crudas.length && !("impressions" in crudas[0])) console.log("AVISO: el archivo no trae la columna impressions: las impresiones (y el CTR) quedan en 0.");
  if (crudas.length && !(CAMPO_CONVERSACIONES in crudas[0]) && !("messaging_conversation_started_7d" in crudas[0])) console.log(`AVISO: no hay columna de conversaciones (${CAMPO_CONVERSACIONES}): quedan en 0.`);

  if (crudas.length && !(CAMPO_LEADS in crudas[0])) console.log(`AVISO: no hay columna de clientes potenciales (${CAMPO_LEADS}): quedan en 0.`);

  const cli = rutaCli(a);
  const mapeo = leerMapeo(cli, a.cliente);
  if (!mapeo.length) throw new Error("No hay filas en comunidad_meta_origen (¿se aplicó db/010 y el mapeo?). Nada para importar.");

  const { registros, ignoradas, advertencias } = mapearFilas(filas, mapeo, { cuentaNombre: a.cuenta });
  console.log(`\nMapeo cargado: ${mapeo.length} reglas, ${new Set(mapeo.map((m) => m.comunidad_id)).size} comunidades.`);

  console.log("\n=== Lo que se importaría (por comunidad) ===");
  console.table(resumirPorComunidad(registros).map((r) => ({
    comunidad: r.comunidad, desde: r.desde, hasta: r.hasta, dias: r.dias, inversion: fmt(r.inversion), impresiones: fmt(r.impresiones), clics: fmt(r.clics), conversaciones: fmt(r.conversaciones), leads: fmt(r.leads),
  })));
  const totalIgnoradas = Object.values(ignoradas).reduce((x, y) => x + y, 0);
  console.log(`Registros (comunidad × día): ${registros.length}. Filas de campañas que no son de estos clientes (ignoradas a propósito): ${totalIgnoradas} en ${Object.keys(ignoradas).length} campañas.`);
  for (const adv of advertencias) console.log(`⚠️  ${adv}`);

  if (!a.aplicar) { console.log("\nENSAYO: no se escribió nada. Para guardar, repetí el comando con --aplicar."); return; }
  if (!registros.length) { console.log("\nNo hay registros para guardar."); return; }

  for (const sql of construirSqlUpsert(registros)) ejecutarSql(cli, sql);
  const [v] = ejecutarSql(cli, "select count(*)::int as filas, min(fecha)::text as desde, max(fecha)::text as hasta, round(sum(inversion),2)::text as inversion_total from crm_comunidades_v2.meta_ads_metrica;");
  console.log(`\n✅ Guardado. meta_ads_metrica ahora tiene ${v.filas} filas (${v.desde} → ${v.hasta}), inversión total ${v.inversion_total}.`);
}

main().catch((e) => { console.error(`\n❌ ${e.message}`); process.exit(1); });
