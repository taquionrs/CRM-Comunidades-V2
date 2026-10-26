# Auditoría de métricas del CRM (2026-10-26)

Revisión de cada métrica que muestra el CRM: qué dice la fórmula, de dónde sale el dato y qué límite tiene. Hecha leyendo las funciones de la base y el panel, y cruzando con los números de producción del 26/10 (Control_Comunidades y Overview). Ver también las [definiciones y líneas de base v0](definiciones-y-lineas-de-base-v0.pdf).

**Regla de lectura:** una métrica "correcta" acá significa que la fórmula del panel es la de la base, que el dato de origen es el que dice y que sus límites están escritos. No significa que el número sea bueno.

## Meta Ads (fuente: Windsor, cuenta `TQN - Growing 2 - LC`)

| Métrica | Fórmula | Estado | Límites |
|---|---|---|---|
| Inversión | Suma de `meta_ads_metrica` de las campañas que cuentan (sección Campañas) | Correcta. El desglose por campaña suma lo mismo, al centavo (26/10) | Llega con un día de retraso. Windsor puede corregir días anteriores. Un día sin detalle por campaña hace que el desglose no cubra la tabla (lo avisa el chequeo "desglose vs tabla") |
| Conversaciones | Suma de `actions_onsite_conversion_messaging_conversation_started_7d` | Correcta | Ventana de atribución de 7 días: Meta puede mover cifras de días pasados |
| CPMI | Inversión ÷ conversaciones | Correcta (Overview 26/10: $761.836,83 ÷ 212 = $3.593,57) | Sin dato si no hubo conversaciones |
| Clientes potenciales y su costo | `actions_onsite_conversion_lead_grouped`; inversión ÷ clientes potenciales | Correcta | No todas las campañas informan clientes potenciales |
| CTR (todos los clics) | Clics ÷ impresiones | Correcta | Cuenta todos los clics, no solo los del enlace: no es el CTR de enlace de Ads Manager |

## ManyChat y CRM (fuente: webhook)

| Métrica | Fórmula | Estado | Límites |
|---|---|---|---|
| Entradas al flow | Personas cuyo **primer** evento cae en el período, atribuidas a la comunidad de ese evento | Correcta | Incluye pruebas del equipo y personas que no llegaron por la pauta. WhatsApp e Instagram cuentan como personas distintas |
| Trigger entregados | Personas distintas que recibieron el primer mensaje | Correcta | |
| Clics en "Me sumo" | Personas distintas que tocaron el botón | Correcta | Se registra desde el 09/10: un período anterior queda subcontado |
| CTR del botón | Clics en "Me sumo" ÷ trigger entregados | Correcta | Mismo límite de fecha de los clics |
| Entradas ÷ conversaciones | Entradas al flow ÷ conversaciones de Meta | Correcta como cuenta, **mal nombrada** antes | Puede pasar de 100 % (Palermo: 110 entradas contra 21 conversaciones). Ya **no se llama tasa de triaje** |
| Clic en "Me sumo" ÷ entradas | Clics ÷ entradas | Correcta | |
| Contactos repetidos | Personas con más de un evento aceptado | Correcta | No sabe el motivo (prueba, reingreso, doble toque) |

## Miembros y salud de los grupos (fuente: listas cargadas a mano)

| Métrica | Fórmula | Estado | Límites |
|---|---|---|---|
| MF (miembros finales) | Personas que siguen en la última lista completa cargada | Correcta (26/10: 16, 51, 41, 49 = 157). El chequeo "MF vs listas" avisa si alguien lo editó a mano | Es una foto del día de la carga |
| MI (miembros iniciales) | Lista de partida del 14/10 | Correcta | Fija: no se actualiza sola |
| Crecimiento neto | MF − MI | Correcta | Mide desde el 14/10 |
| Bajas | Salidas detectadas al cargar una lista completa, con fecha dentro del período | Correcta desde la segunda carga completa | La fecha de salida es el **día de la carga**, no el día real en que la persona se fue. Un período que no incluya ese día muestra 0 |
| Tasa de fuga | Bajas ÷ (bajas + MF actual) | Correcta con límite | Usa el MF de hoy, no el del cierre del período: es aproximada para períodos pasados |
| CPME / costo por miembro neto | Inversión ÷ (MF − MI) | Correcta (Overview 26/10: $761.836,83 ÷ 78 = $9.767,14) | Solo es comparable si la inversión es del mismo tramo que el crecimiento (desde el 14/10) |
| Costo por entrada y por clic en "Me sumo" | Inversión ÷ entradas y ÷ clics | Correcta | Heredan los límites de entradas y clics |

## Objetivos del puesto (sección nueva, db/033)

| Métrica | Fórmula | Límites |
|---|---|---|
| % de ingresos sin toque humano | Personas cuyo primer evento no lleva la marca `_recuperado` ÷ personas del período | Cota superior: no mide correcciones manuales de estado ni la carga de MI y MF |
| Tasa de triaje (I1, I2, I3) | Entradas, clics en "Me sumo" o ingresos al grupo ÷ conversaciones de Meta, por comunidad; el total suma, no promedia | **I3 es la definición de la carta.** Sale de las fechas de las listas de miembros (sin contar la lista de partida); si una lista no trae fecha, se usa el día de la carga |
| Horas de carga manual | Minutos registrados a mano | Necesita 5 días hábiles de registro para ser línea de base |
| TRG por grupo | Miembros que siguen ÷ (siguen + bajas) | **Definición propuesta, por confirmar** |
| CPMR y K-Factor | — | Sin fuente: faltan los pulsos de retención y el enlace único por miembro |

## Errores encontrados y qué se hizo

| Hallazgo | Efecto | Solución |
|---|---|---|
| Las vistas devolvían `comunidad_id` y el panel buscaba `id` | El selector de comunidad de Control_Comunidades y de Base_Limpia no filtraba, y el botón Guardar de Mi/Mf en Overview no sabía a qué comunidad apuntar | PR #58: las filas llevan `id` |
| Base_Limpia y Data_Deduplicada pedían todo sin avisar del tope de 1000 filas de la API | Una lista larga se mostraba recortada sin decirlo | PR #58: piden el total y avisan |
| "Entradas ÷ conversaciones" se llamaba tasa de triaje | Se podía confundir con el número del puesto (más de 50 %), que cuenta miembros | Esta PR: se aclara en su ayuda y se agrega la tasa de triaje con I1, I2 e I3 en Objetivos |
| Nada controlaba que las métricas coincidan con sus fuentes | Un desvío se veía recién en una reunión | Esta PR: 8 chequeos de integridad en Objetivos (desglose vs tabla, Windsor al día, eventos recientes, errores de planilla, gasto sin comunidad, MI y MF, bajas calculables, MF vs listas) |

## Para decidir

1. **TRG:** confirmar la definición (propuesta: miembros que siguen ÷ siguen + bajas).
2. **Fecha de las bajas:** si se quiere la fecha real de salida, hay que pedirla en la carga o cargar la lista cada vez que se detecta una salida.
3. **Entradas que no vienen de la pauta:** para que la tasa de triaje no se distorsione, definir cómo separar entradas orgánicas de las pagas.
