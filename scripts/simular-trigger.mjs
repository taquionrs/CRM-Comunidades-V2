#!/usr/bin/env node
// Simula avisos de "Trigger entregados" o "Clics en Me sumo" para ver la columna en Control_Comunidades, y los borra al terminar.
// Las filas de prueba usan teléfonos que empiezan con 5491199999 (inventados): se reconocen y se borran solas.
//
//   node scripts/simular-trigger.mjs                       (modo base: inserta avisos de prueba en la base)
//   node scripts/simular-trigger.mjs --cliente todo-un-pais --comunidad "La Toma" --personas 4 --repeticiones 2
//   node scripts/simular-trigger.mjs --webhook             (modo webhook: manda POST reales; pide WEBHOOK_SECRET en el entorno)
//   node scripts/simular-trigger.mjs --evento clic_me_sumo (simula clics en "Me sumo" en lugar de triggers)
//   node scripts/simular-trigger.mjs --limpiar             (borra TODAS las filas de prueba, de las dos tablas)
//
// Modo base: escribe con el Supabase CLI ya logueado (igual que windsor-importar). No usa ningún secreto.
// Modo webhook: ejercita la Edge Function completa (secreto, comunidad, guardado). El secreto se lee SOLO de la variable de
// entorno WEBHOOK_SECRET y nunca se imprime:  $env:WEBHOOK_SECRET="..."   (PowerShell)  o  export WEBHOOK_SECRET=...  (bash)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const PREFIJO = "5491199999";
const URL_WEBHOOK = "https://zyyxsammrryhfrgfwlxr.supabase.co/functions/v1/manychat-webhook";
const TABLAS = { trigger: "trigger_entregado", clic_me_sumo: "clic_me_sumo" };
const AYUDA = `Uso: node scripts/simular-trigger.mjs [--evento trigger|clic_me_sumo] [--cliente <slug>] [--comunidad "<nombre>"] [--personas N] [--repeticiones N] [--webhook] [--limpiar] [--cli <supabase.exe>]`;

function leerArgumentos(argv) {
  const a = { evento: "trigger", cliente: "cortado-en-jarrito", comunidad: "Palermo", personas: 3, repeticiones: 2, webhook: false, limpiar: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--webhook") a.webhook = true;
    else if (k === "--limpiar") a.limpiar = true;
    else if (k === "--ayuda" || k === "-h") a.ayuda = true;
    else if (["--evento", "--cliente", "--comunidad", "--cli"].includes(k)) a[k.slice(2)] = argv[++i];
    else if (["--personas", "--repeticiones"].includes(k)) a[k.slice(2)] = Number(argv[++i]);
    else throw new Error(`Opción desconocida: ${k}\n${AYUDA}`);
  }
  if (!TABLAS[a.evento]) throw new Error("--evento tiene que ser trigger o clic_me_sumo");
  if (!/^[a-z0-9-]+$/.test(a.cliente)) throw new Error("--cliente solo admite minúsculas, números y guiones");
  if (!Number.isInteger(a.personas) || a.personas < 1 || a.personas > 50) throw new Error("--personas tiene que ser un entero entre 1 y 50");
  if (!Number.isInteger(a.repeticiones) || a.repeticiones < 1 || a.repeticiones > 10) throw new Error("--repeticiones tiene que ser un entero entre 1 y 10");
  return a;
}

function rutaCli(a) {
  const c = [a.cli, process.env.SUPABASE_CLI, path.join(process.env.LOCALAPPDATA ?? "", "supabase-cli", "supabase.exe")].filter(Boolean);
  return c.find((p) => fs.existsSync(p)) ?? "supabase";
}

function sql(cli, texto) {
  const f = path.join(os.tmpdir(), `simular-trigger-${process.pid}-${Date.now()}.sql`);
  fs.writeFileSync(f, texto, "utf8");
  try {
    const salida = execFileSync(cli, ["db", "query", "--linked", "-f", f], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const m = salida.match(/\{[\s\S]*\}/);
    return m ? (JSON.parse(m[0]).rows ?? []) : [];
  } catch (e) {
    const detalle = String(e.stderr || e.stdout || e.message || e).split("\n").filter((l) => /error|message/i.test(l)).slice(0, 3).join(" | ");
    throw new Error(`Falló la consulta a la base (¿hiciste "supabase login"?). ${detalle}`.trim());
  } finally {
    try { fs.unlinkSync(f); } catch { /* temporal */ }
  }
}

const telefono = (n) => `${PREFIJO}${String(n).padStart(4, "0")}`;

function contarPrueba(cli, evento) {
  const [r] = sql(cli, `select count(*)::int as avisos, count(distinct telefono_id)::int as personas from crm_comunidades_v2.${TABLAS[evento]} where telefono_id like '${PREFIJO}%';`);
  return r;
}

function limpiar(cli) {
  const [r] = sql(cli, `with a as (delete from crm_comunidades_v2.trigger_entregado where telefono_id like '${PREFIJO}%' returning 1), b as (delete from crm_comunidades_v2.clic_me_sumo where telefono_id like '${PREFIJO}%' returning 1) select (select count(*) from a)::int + (select count(*) from b)::int as borradas;`);
  return r.borradas;
}

function mostrarMatriz(cli, slug, comunidad) {
  const filas = sql(cli, `select nombre, triggers_entregados, clics_me_sumo, clics_unicos from crm_comunidades_v2.comunidad_performance_rango((select id from crm_comunidades_v2.cliente where slug = '${slug}'), null, null) order by nombre;`);
  console.table(filas.map((f) => ({ comunidad: f.nombre, trigger_entregados: f.triggers_entregados, clics_me_sumo: f.clics_me_sumo, entradas_al_flow: f.clics_unicos, "◀": f.nombre === comunidad ? "prueba" : "" })));
}

async function main() {
  const a = leerArgumentos(process.argv.slice(2));
  if (a.ayuda) { console.log(AYUDA); return; }
  const cli = rutaCli(a);

  if (a.limpiar) { console.log(`Filas de prueba borradas: ${limpiar(cli)}.`); return; }

  const previas = contarPrueba(cli, a.evento);
  if (previas.avisos > 0) console.log(`Ojo: ya había ${previas.avisos} avisos de prueba sin borrar (${previas.personas} personas). Se suman a los nuevos; --limpiar los borra.`);

  const total = a.personas * a.repeticiones;
  console.log(`Simulando ${total} avisos (${a.personas} personas × ${a.repeticiones} veces) en ${a.cliente} / ${a.comunidad}…`);

  if (a.webhook) {
    const secreto = process.env.WEBHOOK_SECRET;
    if (!secreto) throw new Error("Modo --webhook: falta la variable de entorno WEBHOOK_SECRET (el secreto de ese cliente).");
    let ok = 0, fallos = 0;
    for (let rep = 0; rep < a.repeticiones; rep++) {
      for (let p = 1; p <= a.personas; p++) {
        const r = await fetch(URL_WEBHOOK, {
          method: "POST",
          headers: { "content-type": "application/json", "x-cliente": a.cliente, "x-webhook-secret": secreto },
          body: JSON.stringify({ evento: a.evento, community_id: a.comunidad, contact: { whatsapp_phone: telefono(p), first_name: "PRUEBA" } }),
          signal: AbortSignal.timeout(30000),
        });
        if (r.ok) ok++; else { fallos++; if (fallos <= 3) console.log(`  HTTP ${r.status}: ${(await r.text()).replaceAll(secreto, "***").slice(0, 200)}`); }
      }
    }
    console.log(`Webhook: ${ok} aceptados, ${fallos} rechazados.`);
  } else {
    const [c] = sql(cli, `select cl.id as cliente_id, co.id as comunidad_id from crm_comunidades_v2.cliente cl join crm_comunidades_v2.comunidad co on co.cliente_id = cl.id where cl.slug = '${a.cliente}' and co.nombre = '${a.comunidad.replaceAll("'", "''")}';`);
    if (!c) throw new Error(`No existe la comunidad "${a.comunidad}" en el cliente ${a.cliente}.`);
    const valores = [];
    for (let rep = 0; rep < a.repeticiones; rep++) for (let p = 1; p <= a.personas; p++) valores.push(`('${c.cliente_id}','${c.comunidad_id}','${telefono(p)}')`);
    sql(cli, `insert into crm_comunidades_v2.${TABLAS[a.evento]} (cliente_id, comunidad_id, telefono_id) values ${valores.join(",")};`);
  }

  const d = contarPrueba(cli, a.evento);
  console.log(`\nEn la base hay ${d.avisos} avisos de prueba de ${d.personas} personas distintas. El panel debería mostrar ${d.personas} (cuenta personas, no avisos).`);
  console.log(`\nMatriz tal como la calcula Control_Comunidades (${a.cliente}):`);
  mostrarMatriz(cli, a.cliente, a.comunidad);
  console.log(`Miralo en el panel (Control_Comunidades, cliente ${a.cliente}). Cuando termines:  node scripts/simular-trigger.mjs --limpiar`);
}

main().catch((e) => { console.error(`\n❌ ${e.message}`); process.exit(1); });
