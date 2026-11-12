# Auditoría de métricas del CRM (2026-10-26)

Revisión de cada métrica que muestra el CRM: qué dice la fórmula, de dónde sale el dato y qué límite tiene. Hecha leyendo las funciones de la base y el panel, y cruzando con los números de producción del 26/10 (Control_Comunidades y Overview). Ver también las [definiciones y líneas de base v0](definiciones-y-lineas-de-base-v0.pdf).

**Regla de lectura:** una métrica "correcta" acá significa que la fórmula del panel es la de la base, que el dato de origen es el que dice y que sus límites están escritos. No significa que el número sea bueno.

## Meta Ads (fuente: Windsor, cuenta `TQN - Growing 2 - LC`)

| Métrica | Fórmula | Estado | Límites |
|---|---|---|---|
| Inversión | Suma de `meta_ads_metrica` de las campañas que cuentan (sección Campañas) | Correcta. El desglose por campaña suma lo mismo, al centavo (26/10) | Llega con un día de retraso. Windsor puede corregir días anteriores. Un día sin detalle por campaña hace que el desglose no cubra la tabla (el propio desglose avisa cuánto falta) |
| Conversaciones | Suma de `actions_onsite_conversion_messaging_conversation_started_7d` | Correcta | Ventana de atribución de 7 días: Meta puede mover cifras de días pasados |
| CPMI | Inversión ÷ conversaciones | Correcta (Overview 26/10: $761.836,83 ÷ 212 = $3.593,57) | Sin dato si no hubo conversaciones |
| Clientes potenciales y su costo | `actions_onsite_conversion_lead_grouped`; inversión ÷ clientes potenciales | Correcta | No todas las campañas informan clientes potenciales |
| CTR (todos los clics) | Clics ÷ impresiones | **Retirada de Control_Comunidades en la PR #67** | Contaba todos los clics, no solo los del enlace. El único CTR del panel es "CTR del enlace" (clics en el enlace ÷ impresiones de los días con dato). La base sigue guardando `clics` y `ctr_anuncio_pct` |
| Clics en el enlace (PR #65, `db/036`) | Suma de `actions_link_click` | Nueva. Para el 02 al 10/11 Ads Manager informa 11.615 en la campaña de WhatsApp de Cortado: es la cifra de control | Hasta que el campo esté en la tarea de Windsor y se vuelvan a traer los días, figura "Sin fuente" (NULL, nunca 0). Con el dato solo en parte de los días, el panel avisa cuántos faltan |
| CTR del enlace y costo por clic en el enlace | Clics en el enlace ÷ impresiones; inversión ÷ clics en el enlace | Nueva | Se calculan solo con los días que ya traen el dato, para no dividir clics parciales por un gasto completo |
| Clic → conversación | Conversaciones ÷ clics en el enlace | Nueva (02–10/11: 201 ÷ 11.615 = 1,7 %) | Solo se calcula si TODOS los días del período traen los clics en el enlace. Mezcla la ventana de atribución de 7 días de las conversaciones con clics del día |

## ManyChat y CRM (fuente: webhook)

| Métrica | Fórmula | Estado | Límites |
|---|---|---|---|
| Entradas al flow | Personas cuyo **primer** evento cae en el período, atribuidas a la comunidad de ese evento | Correcta | Incluye pruebas del equipo y personas que no llegaron por la pauta. WhatsApp e Instagram cuentan como personas distintas |
| Trigger entregados | Personas distintas que recibieron el primer mensaje | Correcta | |
| Clics en "Me sumo" | Personas distintas que tocaron el botón | Correcta | Se registra desde el 09/10: un período anterior queda subcontado |
| CTR del botón | Clics en "Me sumo" ÷ trigger entregados | Correcta | Mismo límite de fecha de los clics |
| Desfasaje conversaciones → flow (PR #65) | (Conversaciones − entradas al flow) ÷ conversaciones | Reemplaza a "Entradas ÷ conversaciones" (es 100 % − esa cobertura). Para el 02 al 10/11: (201 − 62) ÷ 201 = 69,2 % | Es una medida de cobertura del tracking, no un KPI ni la tasa de triaje. Puede dar negativo (Palermo el 04/11: 110 entradas contra 21 conversaciones). El total no incluye las campañas globales, que no tienen entradas propias |
| Chats sin registrar (PR #65) | Conversaciones − entradas al flow, en personas | Nueva (02–10/11: Boedo 78, Devoto 30, Palermo 31, total 139) | El mismo desfasaje en números absolutos, para no leer mal un porcentaje con pocos casos |
| Sin clasificar (PR #64/#65) | Personas que escribieron al número y no eligieron comunidad | En la tabla solo aparece en el total del cliente (no pertenecen a ninguna comunidad) | Sigue en cero hasta que ManyChat avise de quienes no eligen (flow de "sin clasificar") |
| Clic en "Me sumo" ÷ entradas | Clics ÷ entradas | Correcta | |
| Contactos repetidos | Personas con más de un evento aceptado | Correcta | No sabe el motivo (prueba, reingreso, doble toque) |

## Miembros y salud de los grupos (fuente: listas cargadas a mano)

| Métrica | Fórmula | Estado | Límites |
|---|---|---|---|
| MF (miembros finales) | Personas que siguen en la última lista completa cargada | Correcta (26/10: 16, 51, 41, 49 = 157). Se puede editar a mano desde Overview: si no coincide con la última lista, gana lo editado | Es una foto del día de la carga |
| MI (miembros iniciales) | Lista de partida del 14/10 | Correcta | Fija: no se actualiza sola |
| Crecimiento neto | MF − MI | Correcta | Mide desde el 14/10 |
| Bajas | Salidas detectadas al cargar una lista completa, con fecha dentro del período | Correcta desde la segunda carga completa | La fecha de salida es el **día de la carga**, no el día real en que la persona se fue. Un período que no incluya ese día muestra 0 |
| Tasa de fuga | Bajas ÷ (bajas + MF actual) | Correcta con límite | Usa el MF de hoy, no el del cierre del período: es aproximada para períodos pasados |
| CPME / costo por miembro neto | Inversión ÷ (MF − MI) | Correcta (Overview 26/10: $761.836,83 ÷ 78 = $9.767,14) | Solo es comparable si la inversión es del mismo tramo que el crecimiento (desde el 14/10) |
| Costo por entrada y por clic en "Me sumo" | Inversión ÷ entradas y ÷ clics | Correcta | Heredan los límites de entradas y clics |

## Números del puesto (definiciones; no tienen pestaña propia en el panel)

| Métrica | Fórmula | Límites |
|---|---|---|
| % de ingresos sin toque humano | Personas cuyo primer evento no lleva la marca `_recuperado` ÷ personas del período | Cota superior: no mide correcciones manuales de estado ni la carga de MI y MF |
| Entradas al flow (I1) | Personas que entran al flow en el período | **KPI principal.** Las campañas son de WhatsApp y el disparador es una frase armada: la entrada al flow es el primer paso medible de cada persona |
| Tasa de triaje | I3 ÷ I1: ingresos al grupo ÷ entradas al flow, por comunidad; el total suma, no promedia. I2 ÷ I1 (clic en "Me sumo") es el paso del medio | Definición del 27/10, **reemplaza a la v0** (entradas ÷ conversaciones). I3 sale de las fechas de las listas de miembros (sin contar la lista de partida); si una lista no trae fecha, se usa el día de la carga |
| Conversaciones de Meta | Suma de las conversaciones iniciadas | Dato de contexto, no es el KPI principal |
| Horas de carga manual | Minutos de trabajo manual anotados | Necesita 5 días hábiles de registro para ser línea de base; el registro se lleva fuera del CRM |
| TRG por grupo | Miembros que siguen ÷ (siguen + bajas) | **Definición propuesta, por confirmar** |
| CPMR y K-Factor | — | Sin fuente: faltan los pulsos de retención y el enlace único por miembro |

## Errores encontrados y qué se hizo

| Hallazgo | Efecto | Solución |
|---|---|---|
| Las vistas devolvían `comunidad_id` y el panel buscaba `id` | El selector de comunidad de Control_Comunidades y de Base_Limpia no filtraba, y el botón Guardar de Mi/Mf en Overview no sabía a qué comunidad apuntar | PR #58: las filas llevan `id` |
| Base_Limpia y Data_Deduplicada pedían todo sin avisar del tope de 1000 filas de la API | Una lista larga se mostraba recortada sin decirlo | PR #58: piden el total y avisan |
| "Entradas ÷ conversaciones" se llamaba tasa de triaje | Se podía confundir con el número del puesto (más de 50 %), que cuenta miembros | Se aclaró en su ayuda: no es la tasa de triaje del puesto (ingresos al grupo ÷ entradas al flow) |
| Nada controla automáticamente que las métricas coincidan con sus fuentes | Un desvío se ve recién en una reunión | Se armó una pestaña "Objetivos" con 8 chequeos y se retiró por decisión del usuario (PR #63). Hoy el desglose avisa cuánto falta cuando no coincide con la tabla |

## Para decidir

1. **TRG:** confirmar la definición (propuesta: miembros que siguen ÷ siguen + bajas).
2. **Fecha de las bajas:** si se quiere la fecha real de salida, hay que pedirla en la carga o cargar la lista cada vez que se detecta una salida.
3. **Entradas que no vienen de la pauta:** para que la tasa de triaje no se distorsione, definir cómo separar entradas orgánicas de las pagas.
4. **Documento de líneas de base:** la v0 define el triaje como entradas ÷ conversaciones. Hay que sacar una v1 con la definición nueva (I3 ÷ I1) y el KPI principal, y pedir la aprobación del manager.
