# Spec — Centro de rendimiento por anuncio (código por anuncio, datos de Windsor, panel e IA)

Estado: **etapa 1 armada en la PR #70 (2026-11-13); etapas 2 a 5 por construir.**
Pedido de Juan Marroncle (2026-11-13), a partir del análisis de tracking para el 1:1 con la PO del mismo día.

## Para qué

Hoy el CRM sabe **la zona que eligió la persona**, pero no **el anuncio que vio**. Meta cuenta 201 conversaciones iniciadas y el CRM registra 62 entradas al flow (02 al 10/11, 31 %). Sin saber de qué anuncio viene cada persona no se puede decir qué anuncio trae gente que entra a la comunidad, ni dónde está el hueco de Boedo (16 %) o de Palermo (14 %).

Objetivo: una sección aparte del panel, **debajo de Control_Comunidades**, que muestre el rendimiento **por anuncio** (gasto de Meta + entradas del CRM) y ayude a decidir optimizaciones, con una capa de IA que ayude a leerlo.

Principio: **no perder ningún dato**. Todo lo que llega queda guardado tal cual; lo nuevo es un dato extra, nunca un filtro.

## Resumen de las etapas

| # | Etapa | PR | Depende de |
|---|---|---|---|
| 1 | Código por anuncio (piloto en Palermo) | #70 | — |
| 2 | Datos por anuncio desde Windsor | por definir | — (puede ir en paralelo a la 1) |
| 3 | Sección "Rendimiento" (tabla por anuncio y filtros) | por definir | 1 y 2 |
| 4 | Alertas y comparaciones | por definir | 3 |
| 5 | IA con OpenRouter (prueba de 5 USD por mes) | por definir | 3 (mejor con la 4) |

Cada etapa es una PR numerada, probada en su rama antes de subir.

## Etapa 1 — Código por anuncio (PR #70)

Cada anuncio de Meta tiene su plantilla de mensaje, que termina con un código corto (`P1` a `P4` en Palermo). La persona lo manda en su primer mensaje, ManyChat lo entrega en `contact.last_input_text` y el webhook lo reconoce contra el catálogo.

- `db/039`: tabla `anuncio_codigo`, columna `anuncio_codigo` en `evento_crudo` y `ingreso_sin_clasificar`, función `entradas_por_anuncio()`.
- La comunidad se sigue decidiendo por la frase. El código es un dato extra: si falta, el contacto entra igual y queda "sin anuncio".
- Solo cuentan los códigos del catálogo y activos.
- Guía de uso: `docs/how-to/codigo-por-anuncio-palermo.md`.

**Criterio de éxito del piloto** (una semana con las 4 plantillas activas): qué porcentaje de las entradas de Palermo trae código reconocido, y cuántas entradas y "sin clasificar" aparecen por anuncio. **Umbral para seguir con Devoto y Boedo: a definir con la PO.** Si el porcentaje es bajo se evalúa otra forma (por ejemplo, el código al principio del mensaje).

## Etapa 2 — Datos por anuncio desde Windsor

Hoy Windsor trae los datos por **conjunto de anuncios** (`adset_name`). Se piden además `ad_id` y `ad_name` y se guardan **en una tabla nueva**, un registro por día y anuncio. La sincronización actual por conjunto no se toca.

- Campos por anuncio: fecha, `campaign_name`, `adset_name`, `ad_id`, `ad_name`, gasto, impresiones, clics, clics en el enlace (`actions_link_click`), conversaciones iniciadas (`messaging_conversation_started_7d`) y, si Windsor los entrega, alcance y frecuencia.
- El anuncio se vincula al código por **nombre normalizado** (mismo criterio que `comunidad_meta_origen`, db/010): `anuncio_codigo.anuncio_nombre` ↔ `ad_name`. Para que sea estable se guarda también el `ad_id` en el catálogo la primera vez que se cruza.
- La zona se toma del conjunto de anuncios (ya mapeado en `comunidad_meta_origen`).
- Idempotente: reimportar un día no duplica ni borra otros días (misma regla que PR #68).
- Los datos llegan **al día siguiente** (Windsor). Para "hoy" sigue sirviendo el panel en vivo.

Riesgo a verificar al empezar: que Windsor entregue el campo de conversaciones a nivel anuncio con el mismo valor que a nivel conjunto (se comprueba sumando los anuncios de un conjunto contra el conjunto, como se hizo con los clics: 11.616 vs 11.615).

## Etapa 3 — Sección "Rendimiento"

Nueva sección del menú, **debajo de Control_Comunidades**. Una fila por anuncio, con filtros de cliente, zona, campaña y fechas (hora de Argentina, mismos selectores del resto del panel).

Columnas (en el orden del recorrido de la persona, como en PR #65):

| Grupo | Columnas |
|---|---|
| Anuncio | código, nombre, zona, estado |
| Inversión | gasto, impresiones, frecuencia |
| Interés | clics en el enlace, CTR del enlace, costo por clic en el enlace |
| Chats | conversaciones de Meta, costo por chat |
| CRM | entradas por código, "sin clasificar" por código, costo por entrada |
| Calidad | entradas ÷ chats (cobertura por anuncio), con semáforo |

Reglas:
- Un anuncio **sin código** (todavía no instrumentado) muestra las columnas de Meta y deja las del CRM en "—", no en 0.
- Una fila de "sin código" por zona junta las entradas que no se pudieron atribuir, para que el total cierre con Control_Comunidades.
- "Pocos datos": menos de 20 chats no se interpreta (mismo criterio que el semáforo de PR #69).
- Los umbrales del semáforo siguen pendientes de aprobación de la PO.
- Acceso igual al resto: usuarios del CRM por rol (db/031). Solo conteos, nunca teléfonos.

## Etapa 4 — Alertas y comparaciones

Reglas simples, calculadas por el CRM (no por IA), visibles en la misma sección:
- Anuncio con gasto alto y cero entradas en el período.
- Anuncio con muchos chats y cobertura baja (posible problema de plantilla o de destino).
- Anuncio con frecuencia alta o CTR en caída frente a la semana anterior.
- Anuncio sin datos de Meta pero con entradas (código viejo o nombre cambiado).

Comparaciones: anuncio contra anuncio dentro de una zona, semana contra semana, y zona contra zona (con el aviso de siempre: la zona del CRM es la que eligió la persona).
Opcional: un registro de "optimización realizada" (fecha, anuncio, qué se cambió) para ver el efecto después.

## Etapa 5 — IA con OpenRouter (prueba de 5 USD por mes)

Retoma `specs/2026-10-19-funciones-de-ia.md` y le da forma de prueba acotada.

**Proveedor.** La spec del 19/10 recomendaba la API de Claude directa para datos de clientes y dejaba OpenRouter para experimentos. Juan eligió OpenRouter para la prueba. Para que sea coherente:
- Solo se envían **datos agregados por anuncio y zona** (gasto, clics, chats, entradas, cobertura). Nunca teléfonos, nombres ni mensajes de personas.
- En la cuenta de OpenRouter se desactiva el uso de los datos para entrenamiento y se prefieren proveedores sin retención.
- La llamada pasa por una capa propia del CRM, de modo que cambiar a la API de Claude directa sea cambiar una configuración.
- **Decisión pendiente:** confirmar con la PO si el uso de OpenRouter con métricas agregadas de clientes está aprobado. Los nombres de anuncios y de comunidades son datos de clientes, aunque no son personales.

**Cómo se construye.**
- Una Edge Function llama a OpenRouter. La clave vive como secreto de Supabase; **nunca en el navegador ni en el repositorio**.
- Tope de gasto doble: clave de OpenRouter con **límite mensual de 5 USD** y registro propio en una tabla `consulta_ia` (fecha, función, modelo, tokens, costo estimado, quién la pidió). Al llegar al tope la función responde que no hay presupuesto, sin llamar al modelo.
- **El modelo no calcula números:** redacta sobre cifras que el CRM ya calculó. Cada texto muestra los números en que se apoya.
- Todo texto generado se marca "generado por IA" y es una propuesta; la decisión es de la persona.

**Funciones de la prueba, en este orden.**
1. Resumen semanal por zona en lenguaje simple.
2. Hipótesis sobre anuncios con alertas (qué mirar primero), como las 10 hipótesis del 13/11.
3. Borrador del reporte para el 1:1 o para la PO.
4. Preguntas sobre las cifras del panel, con consultas predefinidas y solo lectura.

**Cómo se mide.** Línea de base antes de empezar: horas por semana que lleva armar el reporte y leer los anuncios a mano. Después: horas con la IA y costo por semana. Sin línea de base no se declara ahorro (regla de la carta oferta). La meta se fija cuando exista la línea de base.

**Lo que hace Juan:** crear la cuenta de OpenRouter, cargar los 5 USD, crear la clave con límite mensual y cargarla como secreto en Supabase (el comando se le da; la clave no pasa por el chat).

## Qué no incluye

- Atribución de las personas que borran o cambian el código ni de quienes abren el chat y no envían nada: hay que decirlo en el panel, no taparlo.
- Datos históricos anteriores al código: las entradas viejas quedan "sin código".
- Devoto y Boedo antes de cerrar el piloto de Palermo.
- Clasificación de mensajes de personas con IA (sigue última y requiere Legal).

## Riesgos

| Riesgo | Qué hacemos |
|---|---|
| Pocas entradas llegan con código y el panel muestra solo una parte | Medir el porcentaje en el piloto; el panel lo muestra siempre al lado de la tabla |
| Editar un anuncio activo reinicia su aprendizaje | Cambiar de a un anuncio o aprovechar anuncios nuevos |
| Nombres de anuncios que cambian en Meta | Vincular por `ad_id` además del nombre |
| La IA inventa cifras | Solo redacta sobre números del CRM y los muestra |
| Se pasa del presupuesto de IA | Límite en OpenRouter más tope propio con registro |

## Decisiones pendientes

1. Umbral del piloto para extender a Devoto y Boedo (propuesta: a definir con la PO tras la primera semana).
2. Aprobación de la PO para usar OpenRouter con métricas agregadas de clientes.
3. Modelo a usar en la prueba (se elige con los precios del día en que se implemente).
4. Umbrales del semáforo de cobertura (ya pendientes desde la PR #69).
5. Si el panel de rendimiento muestra todas las zonas desde el comienzo (propuesta) o solo Palermo mientras dura el piloto.
