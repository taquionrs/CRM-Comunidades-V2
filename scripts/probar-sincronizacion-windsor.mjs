// Prueba de db/015 (sincronizar_meta_desde_windsor) contra producción SIN dejar rastros: carga el CSV de Windsor y 3 casos
// trampa en una tabla temporal, corre la función dentro de una transacción que se anula y muestra el resultado.
// Esperado con el CSV del 01 al 07/10: filas_existentes_que_cambiaron = 0 (reproduce lo que ya guarda el importador),
// filas_sin_comunidad = 2 (un conjunto nuevo y una fila de otra cuenta), registros_en_dia_nuevo = 1.
//   node scripts/probar-sincronizacion-windsor.mjs C:/ruta/data.csv
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parsearCsv } from "./lib/windsor-mapeo.mjs";

const ruta = process.argv[2];
if (!ruta) { console.error("Uso: node scripts/probar-sincronizacion-windsor.mjs <csv de Windsor>"); process.exit(1); }
const csv = parsearCsv(fs.readFileSync(ruta, "utf8"));
const q = (v) => (v === undefined || v === null || v === "" ? "null" : "'" + String(v).replaceAll("'", "''") + "'");
const n = (v) => (v === undefined || v === null || v === "" ? "null" : Number(v));

const filas = csv.map((f) => `(${q(f.date)}, '1669338306456901', ${q(f.account_name)}, ${q(f.campaign)}, ${q(f.adset_name)}, ${n(f.spend)}, ${n(f.impressions)}, ${n(f.clicks)}, ${n(f.actions_onsite_conversion_messaging_conversation_started_7d)}, ${n(f.actions_onsite_conversion_lead_grouped)})`);

const CAMP_TUP = "TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS";
const ADSET_TOMA = "TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS_LA_TOMA";
const trampas = [
  // (a) conjunto nuevo dentro de una campaña mapeada: NO se asigna, queda como "sin comunidad" (100)
  `('2026-10-06', '1669338306456901', 'x', ${q(CAMP_TUP)}, 'TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS_BARRIO_NUEVO', 100, 10, 1, 1, 0)`,
  // (b) misma campaña pero de OTRA cuenta publicitaria: se descarta (5000)
  `('2026-10-07', '999', 'otra cuenta', ${q(CAMP_TUP)}, ${q(ADSET_TOMA)}, 5000, 10, 1, 1, 0)`,
  // (c) nombres con mayúsculas, tildes y espacios distintos, en un día nuevo: se asigna a La Toma (1)
  `('2026-10-20', '1669338306456901', 'x', '  tqn_meta_con_leads_manual_comunidades_todo_un_país ', '  tqn_meta_con_leads_manual_comunidades_todo_un_país_la_toma', 1, 7, 2, 3, 4)`,
];

const sql = `
do $$
declare v record; v_diff int; v_nuevas int; v_toma numeric; v_total_antes int; v_total_despues int; v_sin record;
begin
  create temp table w_prueba (date date, account_id text, account_name text, campaign text, adset_name text,
    spend double precision, impressions double precision, clicks double precision,
    actions_onsite_conversion_messaging_conversation_started_7d double precision,
    actions_onsite_conversion_lead_grouped double precision) on commit drop;
  insert into w_prueba values
  ${[...filas, ...trampas].join(",\n  ")};

  create temp table antes on commit drop as
    select comunidad_id, fecha, inversion, conversaciones_meta, impresiones, clics, leads_meta from crm_comunidades_v2.meta_ads_metrica;
  select count(*) into v_total_antes from antes;

  select * into v from crm_comunidades_v2.sincronizar_meta_desde_windsor('pg_temp.w_prueba');

  select count(*) into v_total_despues from crm_comunidades_v2.meta_ads_metrica;
  select count(*) into v_diff from antes a join crm_comunidades_v2.meta_ads_metrica m using (comunidad_id, fecha)
   where (a.inversion, a.conversaciones_meta, a.impresiones, a.clics, a.leads_meta)
         is distinct from (m.inversion, m.conversaciones_meta, m.impresiones, m.clics, m.leads_meta);
  select count(*) into v_nuevas from crm_comunidades_v2.meta_ads_metrica m where m.fecha = date '2026-10-20';
  select coalesce(sum(m.inversion),0) into v_toma from crm_comunidades_v2.meta_ads_metrica m join crm_comunidades_v2.comunidad c on c.id=m.comunidad_id where m.fecha = date '2026-10-20' and c.nombre = 'La Toma';
  select * into v_sin from crm_comunidades_v2.meta_sin_comunidad('pg_temp.w_prueba') order by 4 desc limit 1;

  raise exception 'RESULTADO %', jsonb_build_object(
    'filas_origen', v.filas_origen, 'filas_asignadas', v.filas_asignadas, 'registros_escritos', v.registros_escritos,
    'filas_sin_comunidad', v.filas_sin_comunidad, 'gasto_sin_comunidad', v.gasto_sin_comunidad,
    'filas_antes', v_total_antes, 'filas_despues', v_total_despues,
    'filas_existentes_que_cambiaron', v_diff, 'registros_en_dia_nuevo', v_nuevas, 'inversion_la_toma_dia_nuevo', v_toma,
    'primer_conjunto_sin_comunidad', v_sin.conjunto);
end $$;`;

const archivo = path.join(os.tmpdir(), "t015.sql");
fs.writeFileSync(archivo, sql);
const cli = [process.env.SUPABASE_CLI, path.join(process.env.LOCALAPPDATA ?? "", "supabase-cli", "supabase.exe")].filter(Boolean).find((p) => fs.existsSync(p)) ?? "supabase";
let salida = "";
try { salida = execFileSync(cli, ["db", "query", "--linked", "-f", archivo], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
catch (e) { salida = String(e.stdout || "") + String(e.stderr || ""); }
const m = salida.match(/RESULTADO (\{[^}]*\})/);
// El texto llega con las comillas escapadas una o dos veces: se quitan todas las barras antes de una comilla.
const limpio = m ? m[1].split("\\").join("") : null;
console.log(limpio ? JSON.stringify(JSON.parse(limpio), null, 1) : salida.slice(0, 1500));
console.log("filas del CSV:", csv.length, "+ 3 trampas");
