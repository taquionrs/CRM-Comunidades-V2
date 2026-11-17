# Plan global — reportes automáticos, monitoreo de métricas compuestas, CRR y churn

**Estado al 2026-11-17:** CRR y catálogo de anuncios en producción (PR #73 y #74). Reporte semanal (función, botón y dos flujos de n8n) en la PR #75. El resto, por construir en el orden de abajo.
Pedido de Juan Marroncle (2026-11-16 y 17). Reúne lo que ya se construyó y lo que quedó pendiente de las especs anteriores.

---

## 1. En una página (para mostrar)

**Qué queremos.** Que las métricas que se miran cada semana (retención, churn, costo por miembro, cobertura, triaje) **se calculen y se entreguen solas**, con números confiables, y que haya alertas cuando algo se mueve fuera de lo normal.

**Qué ya funciona.**
- **CRR y churn** de cada comunidad, calculados por el CRM entre dos cargas de lista completa del grupo.
- **Rendimiento por anuncio:** cada anuncio de Meta con su ID, nombre, gasto, chats y entradas, más un código propio (`PAL-01`) para saber de qué anuncio viene cada persona.
- **Reporte semanal:** un botón que baja el Excel de la semana, y dos flujos de n8n listos para importar (el reporte de los lunes y la carga automática de miembros).

**Qué falta.**
1. Que la lectura de los grupos de WhatsApp se haga sola (hoy es el único paso manual).
2. Fijar con datos propios los umbrales de las alertas.
3. Probar variantes de campaña y un formulario propio para medir mejor de qué anuncio viene cada persona.

**Decisiones ya tomadas.**
- **El CRM es la fuente de verdad** de los miembros (no el conteo del Excel).
- Las métricas de retención se miden **entre cargas de lista completa**; no se estima nada.
- Para saber de qué anuncio viene cada persona, **se usa un código en el mensaje predefinido de WhatsApp** de cada anuncio.
- Los números los calcula el CRM; ni la IA ni una planilla armada a mano.

---

## 2. Prioridades (en este orden)
1. **Automatizar los reportes** semanales y tener **monitoreo real de las métricas compuestas** (las que se arman con más de un dato).
2. **CRR funcionando en producción** (hecho: PR #74).

Principio de siempre: **los números los calcula el CRM**. Si no se puede calcular, dice "no calculable" y por qué. Nunca se rellena con un valor supuesto.

---

## 3. Dónde estamos (el histórico unificado)

| Área | Hecho (en producción) | Pendiente / abierto |
|---|---|---|
| Ingreso bot → CRM | Webhook de ManyChat, flows por comunidad, "sin clasificar" (PR #64–66), contactos a planilla por n8n | Boedo con baja cobertura; origen de los "Hola, quiero más información" |
| Tracking de cobertura | Orden por etapas, clics en el enlace, desfasaje, semáforo (PR #65–69) | Umbrales del semáforo a aprobar por la PO |
| Pauta por anuncio | Código por anuncio (PR #70), métricas por anuncio de Windsor (PR #71), bloque Rendimiento (PR #72), catálogo automático con ID, nombre y código (PR #73) | Poner el código en la plantilla de cada anuncio (ver prueba T4) |
| Miembros | Carga de miembros con lista completa, bajas reales, fuga (PR #38–42); **CRR y churn** (PR #74) | Lectura de grupos automática; conciliar con el Excel |
| Reportes | **Reporte semanal** (función, botón, flujo n8n) en la PR #75 | Foto semanal con alertas; resumen con IA |
| Acceso | SSO con Cloudflare y roles Marketing/General (PR #54) | — |
| IA | Pulso (equipo de Medios); spec de funciones de IA en el CRM | Etapa 5: OpenRouter con tope de 5 USD |
| n8n | Contactos de WhatsApp a Sheets (en uso); embudo mensual (importable, falta su base de datos); **reporte semanal y carga de miembros** (PR #75) | Probarlos en n8n real |
| Línea de base del puesto | Documento v0 de definiciones | Tasa de triaje con numerador mal definido; CPMR, K-Factor, ciclo del miembro, horas manuales |

---

## 4. Las métricas, explicadas

Todas se calculan **por comunidad y período**; el total del cliente se recalcula con los totales, nunca promediando.

| Métrica | Qué responde | Cómo se calcula | De dónde se alimenta | ¿Se alimenta sola? |
|---|---|---|---|---|
| **CRR** (retención) | De los que había al empezar, ¿cuántos siguen? | (miembros al final − nuevos) ÷ miembros al inicio × 100 | Cargas de lista completa del grupo | Depende de la carga de miembros (hoy semiautomática) |
| **Churn** | ¿Cuántos se fueron? | 100 − CRR | ídem | ídem |
| **Nuevos y bajas** | ¿Cuánta gente entró y cuánta salió? | Lo que aparece o desaparece entre dos cargas | ídem | ídem |
| **Entradas al flow** | ¿Cuántas personas empezaron a conversar con el bot? | Personas distintas por primer contacto | ManyChat → CRM, en vivo | **Sí** |
| **Cobertura** | De los chats que cuenta Meta, ¿cuántos quedan registrados? | entradas ÷ chats de Meta | CRM + Meta | **Sí** (Meta llega al otro día) |
| **Costo por entrada** | ¿Cuánto cuesta cada persona que entra al flow? | inversión ÷ entradas | Meta + CRM | **Sí** |
| **Costo por miembro nuevo (CPMN)** | ¿Cuánto cuesta cada miembro que realmente se suma al grupo? | inversión del intervalo ÷ nuevos del intervalo | Meta + cargas de miembros | Depende de la carga de miembros |
| **Tasa de triaje** | De las personas que entran al flow, ¿cuántas terminan siendo miembros? | nuevos ÷ entradas al flow del intervalo | CRM + cargas | Depende de la carga de miembros |
| **Frescura de datos** | ¿Qué tan viejos están los datos de miembros? | días desde la última carga de lista completa | Cargas | **Sí** |

**Sobre la "Tasa de retención" del Excel de Nominizados.** Esa columna dividía los *miembros reales* (un total acumulado del grupo) por las *entradas al flow* (un flujo del período). Eso mezcla dos cosas distintas y por eso daba 3,9, 15 o 28. La idea que quería medir (de la gente que entra, ¿cuánta termina siendo miembro?) es la **tasa de triaje** de arriba, que ya está definida bien y sale sola. La retención de verdad es el **CRR**. Y el "costo por miembro efectivo" del Excel dividía por el total acumulado, así que bajaba solo porque el grupo crecía; el **CPMN** divide por los nuevos del mismo intervalo.

**Cómo se alimentan, en una línea cada una:**
- **Meta (Windsor) → CRM:** gasto, chats y clics por anuncio, una vez al día o con el botón. Automático.
- **ManyChat → CRM:** cada persona que entra al flow, en vivo. Automático.
- **WhatsApp → CRM:** quién está en cada grupo. **Es el único paso que hoy necesita una persona o un equipo** (ver la sección 6).

---

## 5. Fase 2 — Reporte semanal (hecho en la PR #75)

**Un solo cálculo, dos disparadores:** la función `reporte_semanal` del CRM arma todo, y se dispara de dos formas.
1. **Botón** "Reporte semanal (Excel)" en Control_Comunidades: baja el Excel con el período elegido, o la última semana completa si no elegiste fechas.
2. **Flujo n8n, cada lunes a las 8:00:** llama a la misma función, arma el Excel, lo guarda en Drive, lo manda por correo y suma las filas a una hoja *Historial* (la foto semanal).

**El Excel** se llama `Reporte semanal <cliente> <desde> a <hasta> V46.xlsx` (la versión es el número de semana: nunca pisa uno anterior) y trae, por comunidad y total: pauta del período, miembros del último intervalo cerrado (inicio, nuevos, bajas, final, CRR, churn, CPMN, triaje) y la frescura de los datos.

**Dónde entra el agente:** solo para un resumen de cinco renglones. Recibe los números ya calculados; no calcula. Sin presupuesto de IA, el reporte sale igual (el correo ya trae un resumen armado con las cifras).

Guía de puesta en marcha: `docs/how-to/configurar-n8n-reporte-semanal.md`. Flujos: `docs/n8n/reporte-semanal.workflow.json` y `docs/n8n/carga-miembros-automatica.workflow.json`.

---

## 6. Proceso del conteo de miembros (lo que hoy hace la habilidad) y cómo cerrarlo

### Qué hace hoy, paso a paso
La habilidad `conteo-miembros-comunidad-wsp` se corre **dos veces por semana** desde el Chrome de Juan.

| # | Paso | ¿Hace falta una persona o un equipo? | ¿Se puede automatizar? |
|---|---|---|---|
| 1 | Abrir WhatsApp Web y entrar a la comunidad "Cortado en Jarrito" | **Sí:** sesión abierta (si pide el código QR, se escanea con el teléfono) | Solo el QR no |
| 2 | Leer los miembros de cada grupo (General, Boedo, Devoto, Palermo; "Avisos" se ignora) | **Sí:** es lo único que necesita WhatsApp Web | No sin WhatsApp Web |
| 3 | Leer lo que ya está en la planilla de conteo | No | **Sí:** el CRM ya tiene la lista anterior, no hace falta leer la planilla |
| 4 | Comparar: quiénes son existentes, nuevos y posibles salidas | No | **Sí** (cálculo) |
| 5 | Escribir los nuevos al final de cada pestaña de la planilla (con un pegado por JavaScript y un "buscar y reemplazar" para corregir el signo `=`) | No | **Sí**, y sin el truco del reemplazo: n8n puede escribir en la planilla directamente. **Esta es la parte más frágil hoy** |
| 6 | Verificar la planilla (filas, formato, duplicados) | No | **Sí** |
| 7 | Generar el archivo `conteo-miembros-AAAA-MM-DD.csv` (`Comunidad,Fecha,Teléfono`) | No | **Sí** |
| 8 | Cargar el archivo en el CRM como lista completa (la hace Juan, con la clave de carga) | Hoy sí | **Sí**, con el flujo de n8n y su freno de seguridad |
| 9 | Cerrar la pestaña y resumir | No | Sí |

Reglas de seguridad que la habilidad ya respeta y se mantienen: WhatsApp solo en lectura, la planilla solo se agrega al final, nunca se pide ni se escribe la clave de carga, y si algo no coincide se frena y se avisa.

### Por qué no está 100 % automático
Mezcla dos tipos de trabajo: **leer WhatsApp** (necesita una sesión abierta) y **procesar** (calcular, escribir, cargar). El segundo se puede hacer sin ninguna persona; el primero no, porque WhatsApp no entrega por API la lista de miembros de una comunidad. En la habilidad, los dos van juntos y el procesamiento (pasos 3 a 8) es lo que más se rompe.

### Cómo cerrarlo: separar "leer" de "procesar"
| Acción | Qué cambia | Quién |
|---|---|---|
| **A. Achicar la habilidad a "leer"** | Hace solo los pasos 1 y 2 y deja un CSV con todos los miembros actuales en una carpeta de Drive. Desaparecen el pegado y el reemplazo de `=` | Yo ajusto la habilidad |
| **B. Carga automática** | El flujo de n8n `carga-miembros-automatica` toma ese CSV y lo sube al CRM, con freno de seguridad (modo prueba primero) | Listo para importar (PR #75) |
| **C. Planilla de conteo opcional** | Si se quiere seguir teniéndola, n8n la actualiza desde el CRM; ya no es un paso | A pedido |
| **D. Que corra en horario** | Dos opciones: (1) la habilidad como tarea programada en la computadora de Juan, con Chrome y WhatsApp Web abiertos; (2) un script chico que lee WhatsApp Web con una sesión guardada, también en una computadora encendida | Se elige la opción y la armo |
| **E. Que avise si falta** | La frescura ya se calcula; falta la alerta ("Palermo sin carga hace 9 días") | Va con la fase de alertas |

**Límites que quedan, y es mejor decirlos:** hace falta una computadora encendida con WhatsApp Web con la sesión abierta (el QR se vuelve a escanear de vez en cuando); WhatsApp Web puede cambiar su pantalla y romper la lectura; y automatizar WhatsApp Web, aunque sea solo para leer, está en una zona gris de los términos de uso de WhatsApp. Por eso la carga automática tiene el freno de seguridad: una lectura incompleta no debe borrar miembros.

---

## 7. Fase 3 — Monitoreo real de métricas compuestas
- **Foto semanal guardada:** el flujo del lunes ya agrega cada semana a la hoja *Historial*. Falta la tabla en el CRM (`reporte_semanal_foto`) para ver la tendencia dentro del panel.
- **Alertas con regla simple, calculadas por el CRM** (no por IA):

| Alerta | Regla (umbral a definir con la PO) |
|---|---|
| Churn en suba | churn de la semana mayor que el de la anterior en más de X puntos |
| CRR bajo | CRR menor que X % |
| Triaje en caída | tasa de triaje menor que X % |
| Cobertura roja | semáforo rojo dos semanas seguidas |
| Datos viejos | más de 8 días sin carga de lista completa de una comunidad |
| Anuncio sin resultados | gasto alto, chats y cero entradas con código |

- **Dónde se ven:** en Control_Comunidades (una franja de alertas arriba) y por aviso de n8n.
- **Primero una línea de base:** con 3 o 4 semanas de fotos se fijan los umbrales con datos propios, no inventados.

---

## 8. Pruebas de campaña — plan de acción

**Reglas para todas las pruebas:** una sola cosa cambia por prueba; mismo presupuesto, misma zona, mismo público y mismas imágenes; **mínimo 7 días y 100 chats por variante**; no tocar nada mientras corre; y se compara con **los datos del CRM** (costo por entrada, costo por miembro nuevo, tasa de triaje), no con los de Meta.

**Hoy:** objetivo Tráfico con destino WhatsApp, optimizado por clics en el enlace.

### T1. Optimizar por conversaciones en lugar de clics
- **Qué cambia:** el objetivo de optimización de la campaña (de clics a conversaciones). El resto igual.
- **Por qué:** hoy Meta busca gente que haga clic; si busca gente que inicie una conversación, debería subir la cobertura.
- **Cómo:** duplicar la campaña de Palermo en Ads Manager, cambiar el objetivo de optimización a conversaciones, dividir el presupuesto 50/50.
- **Éxito:** menor costo por entrada y mejor cobertura que la campaña original.

### T2. Clientes potenciales con formulario de Meta
- **Qué cambia:** el anuncio abre un formulario de Meta (teléfono y barrio) en lugar de abrir WhatsApp.
- **Por qué:** el formulario **trae el anuncio de origen de cada persona**, sin código.
- **Cómo:** campaña de Clientes potenciales, formulario con teléfono, barrio y la aceptación de los textos legales. Después, un mensaje de WhatsApp (con plantilla aprobada) invita a la comunidad.
- **Cuidado:** requiere plantilla aprobada de WhatsApp y revisar el consentimiento; hay una persona más de pérdida entre el formulario y el grupo.
- **Éxito:** costo por miembro nuevo menor o igual al actual, con atribución completa por anuncio.

### T3. Enlace con el anuncio en la dirección
- **Qué cambia:** el anuncio apunta a una dirección web que lleva el ID del anuncio (`{{ad.id}}`).
- **Por qué:** atribución exacta sin editar plantillas.
- **Cuidado:** no es el formato nativo de WhatsApp; se pierde el saludo automático. Es la base de la prueba T5 (formulario propio).

### T4. Código en el mensaje predefinido de WhatsApp (el camino elegido)
**En palabras simples:** cada anuncio de WhatsApp manda un mensaje ya escrito ("Hola, quiero unirme a la comunidad de Cortado en Jarrito Palermo ☕"). Le agregamos al final un **código corto que identifica el anuncio** (`PAL-01`). Cuando la persona manda el mensaje, el CRM lee el código y sabe de qué anuncio vino. La persona ve el código, pero no tiene que hacer nada.

**Qué cambia:** solo el texto del mensaje predefinido de cada anuncio. El anuncio, la imagen, el público y el presupuesto no cambian.

**Paso a paso (por cada anuncio, unos 2 minutos):**
1. En Ads Manager, **duplicá el anuncio** y abrilo para editar.
2. Entrá a **Conversaciones → Acciones del cliente → Mensaje predefinido**.
3. Al final del mensaje, **agregá el código del anuncio**, por ejemplo ` (PAL-01)`. El código es las 3 letras de la zona más el número con que termina el nombre del anuncio (un anuncio `..._PALERMO_05` es `PAL-05`). Está en la columna *Código* del bloque Rendimiento.
4. Verificá que el mensaje **no pase de 80 caracteres** (el contador te lo dice).
5. Publicá.
6. **Probalo con tu teléfono:** tocá el anuncio, mandá el mensaje, y mirá en el CRM (Data_Cruda) que la entrada quedó con el código. Probá también sin el código: tiene que entrar igual.

**Qué se mide:** qué porcentaje de las entradas llega con código y, por anuncio, el costo por entrada y por miembro nuevo.
**Cuándo está bien:** si al menos 6 de cada 10 entradas traen código (umbral propuesto, a confirmar con la PO). Si es menos, se prueba poner el código al principio o la prueba T5.
**Límite:** la persona puede borrar el código antes de enviar; esa entrada igual cuenta, pero queda "sin anuncio". El mensaje de arriba ya le pide "no modificar el mensaje".

### T5. Formulario propio (vibecoding)
**Idea:** en lugar de depender de WhatsApp o de Meta para saber de qué anuncio viene cada persona, **armamos nuestra propia página y formulario**. El anuncio lleva a la página; la página sabe qué anuncio la trajo (Meta agrega el ID del anuncio a la dirección); la persona deja su teléfono y barrio; y de ahí pasa a WhatsApp.

```
Anuncio (con el ID en la dirección)
   → Página "Unite a la comunidad de Palermo" con formulario (teléfono, barrio, aceptación)
   → El CRM guarda el contacto con anuncio, conjunto y campaña
   → Botón "Abrir WhatsApp" (con el mensaje de la comunidad + un código único)
   → Entra al flow como siempre; el CRM une la entrada con el contacto del formulario
```

**Qué ganamos:**
- **Atribución exacta** de cada persona a su anuncio, conjunto y campaña, sin editar plantillas.
- **Datos propios** desde el primer clic, incluso de quien no termina entrando al grupo.
- **Optimizar por miembros reales:** con la página propia se puede instalar el píxel de Meta y devolverle a Meta, desde el CRM, el evento "se sumó al grupo". Hoy es imposible (el CRM no recibe el identificador de clic de Meta). Es la mayor ventaja a largo plazo.

**Qué hay que construir (lo armo yo):**
1. Una página por zona (`/unite/palermo`), liviana y pensada para el celular, hecha con vibecoding y publicada en Vercel.
2. Una función del CRM pública y protegida contra spam (límite de envíos) que recibe el formulario.
3. Una tabla `lead_formulario` con teléfono, zona, anuncio, conjunto, campaña, y la constancia del consentimiento (texto legal y versión).
4. La unión entre el contacto del formulario y la entrada al flow.
5. Un bloque en Rendimiento: formularios completados, cuántos entran al flow y cuántos terminan como miembros, por anuncio.

**Cuidado:** agrega un paso más para la persona (puede bajar la conversión) y requiere revisar los textos legales del consentimiento. Por eso va como prueba, comparada contra la campaña actual.
**Éxito:** costo por miembro nuevo menor o igual al de la campaña actual, con atribución completa.

### Qué NO se prueba todavía
Optimizar para "miembros que se unen" en la campaña actual: el CRM no recibe el identificador de clic de Meta, así que no se pueden devolver esas conversiones. Se habilita con T5.

---

## 9. Decisión sobre cómo se vincula el anuncio con el mensaje (registro del 16/11)
Descartados por Juan: ManyChat entregando el ID del anuncio, la estimación por reparto, conectar WhatsApp directo a la API de Meta, y la pregunta "¿cuál imagen viste?" en el flow. **Elegido:** el código en el mensaje predefinido (T4), y sumar el formulario propio como prueba (T5).

Notas operativas:
- **El MCP de Meta no puede editar esa plantilla.** La herramienta que crea creativos no fija el mensaje de bienvenida, y un creativo publicado no se puede modificar. Se hace en Ads Manager.
- **El código se puede prever antes de que el anuncio aparezca en Windsor:** zona (3 letras) más el número con que termina el nombre del anuncio.
- **Largo:** el mensaje tiene un máximo de 80 caracteres y los de Palermo y Villa Devoto ya están cerca; un código con paréntesis suma unos 9. Hay que revisar que entre.

---

## 10. Orden de trabajo y PRs

| # | Entrega | PR | Estado |
|---|---|---|---|
| 1 | Catálogo automático de anuncios | #73 | **En producción** |
| 2 | CRR y churn | #74 | **En producción** |
| 3 | Reporte semanal: función, botón, Excel versionado y los dos flujos de n8n | #75 | En revisión |
| 4 | Métricas compuestas en el panel (CPMN, triaje, frescura) | por definir | Ya salen en el reporte; falta mostrarlas en Control_Comunidades |
| 5 | Foto semanal en el CRM y alertas | por definir | Depende de 4 o 5 semanas de fotos |
| 6 | Lectura de WhatsApp automática (acciones A, D y E de la sección 6) | por definir | Espera elegir dónde corre |
| 7 | Prueba T4 (códigos en las plantillas de Palermo) | — | La hace Juan en Ads Manager |
| 8 | Formulario propio (T5) | por definir | Espera revisar los textos legales |
| 9 | Resumen narrativo con IA | por definir | Con presupuesto aprobado |

---

## 11. Decisiones pendientes
1. **Dónde corre la lectura de WhatsApp:** tarea programada con Chrome (opción 1) o script con sesión guardada (opción 2), y en qué computadora.
2. **Dónde se entrega el reporte semanal** (Drive, correo, chat) y a quién.
3. **Umbrales de las alertas** (después de 3 o 4 semanas de fotos).
4. **Qué pruebas de campaña hacer primero** (se propone T1 y T4 en Palermo).
5. **Textos legales del consentimiento** del formulario propio (T5).
6. **Si el CPMN reemplaza** al "costo por miembro efectivo" en lo que se entrega al cliente.
7. **Umbral de éxito del código en el mensaje** (se propone 60 % de las entradas con código).
