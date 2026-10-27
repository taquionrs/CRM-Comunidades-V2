# Spec — Embudo de comunidad (alcance → miembros nuevos)

Estado: **borrador para revisión (2026-10-16)**. Nada de esto está construido. Las decisiones marcadas con ⚖️ las tiene que tomar una persona antes de implementar.

## Para qué

Hoy no se sabe qué pasa entre "la pauta llegó a una persona" y "esa persona está en el grupo de WhatsApp". Esta spec define un **embudo medido**, calculado una sola vez, que usan dos sistemas:

- **CRM de Comunidades:** una vista que muestra cuánta gente pasa de un escalón al siguiente y **dónde se pierde**.
- **Norte-kpi:** reemplaza la tasa de captación de Comunidad (hoy una constante de 4%, "estimación interna") por una tasa medida con datos propios.

Un solo cálculo y una sola fuente de verdad: los números del CRM y los de Norte-kpi no pueden contradecirse.

## El embudo

Cada escalón es un **conteo de personas** (no eventos) de una comunidad en una ventana de fechas.

| # | Escalón | Qué cuenta | Fuente | Ojo |
|---|---|---|---|---|
| 1 | **Alcance** | Personas únicas a las que llegó la pauta | Windsor.ai (`reach`) | **No se puede sumar día por día** (se contaría varias veces a la misma persona): se pide para la ventana completa. Hay que validarlo contra Ads Manager |
| 2 | **Entradas al flow** | Personas distintas que entraron al flow de ManyChat | CRM (`clics_unicos`, first-contact) | Dentro de cada cliente |
| 3 | **Clics en "Me sumo"** | Personas distintas que tocaron el botón | CRM (`clic_me_sumo`) | Mide el toque del botón, no el ingreso al grupo |
| 4 | **Miembros nuevos** | Personas que ingresaron al grupo dentro de la ventana | CRM (`miembro_comunidad.fecha`, carga de miembros) | Ver "Dos medidas de miembros nuevos" |

Datos informativos que se muestran pero **no entran en ninguna tasa**: inversión, impresiones, clics del anuncio, conversaciones iniciadas, clientes potenciales de Meta y triggers entregados (todos ya existen en `comunidad_performance_rango`).

### Tasas

Las tasas **no se guardan**: se calculan al leer, a partir de los conteos.

- Entre escalones: `entradas / alcance`, `me_sumo / entradas`, `miembros_nuevos / me_sumo`.
- **Tasa de captación (punta a punta)** = `miembros nuevos / alcance`. Es la que usa Norte-kpi.

Si el denominador es 0 o falta el alcance, la tasa queda **vacía** (nunca 0 ni un valor inventado).

### Dos medidas de miembros nuevos ⚖️

No todos los que entran al grupo vienen de la pauta, y de los que sí vienen no siempre se puede probarlo:

- **`miembros_nuevos_total`**: todos los ingresos de la ventana. **Sobreestima**, porque incluye gente de otras fuentes (por ejemplo, Palermo tiene 34 miembros y solo 1 contacto de WhatsApp en el CRM).
- **`miembros_nuevos_con_flow`**: los que además aparecen entre las entradas al flow, cruzando por teléfono. **Subestima**, porque las personas de Instagram no tienen teléfono en el CRM (queda pendiente pedirlo en los flows).

Cada tasa de captación sale por duplicado: **mínima** (con flow) y **máxima** (total). Eso alimenta directamente el rango mínimo/máximo de Comunidad en Norte-kpi, en vez de aplicar un solo número a los dos extremos.

⚖️ Decidir si Norte-kpi usa ese rango tal cual o solo la medida conservadora.

## Qué ventanas cuentan

Una ventana (comunidad + desde + hasta) es **elegible** solo si:

1. La comunidad tiene una **carga de lista completa** al inicio y otra al final de la ventana. Sin eso no se sabe quién entró en el medio (misma regla que las bajas reales, db/021).
2. El alcance de la ventana está cargado y fue pedido **por la ventana completa**.
3. Los miembros de la ventana tienen **fecha de ingreso real**. Si la carga marcó la fecha de registro en vez de la de ingreso, la ventana se marca "con fechas aproximadas" y **no entra en la tasa de Norte-kpi** (sí se muestra en el CRM).

Las ventanas son **mensuales y cerradas** (del 1 al último día del mes anterior). El punto de partida de miembros es el 14/10/2026 (Mi = Mf); la primera ventana elegible posible cierra cuando haya una segunda carga completa.

Una ventana no elegible se guarda igual, con `elegible = false` y el motivo, para que el CRM explique por qué no hay tasa.

## Datos

### Tabla nueva `embudo_comunidad_periodo`

| Columna | Tipo | Notas |
|---|---|---|
| `cliente_id`, `comunidad_id` | uuid | FK compuesta `(comunidad_id, cliente_id)`, como el resto |
| `desde`, `hasta` | date | Ventana. Único por `(comunidad_id, desde, hasta)` |
| `alcance` | bigint, nullable | Windsor, de la ventana completa |
| `entradas_flow` | int | Personas distintas |
| `clics_me_sumo` | int | Personas distintas |
| `miembros_nuevos_total` | int | |
| `miembros_nuevos_con_flow` | int | |
| `fechas_aproximadas` | boolean | Ver regla 3 |
| `elegible` | boolean | |
| `motivo_no_elegible` | text, nullable | En palabras |
| `fuente_alcance` | text | `windsor` por ahora |
| `calculado_en` | timestamptz | |

**Solo conteos. Nunca teléfonos ni ids de Instagram.** Escritura solo con `service_role` (n8n); lectura como el resto de las tablas del panel (abierta hoy, por cliente con db/005).

### Funciones

- `calcular_embudo_comunidad(p_comunidad, p_desde, p_hasta)`: devuelve los conteos de entradas, "Me sumo" y miembros nuevos (total y con flow), la elegibilidad y el motivo. Lee `miembro_comunidad` con `security definer` y devuelve **solo números**. Así la lógica vive en la base y se puede ensayar con rollback.
- `guardar_embudo_comunidad(...)`: upsert idempotente de una fila; correrlo dos veces con los mismos datos no duplica nada.

## El flujo de n8n (un cálculo, dos consumidores)

Mensual, el día 2, para el mes cerrado anterior:

1. **Windsor.ai** (conector Facebook, cuenta `TQN - Growing 2 - LC`): `reach`, `impressions`, `campaign`, `adset_name` para la ventana completa, **sin desglosar por día**.
2. **Python:** asigna cada fila a una comunidad con `comunidad_meta_origen` y suma el alcance **por comunidad**. Si dos conjuntos de anuncios apuntan a la misma comunidad, el alcance combinado puede duplicar personas: se marca y se usa el mayor como cota, nunca la suma. ⚖️ Confirmar.
3. **Supabase:** llama a `calcular_embudo_comunidad` y luego a `guardar_embudo_comunidad`.
4. **Python:** con las ventanas elegibles, calcula las tasas para Norte-kpi (regla de muestra abajo).
5. **GitHub:** abre una **PR** a Norte-kpi con `src/data/comunidadMedida.js`. Nunca commitea directo a `master`.
6. **Errores:** si falla Windsor, la ventana se guarda sin alcance y `elegible = false`, y n8n avisa. Nunca se rellena con un valor supuesto.

## Cómo lo usa Norte-kpi

El cálculo sigue puro: lee `comunidadMedida.js` (datos estáticos), sin llamadas de red.

### Muestra mínima ⚖️ (valores propuestos, a confirmar)

La tasa medida **solo se usa** si hay al menos **5 ventanas elegibles** de **2 o más clientes distintos**. Con eso:

- La tasa es el rango **p25–p75** de las tasas de las ventanas (mínima y máxima por separado, ver "Dos medidas").
- La confianza de Comunidad pasa a **alta** y la tarjeta dice de cuántas ventanas y clientes salió y el mes de cierre.

Si no se alcanza la muestra: sigue la constante de 4%, marcada "estimación interna". **Nunca se mezcla** una tasa medida con muestra insuficiente.

### Por rubro (más adelante)

Con 2 clientes no se puede separar por rubro. Cuando haya 5 ventanas elegibles **por rubro**, se calcula una tasa propia de ese rubro; si no, se usa la global. Requiere saber el rubro de cada cliente. ⚖️ Decidir dónde se guarda (columna en `cliente`, o una tabla en n8n).

## Qué NO incluye

- **Porcentaje de nominizados:** sigue siendo estimación interna. Hay que definir primero qué cuenta como "dato identificable"; el CRM hoy tiene teléfonos y nombres de ManyChat, que no distinguen anónimo de nominizado.
- **Cambiar `windsor-sync` ni la sincronización diaria de Meta.** El alcance lo trae n8n por su cuenta, para no tocar lo que ya funciona.
- **Atribuir cada miembro a un anuncio.** Se mide por comunidad y ventana, no por persona.
- **Login y migración 005** (siguen siendo lo último del proyecto).

## Cómo se entrega (una PR por cambio)

| PR | Qué | Antes de aplicar |
|---|---|---|
| 1 | CRM, base: tabla y las dos funciones (`db/023`) | Ensayo con rollback en `exportes/`; lo corre el usuario en el SQL Editor |
| 2 | n8n: flujo mensual como JSON importable + guía en `docs/how-to/` | Probar con una ventana real sin escribir (dry run) |
| 3 | CRM, panel: vista del embudo en Control_Comunidades | Probar en la vista previa de la rama |
| 4 | Norte-kpi: leer `comunidadMedida.js`, muestra mínima, confianza y tarjeta | Probar los 3 casos: sin datos, muestra insuficiente, muestra suficiente |

Las PR 1 a 3 aportan valor aunque haya pocos datos (el embudo se ve desde ya). La 4 espera a que la muestra alcance.

## Criterios de aceptación

- Correr el flujo dos veces para la misma ventana no duplica filas.
- Ninguna tabla, función ni archivo generado contiene teléfonos ni ids de Instagram.
- Una ventana sin carga completa inicial y final aparece como "no elegible" con su motivo, y no entra en ninguna tasa.
- El alcance de una ventana coincide (dentro de un margen razonable) con el de Ads Manager para las mismas fechas.
- Norte-kpi sin `comunidadMedida.js`, o con muestra insuficiente, se comporta exactamente como hoy.
- El panel nunca muestra una tasa con denominador 0 ni con alcance faltante.

## Preguntas abiertas

1. ⚖️ ¿`reach` de Windsor para la ventana completa coincide con Ads Manager? (se prueba con un período corto de Cortado antes de la PR 2).
2. ⚖️ ¿Norte-kpi usa el rango mínima–máxima o solo la conservadora?
3. ⚖️ ¿Muestra mínima de 5 ventanas y 2 clientes?
4. ⚖️ ¿Cómo se trata el alcance cuando dos conjuntos de anuncios van a la misma comunidad?
5. ⚖️ ¿Dónde vive el rubro de cada cliente?
6. Las personas de Instagram no tienen teléfono: mientras no se pida el número en los flows (pendiente anotado el 14/10), `miembros_nuevos_con_flow` subestima de forma sistemática.
7. Con la frecuencia que usa la calculadora (aprox. 3) se puede estimar el alcance desde las impresiones si `reach` no sirve. Es el plan B, y quedaría marcado como estimado, no medido.
