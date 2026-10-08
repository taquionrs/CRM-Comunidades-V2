// Pruebas de la importación de Meta Ads por comunidad. Correr: npm test   (node --test, sin dependencias)
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizarNombre, parsearCsv, normalizarFilasWindsor, mapearFilas, resumirPorComunidad, construirSqlUpsert, CAMPO_CONVERSACIONES,
} from "../scripts/lib/windsor-mapeo.mjs";

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CORTADO = U(1), TUP = U(2);
const C_BOEDO = U(11), C_PALERMO = U(12), C_DEVOTO = U(13), C_CORT_GEN = U(14);
const C_TOMA = U(21), C_QUINES = U(22), C_SANLUIS = U(23);

const CAMP_WA = "TQN_AON_META_CON_LEADS_MANUAL_CORTADO_EN_JARRITO_WHATSAPP";
const CAMP_INTE = "TQN_AON_META_CON_INTE_MANUAL_CORTADO_EN_JARRITO";
const CAMP_TUP = "TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS";

const fila = (c, cn, cm, cp) => ({ cliente_id: c, cliente_slug: cn, comunidad_id: cm, comunidad_nombre: cp });
const MAPEO = [
  { ...fila(CORTADO, "cortado-en-jarrito", C_BOEDO, "Boedo"), campana_nombre: CAMP_WA, adset_nombre: "TQN_AON_META_CON_INTE_MANUAL_CORTADO_EN_JARRITO_WHATSAPP_BOEDO", meta_cuenta_id: "1669338306456901" },
  { ...fila(CORTADO, "cortado-en-jarrito", C_PALERMO, "Palermo"), campana_nombre: CAMP_WA, adset_nombre: "TQN_AON_META_CON_INTE_MANUAL_CORTADO_EN_JARRITO_WHATSAPP_PALERMO", meta_cuenta_id: "1669338306456901" },
  { ...fila(CORTADO, "cortado-en-jarrito", C_DEVOTO, "Villa Devoto"), campana_nombre: CAMP_WA, adset_nombre: "TQN_AON_META_CON_INTE_MANUAL_CORTADO_EN_JARRITO_WHATSAPP_DEVOTO", meta_cuenta_id: "1669338306456901" },
  { ...fila(CORTADO, "cortado-en-jarrito", C_CORT_GEN, "Cortado en Jarrito (general)"), campana_nombre: CAMP_INTE, adset_nombre: null, meta_cuenta_id: "1669338306456901" },
  { ...fila(TUP, "todo-un-pais", C_TOMA, "La Toma"), campana_nombre: CAMP_TUP, adset_nombre: "TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS_LA_TOMA", meta_cuenta_id: "1669338306456901" },
  { ...fila(TUP, "todo-un-pais", C_QUINES, "Quines"), campana_nombre: CAMP_TUP, adset_nombre: "TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS_QUINES", meta_cuenta_id: "1669338306456901" },
  { ...fila(TUP, "todo-un-pais", C_SANLUIS, "San Luis Capital"), campana_nombre: CAMP_TUP, adset_nombre: "TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS_SAN_LUIS", meta_cuenta_id: "1669338306456901" },
];

const w = (date, campaign, adset, spend, clicks, conv, extra = {}) => ({
  date, account_id: "1669338306456901", account_name: "TQN - Growing 2 - LC", campaign, adset_name: adset,
  spend: String(spend), clicks: String(clicks), impressions: String(extra.impr ?? 1000), [CAMPO_CONVERSACIONES]: String(conv), ...extra.campos,
});
const normalizar = (filas) => normalizarFilasWindsor(filas).filas;

test("normalizarNombre: tildes, espacios y mayúsculas (los nombres reales de Meta)", () => {
  assert.equal(normalizarNombre("TQN_META_COMUNIDADES_TODO_UN_PAÍS"), normalizarNombre("tqn_meta_comunidades_todo_un_pais"));
  assert.equal(normalizarNombre("  +55 _TQN_META  "), "+55 _tqn_meta");
  assert.equal(normalizarNombre("VILLA   MERCEDES"), "villa mercedes");
  assert.equal(normalizarNombre("CÓRDOBA"), "cordoba");
  assert.equal(normalizarNombre(null), "");
  assert.equal(normalizarNombre(undefined), "");
});

test("normalizarNombre: NFD y NFC dan lo mismo (tilde precompuesta o combinada)", () => {
  assert.equal(normalizarNombre("PAÍS"), normalizarNombre("PAÍS"));
});

test("parsearCsv: encabezado, comillas con coma, comillas escapadas, CRLF, BOM y líneas vacías", () => {
  const csv = '﻿date,campaign,adset_name\r\n2026-10-07,"A, con coma","dice ""hola"""\r\n\r\n2026-10-08,B,C\r\n';
  const f = parsearCsv(csv);
  assert.equal(f.length, 2);
  assert.deepEqual(f[0], { date: "2026-10-07", campaign: "A, con coma", adset_name: 'dice "hola"' });
  assert.equal(f[1].adset_name, "C");
  assert.deepEqual(parsearCsv(""), []);
});

test("normalizarFilasWindsor: decimales del CSV real, campo de conversaciones y filas sin fecha", () => {
  const { filas, sinFecha } = normalizarFilasWindsor([
    { date: "2026-10-01", campaign: "X", adset_name: "Y", clicks: "1588.0", spend: "92205.23", [CAMPO_CONVERSACIONES]: "3.0" },
    { date: "", campaign: "Z" },
    { date: "2026-10-02", campaign: "X", adset_name: "Y", clicks: "10", spend: "1", messaging_conversation_started_7d: "5" },
  ]);
  assert.equal(sinFecha, 1);
  assert.equal(filas[0].clics, 1588);
  assert.equal(filas[0].inversion, 92205.23);
  assert.equal(filas[0].conversaciones, 3);
  assert.equal(filas[1].conversaciones, 5, "acepta también el nombre del documento de Jaz");
  assert.equal(filas[0].impresiones, 0, "sin columna impressions queda en 0");
});

test("mapearFilas: cada conjunto va a su comunidad y 'SAN_LUIS' es San Luis Capital", () => {
  const filas = normalizar([
    w("2026-10-07", CAMP_TUP, "TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS_SAN_LUIS", 60759.62, 281, 86),
    w("2026-10-07", CAMP_TUP, "TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS_QUINES", 16386.45, 257, 153),
    w("2026-10-07", CAMP_WA, "TQN_AON_META_CON_INTE_MANUAL_CORTADO_EN_JARRITO_WHATSAPP_PALERMO", 20147.37, 121, 24),
  ]);
  const { registros, advertencias } = mapearFilas(filas, MAPEO);
  assert.deepEqual(advertencias, []);
  const por = Object.fromEntries(registros.map((r) => [r.comunidad_nombre, r]));
  assert.equal(por["San Luis Capital"].conversaciones, 86);
  assert.equal(por["San Luis Capital"].inversion, 60759.62);
  assert.equal(por["Quines"].conversaciones, 153);
  assert.equal(por["Palermo"].cliente_slug, "cortado-en-jarrito");
  assert.equal(por["San Luis Capital"].cliente_id, TUP);
});

test("mapearFilas: la campaña general (sin conjunto) junta todos sus conjuntos en la comunidad general", () => {
  const filas = normalizar([
    w("2026-10-07", CAMP_INTE, CAMP_INTE + "_POST", 25733.73, 1537, 0),
    w("2026-10-07", CAMP_INTE, CAMP_INTE + "_DARK", 14962.59, 579, 0),
  ]);
  const { registros } = mapearFilas(filas, MAPEO);
  assert.equal(registros.length, 1);
  assert.equal(registros[0].comunidad_nombre, "Cortado en Jarrito (general)");
  assert.equal(registros[0].inversion, 40696.32);
  assert.equal(registros[0].clics, 2116);
});

test("mapearFilas: las campañas de otros clientes se ignoran y se cuentan", () => {
  const filas = normalizar([
    w("2026-10-07", "TQN_AON_META_INTERACCION_RMARCA_MANUAL_ENFOQUE_FEDERAL", "TQN_AON_META_INTERACCION_RMARCA_MANUAL_ENFOQUE_FEDERAL_SALTA", 17014, 543, 0),
    w("2026-10-07", "TQN_AON_META_INTERACCION_RMARCA_MANUAL_ENFOQUE_FEDERAL", "TQN_AON_META_INTERACCION_RMARCA_MANUAL_ENFOQUE_FEDERAL_ROSARIO", 18647, 537, 0),
    w("2026-10-07", "AON_META_INTERACCION_MANUAL_TAQUION", "AON_META_INTERACCION_MANUAL_TAQUION_ONE SHOT_COMUNIDAD", 5645, 426, 0),
  ]);
  const { registros, ignoradas } = mapearFilas(filas, MAPEO);
  assert.equal(registros.length, 0);
  assert.equal(ignoradas["TQN_AON_META_INTERACCION_RMARCA_MANUAL_ENFOQUE_FEDERAL"], 2);
  assert.equal(ignoradas["AON_META_INTERACCION_MANUAL_TAQUION"], 1);
});

test("mapearFilas: un conjunto NUEVO en una campaña mapeada se avisa y su gasto no se asigna", () => {
  const filas = normalizar([
    w("2026-10-07", CAMP_WA, "TQN_AON_META_CON_INTE_MANUAL_CORTADO_EN_JARRITO_WHATSAPP_VILLA_URQUIZA", 5000, 40, 2),
    w("2026-10-07", CAMP_WA, "TQN_AON_META_CON_INTE_MANUAL_CORTADO_EN_JARRITO_WHATSAPP_PALERMO", 100, 1, 1),
  ]);
  const { registros, advertencias, desconocidos } = mapearFilas(filas, MAPEO);
  assert.equal(registros.length, 1, "solo Palermo");
  assert.equal(registros[0].inversion, 100);
  assert.equal(advertencias.length, 1);
  assert.match(advertencias[0], /VILLA_URQUIZA/);
  assert.equal(Object.values(desconocidos)[0].inversion, 5000);
});

test("mapearFilas: espacios, tildes y mayúsculas distintas siguen coincidiendo", () => {
  const filas = normalizar([
    w("2026-10-07", "  tqn_meta_con_leads_manual_comunidades_todo_un_pais ", "tqn_meta_con_leads_manual_comunidades_todo_un_pais_la_toma  ", 10, 1, 1),
  ]);
  const { registros } = mapearFilas(filas, MAPEO);
  assert.equal(registros[0].comunidad_nombre, "La Toma");
});

test("mapearFilas: varias filas del mismo conjunto y día se suman (nunca dos registros por comunidad y fecha)", () => {
  const filas = normalizar([
    w("2026-10-07", CAMP_TUP, "TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS_LA_TOMA", 10.1, 5, 2),
    w("2026-10-07", CAMP_TUP, "TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS_LA_TOMA", 20.2, 7, 3),
  ]);
  const { registros } = mapearFilas(filas, MAPEO);
  assert.equal(registros.length, 1);
  assert.equal(registros[0].inversion, 30.3);
  assert.equal(registros[0].clics, 12);
  assert.equal(registros[0].conversaciones, 5);
});

test("mapearFilas: no se cruzan clientes (el mismo nombre de conjunto en otra campaña no matchea)", () => {
  const filas = normalizar([
    w("2026-10-07", "OTRA_CAMPAÑA", "TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS_LA_TOMA", 99, 9, 9),
  ]);
  const { registros, ignoradas } = mapearFilas(filas, MAPEO);
  assert.equal(registros.length, 0);
  assert.equal(ignoradas["OTRA_CAMPAÑA"], 1);
});

test("mapearFilas: la cuenta publicitaria se respeta (ID del cliente, o nombre si el CSV no trae ID)", () => {
  const otraCuenta = { account_id: "2519911211576322", account_name: "Cuenta Todo un País" };
  const filas = normalizar([
    { ...w("2026-10-07", CAMP_TUP, "TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS_QUINES", 50, 5, 5), ...otraCuenta },
    w("2026-10-07", CAMP_TUP, "TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS_QUINES", 7, 1, 1),
  ]);
  const r1 = mapearFilas(filas, MAPEO);
  assert.equal(r1.registros[0].inversion, 7, "solo la cuenta del cliente");
  assert.match(r1.advertencias[0], /otra cuenta/);

  const sinId = normalizar([
    { date: "2026-10-07", account_name: "Cuenta Todo un País", campaign: CAMP_TUP, adset_name: "TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS_QUINES", spend: "50" },
    { date: "2026-10-07", account_name: "TQN - Growing 2 - LC", campaign: CAMP_TUP, adset_name: "TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS_QUINES", spend: "7" },
  ]);
  const sinCuentaId = MAPEO.map((m) => ({ ...m, meta_cuenta_id: null }));
  const r2 = mapearFilas(sinId, sinCuentaId, { cuentaNombre: "tqn - growing 2 - lc" });
  assert.equal(r2.registros[0].inversion, 7);
});

test("resumirPorComunidad: totales, días y rango de fechas", () => {
  const filas = normalizar([
    w("2026-10-06", CAMP_TUP, "TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS_LA_TOMA", 6754.6, 56, 21),
    w("2026-10-07", CAMP_TUP, "TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS_LA_TOMA", 15658.64, 303, 63),
  ]);
  const [r] = resumirPorComunidad(mapearFilas(filas, MAPEO).registros);
  assert.equal(r.dias, 2);
  assert.equal(r.desde, "2026-10-06");
  assert.equal(r.hasta, "2026-10-07");
  assert.equal(r.inversion, 22413.24);
  assert.equal(r.conversaciones, 84);
});

test("construirSqlUpsert: upsert por (comunidad, fecha), valores validados y nada de texto libre", () => {
  const filas = normalizar([w("2026-10-07", CAMP_TUP, "TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS_LA_TOMA", 15658.64, 303, 63, { impr: 50000 })]);
  const { registros } = mapearFilas(filas, MAPEO);
  const [sql] = construirSqlUpsert(registros);
  assert.match(sql, /on conflict \(comunidad_id, fecha\) do update/);
  assert.ok(sql.includes(`('${TUP}','${C_TOMA}','2026-10-07',15658.64,63,50000,303)`));
  assert.ok(!sql.includes("La Toma"), "no se interpolan nombres");
});

test("construirSqlUpsert: rechaza uuid, fecha o números inválidos", () => {
  const ok = { cliente_id: CORTADO, comunidad_id: C_BOEDO, fecha: "2026-10-07", inversion: 1, impresiones: 1, clics: 1, conversaciones: 1 };
  assert.throws(() => construirSqlUpsert([{ ...ok, comunidad_id: "x'; drop table comunidad;--" }]), /UUID/);
  assert.throws(() => construirSqlUpsert([{ ...ok, fecha: "2026-10-07'; --" }]), /Fecha/);
  assert.throws(() => construirSqlUpsert([{ ...ok, inversion: -1 }]), /inversion/);
  assert.throws(() => construirSqlUpsert([{ ...ok, clics: NaN }]), /clics/);
});

test("construirSqlUpsert: parte en lotes", () => {
  const regs = Array.from({ length: 1001 }, (_, i) => ({ cliente_id: CORTADO, comunidad_id: C_BOEDO, fecha: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`, inversion: i, impresiones: 1, clics: 1, conversaciones: 0 }));
  assert.equal(construirSqlUpsert(regs, 400).length, 3);
  assert.deepEqual(construirSqlUpsert([]), []);
});

test("formato real: un fragmento del CSV de Windsor del 2026-10-08 se importa completo", () => {
  const csv = [
    "date,datasource,account_name,source,campaign,clicks,spend,adset_name,actions_onsite_conversion_messaging_conversation_started_7d",
    "2026-10-06,facebook,TQN - Growing 2 - LC,facebook,TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS,56.0,6754.6,TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS_LA_TOMA,21.0",
    "2026-10-06,facebook,TQN - Growing 2 - LC,facebook,TQN_AON_META_CON_LEADS_MANUAL_CORTADO_EN_JARRITO_WHATSAPP,0.0,414.38,TQN_AON_META_CON_INTE_MANUAL_CORTADO_EN_JARRITO_WHATSAPP_BOEDO,0",
    "2026-10-06,facebook,TQN - Growing 2 - LC,facebook,TQN_AON_META_INTERACCION_RMARCA_MANUAL_ENFOQUE_FEDERAL,250.0,9118.66,TQN_AON_META_INTERACCION_RMARCA_MANUAL_ENFOQUE_FEDERAL_VILLA MERCEDES,0",
    "2026-10-06,facebook,TQN - Growing 2 - LC,facebook,TQN_META_CON_REGISTROS_MANUAL_CAMPOS_ELECTORAL,4.0,90.19,+55 _TQN_META_CON_REGISTROS_MANUAL_CAMPOS_ELECTORAL,0",
    "",
  ].join("\n");
  const { registros, ignoradas } = mapearFilas(normalizarFilasWindsor(parsearCsv(csv)).filas, MAPEO, { cuentaNombre: "TQN - Growing 2 - LC" });
  assert.equal(registros.length, 2);
  assert.equal(Object.values(ignoradas).reduce((a, b) => a + b, 0), 2);
  assert.equal(registros.find((r) => r.comunidad_nombre === "La Toma").conversaciones, 21);
  assert.equal(registros.find((r) => r.comunidad_nombre === "Boedo").inversion, 414.38);
});
