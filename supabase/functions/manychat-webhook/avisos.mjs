// Lógica pura del webhook de ManyChat que se prueba desde Node (tests/webhook-avisos.test.mjs). La usa index.ts.

// Tipo de aviso que manda el flow, según el campo "evento" del body:
//   (sin evento)     contacto normal: el POST de entrada al flow (evento_crudo)
//   "trigger"        se entregó el primer mensaje del flow (trigger_entregado, db/011)
//   "clic_me_sumo"   la persona tocó el botón "Me sumo" (clic_me_sumo, db/013)
//   "sin_clasificar" la persona le escribió al número y todavía no eligió comunidad (ingreso_sin_clasificar, db/035).
//                    A diferencia de los otros avisos, NO lleva comunidad.
//   otro valor       "desconocido": se rechaza, para que un aviso nuevo mal escrito NO se cuente como entrada.
export function tipoDeAviso(valor) {
  if (valor === undefined || valor === null) return "contacto";
  if (typeof valor !== "string") return "desconocido";
  const v = valor.trim().toLowerCase();
  if (v === "") return "contacto";
  if (v === "trigger" || v === "trigger_entregado") return "trigger";
  if (v === "clic_me_sumo" || v === "clic-me-sumo") return "clic_me_sumo";
  if (v === "sin_clasificar" || v === "sin-clasificar") return "sin_clasificar";
  return "desconocido";
}

// Lo último que escribió la persona (contact.last_input_text de "Full Contact Data"), recortado. null si no vino.
export function mensajeDeContacto(contact, maximo = 500) {
  if (!contact || typeof contact !== "object") return null;
  const v = contact.last_input_text;
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t.slice(0, maximo) : null;
}

// Códigos de anuncio que pueden venir dentro del mensaje (PR #70, db/039): 1 a 3 letras + 1 a 3 números ("P1", "pa12"),
// como palabra suelta. Devuelve los candidatos en mayúsculas, sin repetir y en el orden en que aparecen. El webhook los
// compara contra el catálogo anuncio_codigo: un candidato que no está ahí se ignora (así "A1" dentro de una dirección no cuenta).
export function codigosCandidatos(texto) {
  if (typeof texto !== "string") return [];
  const vistos = [];
  for (const m of texto.matchAll(/(?<![\p{L}\p{N}])([A-Za-z]{1,3}\d{1,3})(?![\p{L}\p{N}])/gu)) {
    const c = m[1].toUpperCase();
    if (!vistos.includes(c)) vistos.push(c);
  }
  return vistos;
}

// De los candidatos del mensaje, el primero que existe y está activo en el catálogo del cliente (lista de códigos activos).
export function codigoDeAnuncio(texto, codigosActivos) {
  const activos = new Set((codigosActivos ?? []).map((c) => String(c).toUpperCase()));
  return codigosCandidatos(texto).find((c) => activos.has(c)) ?? null;
}
