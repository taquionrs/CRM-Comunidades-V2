# Plan global — reportes automáticos, monitoreo de métricas compuestas, CRR y churn

Estado: **plan (2026-11-16).** CRR en la PR #74. Lo demás por construir, en el orden de abajo.
Pedido de Juan Marroncle (2026-11-16). Reúne lo que ya se construyó y lo que quedó pendiente de las especs anteriores.

## Prioridades (en este orden)
1. **Automatizar los reportes** semanales y tener **monitoreo real de las métricas compuestas** (las que se arman con más de un dato: CRR, churn, costo por miembro, triaje, cobertura).
2. **CRR funcionando en producción** (PR #74).

Principio de siempre: **los números los calcula el CRM; ni la IA ni una planilla armada a mano**. Todo con línea de base declarada y sin inventar datos faltantes: si no se puede calcular, dice "no calculable" y por qué.

## Dónde estamos (el histórico unificado)

| Área | Hecho (en producción) | Pendiente / abierto |
|---|---|---|
| Ingreso bot → CRM | Webhook de ManyChat, flows por comunidad, "sin clasificar" (PR #64–66), contactos a planilla por n8n | Boedo con baja cobertura; origen de los "Hola, quiero más información" |
| Tracking de cobertura | Orden por etapas, clics en el enlace, desfasaje, semáforo (PR #65–69) | Umbrales del semáforo a aprobar por la PO |
| Pauta por anuncio | Código por anuncio (PR #70), métricas por anuncio de Windsor (PR #71), bloque Rendimiento (PR #72) | Catálogo automático y columnas Nombre/ID (PR #73, abierta); vincular anuncio con mensaje (ver abajo) |
| Miembros | Carga de miembros con lista completa, bajas reales, fuga (PR #38–42) | Carga automática y frecuente; CRR (PR #74) |
| Acceso | SSO con Cloudflare y roles Marketing/General (PR #54) | — |
| Reportes | Excel manual "Reporte Nominizados" por período; informe de tracking del 13/11 | **Automatizar** (fases 2 y 3) |
| IA | Pulso (equipo de Medios); spec de funciones de IA en el CRM | Etapa 5: OpenRouter con tope de 5 USD |
| n8n | Contactos de WhatsApp a Sheets (en uso); embudo mensual (importable, falta su base de datos) | Reporte semanal, alertas, carga de miembros |
| Línea de base del puesto | Documento v0 de definiciones | Tasa de triaje con numerador mal definido; CPMR, K-Factor, ciclo del miembro, horas manuales |

## Métricas compuestas: definiciones propuestas
Hoy el Excel de "Nominizados" mezcla dos clases de datos (total acumulado y flujo del período) en columnas que parecen una sola cosa. Se propone esta tabla, que reemplaza a la del Excel. Todas se calculan **por comunidad y período** y el total del cliente se recalcula con los totales, nunca promediando.

| Métrica | Fórmula | Fuente | Hoy |
|---|---|---|---|
| **CRR** | (miembros al final − nuevos) ÷ miembros al inicio | Cargas de lista completa | **PR #74** |
| **Churn** | 100 − CRR | ídem | **PR #74** |
| **Altas netas** | final − inicio | ídem | PR #74 (columnas) |
| **Costo por entrada al flow** | inversión ÷ entradas al flow | Windsor + CRM | Existe (Control_Comunidades) |
| **Costo por miembro nuevo (CPMN)** | inversión ÷ nuevos del período | Windsor + cargas | **Por construir.** Reemplaza al "costo por miembro efectivo" del Excel, que dividía por el total acumulado |
| **Tasa de triaje** | nuevos miembros ÷ entradas al flow | Cargas + CRM | Por construir (decisión del 27/10: ingresos al grupo ÷ entradas al flow) |
| **Cobertura** | entradas ÷ conversaciones de Meta | CRM + Meta | Existe (semáforo) |
| **Frescura de datos** | días desde la última carga de lista completa | Cargas | Por construir. Sin esto el CRR se apoya en datos viejos sin avisar |

Cosas del Excel actual a corregir: la "Tasa de retención" (miembros reales ÷ entradas) no es retención; y el "Costo por miembro efectivo" (inversión ÷ miembros reales totales) baja solo porque el total acumulado crece, aunque no entre nadie nuevo.

## Fase 1 — CRR en producción (esta semana)
- **PR #74:** `db/043` (`crr_por_carga()`), bloque en Control_Comunidades, guía `docs/how-to/crr-y-churn.md`. Mide entre dos cargas de lista completa; no estima.
- **Para que haya CRR de todas las comunidades:** cargar la lista completa de cada una. Hoy solo Boedo tiene carga después del 26/10.
- **Conciliar con el conteo del Excel:** los "Miembros reales" del Excel no coinciden con las cargas del CRM (por ejemplo Devoto: 61 en el Excel el 10/11 contra 49 cargados el 26/10). Hay que decidir cuál es la fuente de verdad. La propuesta es el CRM, porque tiene teléfonos y permite detectar salidas.

## Fase 2 — Reporte semanal automático (prioridad 1)
**Un solo cálculo, dos disparadores:** una función del CRM arma el reporte (todas las métricas de arriba, por comunidad y total) y se dispara de dos formas.
1. **Botón** "Descargar reporte semanal" en Control_Comunidades: genera el Excel en el momento, con el período elegido.
2. **n8n, cada lunes:** llama a la misma función y entrega el Excel.

**Entregable simple:** un Excel con número de versión (V1, V2, ...) y estas hojas: *Resumen* (una fila por comunidad con las métricas), *Miembros* (inicio, nuevos, bajas, final, CRR, churn), *Pauta* (inversión, chats, entradas, cobertura por zona y por anuncio), *Notas* (qué no se pudo calcular y por qué).

**Flujo n8n (4 nodos):** `Programación (lunes 8:00)` → `HTTP: función del CRM` → `Armar Excel` → `Drive / correo / chat`. Credenciales: la misma de Supabase que ya usa el flujo de contactos.

**Dónde entra el agente:** solo para el **resumen en cinco renglones** ("esta semana Palermo bajó la cobertura, el churn de Devoto subió"). Los números nunca los calcula el agente: los recibe ya calculados. Si no hay presupuesto de IA, el reporte sale igual con las cifras.

## Fase 3 — Monitoreo real de métricas compuestas
- **Foto semanal guardada** (tabla `reporte_semanal`): cada reporte deja una fila por comunidad y semana. Permite ver tendencia y comparar, sin recalcular el pasado.
- **Alertas con regla simple, calculadas por el CRM** (no por IA):

| Alerta | Regla (umbral a definir con la PO) |
|---|---|
| Churn en suba | churn de la semana mayor que el de la anterior en más de X puntos |
| CRR bajo | CRR menor que X % |
| Triaje en caída | tasa de triaje menor que X % |
| Cobertura roja | semáforo rojo dos semanas seguidas |
| Datos viejos | más de 8 días sin carga de lista completa de una comunidad |
| Anuncio sin resultados | gasto alto, chats y cero entradas con código |

- **Dónde se ven:** en el mismo Control_Comunidades (una franja de alertas arriba) y por aviso de n8n cuando se activa una.
- **Primero una línea de base:** con 3 o 4 semanas de fotos se fijan los umbrales con datos propios, en lugar de inventarlos.

## Fase 4 — Registro de miembros automático (para churn y CRR)
**El cuello de botella:** WhatsApp no entrega por API la lista de miembros de un grupo o comunidad. Hoy se obtiene leyendo el grupo desde WhatsApp Web (la habilidad `conteo-miembros-comunidad-wsp`, 2 veces por semana) y subiendo el archivo con "Cargar miembros".

**Lo que sí se puede automatizar:**
1. **Que el archivo suba solo:** el conteo deja el CSV en una carpeta de Drive; n8n lo detecta y llama a la función de carga del CRM (con la clave de carga guardada como credencial). Cero clics.
2. **Que corra solo en horario:** el conteo se programa como tarea recurrente (lunes y jueves). Requiere WhatsApp Web con la sesión abierta en una computadora encendida, y es el único paso que depende de un equipo.
3. **Que avise si falta:** la métrica de frescura y su alerta ("Palermo sin carga hace 9 días").
- **Lo que no se puede evitar:** mientras WhatsApp no exponga la lista, alguien o algo tiene que leerla. Se documenta como límite.

## Fase 5 — Pruebas de campaña (objetivos)
Hoy: objetivo Tráfico con destino WhatsApp. Una sola cosa cambia por prueba, mismo presupuesto, misma zona y mismo público, **mínimo 7 días y 100 chats por variante**, y se compara con **los datos del CRM** (costo por entrada, CPMN, triaje), no con los de Meta.

| Prueba | Qué cambia | Qué se espera aprender |
|---|---|---|
| T1. Interacción con mensajes | Optimizar por **conversaciones** en lugar de clics (destino WhatsApp) | Hoy Meta busca clics; si pasa a buscar conversaciones, la cobertura debería subir |
| T2. Clientes potenciales con formulario | Objetivo Leads con formulario de Meta (teléfono y barrio) | **Atribución exacta por anuncio** sin código; mide cuánta gente completa el formulario y luego se une. Requiere avisar por WhatsApp con plantilla aprobada y revisar el consentimiento |
| T3. Enlace con parámetros | Anuncio a un enlace de WhatsApp con `{{ad.id}}` en la URL | Atribución exacta; cambia el formato del anuncio (se pierde la plantilla nativa) |
| T4. Código en la plantilla nativa | Mismo formato, con `PAL-NN` al final del mensaje predefinido | Camino elegido para el piloto: atribución por anuncio dentro del formato actual |

No se recomienda optimizar para "miembros que se unen" mientras no exista una señal de retorno a Meta (hoy el CRM no recibe el identificador de clic de Meta, así que no se pueden mandar esas conversiones).

## Decisión sobre el vínculo anuncio–mensaje (registro del 16/11)
Quedan **descartados** por Juan los caminos A (ID del anuncio desde ManyChat), C (estimación) y D (WhatsApp directo a la API de Meta) de `specs/2026-11-13-centro-de-rendimiento-por-anuncio.md`, y la pregunta en el flow ("¿cuál imagen viste?"). **Elegido:** el camino B, código en la plantilla conversacional nativa de WhatsApp (T4), duplicando la plantilla de cada anuncio. Notas operativas:
- **El MCP de Meta no puede editar esa plantilla.** La herramienta que crea creativos no fija el mensaje de bienvenida, y un creativo publicado no se puede modificar. Se hace en Ads Manager: duplicar el anuncio y editar el **Mensaje predefinido** (campo de 80 caracteres).
- **El código se puede prever antes de que el anuncio aparezca en Windsor:** es la zona (3 letras) más el número con que termina el nombre del anuncio. Un anuncio `..._PALERMO_05` es `PAL-05`.
- **Largo:** el código suma unos 7 caracteres a un mensaje de 80 como máximo: las frases de Palermo y Villa Devoto ya están cerca del tope. Hay que revisar que entre.

## Orden de trabajo y PRs
| # | Entrega | PR | Depende de |
|---|---|---|---|
| 1 | Catálogo automático de anuncios | #73 (abierta) | — |
| 2 | **CRR y churn** | **#74** | Cargas de lista completa |
| 3 | Reporte semanal: función, botón y Excel versionado | por definir | 2 |
| 4 | Flujo n8n semanal (Excel a Drive/correo/chat) | por definir | 3 |
| 5 | Métricas compuestas: CPMN, triaje, frescura | por definir | 2 |
| 6 | Foto semanal y alertas | por definir | 3 y 5 |
| 7 | Carga de miembros automática por n8n | por definir | — |
| 8 | Resumen narrativo con IA | por definir | 3 (con presupuesto aprobado) |

## Decisiones pendientes
1. **Fuente de verdad de los miembros:** cargas del CRM (propuesta) o el conteo del Excel.
2. **Umbrales de las alertas** (se proponen después de 3 o 4 semanas de fotos).
3. **Dónde se entrega el reporte semanal:** Drive, correo o chat, y a quién.
4. **Quién corre el conteo de miembros** y en qué equipo (necesita WhatsApp Web abierto).
5. **Qué pruebas de campaña hacer primero** (se propone T1, y T4 en Palermo).
6. **Si el CPMN reemplaza** a "costo por miembro efectivo" en lo que se entrega al cliente.
