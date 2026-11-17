# Cómo: poner en marcha los flujos de n8n del reporte semanal y de la carga de miembros (PR #75)

Hay dos flujos para importar en n8n (menú ⋯ → *Import from file*). Los dos vienen **apagados** y con todo lo que hay que completar marcado como `REEMPLAZAR` o `PEGAR_...`. Después los editás desde n8n como quieras.

| Flujo | Archivo | Qué hace |
|---|---|---|
| **Reporte semanal del CRM** | [`docs/n8n/reporte-semanal.workflow.json`](../n8n/reporte-semanal.workflow.json) | Cada lunes a las 8:00 pide el reporte al CRM, arma el Excel, lo guarda en Drive, lo manda por correo y suma la foto de la semana a una hoja de historial |
| **Carga automática de miembros** | [`docs/n8n/carga-miembros-automatica.workflow.json`](../n8n/carga-miembros-automatica.workflow.json) | Cuando aparece en una carpeta de Drive el archivo `conteo-miembros-AAAA-MM-DD.csv`, lo sube al CRM como lista completa, con un freno de seguridad |

Los **números siempre los calcula el CRM** (función `reporte_semanal`, `db/044`). n8n no calcula nada: pide, ordena y entrega. El botón **"Reporte semanal (Excel)"** de Control_Comunidades usa la misma función y arma las mismas columnas (hay una prueba automática que lo verifica).

## Antes de empezar
- Aplicar `db/043` y `db/044` en Supabase.
- Credenciales en n8n (el nombre exacto es el que aparece entre paréntesis):
  - **Supabase CRM (Custom Auth):** la misma que ya usás en el flujo del embudo. Tiene que usar la clave de servicio, porque el reporte lleva plata y la lee solo Marketing o el servidor.
  - **Google Drive**, **Google Sheets** y **Gmail** (OAuth de tu cuenta).
  - Solo para la carga de miembros: **Supabase CRM + clave de carga (Custom Auth)**, con el mismo JSON que la otra y además `"body": { "p_clave": "<la clave de carga>" }`. La clave la cargás vos directamente en n8n: no hace falta pasarla por ningún chat.

## 1. Reporte semanal
1. Importar `reporte-semanal.workflow.json`.
2. En *Definir semana* revisá `SLUG` (cliente). Por defecto toma la **última semana completa, de lunes a domingo**, con fechas de Argentina.
3. Completar: la carpeta de Drive (*Guardar en Drive*), el correo (*Enviar por correo*) y la planilla de historial (*Foto semanal en Historial*).
4. En la planilla de historial, crear una pestaña **`Historial`** y pegar en la fila 1 los encabezados que arma *Armar Excel* (son los mismos del Excel).
5. Probar con **Correr a mano**. Para una semana puntual, completá `DESDE_MANUAL` y `HASTA_MANUAL`.
6. Cuando salga bien, activar el flujo.

**El Excel se llama** `Reporte semanal <cliente> <desde> a <hasta> V46.xlsx`. La versión es el número de semana, así que un reporte nuevo nunca pisa uno anterior.

**Qué trae** (una fila por comunidad y una de total):
- **Pauta del período:** inversión, chats de Meta, clics en el enlace, entradas al flow, cobertura y costo por entrada.
- **Miembros del último intervalo cerrado entre dos cargas de lista completa:** miembros al inicio, nuevos, bajas, miembros al final, **CRR**, **churn**, **costo por miembro nuevo** y **tasa de triaje**.
- **Frescura:** fecha de la última carga y días sin carga. Si pasan de 8 días, el correo lo avisa.

Lo que el CRM no puede calcular figura **vacío** (nunca 0): por ejemplo, el CRR de una comunidad con una sola carga.

## 2. Carga automática de miembros
> ⚠️ **Probarlo primero en modo prueba.** El flujo viene en `MODO = 'prueba'` (nodo *Freno de seguridad*): solo mira la vista previa de cada comunidad y te avisa, **no carga nada**.

1. Importar `carga-miembros-automatica.workflow.json`.
2. Completar la carpeta de Drive donde cae el CSV (la misma donde guarda el conteo) y el correo del aviso. **La carpeta tiene que ser privada**: el archivo tiene teléfonos.
3. Dejar un `conteo-miembros-AAAA-MM-DD.csv` en esa carpeta (columnas `Comunidad,Fecha,Teléfono`). En unos 15 minutos llega el aviso con la vista previa por comunidad.
4. Cuando las vistas previas coincidan con lo esperado en varias corridas, cambiar `MODO` a `'real'`.

**El freno de seguridad.** Aunque esté en modo real, una comunidad **no se carga sola** si:
- la carga dejaría **más del 10 % de los miembros actuales como salidas**, o
- el archivo trae **menos del 80 % de los miembros actuales** (parece una lectura incompleta de WhatsApp), o
- el nombre de la comunidad no existe en el CRM.

En esos casos te llega el motivo y la cargás a mano (Overview → Cargar miembros → lista completa).

La carga automática usa siempre: **lista completa**, duplicados **ignorados** (se conservan las fechas originales) y **sin** marcar "miembros iniciales".

## 3. Dos flujos más para producción
| Flujo | Archivo | Para qué |
|---|---|---|
| **Aviso de errores** | [`aviso-de-errores.workflow.json`](../n8n/aviso-de-errores.workflow.json) | Si un flujo falla, te manda un correo con **cuál fue y en qué nodo**. Sin esto, un reporte del lunes que no sale se nota recién el martes |
| **Recordatorio del CRM** | [`recordatorio-conteo-miembros.workflow.json`](../n8n/recordatorio-conteo-miembros.workflow.json) | Los lunes y jueves a las 8:00 le pregunta al CRM qué necesita que completes y te lo manda por correo (el mismo mensaje de la franja "Para completar"). Si no hay nada pendiente, **no manda nada** |

Para que el aviso de errores funcione hay que **activarlo en cada flujo**: abrir el flujo → ⋯ → *Settings* → **Error workflow** → elegir "Aviso de errores de los flujos del CRM".

## Lista para dejar todo en producción
Hacela en este orden. Los flujos no avisan solos si les falta algo: por eso conviene tildar cada punto.

1. **Credenciales** (una vez, en n8n → Credentials):
   - **Supabase CRM (Custom Auth)**: JSON con los encabezados `apikey` y `Authorization: Bearer <clave de servicio>`. Tiene que ser la clave de servicio: el reporte lleva plata y la lee solo Marketing o el servidor.
   - **Gmail** y **Google Sheets** (o la cuenta de servicio de Google; si usás cuenta de servicio, **compartí la planilla con el correo de esa cuenta**).
2. **En *Reporte semanal*:**
   - Que **ningún nodo esté deshabilitado** (el nodo gris con una raya): *Supabase: cliente*, *Guardar en Drive* y *Enviar por correo*.
   - Completar `PEGAR_ID_DE_LA_CARPETA_DE_DRIVE`, `PEGAR_ID_DE_LA_PLANILLA_DE_HISTORIAL` y `PEGAR_CORREO_DESTINO`.
   - En el nodo *Supabase: cliente*, la dirección tiene que estar en **modo expresión** (el campo se ve con el recuadro "Expression" activo). *Si importaste la versión del 17/11 a la mañana, este era un error del archivo: ya está corregido; volvé a importarlo o activá "Expression" en ese campo.*
   - En la planilla de historial, pestaña **`Historial`** con los encabezados en la fila 1.
3. **Probar con *Correr a mano*** y controlar el Excel contra el botón **"Reporte semanal (Excel)"** del CRM: tienen que dar lo mismo.
4. **Importar el aviso de errores**, completar su correo y elegirlo como *Error workflow* en cada flujo (paso de arriba).
5. **Importar el recordatorio**, completar `SLUG`, `PANEL_URL` y el correo, y probarlo con *Correr a mano*.
6. **Activar** los flujos. Los de horario (*Reporte semanal*, *Recordatorio*) corren solos; la *Carga automática de miembros* sigue en **modo prueba** hasta que compruebes varias vistas previas.

## Qué puede hacer Claude con el MCP de n8n
El MCP de n8n que conectaste tiene **tres herramientas**: **buscar** flujos, **ver el detalle** de un flujo y **ejecutar** un flujo. Eso permite **mirar** cómo quedó cada nodo y **correr** el flujo para verificarlo, pero **no modificar nodos, credenciales ni activar o desactivar flujos**. Los cambios se hacen en n8n (o importando el JSON del repositorio), y después Claude puede correr el flujo y revisar el resultado.

## Limitaciones
- Los dos flujos se armaron y probaron **sin n8n** (se probó la lógica de cada nodo de código con datos simulados y la estructura del JSON). La primera importación puede pedir ajustes menores en algún nodo de Google; si algo no se parece a esta guía, mandá una captura.
- Lo que sigue necesitando una persona o un equipo es **leer los grupos de WhatsApp** (ver el plan, "Proceso del conteo de miembros").
