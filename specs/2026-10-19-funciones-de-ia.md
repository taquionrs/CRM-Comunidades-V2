# Funciones de IA en el CRM (entrada de roadmap)

**Estado:** idea anotada el 19/10/2026. No hay nada construido ni decidido todavía.

## Objetivo
Sumar al CRM funciones de IA que **bajen el costo de operar cada comunidad**, con línea de base declarada antes y medición después (regla de la carta oferta del rol: "sin línea de base no hay claim de productividad").

## Proveedor: a decidir
| Opción | A favor | En contra |
|---|---|---|
| **Claude API directo** | Menos intermediarios entre los datos del cliente y el modelo | Un solo proveedor de modelos |
| **OpenRouter** | Una sola clave para muchos modelos; útil para probar y comparar | Suma un intermediario por el que pasan los datos |

Recomendación para datos de clientes: **Claude API directo**. OpenRouter queda como opción para experimentos con datos que no sean de clientes.

## Cómo se construiría
- Las llamadas a la IA salen de una **función del servidor** (Edge Function de Supabase), **nunca desde el navegador**. La clave del proveedor se guarda como secreto de esa función, no en el panel ni en el repositorio.
- El panel llama a esa función con el mismo esquema de acceso del resto (clave de carga hoy; usuarios cuando exista el login).
- **Cada consulta queda registrada en "Consultas"**: fecha, función, modelo, tokens, costo estimado y quién la pidió. Con un **tope de gasto mensual** que corta las llamadas.
- **El modelo no calcula números: solo redacta sobre cifras que el CRM ya calculó**, y cada texto muestra de dónde sale el dato. Así se evita que invente cifras.

## Privacidad (regla de la casa)
- **No se envían teléfonos, nombres ni textos de personas** al proveedor. Solo datos agregados (totales por comunidad y período) o anonimizados.
- Cualquier función que necesite datos nominados se valida antes con **Legal** (consentimiento y uso de datos).

## Funciones candidatas, en orden de prioridad
1. **Resumen semanal del tablero por comunidad**, en lenguaje simple (solo datos agregados). Reemplaza el armado manual del reporte.
2. **Alertas de anomalías**: una comunidad sin triggers con tráfico, caída de entradas, errores en la planilla, rechazos nuevos.
3. **Preguntas en lenguaje natural sobre las métricas**, con consultas predefinidas y solo lectura (por ejemplo, "¿cuántas entradas por WhatsApp tuvo Palermo esta semana?").
4. **Borradores de mensajes** (pulsos de retención, mensajes del bot) siempre revisados por una persona antes de usarse.
5. **Clasificación de los mensajes que escriben las personas**: requiere anonimizar y validar con Legal. Va última.

## Cómo se mide
- **Línea de base (antes):** horas por semana de armado de reportes y de lectura del tablero por comunidad.
- **Después:** horas con la IA y costo de IA por comunidad.
- La meta se define cuando exista la línea de base.

## Depende de
- Decisión del proveedor y presupuesto mensual.
- Login con acceso por usuario (`db/005`), para saber quién consulta.
- Definiciones de métricas cerradas (documento de definiciones).
- Validación de Legal para cualquier dato nominado.

## Decisiones pendientes
1. Proveedor: Claude API directo u OpenRouter.
2. Presupuesto mensual y tope de gasto.
3. Primera función a construir (propuesta: el resumen semanal).
