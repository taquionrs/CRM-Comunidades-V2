# Embudo mensual de comunidad en n8n (alcance → miembros nuevos)

Una vez por mes, n8n calcula para cada comunidad el embudo **alcance → entradas al flow → clics en "Me sumo" → miembros nuevos**, lo guarda en el CRM y calcula la tasa de captación medida que después usa Norte-kpi. Diseño completo y reglas: [`specs/2026-10-16-embudo-de-comunidad.md`](../../specs/2026-10-16-embudo-de-comunidad.md).

Flujo para importar: [`docs/n8n/embudo-comunidad-mensual.workflow.json`](../n8n/embudo-comunidad-mensual.workflow.json).

> **Estado:** el flujo necesita las funciones de base de datos de `db/023`, que todavía **no están escritas ni aplicadas**. Sin ellas, el flujo se importa pero falla en el paso "calcular embudo". Ver "Contrato de las funciones" al final.

## Qué hace, paso a paso
1. **Define la ventana:** el mes anterior completo (o las fechas que pongas a mano). La ventana tiene que estar cerrada.
2. **Lee del CRM** las comunidades, a qué campaña de Meta pertenece cada una (`comunidad_meta_origen`) y la cuenta de Meta de cada cliente.
3. **Pide a Windsor el alcance** de toda la ventana (`reach`, sin desglosar por día).
4. **Python: alcance por comunidad.** Asigna el alcance a cada comunidad. Si no puede hacerlo con seguridad, la comunidad queda **sin alcance con el motivo**, nunca con un número supuesto:
   - Windsor devolvió filas por día (el alcance no se puede sumar).
   - Hay varios conjuntos de anuncios en una misma comunidad.
   - La comunidad o el cliente no tienen campaña o cuenta de Meta cargada.
   - Windsor no respondió o no trajo datos de esa campaña.
5. **Calcula el embudo en el CRM** (entradas, "Me sumo", miembros nuevos) y decide si la ventana es **elegible**.
6. **Si el modo es "real":** guarda una fila por comunidad en `embudo_comunidad_periodo`. En modo "prueba" no guarda nada.
7. **Python: tasas y archivo.** Con todas las ventanas elegibles calcula la tasa de captación (rango p25–p75). Solo la da por válida con **5 o más ventanas de 2 o más clientes**.
8. **Abre una PR a Norte-kpi** con `src/data/comunidadMedida.js` (solo en modo real, con muestra suficiente y si hay algo nuevo). **Nunca mergea.**

Solo se manejan conteos: ningún paso toca teléfonos ni ids de Instagram.

## Antes de usarlo (una vez)
1. **Aplicar `db/023`** (tabla `embudo_comunidad_periodo` y las dos funciones). Va como PR aparte, con su ensayo.
2. **Credenciales en n8n** (el flujo las pide con el nombre exacto que aparece entre paréntesis):
   - **Supabase CRM (Custom Auth):** la misma que ya usás en el flujo de contactos de WhatsApp.
   - **Windsor API key (Query Auth):** tipo *Query Auth*, nombre del parámetro `api_key`, valor tu API key de Windsor.
   - **GitHub (Header Auth):** tipo *Header Auth*, nombre `Authorization`, valor `Bearer <token>`. El token necesita permiso de escritura en el repo `norte-kpi` (solo para crear la rama, subir el archivo y abrir la PR).
3. **Python nativo:** los nodos "Python" usan el runner nativo de n8n. Si tu n8n usa el Python anterior (Pyodide), cambiá el lenguaje del nodo a "Python (Pyodide)"; el código está preparado para los dos, pero solo se probó con Python estándar fuera de n8n.
4. **Importar** el JSON (menú ⋯ → *Import from file*) y asignar las credenciales en los nodos que las piden.

## Primera corrida: validar el alcance (modo prueba)
El flujo viene en **modo `prueba`** (en el nodo *Definir ventana*, `MODO = 'prueba'`): calcula y muestra todo, pero **no escribe en la base ni abre PR**.

1. Elegí un mes cerrado de Cortado y en *Definir ventana* completá `DESDE_MANUAL` y `HASTA_MANUAL` (por ejemplo `2026-09-01` y `2026-09-30`).
2. Tocá **Correr a mano**.
3. En el nodo *Python: alcance por comunidad*, mirá el alcance de cada comunidad y compará **uno** con Ads Manager para las mismas fechas (columna *Alcance*, a nivel de campaña o conjunto de anuncios). **Tienen que coincidir** (un margen chico es normal).
   - Si coinciden: el alcance sirve y se puede pasar a modo real.
   - Si no coinciden o aparece "Windsor devolvió filas por día": no pasar a modo real. El plan B es estimar el alcance desde las impresiones y la frecuencia, y eso quedaría marcado como *estimado*, no medido (decisión pendiente en la spec).
   - Si el campo `reach` no aparece: verificá el nombre en la lista de campos de Windsor para tu cuenta.
4. Mirá en *Juntar embudo* qué ventanas salen **elegibles** y cuáles no (con el motivo).

## Pasar a producción
1. En *Definir ventana*, poné `MODO = 'real'` y dejá `DESDE_MANUAL` / `HASTA_MANUAL` **vacíos** (así toma el mes anterior).
2. Activá el flujo. Corre solo el **día 2 de cada mes a las 6:00** (hora de Buenos Aires).
3. Correrlo dos veces para el mismo mes **no duplica** nada: la base actualiza la fila existente.

## Si algo falla
| Síntoma | Causa probable |
|---|---|
| Falla en *calcular embudo* con 404 | Todavía no se aplicó `db/023` |
| Todas las comunidades "sin alcance" | Windsor sin respuesta, API key mal cargada, o filas por día |
| Una comunidad sin alcance | Falta `comunidad_meta_origen` o hay varios conjuntos de anuncios |
| Ninguna ventana elegible | Falta la carga de lista completa al inicio y al final del mes (misma regla que las bajas reales) |
| *Python: tasas y archivo* da `suficiente: false` | Todavía no hay 5 ventanas elegibles de 2 clientes: es lo esperado al principio |
| No se abre la PR | Modo prueba, muestra insuficiente, nada nuevo respecto del archivo actual, o el token de GitHub sin permiso |

## Contrato de las funciones (para `db/023`)
El flujo asume estas dos funciones en el schema `crm_comunidades_v2`, ejecutables con `service_role`:

**`calcular_embudo_comunidad(p_comunidad uuid, p_desde date, p_hasta date)`** devuelve **una fila** con:
`comunidad_id uuid`, `entradas_flow int`, `clics_me_sumo int`, `miembros_nuevos_total int`, `miembros_nuevos_con_flow int`, `fechas_aproximadas boolean`, `elegible boolean`, `motivo_no_elegible text`.
Es `security definer` y devuelve **solo números**.

**`guardar_embudo_comunidad(p_cliente uuid, p_comunidad uuid, p_desde date, p_hasta date, p_alcance bigint, p_entradas_flow int, p_clics_me_sumo int, p_miembros_total int, p_miembros_con_flow int, p_fechas_aproximadas boolean, p_elegible boolean, p_motivo text, p_fuente_alcance text)`**: inserta o actualiza la fila de `embudo_comunidad_periodo` para `(comunidad, desde, hasta)`.

Y la tabla `embudo_comunidad_periodo` con las columnas de la spec, incluyendo `cliente_id`, `desde`, `hasta`, `alcance`, `miembros_nuevos_total`, `miembros_nuevos_con_flow`, `fechas_aproximadas` y `elegible` (el flujo las lee por la API REST).
