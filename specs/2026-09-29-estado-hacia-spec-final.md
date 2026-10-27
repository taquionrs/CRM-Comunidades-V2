---
id: crm-v2-estado-2026-09-29
título: CRM de Comunidades V2 — recapitulación de estado hacia el spec final
estado: vigente — fotografía del 2026-09-29 con actualizaciones fechadas; el estado actual está en la sección 3 terdecies
última actualización: 2026-10-05
fuente(s): carpeta local SDD-TAQUION, repo MarketingTaquion/CRM-Comunidades-V2, cuenta de ManyChat (workspace fb5616665), documento de Jaz (2026-09-24)
---

# CRM de Comunidades V2 — dónde estamos y qué falta para el spec final

Este documento no reemplaza a [`2026-09-25-v2-desde-cero.md`](2026-09-25-v2-desde-cero.md) (spec fundacional). Es una fotografía del 2026-09-29 que cruza tres fuentes: el código y las specs locales, el repo en GitHub y la cuenta de ManyChat. Termina con lo que hay que resolver para poder cerrar el spec final.

> **Nota (2026-10-05):** las secciones 0 a 5 describen cómo estaba el proyecto el 2026-09-29 y se conservan como registro. Lo que cambió después está en las secciones 3 ter en adelante, fechadas. **El estado vigente y el backlog están en la sección 3 terdecies, al final.**

## 0. Cómo se revisó y qué no se pudo verificar

| Fuente | Qué se revisó |
|---|---|
| Carpeta local | Documento de Jaz (.docx), `Patrones.md`, `contexto-madre.md`, todo `crm-comunidades-v2/` (3 migraciones SQL, 4 Edge Functions, `index.html`, docs, spec), la auditoría de V1 y `pulso-ignite/lib` para ver cómo se usa Windsor.ai |
| GitHub | Repo privado `MarketingTaquion/CRM-Comunidades-V2`: rama única `master`, 3 commits (2026-09-25), 0 PRs, 0 issues, 3 deployments de producción (Vercel) |
| ManyChat | Las **3 cuentas** (Cortado en Jarrito, Growing Ideas, Todo un País) desde Chrome, solo lectura: dashboard, contactos, automatizaciones (y el flow de canvas), broadcasts, insights, y Configuración (WhatsApp, campos, etiquetas, eventos de conversión, integraciones, API, aplicaciones, equipo). Detalle en la sección 3 bis |

**No verificado** (no hay acceso desde esta sesión): estado real de Supabase (si las migraciones y las 4 Edge Functions están aplicadas/deployadas, qué secrets hay cargados, si `verify_jwt` está activo), la URL de producción en Vercel, el contenido de los mensajes del flow (no quedó claro en el canvas si "Me sumo" es un botón de URL o de respuesta), la lista de tags por contacto, y los nombres exactos de endpoints/campos de las APIs de ManyChat y Windsor.ai (ver sección 5). Todo lo marcado "por lectura del SQL/código" no se probó en vivo.

## 1. Estado en una línea

El **esqueleto está completo y respeta el documento de Jaz** (5 tabs, 3 niveles de persistencia, First-Contact, endpoint JSON), pero **no está conectado a la realidad**: ManyChat todavía no le manda nada, Windsor no está sincronizando, y hoy el panel no se puede usar para cargar datos ni es seguro dejarlo público con datos reales.

## 2. Inventario de lo construido

| Pieza | Estado | Comentario |
|---|---|---|
| `db/001_init.sql` | Escrito | Schema `crm_comunidades_v2`, 4 tablas, vista `evento_deduplicado`, trigger de `usuario_curado`, RLS, GRANTs |
| `db/002_vistas_panel.sql` | Escrito | `comunidad_performance`, `base_limpia`, `kpis_macro` con las fórmulas del documento |
| `db/003_lectura_abierta_temporal.sql` | Escrito, **no documentado** | Abre SELECT a `anon` (ver hallazgo 3.1). No figura en `docs/how-to/desplegar.md` ni en el README |
| `manychat-webhook` | Escrito, gate 501 sin secret | Sin nadie que lo llame (hallazgo 3.4) |
| `windsor-sync` | Escrito, gate 501 sin key | Ver hallazgos 3.6 y 5 |
| `nominacion-sync` | Escrito, gate 501 sin key | Endpoint no verificado (sección 5) |
| `panel-data` | Escrito | Contrato 4.C de Jaz. **El panel no lo usa**: `index.html` consulta las vistas directo con la anon key, al contrario de lo que dicen la spec y `arquitectura.md` |
| `index.html` | Funcionando en Vercel, sin login | 5 tabs; Overview y Base_Limpia sin edición real; sin filtro de fechas |
| Deploy | 3 deployments Production en Vercel (2026-09-25) | El spec sigue diciendo "sin deploy verificado end-to-end" |

## 3. Hallazgos (ordenados por gravedad)

### Críticos: resolver antes de cargar cualquier dato real

**3.1 Datos personales legibles por cualquiera (por lectura del SQL).**
`003_lectura_abierta_temporal.sql` crea `SELECT using (true)` sobre `evento_crudo` y `usuario_curado`, y `001` ya da `GRANT SELECT` a `anon`. Las vistas son `security_invoker`, así que heredan ese acceso. La anon key es pública (va en `config.js`). Resultado: teléfonos, nombres y emails de miembros se pueden leer con un simple request REST. Además `panel-data` usa `service_role`, no pide auth y responde con `CORS: *`, o sea el mismo dato completo por otra puerta. Choca con la regla de `contexto-madre.md` de que los miembros tienen nombre y se los trata como tales, y con la protección de datos personales aplicable (Ley 25.326 en Argentina; conviene confirmarlo con quien corresponda).

**3.2 El panel no puede escribir, y sin escribir no hay CRM.**
Sin login, `auth.role()` es `anon`; las policies de INSERT/UPDATE exigen `authenticated`. El formulario "+ Agregar comunidad" y los "Guardar" de Mi/Mf van a fallar. Y sin al menos una fila en `comunidad`, el webhook responde 404 a todo evento. Hoy la única forma de crear una comunidad es el SQL Editor.

**3.3 Vercel publica el repo entero.**
`vercel.json` usa `outputDirectory: "."`: además de `index.html` se sirven `/db/*.sql`, `/specs/`, `/docs/` y el código de las funciones. No hay secretos en esos archivos, pero expone el esquema y el razonamiento interno.

### Altos

**3.4 ManyChat no está conectado al CRM V2 (verificado en la cuenta).**
Existe una sola automatización, "Test Comunidades Cortado en Jarrito", en estado LIVE con **0 ejecuciones** (última modificación hace 6 días). Estructura observada:
- 3 disparadores "el mensaje contiene": Boedo, Palermo y otro (el resumen muestra 2 y un "Mostrar todo"; el árbol tiene 3 ramas, la tercera Villa Devoto).
- Acción inicial: `Localidad_CABA` = última entrada de texto del usuario, y **evento a la API de conversiones de Meta**.
- Condiciones por texto del mensaje ("Hola, quiero unirme a la comunidad de Cortado en Jarrito Boedo") que ramifican a un mensaje de WhatsApp con botón "Me sumo" (con CTR medido).
- Por rama: etiqueta del barrio + `Localidad_CABA`; luego `Estado_Comunidad` = "Clic en grupo"; mensaje de términos y condiciones.
- Cierre común (Acciones #8): **Google Sheets "Insert Row"** + otro evento a Meta CAPI.

No hay ninguna acción "External Request" hacia `manychat-webhook`. Hoy el flow escribe en una planilla de Google, no en el CRM. Detalles que hay que reconciliar:
- `community_id` tiene que salir de algún lado: el flow solo maneja el texto libre del usuario y la etiqueta del barrio, y el webhook busca por `id` (uuid) o por `nombre` exacto de la comunidad.
- El flow marca `Estado_Comunidad = "Clic en grupo"` sin que quede claro (en el canvas) si eso ocurre al tocar "Me sumo" o al enviarse el mensaje. El evento que alimenta `evento_crudo` tiene que ser el clic real; hay que confirmarlo en el editor.
- `contexto-madre.md` dice que el evento a Meta CAPI se dispara solo cuando el usuario entra al grupo; el flow lo dispara también en el primer paso.
- Los "Campos de usuario" son 2, ambos de tipo Text; no hay campo de email, así que la nominación de emails va a volver casi siempre vacía.
- Avisos de la cuenta Cortado: Facebook **rechazó el cambio de nombre** de WhatsApp Business (los contactos siguen viendo "Cortado en Jarrito", el número sigue conectado), el monedero de WhatsApp pide recarga automática, y Meta cambia el cobro de mensajes de WhatsApp el 2026-10-01.
- Esto es solo la cuenta Cortado. El panorama completo de las 3 cuentas (y la implicancia más grande: hay más de un cliente en el mismo CRM) está en la sección 3 bis.

**3.5 Formato de teléfono sin normalizar.**
El teléfono es la llave primaria global, pero ningún componente lo normaliza. `+54 9 11...`, `5491156171851` y `1156171851` serían tres personas distintas y romperían First-Contact y el cruce de nominación.

**3.6 Windsor: dos problemas concretos.**
- El upsert falla con "ON CONFLICT DO UPDATE command cannot affect row a second time" si Windsor devuelve más de una fila por `(adset_name, date)` (por ejemplo, si trae también desglose por campaña o anuncio). Falta agregar antes de insertar.
- `ctr_anuncio` existe en la tabla pero nunca se llena, y el panel marca "sin fuente". Pulso Ignite ya trae `clicks` e `impressions` de Windsor para Meta, así que el CTR de anuncio **sí tiene fuente** y solo falta pedir `clicks` en `fields`.

### Medios

**3.7 XSS en el panel.** `index.html` arma tablas con template strings sin escapar `nombre`, `email`, `etiquetas` y `payload` (JSON del webhook). El nombre viene del perfil de ManyChat, o sea, texto controlado por el usuario final.

**3.8 `recibido_en` lo pone el emisor.** El webhook inserta `timestamp ?? now()`. Como la atribución First-Contact se decide por ese campo, un timestamp incorrecto (o `last_interaction`, que es lo que sugiere la doc, y no es el momento del clic) puede cambiar qué comunidad "gana". Conviene guardar la hora de recepción como ordenadora y el timestamp del emisor como dato aparte.

**3.9 Filtro por rango de fechas ausente.** Jaz pide, en Control_Comunidades, filtro por fechas y comunidad. `meta_ads_metrica` está por día, pero `comunidad_performance` suma todo el histórico y los clics únicos no se filtran por fecha. Además, `B = Mi + clics − Mf` mezcla clics acumulados con snapshots puntuales de Mi/Mf: si se filtra por fechas la fórmula pierde sentido salvo que Mi/Mf también tengan fecha.

**3.10 Mf y Mi son manuales y sin fecha.** Sin historial de snapshots no se puede saber de cuándo es cada número ni recalcular por período.

**3.11 Gaps de la matriz de Control_Comunidades.** "Trigger entregados", "Contactos únicos en bot", "Envíos de enlace efectivos" y "CTR interno del bot" están "sin fuente" porque el webhook solo se dispara en el clic final. Todos serían calculables si ManyChat mandara también eventos intermedios (bot iniciado, enlace enviado, clic en grupo) y `tipo` dejara de estar restringido a `webhook_manychat`.

**3.12 Nominación: endpoint sin verificar y diseño frágil.**
`/wa/subscriber/getInfo?whatsapp_phone=` no se pudo verificar (sección 5); la doc de Jaz menciona `GET /subscriber/getInfo`. Además hace una llamada secuencial por teléfono dentro de una Edge Function (riesgo de timeout con volumen). Alternativa más simple: que el External Request de ManyChat mande `first_name`/`last_name` (y `email`, si existiera) en el mismo POST y se guarde en `usuario_curado` sin llamar a ninguna API. Es un desvío del documento de Jaz, así que requiere su visto bueno.

### Bajos

- `windsor-sync` y `nominacion-sync` no validan quién las invoca; con `verify_jwt` activo alcanza la anon key pública para dispararlas.
- La API key de Windsor va en la query string (queda en logs).
- El ejemplo JSON de Jaz es inconsistente consigo mismo (San Luis: clics 120 vs. la tabla Overview con 150; con 120 la fuga daría 8,3 % y no 0,266). Hay que preguntar cuál es el dato de referencia.
- "Tasa de fuga global" en el documento es un "porcentaje promedio"; la vista calcula ΣB/Σclics (ponderada). No está documentada como decisión.
- `evento_deduplicado` es una vista sobre toda `evento_crudo`: correcto y simple hoy, a revisar (vista materializada) cuando el volumen crezca.
- Higiene documental: el spec V2 no sigue la plantilla del método (sin front-matter ni criterios de aceptación); README/`desplegar.md` no mencionan `003`; `arquitectura.md` y el spec dicen que el panel consume `panel-data` y no es así. No se revisó `docs/reference/esquema-de-base-de-datos.md` contra el SQL.
- El repo V2 es privado; `Patrones.md` dice que los repos de `MarketingTaquion` son públicos. Confirmar que es intencional.

## 3 bis. Las tres cuentas de ManyChat (revisadas el 2026-09-29)

### Foto por cuenta

| | Cortado en Jarrito | Growing Ideas | Todo un País |
|---|---|---|---|
| ID de cuenta | `fb5616665` | `fb5347078` | `fb5616672` |
| Rol aparente | Cliente GCBA (Boedo, Palermo, Villa Devoto) | Sandbox de pruebas con los datos del documento de Jaz | Comunidades de San Luis (San Luis Capital, Quines, La Toma) |
| Canales | Instagram (65 contactos) + WhatsApp (0 contactos) | **Ninguno conectado** (WhatsApp figura "Conectar") | Instagram + WhatsApp |
| WhatsApp | Conectado, límite 2000 conv./24 h; cambio de nombre rechazado; monedero sin recarga automática | Desconectado | Conectado, empresa verificada, cuenta aprobada, 2000 conv./24 h; monedero sin recarga automática |
| Contactos | 65 (todos de Instagram) | 5 (Quines 4, La Toma 3, San Luis 1) | 7, todos suscriptos entre hace 1 hora y hace 1 día |
| Automatizaciones | `Test Comunidades Cortado en Jarrito`: LIVE, **0 ejecuciones** | `Teste comunidades`: LIVE, **30 ejecuciones** (Quines 2, La Toma 1 por disparador); copia en borrador; carpeta "Comunidades San Luis"; `WhatsApp Default Reply` detenido | `Comunidades TUP`: LIVE, **0 ejecuciones**; `WhatsApp Default Reply` detenido (modificado hace 1 día); `Instagram Default Reply` detenido |
| Campos de usuario | `Estado_Comunidad`, `Localidad_CABA` | `Barrio`, `Estado_Comunidad`, `Localidad_Sanluis`, `First Name`, `Phone` y un campo numérico | `Estado_Comunidad`, `Localidad_Sanluis` |
| Google Sheets | Conectado | Conectado | Conectado |
| Eventos de conversión (Meta) | Ninguno definido | Ninguno | Ninguno |
| Clave de API de ManyChat | No generada | No generada | No generada |
| Plan | No se relevó | **Business, cancelado: termina en 1 día** | No se relevó |
| Broadcasts / secuencias | Sin broadcasts | No se relevó | No se relevó |

Los tres flows de comunidad son el mismo esqueleto clonado (mismo ID interno de contenido en Cortado y Growing Ideas): disparadores por palabra clave, condición por texto, mensaje con botón "Me sumo", mensaje de términos y condiciones, y cierre con Google Sheets. El de Growing Ideas es el único que se ejecutó de verdad (30 veces).

### Lo que esto cambia para el CRM V2

1. **Hay más de un cliente en un mismo CRM.** Cortado en Jarrito (GCBA) y Todo un País son marcas distintas. V2 usa el teléfono como llave global: una persona que pasó por Cortado y por San Luis quedaría atribuida a la primera, cruzando datos entre clientes. Además `contexto-madre.md` dice que las comunidades de clientes no se nombran públicamente y que no hay roles en V2. Hay que decidir si el CRM es por cliente (un despliegue o un `workspace_id` que separe todo) o único con atribución global. Es la decisión de mayor impacto.
2. **Una sola credencial no alcanza.** La clave de API de ManyChat es por cuenta; `nominacion-sync` solo soporta una. Con tres cuentas, mandar nombre (y email si existiera) en el propio POST del webhook es más simple y evita las tres claves.
3. **El webhook necesita saber de qué cuenta viene.** Hoy busca la comunidad por nombre exacto. Los nombres ya no coinciden entre fuentes: "San Luis Capital" (disparador en Todo un País), "San Luis" (Growing Ideas y documento de Jaz), `Localidad_Sanluis` (campo), "Cortado en Jarrito Boedo" (texto del mensaje en Cortado). Hace falta un identificador de comunidad canónico fijo por rama del flow, no texto libre.
4. ~~**Lo que el flow puede medir de verdad.** ¿"Me sumo" es un botón de URL?~~ **Resuelto (2026-09-29):** "Me sumo" es una respuesta a una encuesta de ManyChat para entrar a la comunidad, o sea que sí es un evento observable por persona: responder dispara el paso siguiente (`Estado_Comunidad = "Clic en grupo"`) y ahí puede salir el POST al CRM. Lo que sigue sin ser observable es la entrada efectiva al grupo de WhatsApp (ManyChat no la reporta). El estadio "clic_en_grupo" significa "dijo que se suma", no "está en el grupo".
5. **Datos de origen ya disponibles.** Growing Ideas tiene los campos `First Name` (lee el nombre del perfil de WhatsApp) y `Phone`; ese dato viaja en el POST sin necesitar la API de nominación.
6. **Monitoreo del embudo.** En Todo un País llegaron 7 contactos reales en el último día pero `Comunidades TUP` tiene 0 ejecuciones y el `WhatsApp Default Reply` está detenido: esas personas escribieron algo que no dispara ninguna automatización (por ejemplo, el disparador exige que el mensaje contenga un nombre exacto). Conviene revisarlo con Lorena antes de conectar el CRM, porque hoy hay tráfico real sin respuesta.
7. **El CAPI a Meta parece no estar operativo.** Los flows tienen la acción "Enviar evento a la API de conversiones de Meta", pero ninguna cuenta tiene eventos de conversión definidos. Esto no es del CRM pero afecta la optimización de pauta que describe `contexto-madre.md`.
8. **Growing Ideas está por perder el plan Business** (cancelado, termina en un día) y no tiene WhatsApp conectado, así que hoy no sirve para probar de punta a punta.

### Qué conviene crear y qué no (para el CRM V2)

**Crear**

| Qué | Dónde | Por qué |
|---|---|---|
| Acción "External Request" (POST) hacia `manychat-webhook`, con header `x-webhook-secret` | En cada flow de comunidad, en un solo punto común después de resolver la rama | Es lo único que falta para que llegue el primer evento. Un solo punto de envío evita duplicados por rama |
| Body con `phone`, `first_name`, `last_name`, un identificador fijo de comunidad y otro de cuenta/cliente | Mismo External Request | Resuelve nominación sin API key y separa clientes |
| Un valor canónico de comunidad por rama (no el texto libre del usuario) | Campo de usuario existente o constante en el body | Elimina los desajustes de nombre |
| Un secret distinto por cuenta | Supabase (`MANYCHAT_WEBHOOK_SECRET_*`) o un secret + `cuenta` validada | Si se filtra uno, no compromete a los tres clientes |
| Una comunidad de prueba en Todo un País (o Cortado) con un número de prueba | ManyChat + CRM | Es la única cuenta con WhatsApp verificado y conectado para probar de punta a punta |
| Recarga automática del monedero de WhatsApp | Cortado y Todo un País | Sin fondos no salen mensajes de plantilla; lo pide el propio aviso de ManyChat |

**No crear (por ahora)**

| Qué | Por qué no |
|---|---|
| Clave de API de ManyChat en las tres cuentas | Solo se necesita si se elige nominación por API. Mandar los datos en el webhook la vuelve innecesaria |
| Campo de email en ManyChat | WhatsApp no lo entrega; pedirlo agrega fricción y datos personales que nadie pidió |
| Eventos intermedios (bot iniciado, enlace enviado...) | Requieren decisión de Jaz (pregunta 3) y ampliar `tipo` en `evento_crudo`. No se construyen sin ese visto bueno |
| Eventos de conversión de Meta | Son de otra spec (pauta), no del CRM |
| Broadcasts, secuencias, IA de ManyChat | Fuera del alcance del documento de Jaz |
| Un flow nuevo desde cero | Alcanza con editar el clonado. Los cuatro problemas están en las acciones finales, no en la estructura |
| Reemplazar ya la planilla de Google Sheets | Dejarla en paralelo hasta que el CRM reciba datos verificados; después decidir |
| Nada en Growing Ideas | Plan cancelado y sin WhatsApp. Si se quiere sandbox, hay que reactivarlo o migrarlo |

## 3 ter. Modelo de cuenta/cliente (escrito, sin aplicar)

Decisión (2026-09-29): un solo CRM con **selector de cliente** en el panel. El teléfono sigue siendo la llave de identidad, pero First-Contact y todo el resto se calculan dentro de cada cliente: la misma persona en dos clientes son dos filas independientes, cada una con su propia comunidad de origen. Recorrido de la información: [`docs/explanation/flujo-de-informacion.md`](../docs/explanation/flujo-de-informacion.md).

| Pieza | Migración | Qué cambia |
|---|---|---|
| Tabla `cliente` (nombre, slug, `manychat_account_id`, hash del secreto del webhook) | `004` | Un cliente = una cuenta de ManyChat. El secreto se guarda hasheado, nunca en claro |
| `cliente_id` en `comunidad`, `evento_crudo`, `meta_ads_metrica`, `usuario_curado` | `004` | FK compuesta `(comunidad_id, cliente_id)`: un evento no puede apuntar a una comunidad de otro cliente |
| `usuario_curado` con PK `(cliente_id, telefono_id)` | `004` | Datos existentes van a un cliente "Sin asignar (migrado)" |
| `usuario_estado_historial` + trigger | `004` | Cada cambio de estadio queda registrado (anterior, nuevo, origen, fecha) |
| Vistas `evento_deduplicado`, `comunidad_performance`, `base_limpia`, `kpis_macro` por cliente | `004` | `kpis_macro` pasa de una fila global a una fila por cliente |
| `usuario_cliente` y función `mis_clientes()` | `005` | Lista de clientes que ve cada usuario; alimenta el selector |
| RLS por cliente y cierre de `anon` | `005` | Reemplaza `lectura_abierta` (cierra el hallazgo 3.1 a nivel base de datos). `evento_crudo` queda solo lectura desde el panel |

**Adaptación mínima para 004 (hecha el 2026-09-29, sin deployar):**
- `manychat-webhook`: resuelve el cliente por el header `x-cliente`, valida el secreto contra `cliente.webhook_secret_hash` (sha256, comparación de tiempo constante), busca la comunidad solo dentro de ese cliente e inserta con `cliente_id`. Reemplaza al secreto global `MANYCHAT_WEBHOOK_SECRET`.
  - **Adaptado a la forma real de ManyChat (2026-09-29):** acepta `{ community_id, contact: <Full Contact Data> }`; toma el teléfono de `contact.whatsapp_phone` y lo normaliza a solo dígitos (`phone` llega `null` en WhatsApp); copia `first_name`/`last_name` (y `email`, si viene) a `usuario_curado` solo si todavía están vacíos y el nombre no es solo dígitos; si falta `community_id` usa el primer campo personalizado `Localidad*` con valor; `recibido_en` pasa a ser siempre la hora del servidor (un timestamp del emisor queda solo en el payload). Sigue aceptando el formato plano `{ phone, community_id }`. Sin probar contra ManyChat ni contra Supabase: la lógica de normalización, nombre y comunidad se probó aparte; el resto no se pudo ejecutar acá.
- `windsor-sync`: exige `cliente_id` en el body y sincroniza solo las comunidades de ese cliente.
- `panel-data`: exige `?cliente=` y filtra todo por ese cliente. **Sigue sin autenticar y con service_role**: no cierra el hallazgo 3.1, eso queda para el login y `005`.
- `nominacion-sync`: exige `cliente_id` y solo completa personas de ese cliente (antes actualizaba por teléfono en todos los clientes).
- `index.html`: selector de cliente en la barra lateral (recuerda la última elección), y `cliente_id` en todas las consultas, en el alta de comunidad y en la sincronización con Windsor.
- Docs: nueva guía [agregar un cliente](../docs/how-to/agregar-un-cliente.md); actualizadas las del webhook, deploy, variables de entorno y contrato de `panel-data`.

**Decisión (2026-09-29): el login y la `005` se dejan para el último momento.** Hasta entonces el panel sigue con la lectura abierta de `003`: los datos personales (teléfonos, nombres, emails) siguen legibles con la anon key, así que **no conviene cargar datos reales de miembros antes de hacerlo**. Lo que **sigue pendiente** de la sección: login y `005` (el panel todavía funciona con la lectura abierta de `003`, y el alta de comunidades desde el panel sigue sin poder escribir hasta que haya sesión), y mostrar el historial de estadios en el panel. **Antes de aplicar 005** el panel tiene que tener login, o todo se ve vacío.

## 3 quater. Contrato del POST de ManyChat: qué se manda y qué no (2026-09-29)

**Punto de partida:** el POST todavía no existe. Ningún flow de las tres cuentas tiene una acción External Request; el cierre de cada flow (`Acciones #8`) hace "Google Sheets: Insert Row" y un evento a Meta CAPI (`LeadSubmitted`, canal configurado: **Instagram**, en un flow que es de WhatsApp). Las columnas que escribe la planilla no se ven en la vista de solo lectura del flow, así que no se pudieron verificar. Lo que sigue compara lo que **ManyChat tiene** por contacto (perfil de un contacto de prueba en Growing Ideas) contra lo que **el webhook necesita y usa**.

| Dato | En ManyChat | Lo pide el webhook | Qué hace el webhook hoy | Estado |
|---|---|---|---|---|
| Teléfono | **Sí, pero no en el campo `phone`.** El número de WhatsApp viene en `whatsapp_phone` (formato `+549…`, con `+`). `phone` y el campo de sistema "Teléfono" llegan **`null`** para contactos de WhatsApp (verificado, ver "Verificación del teléfono") | Obligatorio (`phone`) | Guarda `phone` tal cual como `telefono_id`, sin normalizar | **No funciona tal cual:** si el POST manda "Teléfono" llega vacío y el webhook responde 400. Hay que mandar `whatsapp_phone` y normalizar (quitar el `+`) |
| Comunidad | No hay un campo "comunidad" como tal: hay `Localidad_Sanluis` (Growing Ideas y Todo un País) y `Localidad_CABA` (Cortado). Tras la rama del flow quedan con el nombre limpio ("Quines", "Boedo"…) | Obligatorio (`community_id`: uuid o nombre exacto) | Busca la comunidad por nombre dentro del cliente | Enviable si el POST sale **después** de las acciones de rama; el nombre del campo tiene que coincidir exacto con `comunidad.nombre` |
| Cliente y secreto | Constantes del flow | Headers `x-cliente` y `x-webhook-secret` | Los valida | Hay que configurarlos en cada cuenta |
| Momento | `last_interaction` (formato sin verificar) | Opcional (`timestamp`) | Si viene, lo usa para ordenar el primer contacto | Mejor **no mandarlo**: sin él usa la hora de recepción |
| Nombre | Sí: "Nombre" del perfil de WhatsApp; "Apellido" viene vacío. Hay contactos cuyo nombre es el propio teléfono (no revelaron nombre) | No | Queda dentro de `payload`, **pero no se copia a `usuario_curado`**: el panel seguiría mostrando "Usuario WA" | **Se manda y se ignora.** Falta que el webhook lo tome, y que descarte nombres que sean solo dígitos |
| Email | **No existe** en ninguna cuenta (no hay campo ni WhatsApp lo entrega) | No | — | Siempre "Sin email" |
| Estadio | Campo `Estado_Comunidad` = "Clic en grupo" | No | Ignora el campo; el estadio inicial sale del valor por defecto de la tabla | Suficiente para `clic_en_grupo`; cualquier estadio nuevo no se propagaría |
| ID de contacto de ManyChat (`subscriber_id`) | Sí | No | Se guardaría dentro de `payload` si se manda | Recomendable mandarlo: hace falta si se elige nominación por API |
| Etiqueta del barrio | Sí (una etiqueta por barrio) | No | No se usa | Redundante con la comunidad |
| Canal (WhatsApp/Instagram) | Cortado tiene 65 contactos de **Instagram** y 0 de WhatsApp | No | Un contacto de Instagram no tiene teléfono: el webhook respondería 400 | El POST tiene que salir solo del flow de WhatsApp |

**Conclusión:** con lo que ManyChat ya tiene alcanza para el mínimo (teléfono, comunidad, cliente). Lo que no está resuelto es que el nombre viaja pero no se aprovecha, que el email no existe, y que el nombre del campo de comunidad tiene que coincidir con el del CRM.

### Verificación en vivo (2026-09-29, desde Chrome, sin guardar nada)

Se abrieron en modo edición los pasos finales de los flows de Cortado y Todo un País y se cerraron con "Cancelar"; la fecha de modificación de ambos flows no cambió. También se abrieron las planillas de Drive.

| Cuenta | Acción de Google Sheets | Planilla | Contenido de la planilla |
|---|---|---|---|
| Cortado en Jarrito | Configurada: `Última interacción`→Fecha, `Nombre`→Nombre, `Teléfono`→Teléfono, `Localidad_CABA`→Localidad, etiquetas de Palermo/Boedo/Villa Devoto→una columna cada una, `Suscrito`→**Estado** | `Cortado _en_Jarrito_ Comunidades`, Hoja 1 | Solo los encabezados: 0 filas (coincide con las 0 ejecuciones) |
| Todo un País | **Sin planilla elegida** ("Selecciona una hoja de cálculo"): la acción existe pero no escribe en ningún lado | — | — |
| Growing Ideas | Configurada, **en el borrador** (el flow tiene cambios sin publicar): `Nombre` ← campo personalizado `First Name`; `Localidad` ← `Localidad_Sanluis`; una etiqueta por comunidad; `Estado` ← `Estado_Comunidad`. Los orígenes de `Fecha` y `Teléfono` figuran **vacíos** en esa versión | `TODO_UN_PAÍS_COMUNIDADES` (confirmado) | 9 filas del 2026-08-14 (las mismas que aparecen como ejemplo en el documento de Jaz). Fecha, Nombre, Teléfono, Localidad, una etiqueta TRUE/FALSE por comunidad, Estado = "Clic en grupo" |

Lo que revela la planilla con datos reales:
- La columna **Nombre está vacía en las 9 filas**, aunque los contactos tienen nombre en ManyChat: el mapeo de nombre nunca llegó a llenarse en esa versión del flow.
- **Localidad mezcla dos formatos**: a veces el mensaje completo ("Hola, quiero unirme a la comunidad de San Luis") y a veces el nombre limpio ("Quines"). El CRM necesita siempre el limpio.
- Las columnas de **etiquetas se acumulan** entre pruebas (una misma persona figura TRUE en varias comunidades): no sirven para saber la comunidad de origen.
- Hay **filas repetidas** del mismo teléfono y el mismo segundo (4 filas iguales): confirma que el crudo tiene que aceptar duplicados y la vista deduplicada resolverlos.
- La columna **Estado** vale "Clic en grupo" en la planilla de prueba, pero en el flow de Cortado está mapeada a `Suscrito` (estado de suscripción de ManyChat, no el estadio de la comunidad). Los dos flows no dicen lo mismo.
- Fila 2 con fecha y teléfono vacíos.
- Los nombres de variables que ofrece ManyChat en esos mapeos son: `Última interacción`, `Nombre`, `Teléfono`, y los campos personalizados (`Localidad_CABA`, etc.). La sintaxis exacta de llaves para el External Request se elige del selector al armarlo.
- **Por qué la columna Nombre está vacía (verificado en Growing Ideas):** ese flow manda a "Nombre" el campo personalizado `First Name`, que no se completa; el flow de Cortado usa el campo de sistema `Nombre`, que sí tiene el nombre del perfil de WhatsApp. Para el POST hay que usar el campo de sistema.
- Growing Ideas tiene Fecha y Teléfono sin origen en el borrador, pero las filas viejas sí traen ambos: la versión publicada probablemente los tenía. Hay que revisar qué versión corre (el flow muestra cambios sin publicar).
- **Evento a Meta CAPI (verificado):** existe **solo en Cortado** (`LeadSubmitted`). Su desplegable "Canal" ofrece Facebook, Instagram y WhatsApp y está en **Instagram**, siendo un flow de WhatsApp: está mal configurado (o quedó el valor por defecto). Los flows de Todo un País y Growing Ideas no lo tienen. No se cambió.
- **Sintaxis del External Request (verificado a medias).** La ayuda oficial de ManyChat ([Dev Tools: External request](https://help.manychat.com/hc/en-us/articles/14281285374364-Dev-Tools-External-request)) confirma: disponible en planes pagos (las tres cuentas son Pro), métodos POST/GET/PUT/DELETE, **solo URLs HTTPS** (Supabase lo cumple), cuerpo en JSON, y un botón "Test Request" contra un contacto de prueba. La lista de datos que documenta incluye estado, nombre, apellido, idioma, zona horaria y campos personalizados; **no menciona teléfono ni última interacción**. La sintaxis de llaves (`{{first_name}}`, `{{cuf_ID}}` para campos personalizados) sale de foros y de documentación de terceros, no de la ayuda oficial. **Verificado después en la interfaz:** ver el apartado siguiente.

### Verificación del teléfono en el External Request (2026-09-29)

Hecho en la copia en borrador de Growing Ideas (que estaba vacía), con un contacto de prueba de WhatsApp; el nodo de prueba se borró al terminar y el borrador quedó como estaba. La acción se llama "Realizar solicitud externa" y se encuentra en Acciones → Automatización.

- **El selector de campos** ("(+) Añadir un Campo") ofrece campos del sistema (Nombre, Apellido, Nombre completo, Correo electrónico, **Teléfono**, Última entrada de texto, Suscrito, Id de contacto, Last Reply Type, Full Contact Data...), campos personalizados y campos de bot. Se insertan como "pastillas" azules, no como llaves escritas a mano. Cada pastilla tiene un valor de reserva ("Fallback") y una opción "Encode to JSON".
- **"Teléfono" resuelve vacío** para el contacto de prueba, igual que el campo personalizado "Whatsapp Phone number" de Growing Ideas. El mismo panel resuelve bien "Nombre", así que no es un fallo de la vista previa.
- **"Full Contact Data"** inserta el objeto completo del contacto. Claves que trae: `key`, `id` (ID de contacto de ManyChat), `page_id`, `user_refs`, `status`, `first_name`, `last_name`, `name`, `gender`, `profile_pic`, `locale`, `language`, `timezone`, `live_chat_url`, `last_input_text` (el mensaje con el que entró, por ejemplo "Hola, quiero unirme a la comunidad…"), `optin_phone`, `phone` (**null**), `optin_email`, `email` (**null**), `subscribed` (fecha ISO con zona horaria, coincide con la fecha de las filas de la planilla), `last_interaction` (**null** en el contacto de prueba), `ig_*`, `whatsapp_phone` (**`+549…`**), `whatsapp_bsuid` (ID de usuario de WhatsApp, del tipo `AR.…`), `whatsapp_username`, `optin_whatsapp`, `phone_country_code`, `last_growth_tool` y `custom_fields` con todos los campos personalizados del contacto.
- **Consecuencias:**
  1. El POST tiene que salir con `whatsapp_phone` (no con "Teléfono") y el webhook tiene que **normalizar a solo dígitos**: hoy `+5493834290210` y `5493834290210` serían dos personas.
  2. `last_interaction` puede venir `null`; no conviene depender de él. Para el orden del primer contacto sirve la hora de recepción, y `subscribed` queda como dato de apoyo.
  3. `whatsapp_bsuid` es una segunda identidad estable (Meta está reemplazando el número por identificadores de usuario); conviene guardarla en el payload aunque hoy no sea la llave.
  4. Hay campos personalizados muertos (`Phone`, `First Name`, `Whatsapp Phone number`, `Barrio`) que están siempre `null`: no sirven para nada y confunden, en línea con lo que pasó con la columna Nombre de la planilla.
  5. El camino más simple es mandar **Full Contact Data** completo más dos valores fijos (cliente y comunidad), y que el webhook elija los campos. Requiere adaptar el webhook a esa forma, que difiere del contrato original (`phone`, `community_id`, `timestamp`).
- **Sigue sin probarse** un POST real contra el webhook: la vista previa resuelve variables pero no se apretó "Probar solicitud", para no enviar nada a un servidor.

**La planilla no es fuente del CRM.** Se llena por su cuenta desde ManyChat y el CRM no la lee. El CRM se alimenta únicamente del POST del webhook. La planilla puede seguir como respaldo; los datos de prueba del 2026-08-14 no se importan (nombre vacío, comunidad inconsistente, duplicados de prueba).

**Cómo se ve esa información en el panel del CRM** (contemplado en el diseño, sin datos hasta que exista el POST):
| Columna de la planilla | Dónde se ve en el panel | Se alimenta con el POST |
|---|---|---|
| Fecha | Base_Limpia (fecha 1º contacto), Data_Deduplicada, Data_Cruda | Sí (hora de recepción) |
| Teléfono | Todas las tabs de personas | Sí |
| Localidad | Base_Limpia y Overview (comunidad atribuida) | Sí, si se manda el nombre limpio |
| Nombre | Base_Limpia | **No todavía**: el webhook no lo copia (cambio propuesto, pendiente de aprobación) |
| Etiquetas por comunidad | — | No hace falta: la comunidad ya sale de la atribución |
| Estado | Base_Limpia (estadio) | Solo el valor inicial `clic_en_grupo`; los siguientes estadios están por definir |

## 3 quinquies. Estado de los hallazgos al cierre del 2026-09-29

Todo lo que sigue está **escrito en el repo y sin deployar ni aplicar** (no hay acceso a Supabase ni a Vercel desde esta sesión). El panel se probó en el navegador con un Supabase simulado: carga las 5 tabs, cambia de cliente, filtra por fechas, y el HTML malicioso se muestra como texto.

| Hallazgo | Estado |
|---|---|
| 3.1 Datos personales legibles | **Pendiente, a propósito**: se cierra con el login y `005` (último cambio). No cargar datos reales de miembros antes |
| 3.2 El panel no puede escribir | **Pendiente**: depende del login. Mientras tanto, las comunidades se cargan por SQL |
| 3.3 Vercel publica el repo entero | **Resuelto**: el frontend está en `public/` y `vercel.json` publica solo esa carpeta |
| 3.4 ManyChat sin POST al CRM | **Parcial**: el webhook ya entiende la forma real del POST; falta armar la acción en el flow de ManyChat (una prueba en Todo un País) |
| 3.5 Teléfono sin normalizar | **Resuelto en código**: el webhook normaliza a solo dígitos y `db/006` lo exige con una restricción |
| 3.6 Windsor: upsert y CTR | **Resuelto en código**: se suman las filas repetidas antes de guardar, se pide `clicks` y el CTR se calcula. El nombre del campo de conversaciones sigue sin confirmar (configurable) |
| 3.7 HTML sin escapar | **Resuelto**: todo valor dinámico pasa por un escapador |
| 3.8 Timestamp del emisor | **Resuelto**: `recibido_en` es siempre la hora del servidor |
| 3.9 Filtro por fechas | **Resuelto en código**: función `comunidad_performance_rango` y filtros en Control_Comunidades. Mi/Mf siguen sin fecha (decisión 6) |
| 3.10 Mi/Mf manuales sin fecha | **Abierto**: decisión 6 |
| 3.11 Bloques "sin fuente" | **Abierto**: CTR de anuncio ya tiene fuente; "trigger entregados", "contactos únicos en bot" y "envíos de enlace" siguen sin ella (decisión 3) |
| 3.12 Nominación | **Acotada por cliente**; opcional ahora que el webhook copia el nombre (decisión 4) |
| `panel-data` sin autenticar | **Pendiente**: con el login |

**Migraciones a aplicar, en orden:** `004` (clientes), `006` (fechas, clics, teléfono). `005` va al final. **Orden de deploy:** funciones y frontend primero, migraciones después (ver [desplegar](../docs/how-to/desplegar.md)).

## 3 sexies. Estado real del proyecto de Supabase (revisado el 2026-09-29, solo lectura)

Proyecto `crm-comunidades` (ref `zyyxsammrryhfrgfwlxr`), organización Marketing-Taquion-IGNITE, rama `main` de producción, **plan Free**. URL base de la API (formato estándar del ref): `https://zyyxsammrryhfrgfwlxr.supabase.co`.

| Qué se revisó | Resultado |
|---|---|
| Schema `crm_comunidades_v2` | Existe, con la forma **original**: `comunidad`, `evento_crudo`, `meta_ads_metrica`, `usuario_curado` y las vistas `evento_deduplicado`, `base_limpia`, `comunidad_performance`, `kpis_macro`. `usuario_curado` tiene 7 columnas (sin `cliente_id`). Es decir, `001` a `003` están aplicadas y `004` a `006` no |
| Datos | Las 4 tablas tienen **0 filas**. La migración `004` no tiene nada que backfillear |
| Políticas (RLS) | Coinciden con `003`: en cada tabla, SELECT abierto (`lectura_abierta`) y escritura solo autenticada. Confirma que el acceso público de lectura está activo hoy |
| Exposición a la Data API | Los 4 schemas están expuestos. Las 8 relaciones de V2 figuran con una alerta naranja que dice "custom grants": significa que sus permisos (los de `001`) difieren de los estándar de Supabase. **No es un error** y no hay que "corregirlo" con el botón de la interfaz, que pisaría nuestros permisos |
| Edge Functions | **No hay ninguna deployada**, ni las de V2 ni las de V1 (`api-publica`, `activacion-manychat`) |
| Secretos de funciones | **Ninguno cargado.** Solo están los reservados del sistema |
| Migraciones registradas | Ninguna: el esquema se aplicó desde el SQL Editor, no con la CLI |

Consecuencias:
1. **El webhook, Windsor, la nominación y `panel-data` no existen todavía en producción.** El botón "Sincronizar" del panel, y la prueba del POST desde ManyChat, no pueden funcionar hasta deployar las funciones.
2. **Clave de servicio "deprecada".** Supabase marca `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_ANON_KEY` como legadas y recomienda `SUPABASE_SECRET_KEYS` / `SUPABASE_PUBLISHABLE_KEYS`. Las funciones de este repo usan `SUPABASE_SERVICE_ROLE_KEY`: hoy sigue inyectada y funciona, pero conviene migrarla antes de que se retire.
3. **Plan Free.** Los proyectos Free se pausan tras un período sin actividad. Un webhook en producción que reciba tráfico esporádico corre el riesgo de encontrarse el proyecto pausado. Hay que decidir si se sube de plan o se acepta ese riesgo.
4. **Nada se aplicó ni se cambió** en este relevamiento.

**Actualización (2026-09-29, tras el deploy):** se deployaron `manychat-webhook` (sin verificación de JWT), `windsor-sync` y `nominacion-sync` con la CLI, todas ACTIVE (versión 1). **`panel-data` no se deployó a propósito**: usa la clave de servicio, no autentica y el panel actual no la llama; se deploya junto con el login. Prueba de humo: el webhook responde 405 a un GET y 401 sin headers; con un cliente inexistente responde 500 `Could not find the table crm_comunidades_v2.cliente`, lo que confirma que la función llega a la base con su clave de servicio y que **falta aplicar la migración `004`**. `windsor-sync` y `nominacion-sync` exigen el JWT de Supabase (401 sin él). Siguen sin secretos cargados: sin ellos responderán 501, salvo el webhook, que depende del hash guardado en la tabla `cliente`. Como el panel público lleva la anon key, cualquiera podría invocar `windsor-sync` y `nominacion-sync` cuando tengan sus secretos; se resuelve con el login.

**Actualización (2026-09-30, migración `004` aplicada):** se aplicó `db/004_cliente.sql` al proyecto con `supabase db query --linked`, dentro de una transacción, tras un ensayo con rollback y con las 4 tablas vacías. Verificado: existen `cliente` y `usuario_estado_historial`; `cliente_id` está en las 4 tablas; `usuario_curado` tiene PK `(cliente_id, telefono_id)`; las 2 FK compuestas existen; las 4 vistas se recrearon; 5 triggers activos; RLS activa en `cliente`; `anon` y `authenticated` **no** pueden leer `webhook_secret_hash` y `service_role` sí. Prueba funcional en una transacción deshecha (sin dejar datos): la misma persona en dos clientes queda como dos filas separadas, cada una atribuida a su propia primera comunidad; el historial registra `clic_en_grupo` → `en_el_grupo`; un evento que apunta a una comunidad de otro cliente es **rechazado** por la FK. Nota: con datos de prueba donde Mf supera a Mi + clics, la tasa de fuga da negativa (fórmula del documento con snapshots que no cuadran); es el comportamiento esperado de la fórmula, no un defecto. **Pendiente:** `006` (sin ella, `windsor-sync` falla al guardar la columna `clics`), alta del cliente `todo-un-pais` y secreto, y el panel nuevo en Vercel.

**Actualización (2026-09-30, migración `006` aplicada):** se aplicó `db/006_rango_fechas_y_clics.sql` con el mismo procedimiento (chequeo previo, ensayo con rollback, aplicación en transacción). Verificado: columna `meta_ads_metrica.clics` (int, default 0); función `comunidad_performance_rango(uuid, date, date)`; dos restricciones de teléfono `NOT VALID` (no revisan filas viejas, sí bloquean las nuevas; por eso `convalidated` figura `false`). Prueba en transacciones deshechas: la función devuelve inversión, conversaciones, impresiones, clics, CTR (clics/impresiones), clics únicos por fecha de primer contacto, CPL y CPCU; con datos de ejemplo, el total dio inversión 500, CTR 1,25 % y 3 clics únicos; agosto dio 200 y 2; septiembre 300 y 1; un cliente inexistente devuelve 0 filas. La restricción rechaza `+5493830000009`, `123` y `549 383 0000009`, y acepta `5493830000009`. Con esto `windsor-sync` ya puede guardar `clics`. **Pendiente:** alta del cliente `todo-un-pais` con su secreto, y el panel nuevo en Vercel. `005` y el login siguen para el final.

**Actualización (2026-09-30, cliente de prueba y webhook probado de punta a punta):** se dio de alta el cliente `todo-un-pais` (`manychat_account_id` `fb5616672`) con una comunidad de prueba `Quines`. El secreto se generó al azar (32 bytes) y se guardó **solo su hash SHA-256** en `cliente.webhook_secret_hash`; el secreto en claro está en `SECRETO-todo-un-pais.txt` dentro del repo local, ignorado por Git (`.gitignore`), para pegarlo en ManyChat y luego borrar el archivo. Prueba contra el webhook deployado con un contacto inventado (teléfono `+5490000000001`): secreto incorrecto → 401; comunidad inexistente → 404; sin teléfono → 400; contacto completo válido → 200, con teléfono normalizado a `5490000000001`, nombre "Prueba CRM" copiado a `usuario_curado`, estadio inicial `clic_en_grupo` registrado en el historial y visible en `base_limpia` atribuido a Quines. Los datos de prueba se borraron; quedan 1 cliente, 1 comunidad y 0 eventos. **Pendiente:** reemplazar en el flow de ManyChat la URL marcador y el secreto, y probar con "Probar solicitud" contra un contacto de prueba; publicar el panel nuevo en Vercel.

**Nota de seguridad (2026-09-30):** el secreto del webhook de `todo-un-pais` quedó **visible en una captura de pantalla compartida en el chat** (campo `x-webhook-secret` del editor de ManyChat). Se decidió seguir usándolo por ahora, solo para pruebas. **Hay que rotarlo antes de usar el webhook con tráfico real**: generar un secreto nuevo, actualizar `cliente.webhook_secret_hash`, pegarlo en ManyChat y borrar el archivo local. Además, el buscador "Contacto para pruebas" del flow de prueba de Todo un País no listó ningún contacto (el creado a mano, sin canal, tampoco aparece), así que la prueba del POST desde ManyChat con "Probar solicitud" quedó **sin hacer**; el servidor sí se probó de punta a punta con un contacto inventado.

## 4. Avance contra el checklist de entrega de Jaz

| Ítem del checklist | Estado |
|---|---|
| Maquetación de las 5 tabs | Hecho (funcional; Control sin filtro de fechas, tres bloques "sin fuente") |
| Atribución First-Contact | Hecho en SQL; falta normalizar teléfono y robustecer el timestamp |
| Módulo CPL | Hecho (Overview y Control) |
| Integración Windsor.ai | Código escrito, sin key, sin probar; con el bug de agregación |
| Módulo de Nominación | Código escrito, endpoint sin verificar |
| Base_Limpia (KPI cards + tabla con buscador/filtros/paginado) | Hecho en UI; sin edición de etiquetas/estado |
| Despliegue como Claude Artifact / MCP | **No hecho, por decisión explícita** (2026-09-25); `panel-data` deja el contrato listo. Falta confirmar con Jaz que aceptan la app en Vercel |

## 5. Supuestos externos a validar antes de escribirlos como "hecho"

1. **API de ManyChat.** El swagger público (`api.manychat.com/swagger`) no se pudo leer desde esta sesión. La doc de Jaz cita `GET /subscriber/getInfo`; el código usa `/wa/subscriber/getInfo?whatsapp_phone=`. Ninguno está confirmado. Validar en la documentación oficial o con una llamada de prueba antes de darlo por bueno.
2. **Variable de teléfono en el External Request.** La doc del repo usa `{{system field: phone}}` y `{{system field: last_interaction}}`; el nombre real de las variables se elige desde el selector de ManyChat.
3. **Campo de Windsor.** `messaging_conversation_started_7d` no se pudo confirmar en la documentación de Windsor. Validar el nombre exacto del campo con una consulta real (o con el conector MCP de Windsor).
4. Windsor sincroniza **una vez por día** (según los propios textos de Pulso Ignite): "conversaciones de hoy" siempre van a estar incompletas.

## 6. Camino al spec final

**Etapa A. Bloqueantes de seguridad y uso (antes de cualquier dato real)**
1. **Diferido por decisión (2026-09-29): se hace al último momento, antes de cargar datos reales.** Restaurar login (o al menos un acceso autenticado), quitar `lectura_abierta` y sacar las tablas con PII del alcance de `anon`.
2. Autenticar `panel-data` (o dejar de exponerla) y acotar CORS.
3. Cambiar `outputDirectory` a una carpeta `public/` con solo el frontend.
4. Escapar todo el HTML dinámico.
5. Cargar las comunidades reales (Boedo, Palermo, Villa Devoto...) con su `adset_name`.

**Etapa B. Circuito de datos reales**
0. Resolver antes la decisión 9 (CRM por cliente o único) y el modelo de cuenta/cliente en el esquema.
1. Definir el mapeo ManyChat, barrio a `community_id`, y agregar en el flow la acción External Request a `manychat-webhook` en un punto único (sección 3 bis), empezando por una comunidad de prueba en Todo un País.
2. Normalizar teléfono (en el webhook y como restricción en la base).
3. Definir qué timestamp manda para First-Contact.
4. Decidir el camino de nominación: API vs. mandar nombre/email en el webhook vs. CSV.
5. Cargar `MANYCHAT_WEBHOOK_SECRET`, deployar las 4 funciones y probar con un clic real de punta a punta.

**Etapa C. Paridad con Jaz**
1. Windsor: agregar `clicks` (CTR de anuncio), corregir el upsert, validar el nombre de campo y conectar con la cuenta real.
2. Filtro por rango de fechas en Control_Comunidades (y decidir cómo se tratan Mi/Mf en un período).
3. Eventos intermedios de ManyChat para los 3 bloques "sin fuente" (si Jaz los quiere).
4. Definir si se agenda `windsor-sync` (cron) o queda manual.

**Etapa D. Cierre documental**
Reescribir el spec V2 con la plantilla del método (front-matter, requisitos, criterios de aceptación, fuera de alcance, preguntas abiertas tachables, historial de implementación), incorporar `003`, corregir las contradicciones de la sección 3 y mover este documento al historial.

## 7. Decisiones que necesitan respuesta

| # | Pregunta | Quién | Por qué importa |
|---|---|---|---|
| 1 | (Login diferido al final por decisión del 2026-09-29.) ¿El CRM puede vivir con login y acceso restringido, o Jaz lo necesita público? | Taquion / Jaz | Define toda la Etapa A |
| 2 | ¿Se acepta la app en Vercel + Supabase en lugar de un Claude Artifact real? | Jaz | Último ítem del checklist |
| 3 | ¿Los eventos de ManyChat pueden ser más que el clic final (bot iniciado, enlace enviado)? | Jaz / Taquion | Llena 3 columnas hoy vacías |
| 4 | ¿Nominación por API, por datos en el webhook o por CSV semanal? | Jaz | Cambia el diseño de `nominacion-sync` |
| 5 | ¿Cuál es el dato de referencia del ejemplo JSON (clics 120 vs. 150)? ¿Tasa de fuga global ponderada o promedio simple? | Jaz | Fórmulas con criterio de aceptación |
| 6 | ¿Cómo se toman Mi y Mf: snapshots con fecha, o un único valor manual? | Taquion | Habilita filtros por período |
| 7 | ¿Qué hacer con el flow LIVE de Google Sheets: convive con el CRM o se reemplaza? | Taquion | Evita datos duplicados en dos lados |
| 8 | Cambio de nombre de WhatsApp rechazado por Facebook en Cortado: ¿se reintenta? | Taquion | El número sigue funcionando con el nombre actual; es de marca, no bloquea el CRM |
| ~~9~~ | ~~¿El CRM es por cliente o único para todos?~~ **Resuelto (2026-09-29): un solo CRM con selector de cliente, y los datos se separan por cliente.** Implementado en `db/004_cliente.sql` y `db/005_rls_por_cliente.sql` (ver sección 3 ter) | Taquion | El teléfono sigue identificando a la persona, pero la atribución y los datos son por cliente |
| 10 | ¿Growing Ideas se reactiva como sandbox o se abandona? Vence en un día | Lorena Rinaldini (titular) | Sin ella no hay entorno de prueba con los datos de Jaz |
| 11 | Tráfico real en Todo un País sin automatización que responda: ¿es esperado? | Lorena / Taquion | Contactos entrando y flow con 0 ejecuciones |
| ~~12~~ | ~~¿"Me sumo" es un botón de URL o de respuesta?~~ **Resuelto (2026-09-29): es la respuesta a una encuesta de ManyChat.** | Taquion | El evento es observable; la entrada real al grupo no |
| 13 | ¿Cuáles son los estadios de la persona después de "clic_en_grupo"? (en el grupo, abanderado, otros) y qué dispara cada cambio | Taquion / Jaz | Hoy solo existe `clic_en_grupo`; el resto está marcado "por definir" en el modelo y el diagrama |
| 14 | ¿Un usuario del panel puede tener acceso a más de un cliente y quién asigna los accesos (`usuario_cliente`)? | Taquion | Define qué clientes aparecen en el selector |

## 3 septies. Opción A aplicada en el flow real de Todo un País (2026-09-30)

- Flow "Comunidades TUP" (LIVE, cuenta `fb5616672`): el nodo final "Acciones #8" tiene ahora dos acciones: Google Sheets Insert Row (respaldo) y Solicitud externa (POST al webhook del CRM, headers `x-cliente: todo-un-pais` y `x-webhook-secret`, cuerpo `{"community_id": <Localidad_Sanluis>, "contact": <Full Contact Data>}`). Publicado por el usuario.
- Planilla `TODO_UN_PAÍS_COMUNIDADES` / Hoja 1, mapeo: Nombre ← Nombre completo, Teléfono ← WhatsApp ID, Localidad ← `Localidad_Sanluis`, Estado ← `Estado_Comunidad`, Etiqueta San Luis / Quines / La Toma ← las etiquetas homónimas. Fecha queda sin mapear (ManyChat no ofrece campo de fecha).
- Valores de `Localidad_Sanluis` en las ramas: `La Toma`, `San Luis Capital`, `Quines`. Las tres existen como comunidades del cliente `todo-un-pais` en el CRM (se crearon `La Toma` y `San Luis Capital`).
- Pendiente: prueba de punta a punta con un contacto real (la planilla estaba vacía al publicar); rotar el secreto del webhook antes de tráfico real.

## 3 octies. Cortado en Jarrito dado de alta (2026-10-01)

- **Decisión del equipo (2026-10-01):** Todo un País queda en pausa (su número de WhatsApp no está activo). Todos los clientes de Taquion con una comunidad van a este mismo CRM. Se hizo el procedimiento completo con Cortado en Jarrito, que sí tiene WhatsApp activo (+54 9 11 2753-5622).
- **Base de datos:** cliente `cortado-en-jarrito` (cuenta `fb5616665`) con secreto propio (archivo local ignorado por Git, hash en la base). Comunidades `Boedo`, `Palermo`, `Villa Devoto`.
- **ManyChat:** acción "Solicitud externa" agregada al nodo final del flow "Test Comunidades Cortado en Jarrito", con `x-cliente`, `x-webhook-secret` y cuerpo `{community_id: Localidad_CABA, contact: Full Contact Data}`. El evento a la API de conversiones de Meta pasó del canal Instagram a WhatsApp.
- **Hallazgo:** las condiciones del flow comparaban con "es" una frase que termina en ☕; los mensajes escritos a mano caían todos en Villa Devoto. Se cambiaron a "contiene". Probado: "…Cortado en Jarrito Boedo" → Boedo.
- **Otros hallazgos:** el monedero de WhatsApp de Cortado figuraba sin saldo en los registros (4 avisos críticos); el disparador de etiqueta no sirve para probar porque el flow aplica etiquetas (riesgo de bucle); el chat de la bandeja de entrada está bloqueado por permisos del usuario actual.
- **Panel:** la pestaña Data_Cruda pasó a ser un registro legible (nombre, comunidad, texto recibido, JSON plegable, botón y refresco automático). Los intentos rechazados no quedan guardados.
- **Pendiente:** ignorar nombres de solo puntuación (el perfil de prueba se llama "."); rotar secretos antes de tráfico real; login, migración 005 y `panel-data` al final.

## 3 nonies. PR #2 — Intentos rechazados del webhook visibles en Data_Cruda (2026-10-01)

- **Qué:** nueva tabla `webhook_intento` (migración `db/007`, aplicada) donde la función `manychat-webhook` anota cada POST rechazado de un cliente identificado: código (400/401/404/500/501), motivo en palabras, comunidad recibida y teléfono si se leyó. Nunca guarda el secreto ni el body. No registra intentos sin cliente identificable (headers ausentes o slug inexistente).
- **Panel:** Data_Cruda tiene un filtro **Todos · Aceptados · Rechazados** con conteos, una columna Resultado (Aceptado / Rechazado + código) y el motivo en la columna Detalle.
- **Respuestas HTTP:** sin cambios (mismos códigos y mensajes que antes).
- **Probado** con un cliente temporal (ya eliminado): secreto incorrecto → 401, comunidad inexistente → 404, sin teléfono → 400, cliente inexistente y sin headers → 401 sin registro, caso válido → 200.
- **Con el login:** `db/005` ya incluye la tabla (solo lectura por cliente). Orden de aplicación: 007 antes que 005.
- **Pendiente:** política de retención de `webhook_intento` si el volumen crece.

## 3 decies. PR #3 — Limpieza de datos de prueba de Cortado en Jarrito (2026-10-01)

- **Qué:** se borraron de producción los datos de las pruebas del equipo hechas ese día en el cliente `cortado-en-jarrito`: 14 eventos de `evento_crudo`, 7 personas de `usuario_curado` y sus 7 registros de `usuario_estado_historial`. Alcance acotado a lo recibido hasta las 11:32:33 (hora de Argentina); se verificó antes que no había eventos posteriores.
- **Cómo:** consulta SQL con verificación previa del alcance y conteo posterior. Estado final: `cortado-en-jarrito` y `todo-un-pais` con sus 3 comunidades cada uno y 0 eventos, 0 personas y 0 rechazos.
- **Sin cambios de código:** esta PR solo deja el registro del borrado. No toca el panel, la función ni el esquema.
- **Queda para después (no incluido):** las condiciones del flow de Cortado siguen comparando contra la frase completa, y un mensaje de Palermo con otra redacción cae en Villa Devoto. La carga manual de miembros (Mf) sigue en 0 hasta que se cargue.

## 3 undecies. PR #4 — Contactos de Instagram (2026-10-02)

- **Problema:** el flow de Instagram de Cortado ("Test Comunidades Cortado en Jarr IG") enviaba el POST pero el CRM lo rechazaba con 400: la persona se identificaba solo por teléfono y un contacto de Instagram no tiene.
- **Qué:** migración `db/008` — la columna `telefono_id` (se conserva el nombre) acepta también `ig:<id numérico>`. El webhook usa `contact.whatsapp_phone` si llega; si no, `contact.ig_id`. El canal se deduce del prefijo (no hay columna nueva). La respuesta del webhook incluye `canal`.
- **Precisión del ig_id:** los identificadores de Instagram tienen 17 dígitos y `JSON.parse` los redondea si llegan como número (…123 → …124). El webhook toma el id exacto del texto del body. Atención: el `payload` guardado en `evento_crudo` sí pasó por `JSON.parse`, así que su `ig_id` puede verse redondeado; la clave real de la persona es `telefono_id`.
- **Rechazos más claros:** si no llega ni teléfono ni `ig_id`, el motivo (visible en Data_Cruda → Rechazados) lista los nombres de los campos del contacto que sí llegaron (nunca los valores).
- **Panel:** etiqueta de canal (WhatsApp / Instagram) en Data_Cruda, Base_Limpia y Data_Deduplicada; en Data_Cruda un contacto de Instagram se muestra como @usuario si ManyChat lo envía. Las columnas "Teléfono" pasaron a "Contacto".
- **Probado** con un cliente temporal (eliminado): Instagram con `ig_id` numérico y como texto, WhatsApp, ambos a la vez (gana WhatsApp), repetido sin duplicar persona, sin identificador y `ig_id` corto (400).
- **Limitación conocida:** la misma persona en WhatsApp e Instagram cuenta como dos. La confirmación con una ejecución real de Instagram quedó **resuelta el 2026-10-05**, ver la sección 3 duodecies.

## 3 duodecies. Instagram confirmado con un caso real (2026-10-05)

- **Qué se probó:** primera ejecución real del flow de Instagram de Cortado ("Test Comunidades Cortado en Jarr IG") después de la PR #4. El CRM la aceptó y apareció en Data_Cruda con la etiqueta Instagram.
- **Qué mandó ManyChat:** `contact.ig_id` llegó como **número JSON** de 16 dígitos (por eso fue necesaria la lectura del id desde el texto crudo: con 17 dígitos `JSON.parse` lo redondea), `contact.ig_username` y `contact.name` con valor, y el resto del contacto igual que en WhatsApp (`whatsapp_phone` y `phone` sin valor).
- **Resultado en el CRM:** clave `ig:<16 dígitos>`, persona creada en `usuario_curado`, comunidad enviada por el flow (`Villa Devoto`) asignada correctamente, estado `clic_en_grupo`.
- **Queda cerrado** el pendiente de la PR #4 (confirmar los campos que manda ManyChat desde Instagram).
- **Sigue abierto:** la misma persona en WhatsApp e Instagram cuenta como dos.

## 3 terdecies. Estado vigente y backlog (2026-10-05)

**En producción**
- Panel en `crm-comunidades-v2.vercel.app` (Vercel, despliegue automático desde `master`): 5 pestañas, selector de cliente, filtros de fecha, Data_Cruda como registro con filtro Aceptados / Rechazados, etiqueta de canal (WhatsApp / Instagram) y aviso del origen del campo Nombre.
- Base de datos (Supabase `crm-comunidades`): migraciones `001` a `004`, `006`, `007` y `008` aplicadas. `005` (login) escrita, sin aplicar.
- Edge Functions deployadas: `manychat-webhook`, `windsor-sync` (sin API key cargada) y `nominacion-sync` (sin `MANYCHAT_API_KEY`). `panel-data` **no** está deployada: espera al login.
- Clientes: **Cortado en Jarrito** (probado de punta a punta por WhatsApp e Instagram) y **Todo un País** (configurado con POST publicado; sin tráfico porque su WhatsApp no está activo).
- SOP-001 (`docs/sop/`) con el procedimiento de alta de un cliente.

**Backlog**

| Prioridad | Ítem |
|---|---|
| P1 | Rotar el secreto de **Cortado** (quedó visible en una captura del 2026-10-07). El de Todo un País se rotó el 2026-10-07 |
| P1 | Login, migración `005` y `panel-data` (hoy el panel muestra teléfonos y nombres a quien tenga la URL) |
| P1 | Corregir las condiciones de los flows (usar "Contiene" con la palabra sola, no "Es" con la frase completa): Cortado WhatsApp, Cortado Instagram y Todo un País |
| P2 | Todo un País: ya recibe tráfico por Instagram. Falta revisar el flow de WhatsApp (copiado de Cortado: encabezados, enlaces de grupo y nombres) y probarlo con un contacto real |
| P2 | Dar de alta Growing Ideas (cuenta `fb5347078`) |
| P2 | Recargar el monedero de WhatsApp de Cortado |
| P2 | Datos de Meta Ads: la fuente quedó asentada (cuenta `TQN - Growing 2 - LC`, ver 3 septendecies). Falta confirmar los conjuntos de anuncios por comunidad y el campo de conversaciones (`actions_onsite_conversion_messaging_conversation_started_7d`); no se carga la clave de Windsor en Supabase hasta validar al usuario en `windsor-sync` |
| P2 | Carga manual de miembros iniciales y finales (MI / MF) |
| P2 | Panel: aclarar los cuadros "miembros reales" de Base_Limpia y avisar cuando MF está sin cargar |
| P2 | Política de retención de `webhook_intento` |
| P3 | Decisiones con Jaz: estadios posteriores a `clic_en_grupo`, fechas para MI / MF, eventos intermedios del bot, nominación por API o por POST, unificar personas entre WhatsApp e Instagram |
| P3 | Migrar de la clave `service_role` a las nuevas claves de Supabase; evaluar el plan pago (el Free pausa proyectos inactivos) |
| P3 | Evento a la API de conversiones de Meta en los clientes que lo necesiten (hoy solo Cortado) |

## 3 quaterdecies. PR #6 — Exportar Data_Cruda a CSV (2026-10-07)

- **Qué:** botón **Exportar CSV (toda la base)** en Data_Cruda. Descarga **toda la historia del cliente elegido** (eventos aceptados y rechazados), no solo las 200 filas visibles: trae los datos de a 1000 por consulta hasta completar.
- **Columnas:** fecha y hora (Argentina y UTC), resultado (Aceptado / Rechazado), código HTTP, canal, contacto, usuario de Instagram, nombre, comunidad asignada, comunidad enviada, mensaje de la persona (`last_input_text`), motivo del rechazo y el JSON completo del payload.
- **Formato:** UTF-8 con BOM (acentos correctos en Excel), saltos de línea CRLF, todas las celdas entre comillas, separador a elección (`;` para Excel en español, `,` estándar). Más reciente primero. Archivo `data_cruda_<cliente>_<fecha>.csv`.
- **Seguridad del archivo:** las celdas que empiezan con `=`, `+`, `-` o `@` se prefijan con `'` para que Excel no las ejecute como fórmula (los nombres de perfil los escribe cualquiera). Los teléfonos van como `="…"` para que Excel no los muestre como `5,49E+12`.
- **Alcance:** un cliente por archivo (el elegido en el selector). Mientras exporta se pausa el refresco automático.
- **Ojo:** el archivo contiene datos personales y el panel todavía no tiene login; quien tenga la URL puede exportarlo. No compartir ni dejar los archivos sueltos.

## 3 quindecies. PR #7 — Los rechazos guardan el JSON completo (2026-10-07)

- **Por qué:** el 6 de octubre el flow de Instagram de Todo un País empezó a enviar con el cliente y el secreto de Cortado. El CRM rechazó 123 envíos de 99 personas con 404 (comunidades que Cortado no tiene) y, como los rechazos solo guardaban el motivo, la comunidad y el identificador, se perdieron el nombre, el @usuario y el mensaje. Un error de configuración no debería hacer perder información que no se puede recuperar.
- **Qué:** `db/009` agrega `webhook_intento.payload` (jsonb) y la tabla `webhook_intento_sin_cliente`. Ahora **cada rechazo guarda el contenido completo del POST**. Con cliente identificado va a `webhook_intento` y se ve en Data_Cruda (botón Ver JSON, nombre y mensaje en el CSV). Sin cliente identificable (encabezados ausentes o `x-cliente` inexistente, p. ej. un slug mal escrito) va a `webhook_intento_sin_cliente`, que el panel **no** lee (solo por SQL).
- **Qué no cambia:** las respuestas HTTP son las mismas. El secreto nunca se guarda (viaja en un header). Un `ig_id` de 17 dígitos se conserva exacto en `_ig_id_exacto`.
- **Topes** (para que el ruido de internet no llene la base): contenido máximo de 64 KB (por encima se guarda el comienzo con una marca), 200 rechazos por secreto incorrecto cada 10 minutos por cliente y 300 sin cliente por hora.
- **Probado** en producción con un cliente temporal (ya eliminado): secreto incorrecto, comunidad inexistente, cliente inexistente, sin encabezados, body que no es JSON, body de más de 64 KB y caso válido. Se comprobó que el secreto no queda guardado en ninguna tabla.
- **Pendiente:** política de retención de ambas tablas. Los rechazos anteriores a esta PR no guardaron el contenido y no se pueden recuperar con el JSON; sus identificadores y horas sí (ver la migración de los eventos de Todo un País).

## 3 sexdecies. PR #8 — Todo un País: flow mal copiado de Cortado, corrección y migración (2026-10-07)

**Qué pasó.** El flow de Instagram de Todo un País ("Test Comunidades IG", creado el 2026-10-02 copiando el de Cortado) estuvo LIVE desde el 2026-10-06 a las 19:05 con tres errores heredados de Cortado:
1. **Encabezados:** enviaba `x-cliente: cortado-en-jarrito` y el secreto de Cortado. El CRM lo autenticaba como Cortado y rechazaba cada envío con 404, porque las comunidades (San Luis, Quines, La Toma) no son de Cortado. La separación por cliente funcionó: no se mezcló ningún dato.
2. **Nombre de la comunidad:** la rama de San Luis escribía `San Luis`, y en el CRM la comunidad se llama `San Luis Capital`.
3. **Enlace del botón "Me sumo":** abría el **grupo de WhatsApp de Cortado**, no el de Todo un País. Las personas que entraron por ese flow en ese período llegaron al grupo equivocado. **El CRM no puede detectar este error** (el POST sale bien y la persona figura como "clic en grupo").

**Qué se hizo (todo el 2026-10-07).**
- Se rotó el secreto de Todo un País (el anterior había quedado visible en una captura). Verificado: el nuevo autentica, uno erróneo da 401.
- El equipo corrigió el flow: encabezados y secreto de Todo un País, valor `San Luis Capital` y los enlaces de los botones. La corrección de los enlaces se confirmó alrededor de las 14:24 (hora de Argentina).
- **Migración de los envíos rechazados:** 133 rechazos de Cortado (de unas 99 personas) se convirtieron en eventos aceptados de Todo un País, con su hora original y marcados con `_recuperado` en el payload (script en `db/mantenimiento/2026-10-07_migrar_rechazos_a_todo_un_pais.sql`). `San Luis` se convirtió en `San Luis Capital`. Los candidatos, insertados y borrados coincidieron (133). Se ensayó antes con rollback.
- **Límite de la recuperación:** los rechazos de ese período anteriores a la PR #7 no guardaron el contenido, así que de esas personas se recuperaron el identificador de Instagram, la comunidad y la hora, pero **no el nombre ni el @usuario** (solo 18 de las 119 personas tienen nombre).
- **Estado final de Todo un País:** 144 eventos de 119 personas únicas; 0 rechazos. Cortado: 20 eventos, 18 personas, 1 rechazo (el real del 2026-10-02).

**Cómo leer esos números.** Los eventos de Todo un País anteriores a la corrección del enlace significan "la persona escribió y tocó el botón", **no** "entró al grupo de Todo un País": esas personas fueron a un grupo de Cortado. No sirven como miembros del grupo. Los grupos de WhatsApp de Cortado pueden tener personas de San Luis que no son de su comunidad.

**Acciones para el equipo.** Avisar al equipo de Cortado; decidir si se recontacta a las personas afectadas (en Instagram solo se puede escribir dentro de las 24 horas desde su último mensaje, o con las etiquetas de mensaje que permita ManyChat, que hay que verificar); la lista sale de Data_Cruda → Exportar CSV, con el cliente Todo un País.

**Qué cambió en el procedimiento.** El SOP-001 (v1.4) tiene un recuadro "Si copiás el flow de otro cliente, cambiá todo esto" (encabezado, secreto, enlace de cada "Me sumo", valor de la localidad, etiquetas, mensajes y planilla), un paso de prueba que obliga a comprobar que el grupo que se abre es el del cliente, y dos filas nuevas en la tabla de errores.

**Pendiente.**
- **Rotar el secreto de Cortado:** quedó visible en una captura. Hay que cambiarlo a la vez en la base y en sus dos flows (WhatsApp e Instagram), porque tienen tráfico real.
- **Revisar el flow de WhatsApp de Todo un País ("Comunidades TUP")** antes de activarlo: se copió igual que el de Instagram y probablemente tiene los mismos errores (encabezados, enlaces y nombres).
- **Dar de alta Growing Ideas**, que no está en el CRM.

## 3 septendecies. Control_Comunidades: de dónde salen los datos de Meta Ads (decisión del 2026-10-08)

**Pregunta.** ¿Los datos de Meta Ads (inversión, impresiones, clics y conversaciones por comunidad) se toman directamente de Windsor.ai o a través de Pulso?

**Decisión: directamente de Windsor.ai, no a través de Pulso.** Motivos verificados leyendo el código de Pulso (`pulso-ignite/lib/windsor*.ts`):
- Pulso trabaja a nivel **campaña y anuncio**, agregado por período. Nunca pide `adset_name` ni campos de mensajes (su `conversions` es genérico), y el CRM necesita datos **por conjunto de anuncios y por día** (`meta_ads_metrica`: una fila por comunidad y fecha).
- Los endpoints de Pulso son públicos y la seguridad de Pulso y del CRM V2 está en manos del equipo de Tecnología: depender de ellos acoplaría el CRM a algo que va a cambiar.
- Pulso tarda de 9 a 20 segundos en consultas de anuncios; no conviene encadenarlo.
- Se **reutilizan sus lecciones, no su código**: reintentos ante 429 y 5xx, tiempo límite, tope de consultas simultáneas y `trim()` de los nombres (a Pulso un espacio invisible le rompió el cruce de nombres en silencio).

**Fuente asentada.** Cuenta publicitaria de Meta **`TQN - Growing 2 - LC`** (ID `1669338306456901`), conector Facebook de Windsor. Evidencia: la vista de Pulso muestra, dentro de esa cuenta, las campañas `TQN_AON_META_CON_INTE_MANUAL_CORTADO_EN_JARRITO`, `TQN_META_CON_LEADS_MANUAL_CORTADO_EN_JARRITO_WHATSAPP` y `TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS`, todas con gasto real. Confirmado por el equipo que **la cuenta `Cuenta Todo un País` (ID `2519911211576322`), también conectada en Windsor, no se usa** y se ignora.

**Lo que Windsor tiene conectado** (revisado el 2026-10-08 en modo solo lectura): Facebook: `TQN - Growing 2 - LC`, `TQN - Growing - LC`, `Diego Marcelo Lajst`, `Cuenta Todo un País`, `Froneri Arg`; Google Ads: `TQN - LC`, `FRONERI`; una hoja de Google Sheets; TikTok: `Taquion`, `Taquion0126`, `Taquion-AdAccountTTK`. Windsor ofrece además **Supabase y PostgreSQL como destinos**: Windsor podría escribir directamente en una tabla, sin función propia ni clave de Windsor en la nube. Queda como alternativa a consultar con Tecnología (implica darle a un servicio externo un usuario de base, y no se verificó si el plan lo incluye).

**Consecuencias de diseño** (a implementar en una PR aparte):
1. **El cliente se distingue por la campaña, la comunidad por el conjunto de anuncios.** El mapeo actual (`comunidad.adset_name`, único por cliente) no alcanza en una cuenta compartida. Propuesta: una tabla que diga, para cada comunidad, qué campaña y qué conjunto de anuncios le corresponden (varios por comunidad), comparando con `trim` y sin diferencia de mayúsculas.
2. **El campo de conversaciones tiene otro nombre.** En el conector de Windsor es `actions_onsite_conversion_messaging_conversation_started_7d`, no `messaging_conversation_started_7d` (el del documento de Jaz). `adset_name` sí existe.
3. **No se carga `WINDSOR_API_KEY` en Supabase** hasta que `windsor-sync` valide al usuario (hoy se puede invocar con la clave pública del panel y gastaría el cupo de Windsor). Mientras tanto: importación desde la computadora del equipo, que lee la clave del entorno local y escribe en `meta_ads_metrica`.

**Pendiente.** Ver en Windsor, para las campañas de Cortado y Todo un País: los nombres de los conjuntos de anuncios (¿traen el barrio?), si el campo de conversaciones devuelve números, y si hay otras campañas de estos clientes (por ejemplo, las de Instagram). Hasta tener eso no se define el mapeo definitivo.

## 3 octodecies. PR #10 — Importador de Meta Ads por comunidad (2026-10-08)

Implementa las consecuencias de diseño 1 y 3 de la sección 3 septendecies.
- **Base (`db/010`, aplicada):** tabla `comunidad_meta_origen` (campaña + conjunto → comunidad; conjunto vacío = toda la campaña), `cliente.meta_cuenta_id` y función `normalizar_nombre()`.
- **Mapeo cargado (`db/mantenimiento/2026-10-08_cargar_mapeo_meta.sql`):** Cortado en Jarrito → Boedo, Palermo, Villa Devoto y "Cortado en Jarrito (general)" (campaña sin barrio); Todo un País → La Toma, Quines, San Luis Capital (San Luis = San Luis Capital, confirmado) y "Todo un País (general)" (sin campaña asignada todavía). Cuenta `1669338306456901` para ambos.
- **Importador (`scripts/windsor-importar.mjs` + `scripts/lib/windsor-mapeo.mjs`, 17 pruebas):** lee un CSV de Windsor o la API, ensayo por defecto, `--aplicar` guarda por upsert (comunidad, fecha). Clave de Windsor solo en el entorno local.
- **Primera importación real (CSV del 1 al 7 de octubre):** 19 registros comunidad×día, inversión total 714.202,21; 121 filas de campañas de otros clientes ignoradas. Repetirla no duplica.
- **Límites conocidos:** el CSV no traía `impressions` (impresiones y CTR en 0 hasta reimportar con esa columna); la campaña de Cortado "general" tiene 14.014 clics y 6 conversaciones (revisar con el equipo si el objetivo de esa campaña es tráfico y no mensajes); la comunidad "Todo un País (general)" no tiene campaña mapeada.
- **Seguridad:** `comunidad_meta_origen` es solo lectura para el panel; `anon` no puede escribir. `db/005` la incluye para cuando haya login.

## 3 novodecies. PR #11 — Títulos de la matriz de Control_Comunidades (2026-10-08)

Error de presentación, no de datos: los títulos decían "Trigger entregados, Envíos de enlace, Clics únicos" pero las celdas se pintaban como trigger (sin fuente), clics únicos, envíos de enlace (sin fuente). Se intercambiaron los dos títulos del medio; los números no cambian. Origen: anterior a la PR #10.

## 3 vicies. PR #12 — Trigger entregados y columna Envíos de enlace (2026-10-08)

- **Envíos de enlace: columna eliminada.** El equipo confirmó que el enlace al grupo se envía justo después de "Me sumo": es el mismo evento que ya cuenta como clic único, así que la columna mostraría el mismo número.
- **Trigger entregados: ahora tiene fuente.** El flow de ManyChat manda un segundo POST al empezar, con `"evento": "trigger"`. El webhook lo guarda en `trigger_entregado` (db/011) y **no** en `evento_crudo`, para no alterar clics únicos, atribución ni Base_Limpia. El panel cuenta personas distintas por comunidad y rango de fechas (`comunidad_performance_rango.triggers_entregados`). Hasta que el flow mande el aviso, la celda sigue diciendo "sin fuente" con la explicación.
- **Panel:** además se corrigieron los grupos de encabezado de la matriz (Meta Ads / ManyChat Bot / CRM) que estaban corridos respecto de sus columnas.
- **Verificado:** con rollback sobre producción, 4 avisos de 3 personas (uno de hace 40 días) dan 3 en el histórico y 2 en los últimos 7 días (uno quedó fuera de rango), los clics únicos no cambian, no se crean eventos crudos y `anon` no puede insertar. Webhook desplegado.
- **Pendiente del equipo:** agregar el paso "Solicitud externa" al empezar cada rama del flow (pasos en `docs/how-to/configurar-webhook-manychat.md`). SOP-001 (PDF) todavía no incluye este paso.

## 3 unvicies. PR #13 — Documentación corregida tras leer el flow real de Cortado (2026-10-08)

Lectura en modo solo lectura del flow `Test Comunidades Cortado en Jarrito` (cuenta ManyChat de Cortado), versión publicada:
- **Condiciones con frase completa: es a propósito.** El texto sale prellenado del formulario de anuncios con opción múltiple. Se retira la recomendación anterior de pasarlas a "Contiene" con una palabra sola (README, how-to y SOP-001 v1.5). Si cambia el texto del formulario, hay que cambiar la condición.
- **El POST al CRM no espera el toque en "Me sumo".** Todos los pasos están encadenados con "Siguiente paso" (acciones de rama, mensaje de términos y nodo final con el POST). Evidencia: en Villa Devoto, de 7 mensajes enviados el 71,4 % hizo clic (5 personas) y el segundo mensaje se envió a 6. Consecuencia: lo que el CRM llama "clics únicos" son **entradas al flow**, no toques del botón. **Pendiente de confirmar** con una prueba sin tocar el botón.
- **Panel:** se renombran las etiquetas ("Clics únicos" → "Entradas al flow", "Tasa clic a grupo" → "Entradas / conversaciones"). Los nombres internos en la base no cambian.
- **Trigger entregados (PR #12):** con este flow daría casi lo mismo que las entradas al flow; queda disponible pero opcional. Documentado en el how-to.
- **Decisión:** el flow se deja como está por ahora. Medir el toque real implicaría convertir "Me sumo" en un botón que continúa el flow, con el enlace al grupo en el mensaje siguiente.

## 3 duovicies. PR #16 — Nombres de los costos y corrección del how-to del trigger (2026-10-08)

- **Panel, Control_Comunidades:** "CPCU" pasa a "Costo por entrada al flow" y "CPMN / Tasa fuga" se separa en "Costo por miembro neto" y "Tasa de fuga" (la tabla tenía 3 celdas financieras y solo 2 títulos, así que la tasa de fuga quedaba sin encabezado). Los nombres internos en la base no cambian.
- **Qué mide cada costo:** CPL = inversión ÷ conversaciones de Meta; costo por entrada al flow = inversión ÷ personas que entraron al flow (no es una incorporación al grupo); **costo por miembro neto (CPMN) = inversión ÷ (MF − MI)**, el que corresponde a "costo por incorporación" y requiere cargar MI y MF.
- **How-to del trigger:** `community_id` del aviso va como **texto fijo por rama**, no con `Localidad_…` (en ese punto del flow el campo todavía tiene la frase completa del anuncio). Se enlaza el instructivo en PDF (PR #15).

## 3 tervicies. PR #17 — Fila "Total del cliente" en Control_Comunidades (2026-10-08)

- La matriz suma al pie **todas las comunidades del cliente** (aunque haya una elegida en el filtro) y **recalcula las razones con esos totales**, no promedia filas: CPL = inversión total ÷ conversaciones totales; costo por entrada al flow = inversión total ÷ entradas totales; CTR = clics ÷ impresiones.
- Resuelve que la inversión de la comunidad "(general)" (campañas que no distinguen barrio) no entraba en ningún costo por entrada: en el total sí cuenta. Las entradas no se duplican (atribución por primer contacto).
- Respeta el rango de fechas elegido. Sin MI y MF cargados, el costo por miembro neto del total queda en "—".
- Verificado con datos reales: el total histórico de Cortado ($7.899.429,93, 96 conversaciones, CPL $82.285,73) coincide con los KPIs de Overview.

## 3 quatervicies. PR #18 — Columna "CTR (todos los clics)" (2026-10-08)

La columna "CTR anuncio" de Control_Comunidades pasa a llamarse **"CTR (todos los clics)"**: es clics totales ÷ impresiones, igual al "CTR (todos)" de Ads Manager (verificado el 6–7/10: Cortado WhatsApp 3,46 % y Todo un País 2,65 % en ambos). No es el CTR de clics en el enlace de Meta (1,53 % y 1,58 % esos días). Solo cambia la etiqueta.

## 3 quinvicies. PR #19 — Clientes potenciales (Meta) por comunidad (2026-10-08)

- **Campo elegido: `actions_onsite_conversion_lead_grouped`** de Windsor (conector Facebook). Se probó contra el CSV del 6 al 7 de octubre: Todo un País suma 158 y Cortado WhatsApp 0, igual que la columna "Resultados" ("Cliente potencial de Meta") de Ads Manager. `actions_lead` dio lo mismo en esos días; los demás campos de leads (formulario instantáneo, pixel, offline) vinieron vacíos.
- **No es lo mismo que "Conversaciones":** las conversaciones de mensajes iniciadas (`actions_onsite_conversion_messaging_conversation_started_7d`) siguen importándose aparte (45 y 350 esos días, coinciden con Ads Manager).
- **Base:** `db/012` agrega `meta_ads_metrica.leads_meta` y `leads_meta` / `costo_por_lead` a `comunidad_performance_rango`.
- **Importador:** lee la columna y la guarda por upsert; 18 pruebas. **Panel:** columnas "Clientes potenciales (Meta)" y "Costo por cliente potencial" (también en el total del cliente). Total Todo un País 6–7/10: 158 leads, $732,65 por lead, igual al de Ads Manager.
- **Importación del CSV (1 al 7/10):** también actualizó la inversión a los valores vigentes de Meta ($55.171,70 Cortado WhatsApp y $115.758,22 Todo un País, iguales a Ads Manager).
- **Observación abierta:** Cortado WhatsApp muestra 0 leads en Meta pero 23 entradas al flow en el CRM; el flow de Todo un País sí coincide (158 vs 162). Pendiente revisar en Events Manager si el evento de ManyChat llega a Meta desde la cuenta de Cortado.

## 3 sexvicies. PR #20 — Columnas personalizables en Control_Comunidades (2026-10-08)

- Botón **"Columnas"** junto a los filtros, como en el Administrador de anuncios de Meta: se puede **ocultar y mostrar** cada columna, **reordenarlas** (arrastrando o con ↑ ↓) y **restablecer** el orden original. "Comunidad" siempre va primera.
- La preferencia se guarda **en el navegador de cada persona** (localStorage), sin tocar la base: cada usuario ve su propia configuración. Si el navegador no permite guardar, vale solo para esa sesión.
- La fila "Total del cliente" sigue las mismas columnas que se ven. Las columnas nuevas que se agreguen en el futuro aparecen al final automáticamente.
- Los encabezados de grupo (Meta Ads / ManyChat Bot / …) pasaron a una etiqueta chica sobre cada título, porque con el reordenamiento los grupos ya no quedan contiguos.
- Probado en el navegador con datos reales de Cortado: ocultar, reordenar con botones y arrastrando, restablecer, cierre con Escape y con clic afuera, y persistencia al recargar. No cambia datos ni base.

## 3 septvicies. PR #21 — Clics en "Me sumo" (2026-10-09)

- **Hallazgo en ManyChat (2026-10-08):** el botón "Me sumo" tiene una **salida propia** (círculo a la derecha del botón) que se activa solo cuando la persona lo toca. Conectada a un nodo de Acciones con una solicitud externa permite medir el clic real sin cambiar lo que ve la persona. Es la medición que faltaba: hasta ahora el POST salía solo tras el primer mensaje y no distinguía toques.
- **Webhook:** nuevo `"evento": "clic_me_sumo"` → tabla `clic_me_sumo` (db/013), igual que el trigger: no entra a `evento_crudo`. **Regla nueva: un `evento` desconocido se rechaza** (antes se contaba como entrada y habría duplicado a cada persona).
- **Panel:** columnas "Clics en Me sumo", "Clic en Me sumo / entradas" y "Costo por clic en Me sumo" (personas distintas, por comunidad y rango de fechas; "sin fuente" mientras el flow no mande el aviso).
- **Simulador:** `--evento clic_me_sumo`, limpia las dos tablas.
- **Verificado:** `tipoDeAviso` con 15 casos; migración con rollback (4 avisos de 3 personas dan 3 en el histórico y 2 en 7 días, las entradas no cambian); simulación en producción con limpieza (0 filas). Webhook desplegado antes de que el flow publique el aviso.
- **Observación abierta:** desde la noche del 8/10 todo el tráfico real de Cortado entró por **Instagram** (12 eventos, todos `ig:`), cada uno precedido de un aviso de trigger rechazado con cuerpo vacío: la solicitud externa del flow de Instagram está sin cuerpo.

## 3 octovicies. PR #22 — Documento de definiciones y líneas de base v0 (2026-10-10)

Entregable R4 del roadmap: `docs/reference/definiciones-y-lineas-de-base-v0.html` (y `.pdf`). Borrador para revisión del manager.
- **"Ingreso" en tres niveles:** I1 entrada al flow (medido desde el 05/10), I2 clic en "Me sumo" (desde el 09/10), I3 ingreso al grupo (la definición de la carta oferta; sin fuente todavía). Mientras no exista I3 ningún reporte dice "ingresos" a secas.
- **Líneas de base v0:** in toque humano 69,9 % de personas (253 de 362; desde el 08/10, 100 % con 175 de 175; los 133 eventos recuperados son un único episodio de Todo un País del 06 y 07/10); tasa de triaje 44 % a 50 % por comunidad (6 y 7/10), cota superior porque el numerador es entrada al flow; horas de carga manual: sin línea de base, con plantilla de registro de minutos.
- **Hallazgo:** de 362 personas, 360 son de Instagram y 2 de WhatsApp.
- **Decisiones pendientes del manager:** nivel de ingreso del reporte oficial, ventana de la línea de base, significado de TRG y contra qué nivel se evalúa la meta de más de 50 %.
- Todas las cifras se reproducen con las consultas del apéndice A.

## 4 vicies. PR #24 — Windsor.ai como destino de la base: zona de aterrizaje (2026-10-13)

Decisión: integrar Windsor con el **destino Supabase** (la tarea corre sola, sin CSV ni scripts), en lugar de la API con una tarea programada. `db/014` crea el esquema `windsor_raw` y el usuario `windsor_escritor`, que **solo puede crear y escribir tablas en ese esquema** (verificado: sin acceso a `crm_comunidades_v2` ni a `public`, hasta 3 conexiones, sin contraseña ni login hasta que quien configura Windsor se la ponga). `windsor_raw` no está expuesto por la API del panel. El usuario principal es miembro de `windsor_escritor` para poder leer lo que Windsor aterriza. Guía en `docs/how-to/conectar-windsor-a-supabase.md`. **Siguiente (db/015):** función que convierte lo aterrizado en `meta_ads_metrica` por comunidad con `comunidad_meta_origen`, programada con pg_cron; se escribe cuando exista la primera tabla de Windsor para ver sus columnas reales.
## 3 novovicies. PR #23 — Pulsos de retención: guía de configuración en ManyChat (2026-10-13)

Decisión: la retención se mide sin carga manual con un flow nuevo en ManyChat que pregunta a los 7 y 30 días si la persona sigue en el grupo. Guía paso a paso en `docs/how-to/configurar-pulso-retencion-manychat.md` (también agregada al roadmap como sección 14, M6). Restricciones verificadas: WhatsApp exige plantilla aprobada y paga fuera de las 24 h; Instagram exige notificaciones recurrentes con permiso (disponibilidad por confirmar en la cuenta). Falta construir la recepción en el CRM (tipo de aviso `pulso_retencion`); hasta entonces no se publican los nodos. El conteo de miembros por planilla queda como carga manual provisoria.

## 4 unvicies. PR #25 — Convertir lo que aterriza Windsor en meta_ads_metrica (2026-10-13)

`db/015`: `sincronizar_meta_desde_windsor(tabla)` y `meta_sin_comunidad(tabla)` (solo `service_role`, nunca la API pública) más la tabla `windsor_sync_log`. Misma regla que el importador por CSV: campaña → cliente, conjunto → comunidad (`comunidad_meta_origen`, la regla por conjunto gana sobre la de toda la campaña), nombres normalizados, cuenta publicitaria del cliente, campañas ajenas ignoradas, upsert por comunidad y día.
- **Verificado contra producción sin dejar rastros** (`scripts/probar-sincronizacion-windsor.mjs`, transacción anulada): con el CSV real del 01 al 07/10 la función **reproduce exacto lo que ya guardaba el importador** (0 de 19 filas existentes cambiaron); un conjunto nuevo dentro de una campaña mapeada queda como "sin comunidad" (100) y su gasto no se asigna; una fila de otra cuenta se descarta (5000); nombres con tildes, mayúsculas y espacios distintos se asignan bien. Después: 67 filas, 0 de prueba, 0 en el log.
- **Pendiente:** primera corrida real de Windsor (configuración del lado de Windsor), verificar contra Ads Manager y programar con `pg_cron` (hoy no instalada).

## 4 tervicies. PR #27 — Windsor corre solo: programación diaria (2026-10-13)

Primera corrida real de Windsor (destino PostgreSQL, usuario aislado): `windsor_raw.facebook_ads` llegó con los nombres de columna esperados (555 filas, 30 días, cuenta correcta). Ensayo con transacción anulada: 0 filas sin comunidad, 72 registros por comunidad y día (37 existentes y 35 nuevos), 1 día existente con cifras corregidas y la inversión total coincide al centavo con el CSV. Corrida real: `meta_ads_metrica` pasó a 109 filas (14/08 al 13/10); Todo un País 6–7/10 = $115.758,22 / 350 conversaciones / 158 clientes potenciales, igual que Ads Manager. `db/017` habilita `pg_cron` (1.6) y programa `sincronizar-meta-windsor` a las 09:30 UTC, media hora después de Windsor (09:00 UTC). **Aprendizajes:** una tarea programada de Windsor admite como máximo 30 días por corrida (el historial se trae con backfill de 3 meses) y la dirección de consulta muestra la clave de API. **Pendiente:** quitar del panel el botón "Sincronizar Windsor.ai" (apunta a la función vieja) y regenerar la clave de Windsor expuesta en una captura.
## 4 duovicies. PR #26 — Windsor: usar el destino PostgreSQL con el usuario aislado (2026-10-13)

Al abrir el destino **Supabase** de Windsor se vio que se conecta por OAuth con la cuenta de Supabase (cuenta, proyecto, esquema y tabla; según su guía, además pide la contraseña de PostgreSQL): le daría acceso a la **cuenta**, no a una tabla, y anularía el aislamiento de `db/014`. Decisión: usar el destino **PostgreSQL** de Windsor (usuario, contraseña, host, puerto, base y tabla) con `windsor_escritor` por el Session pooler. `db/016` fija `windsor_raw` como esquema por defecto del usuario, porque ese destino no pide esquema. Guía actualizada. Pendiente: comprobar que Windsor crea la tabla y que el mismo destino acepta actualizar por fecha sin duplicar.

## 4 quatervicies. PR #28 — Trazabilidad de Windsor: botón "Consultas" (2026-10-13)

- **Panel:** se quita el botón "Sincronizar Windsor.ai" (llamaba a la función vieja `windsor-sync`, que nunca tuvo clave) y se agrega **Consultas**, que abre a pantalla completa la línea de tiempo de todo lo que pasa entre Windsor y el CRM, con resumen, filtros por tipo y estados.
- **Base (`db/018`):** `windsor_entrega_log` (un trigger sobre `windsor_raw.facebook_ads` anota cada INSERT o DELETE de Windsor con filas y fechas; la conversión lo reinstala si Windsor recrea la tabla) y `consultas_windsor(limite)`, que junta entregas, conversiones (`windsor_sync_log`), corridas de `pg_cron` y CSV manuales. Sin datos personales. Lectura abierta temporal para el panel; `db/005` la retira.
- **Importador por CSV:** ahora deja constancia de cada importación (archivo, filas y gasto sin comunidad). 19 pruebas.
- **Verificado:** los triggers registran una inserción y un borrado de prueba (con rollback, sin rastros); el modal se probó en el navegador con datos reales y casos sintéticos (abrir, filtrar, Escape, botón, scroll).
- **Límite:** no muestra las llamadas internas de Windsor a Meta ni los intentos que no llegan a escribir en la base.
- **Decisiones del 13/10:** la clave de API de Windsor no se regenera por ahora; los campos extra de Windsor se dejan (las columnas que sobren se ocultan desde "Columnas"); la verificación en dos pasos de Supabase no es necesaria por ahora.
## 4 quinvicies. PR #29 — Atajos de período en Control_Comunidades (2026-10-13)

Botones **Ayer**, **Últimos 7 días**, **Últimos 10 días**, **Últimos 15 días** y **Últimos 30 días** junto a "Desde / Hasta": cargan el rango en un clic y el activo queda resaltado. "Últimos N días" incluye hoy y los N-1 anteriores; todo en hora de Buenos Aires (la zona con que el CRM fecha las entradas, por primer contacto). Si el rango incluye hoy, un aviso aclara que las entradas del CRM están al día pero la inversión y las conversaciones de Meta llegan a la mañana siguiente (Windsor trae lo de ayer a las 06:00). Elegir una fecha a mano o "Todo el histórico" desactiva el atajo. Funciones de fecha puras con 5 pruebas automáticas (cruce de meses, años, 29 de febrero y la hora de Argentina). Probado en el navegador. No cambia la base: el filtro ya existía y lo recalcula la base.

## 4 sexvicies. PR #30 — Menú lateral retraíble (2026-10-14)

Botón **«** arriba a la derecha del menú lateral (junto a "Comunidades V2") para ocultarlo, y botón **☰** junto al título de la sección para volver a abrirlo. Al ocultarlo, el contenido ocupa todo el ancho (útil para la matriz de Control_Comunidades: de 1280 a todo el ancho disponible). La preferencia queda guardada en el navegador de cada persona y se mantiene al recargar; si el navegador no permite guardar, vale solo para la sesión. Accesible: etiquetas, `aria-expanded` y el foco pasa al botón contrario. Con el menú oculto no está a la vista el selector de cliente: hay que volver a abrirlo para cambiar de cliente. Probado en el navegador con el HTML y los estilos reales (ocultar, mostrar, foco, preferencia, recarga). No cambia datos ni base.

## 4 septvicies. PR #31 — Período rápido en un solo desplegable (2026-10-14)

Los cinco botones de período (Ayer, 7, 10, 15 y 30 días) pasan a **un único desplegable** compacto, "Período rápido", que ocupa mucho menos lugar en la barra de filtros. Muestra el período vigente (o "Personalizado" si se eligieron fechas a mano, o "Elegir…" si no hay fechas) y las fechas se ven en "Desde" y "Hasta". Mismas reglas de la PR #29 (incluye hoy, hora de Argentina, aviso de Meta con un día de retraso) y mismas funciones de fecha con sus pruebas. Se quitan los estilos de los botones. Probado en el navegador.

## 4 octovicies. PR #32 — "Todo el histórico" resaltado cuando está activo (2026-10-14)

El botón **Todo el histórico** de Control_Comunidades se resalta (mismo azul suave de los demás controles activos) cuando no hay fechas elegidas, es decir, cuando eso es lo que se está viendo; con un período elegido o fechas a mano vuelve al aspecto normal. Incluye `aria-pressed` para lectores de pantalla. Al abrir la sección sin fechas ya aparece resaltado, porque es el estado inicial. Probado en el navegador.

## 4 novovicies. PR #33 — "Métricas por comunidad" y sección Atribucion (2026-10-14)

- **Título:** la tarjeta de Control_Comunidades "Matriz de atribución multi-plataforma" pasa a **"Métricas por comunidad"**, con el subtítulo "Meta Ads · ManyChat · CRM". El CRM no tiene un modelo de atribución de personas a anuncios: lo que existe es (1) la regla de **primer contacto** entre comunidades de un mismo cliente y (2) la asignación del gasto y las conversaciones de Meta a cada comunidad por nombre de campaña y de conjunto de anuncios. El nombre viejo venía del documento original de Jaz y daba a entender otra cosa. La nota de la tarjeta lo aclara.
- **Sección nueva "Atribucion"** en el menú (después de Control_Comunidades), solo con estructura: estado "En construcción" y la lista de lo que hace falta para construir el modelo (anuncio o campaña de origen por persona, regla de atribución, identidad entre canales, ingreso real al grupo y uso de datos personales), cada punto con su estado. El contenido se completa cuando esos puntos estén resueltos.
- Sin cambios en datos ni en la base. Probado: sintaxis, orden del menú, enrutado y vista en el navegador.

## 4 tricies. PR #34 — Rediseño de la tabla "Métricas por comunidad" (2026-10-13)

- **Grupos con color e ícono** (Meta Ads, ManyChat, CRM, WhatsApp & Salud, Financiera): fila de títulos de grupo, fondo apenas diferenciado y una línea de separación entre grupos. El orden por defecto junta las columnas de cada grupo; si la persona las reordena, el grupo aparece partido y se sigue entendiendo.
- **Encabezados más legibles** con salto de línea y un ícono "i" en cada columna que explica qué mide, cómo se calcula y qué límite tiene (se abre con el mouse y con el teclado; Esc lo cierra).
- **Valores:** dinero siempre con dos decimales y separadores argentinos; porcentajes en pastillas de alto contraste; los vacíos dicen por qué: "Sin dato" (no hay base para calcular), "Sin fuente" (la integración todavía no lo envía) y "No disponible" (faltan los miembros iniciales y finales).
- **Accesibilidad:** títulos de columna y de fila marcados como tales, descripción de la tabla para lectores de pantalla, foco visible, columna "Comunidad" fija al desplazar.
- Sin cambios en datos ni en la base. Quedan fuera, por no estar pedidos: paginación y exportar. Pruebas: 8 nuevas (32 en total) y vista en el navegador.

## 4 untricies. PR #35 — n8n: contactos de WhatsApp a una hoja por comunidad (2026-10-14)

- El flujo de n8n se rehace: ahora se dispara con cada entrada nueva (`evento_crudo`) desde un Database Webhook de Supabase, **solo si es WhatsApp con número de teléfono** (los de Instagram se ignoran), y agrega el número en la **pestaña de su comunidad** de la planilla (una pestaña por comunidad).
- No duplica: si el número ya está en la pestaña, actualiza la fila. Columnas: Fecha, Hora, Teléfono, Nombre, Cliente.
- Reemplaza al flujo anterior (que registraba un código sin datos personales); esta versión guarda el número y el nombre reales, como se pidió.
- Guía de armado en `docs/how-to/configurar-n8n-contactos-wsp.md`. Probado: el JSON, las conexiones, el filtro de WhatsApp/Instagram y el armado de la fila. **No probado de punta a punta** (falta crear la planilla, las credenciales y el webhook en Supabase).

## 4 duotricies. PR #36 — Pendiente anotado: pedir el teléfono en los flows de Instagram (2026-10-14)

**Para más adelante (no se implementa todavía):** agregar un paso extra en **todos los flows de ManyChat de Instagram**, antes del botón "Me sumo", que le pida a la persona su número de WhatsApp y lo guarde junto a su identificador de Instagram.

- **Para qué:** hoy los contactos de Instagram no traen teléfono, así que no se puede saber quién de la pauta entró de verdad al grupo de WhatsApp. Con el número se puede cruzar contra la lista de miembros del grupo (carga manual por ahora) y medir el ingreso real al grupo. Es la base para cerrar el "ingreso al grupo, sin fuente" y para que la planilla de n8n (PR #35) tenga los números de la gente que viene de Instagram.
- **Qué hace falta:** (1) el paso de pregunta en cada flow de Instagram, con el número validado; (2) que el CRM reciba y guarde ese número asociado al identificador de Instagram (aviso nuevo de ManyChat); (3) cargar la lista de miembros del grupo y cruzarla; (4) mostrarlo en el panel.
- **Riesgos a resolver antes:** pedir un dato más hace que parte de la gente abandone (medir el efecto en un solo flow, empezando por Cortado Palermo); y hay que avisar para qué se usa el número y validarlo con Legal (uso de datos personales, ya pendiente en la sección Atribucion).
- Contexto: en Cortado Palermo el grupo tiene 34 miembros y el CRM solo conoce 1 contacto de WhatsApp; el resto entró por Instagram.

## 4 tritricies. PR #37 — Texto honesto en "Sin fuente" de Trigger y Clic en "Me sumo" (2026-10-14)

El aviso de las celdas "Sin fuente" de **Trigger entregados** y **Clics en "Me sumo"** decía siempre que "falta el paso" en ManyChat, aunque el paso estuviera puesto: con conteo cero no se puede distinguir entre "nadie entró" y "el paso no funciona" (caso Boedo: el paso existe en el flow, pero no entra tráfico desde el 09/10). Ahora dice que puede ser cualquiera de las dos cosas y cómo comprobarlo (entrar al flow y mirar si el contador sube). Solo cambia el texto; no cambia datos ni cálculos.

## 4 quadricies. PR #38 — Cargar miembros de un grupo (2026-10-14)

- **Botón "Cargar miembros"** (Overview, tarjeta "Comunidades"): se sube el CSV o se pegan los números de un grupo; vista previa (válidos, entraron/salieron vs. la carga anterior, coincidencias con contactos del CRM); al confirmar se guarda una **foto con fecha**, se actualizan los miembros finales (Mf) y queda una línea nueva en **Consultas** (tipo "Carga de miembros", sin números de teléfono). Una vista "Ver miembros del grupo" muestra teléfono, nombre y si entró por el flow.
- **Excepción de seguridad (decisión del usuario, 14/10):** se construye antes del login, contra la decisión anterior de no cargar datos reales de miembros antes de él. Compensación: las tablas con números no se pueden leer ni escribir desde el panel y todo pasa por funciones que exigen una **clave de carga** (hash en la base; el valor no está en el repositorio). Con el login (`db/005`) se reemplaza por acceso por usuario. El repositorio de GitHub ya era privado; eso protege el código, no los datos.
- Migración `db/019_carga_miembros.sql`: tablas `carga_miembros`, `miembro_grupo`, `config_carga_miembros` y funciones `vista_previa_carga_miembros`, `cargar_miembros_grupo`, `ver_miembros_grupo`; `consultas_windsor` suma el tipo nuevo. **Pendiente de ensayar y aplicar** (el ensayo con rollback contra producción quedó bloqueado por permisos).
- Pruebas: 9 nuevas del lector de listas (41 en total). Guía: `docs/how-to/cargar-miembros-de-un-grupo.md`.

## 4 quinquicies. PR #39 — Cargar miembros: solo Fecha y Teléfono, con duplicados que se confirman (2026-10-14)

- **Cambio de insumo:** no se consiguen nombres ni usuarios, así que la carga pasa a ser **solo Fecha y Teléfono** por fila (fecha de ingreso al grupo si se conoce, o la del registro; si falta, la de hoy). Se puede subir un CSV, pegar filas o agregar una persona con un mini formulario de fecha y teléfono.
- **Miembros acumulados:** cada comunidad tiene su lista de miembros con la fecha de cada uno (tabla `miembro_comunidad`), en vez de una foto completa por carga. Soporta **lista completa** (quienes ya estaban y no aparecen pasan a "salidas", con confirmación explícita) y **solo personas nuevas**. Mf = miembros que no salieron. Quien había salido y reaparece se reactiva.
- **Duplicados:** la vista previa lista los números ya cargados (fecha actual vs. del archivo); hay que elegir **ignorarlos** o **actualizar su fecha** antes de poder guardar (el servidor también lo exige). Las salidas también se confirman.
- Migración `db/020_miembros_acumulados.sql` (reemplaza las funciones de 019 y pasa lo ya cargado a la lista acumulada). **Se ensaya con rollback y se aplica antes de fusionar**: las funciones de 019 dejan de existir y el panel anterior no funcionaría con la base nueva.
- Pruebas del lector: 12 (44 en total). Guía actualizada: `docs/how-to/cargar-miembros-de-un-grupo.md`.

## 4 sexquinquicies. PR #40 — Cargar miembros: elegir cliente y "Todas las comunidades" (2026-10-14)

- **Cliente arriba del formulario:** el modal ahora tiene su propio selector de **Cliente** (todos los clientes; si se suma uno nuevo, aparece solo) y la lista de comunidades cambia con él.
- **Comunidad:** lista todas las comunidades del cliente, **incluida la "(general)"** (la de Cortado en Jarrito es un grupo real; una versión intermedia la omitía por error y se corrigió antes de subirla).
- **Opción "Todas las comunidades":** para un CSV que junta las hojas de varias comunidades, con una columna Comunidad (o Hoja, Localidad, Barrio). El panel reparte las filas por nombre (sin importar mayúsculas ni tildes), muestra una vista previa por comunidad y una sola decisión para los duplicados y para las salidas, y guarda comunidad por comunidad. Cada comunidad se guarda por separado: si una falla, se avisa cuáles quedaron guardadas y cuáles no. Las filas con comunidad no reconocida o sin comunidad quedan afuera y se listan.
- Sin cambios en la base (usa las funciones de `db/020`). Pruebas: 6 nuevas (50 en total).

## 4 septquinquicies. PR #41 — Cargar miembros: se ve por qué no se puede guardar (2026-10-14)

Al usar el botón con un CSV real (11 teléfonos válidos), "Confirmar y guardar" parecía "nunca habilitarse": el botón solo se habilita después de "Vista previa", pero el resultado (o el error) aparecía debajo de los botones, fuera de la pantalla. Ahora: (1) la pantalla baja sola hasta el resultado y (2) junto al botón hay un aviso que dice qué falta: tocar Vista previa, elegir qué hacer con los duplicados, confirmar las salidas, o que la vista previa falló. Solo cambia la presentación; no cambia datos ni la base.

## 4 octoquinquicies. PR #42 — Bajas reales y tasa de fuga (2026-10-14)

- **Punto de partida (14/10):** con las cargas del día se igualó Mi = Mf en las 4 comunidades de Cortado en Jarrito (11, 10, 32 y 26), para que el crecimiento neto arranque en 0 y mida lo que se sume desde ahora. Se hizo con una query a mano en el SQL Editor (no hay migración).
- **Problema:** "Bajas estimadas" (Mi + entradas al flow − Mf) daba negativo (−9, −10) porque los grupos tienen gente que no pasó por el flow; la fuga global (36,3 %) no era confiable.
- **Cambio (\`db/021_bajas_reales.sql\`):** las bajas son las salidas registradas al cargar la lista completa del grupo, con fecha de salida dentro del período; se pueden calcular desde la **segunda** carga de lista completa (antes devuelve NULL y el panel dice "No calculable"). Tasa de fuga = bajas ÷ (bajas + miembros finales). Cambian la función de Control_Comunidades y las vistas de Overview (\`comunidad_performance\`, \`kpis_macro\`); las columnas y sus tipos no cambian. La función auxiliar solo devuelve un número, nunca teléfonos.
- Panel: columnas "Bajas (salidas cargadas)" y "Tasa de fuga" con estado "No calculable"; Overview igual. Pruebas: 3 nuevas (53 en total). Migración pendiente de ensayar y aplicar **antes de fusionar**.

## 4 novoquinquicies. PR #43 — Filtro de Canal en Control_Comunidades (2026-10-14)

- **Filtro "Canal"** (Todos / Instagram / WhatsApp) junto a Comunidad y Fecha. El canal de cada persona se deduce del identificador (`ig:<id>` = Instagram, dígitos = WhatsApp).
- **Qué se divide:** lo que viene del flow de ManyChat: entradas al flow, trigger entregados, clics en "Me sumo" y la tasa clic / entradas. **Qué no se divide:** Meta (inversión, conversaciones, CPL, leads, CTR), miembros y bajas (el grupo es de WhatsApp) y los costos (usan la inversión de Meta); con un canal elegido esas columnas dicen "No se divide" en lugar de mostrar el total mezclado. "Entradas / conversaciones" tampoco se divide porque su denominador son las conversaciones de Meta (se había anticipado lo contrario al proponerlo).
- Migración `db/022_filtro_canal.sql`: `comunidad_performance_rango` suma el parámetro `p_canal` (se borra la firma anterior; las columnas devueltas no cambian). Un canal inválido devuelve ceros. **Se ensaya con rollback y se aplica antes de fusionar** (si no, el panel nuevo falla al llamar a la función).
- Posible paso siguiente: dividir también los datos de Meta por plataforma con Windsor (no es lo mismo que el canal del flow). Pruebas: 2 nuevas (55 en total).

## 4 tricies semel. PR #44 — Estado de la planilla en Data_Cruda y flujo de n8n actualizado (2026-10-19)

- **Problema:** el flujo de n8n (PR #35) escribe en Google Sheets, pero el CRM no se enteraba de cómo le iba: si n8n fallaba (por ejemplo, una pestaña inexistente), esa persona no quedaba en la planilla y nada lo mostraba. Además, "Responder 200" de n8n es una respuesta de éxito, no un rechazo del CRM.
- **Cambio (`db/023_envio_planilla.sql`):** tabla `envio_planilla` (estado y motivo por evento; sin teléfonos) y función `registrar_envio_planilla`, que n8n llama con un encabezado secreto `x-crm-secret` (hash en `config_n8n`; el valor no está en el repositorio). Estados: **Registrado**, **Ignorado (Instagram)** y **Error** con el motivo.
- **Panel:** Data_Cruda suma la columna **Planilla** y el filtro **"Error en planilla"**. Un evento sin aviso aparece como "Sin registro".
- **Flujo de n8n actualizado** con lo hecho al implementarlo: pestañas con los nombres reales (`Cortado-Palermo`, `Todounpais-LaToma`, …), 4 columnas (sin Cliente), formato RAW para conservar el `+` del teléfono (sin eso la búsqueda para no duplicar fallaba), salida de error del nodo de Sheets y tres avisos al CRM. Guía reescrita con las credenciales (Publishable key, cuenta de servicio de Google), la instalación de Database Webhooks en Supabase y la prueba con datos de ejemplo.
- Probado: JSON y conexiones del flujo, el armado de la fila (con comunidad desconocida → `SIN-HOJA`) y 6 pruebas nuevas del panel (61 en total). **La migración se ensaya con rollback y se aplica antes de fusionar.** Falta cargar el hash del secreto y sumar los tres nodos en el n8n real.
- Pendiente de `db/005` (login): `envio_planilla` ya figura en la lista de tablas que se restringen por cliente.

## 4 tricies bis. PR #45 — El secreto de n8n se acepta con cualquiera de los dos nombres de encabezado (2026-10-19)

Al probar los avisos de n8n al CRM, la función `registrar_envio_planilla` respondía "Clave incorrecta" aunque el valor era correcto: la credencial Header Auth de n8n quedó con el nombre `Webhook-crm-secret` (el mismo que usa el webhook de Supabase hacia n8n) y la función buscaba solo `x-crm-secret`. En lugar de renombrar el encabezado en n8n y en Supabase a la vez (con riesgo de perder avisos mientras tanto), `db/024_envio_planilla_encabezados.sql` hace que la función lea `x-crm-secret` y, si no está, `webhook-crm-secret`. Guía actualizada con una comprobación para verificar que el hash guardado coincide con el secreto. Se ensaya con rollback y se aplica antes de fusionar.

## 4 tricies ter. PR #46 — Roadmap: funciones de IA en el CRM (2026-10-19)

Se anota en `specs/2026-10-19-funciones-de-ia.md` la idea de sumar IA (Claude API u OpenRouter) al CRM. Solo documentación: no se construye nada. Puntos clave: las llamadas salen de una función del servidor (nunca del navegador) con la clave como secreto; cada consulta queda registrada en "Consultas" con tope de gasto; el modelo redacta sobre cifras ya calculadas y no recibe teléfonos, nombres ni textos de personas; primera función propuesta: resumen semanal por comunidad. Decisiones pendientes: proveedor, presupuesto y primera función.

## 4 tricies quater. PR #47 — Guía de n8n: solución de problemas (2026-10-20)

La guía `docs/how-to/configurar-n8n-contactos-wsp.md` suma la sección "Si algo falla", con lo aprendido al implementar el flujo: cómo leer las respuestas de n8n a Supabase (`net._http_response`) y una tabla de causas y soluciones para los errores 403, 404, 401, `PGRST202` ("Could not find the function"), "No columns found", filas duplicadas y la clave privada de Google. Solo documentación. Es también la primera PR después de reconectar Vercel al repositorio de la organización taquionrs: su despliegue sirve para comprobar que la conexión funciona.

## 4 tricies quinquies. PR #48 — Solo cuentan las campañas de conversión o tráfico a WhatsApp (2026-10-20)

- **Origen:** minuta de la reunión del 20/10 (métricas del panel y campañas). Se acordó que el gasto y los costos reflejen únicamente campañas de conversión o tráfico de Instagram y WhatsApp.
- **Hallazgo:** la campaña general de Cortado (`…CON_INTE_MANUAL_CORTADO_EN_JARRITO`, conjuntos POST y DARK) tiene como resultado en Meta "visitas al perfil y a la página" y aportaba ~96 % del gasto de Cortado (unos $8,0 M de $8,3 M hasta el 12/10) con 53 conversaciones: inflaba la inversión de Overview y el CPL global ($28.896). La campaña de leads por WhatsApp sumaba ~$297 mil con 227 conversaciones (≈ $1.310 cada una).
- **Cambio (`db/025_campanas_que_cuentan.sql`):** marca `cuenta` y `motivo_exclusion` en `comunidad_meta_origen`; la sincronización la respeta, registra lo excluido en `windsor_sync_log` (visible en Consultas) y quita de `meta_ads_metrica` lo que ya no corresponde (solo si se asignó algo). Reglas: para Cortado cuenta solo `…CON_TRAFICO_MANUAL_CORTADO_EN_JARRITO_WHATSAPP`, con sus tres conjuntos (`_BOEDO`, `_DEVOTO`, `_PALERMO`) asignados a su comunidad y cualquier otro conjunto a la comunidad general; INTE y la de leads de Cortado quedan fuera (esta última por decisión del usuario, reversible con un `update`); Todo un País sin cambios.
- **Efecto a tener en cuenta:** el historial de Cortado de antes de la campaña de tráfico queda con inversión en cero (la de leads y la INTE ya no cuentan); su gasto sigue registrado en Consultas.
- Importador por CSV con la misma regla (3 pruebas nuevas, 64 en total). Se ensaya con rollback y se aplica antes de fusionar.
- Pendiente de la minuta (no incluido): CPMI, CTR del botón, filtro de fecha en Overview, doble CPA, retención mensual, etiquetas de ManyChat, gasto en vivo, MCP.

## 4 tricies sexies. PR #49 — Sección "Campañas": elegir desde el panel qué campañas de Meta cuentan (2026-10-20)

- **Pedido:** poder elegir desde el CRM qué campañas se ven y se contabilizan, y traer campañas nuevas por cuenta propia, en lugar de depender de SQL cada vez que sale una.
- **Qué es:** botón **"Campañas"** en Control_Comunidades que abre un modal de pantalla completa con todas las campañas y conjuntos que llegan de Windsor (de cualquier cliente de la cuenta publicitaria), con gasto, conversaciones y clics, y su estado: *Cuenta*, *No cuenta* o *Sin asignar*. Para cada campaña o conjunto se elige el destino (sin asignar, no cuenta, o cuenta en una comunidad). Filtros por estado, cliente y texto; "Recalcular ahora" para ver el efecto al instante. **Una campaña nueva queda "Sin asignar" y no suma** hasta que se la clasifica (decisión del usuario).
- **Base (`db/026_seccion_campanas.sql`, requiere db/025):** funciones `campanas_windsor`, `guardar_regla_campana` y `recalcular_meta_windsor`, y la tabla `campania_regla_historial`; `consultas_windsor` suma el tipo "Campañas". Cada cambio queda registrado con el nombre de quien lo hizo.
- **Excepción de seguridad (decisión del usuario, 20/10):** sin clave y antes del SSO. Cualquiera con el enlace puede ver el gasto de todas las campañas de la cuenta (incluidas las de otros clientes) y cambiar qué cuenta; compensación: historial de cambios con nombre. Con el SSO pasa a exigir usuario.
- Pruebas: 7 nuevas (71 en total). Se ensaya con rollback y se aplica antes de fusionar; **requiere que db/025 ya esté aplicada**.

## 4 tricies septies. PR #50 — Meta en vivo: traer de Windsor a pedido y para el rango elegido (2026-10-20)

- **Pedido:** un enfoque en vivo: que Windsor traiga los datos de Meta según el rango de fechas que se elija (punto "gasto en vivo" de la minuta del 20/10).
- **Decisiones del usuario:** guardar lo que trae en el CRM (así Overview, Control_Comunidades y los costos usan los datos nuevos sin cambiar nada más) y cargar él mismo la clave de Windsor como secreto de Supabase (la clave nunca va en el panel, el repositorio ni el chat).
- **Qué es:** botón **"Traer de Meta ahora"** en Control_Comunidades. Valida el rango (hasta 31 días, sin fechas futuras; sin fechas pide los últimos 7 días hasta ayer), llama a la función del servidor `meta-en-vivo`, que consulta a Windsor en ventanas de 14 días en paralelo y le pasa las filas a la base. Muestra un resumen y recarga el panel. No es instantáneo: tarda entre unos segundos y 1 minuto.
- **Base (`db/027_meta_en_vivo.sql`):** la lógica de asignación de la sincronización diaria se separa en una pieza común (`_windsor_aplicar`) sin cambiar su comportamiento; `meta_en_vivo_aplicar` (solo service_role) valida el rango, frena una consulta si hubo otra hace menos de 45 s y descarta las filas fuera del rango. El registro queda en `windsor_sync_log` y se ve en Consultas.
- **Excepción de seguridad (hasta el SSO):** la función se despliega sin verificación de token; la acotan el tope de 31 días y la pausa de 45 s. No devuelve datos de personas.
- Sirve también para traer el tramo viejo que falta (14/08 al 12/09) sin entrar a Windsor.
- Pruebas: 7 nuevas (71 en total). Guía: `docs/how-to/meta-en-vivo.md`. **Pendiente:** ensayar y aplicar db/027, cargar el secreto `WINDSOR_API_KEY` y desplegar la función.

## 4 tricies octies. PR #51 — La limpieza del gasto que no cuenta también corre si todo el gasto del período es excluido (2026-10-20)

Al probar "Traer de Meta ahora" con el tramo 14/08 al 12/09, Windsor devolvió 333 filas, 50 de ellas ($3.873.506,76) de la campaña INTE (que no cuenta), y no quedó ninguna fila asignada: la protección de db/025 y db/027 ("no borrar nada si no se asignó ninguna fila") frenó la limpieza y ese gasto siguió en `meta_ads_metrica`, en la comunidad general. `db/028_limpiar_gasto_excluido.sql` cambia la condición: la limpieza corre si alguna fila coincidió con **alguna regla** (cuente o no). Un mapeo vacío o roto sigue sin borrar nada. Se ensaya con rollback y se aplica antes de fusionar; después se vuelve a traer el mismo rango.

## 4 tricies nonies. PR #52 — Desglose de campañas contempladas debajo de la tabla de Control_Comunidades (2026-10-20)

- **Pedido:** debajo de la tabla "Métricas por comunidad", ver el desglose de las campañas contempladas de Meta; si hay otros medios (por ejemplo Google Ads), su detalle también va ahí. **Decisión del usuario:** solo las campañas que cuentan (las mismas de la tabla de arriba), sin línea de las excluidas.
- **Base (`db/029_desglose_campanas.sql`):** tabla `ads_campana_dia` (medio, campaña, conjunto, comunidad, día; inversión, conversaciones, clics, impresiones, leads). La escriben `_windsor_aplicar` (por lo tanto la sincronización diaria y "Traer de Meta ahora") con las mismas reglas que `meta_ads_metrica` y la limpian igual. `desglose_campanas(cliente, desde, hasta, comunidad)` la lee agrupada. La columna `medio` ('Meta Ads' hoy) deja el lugar para Google Ads u otros.
- **Panel:** tarjeta "Desglose de campañas contempladas" debajo de la tabla: medio → campañas desplegables → conjuntos con comunidad; inversión, conversaciones, costo por conversación, clics y CTR; respeta el período y la comunidad elegidos. Si el desglose no alcanza para explicar la inversión de la tabla, avisa cuánto falta. Si la lectura falla, la tabla de arriba se muestra igual.
- **Limitación:** el detalle se llena hacia adelante. Los días anteriores a aplicar la migración no lo tienen hasta volver a traerlos (sincronización diaria o "Traer de Meta ahora" sobre esas fechas).
- Pruebas: 6 nuevas (77 en total). Ensayo: `exportes/ensayo-029.sql`. **Pendiente:** ensayar y aplicar db/029, y volver a traer 14/08–12/09 y 13/09 en adelante.

## 4 tricies decies. PR #53 — CPL pasa a llamarse CPMI (2026-10-20)

- **Pedido (minuta del 20/10):** renombrar CPL como CPMI: costo por mensaje iniciado. La fórmula no cambia (inversión ÷ conversaciones iniciadas en Meta).
- Cambia el nombre en la tabla de Control_Comunidades, en el KPI global de Overview ("CPMI global") y en el desglose de campañas. El identificador interno de la columna se mantiene, así que el orden y las columnas ocultas que cada persona guardó siguen valiendo. No hay cambios de base.
- Pruebas: 1 nueva (78 en total).

## 4 tricies undecies. PR #56 — Contactos repetidos en Data_Cruda (2026-10-26)

- **Pedido:** un filtro que cuente todos los contactos que se registraron varias veces, por pruebas o porque entraron a una comunidad, salieron y volvieron a ingresar.
- **Base (`db/032_contactos_repetidos.sql`, requiere 031):** `contactos_repetidos(cliente, desde, hasta, comunidad, límite)` devuelve un resumen (contactos, eventos, repetidos, registros de más, repetidos dentro de una misma comunidad y en más de una) y el detalle por contacto (veces, primer y último registro, comunidades, nombre). Cuenta eventos aceptados de **toda la historia**, no solo los últimos 200. Fechas en hora de Buenos Aires. Solo Marketing.
- **Panel:** bloque "Contactos repetidos" arriba del registro de Data_Cruda, con filtros de comunidad y fechas, chips por tipo (todos / misma comunidad / más de una comunidad) y botón para exportar CSV.
- **Límite:** el CRM no puede saber el motivo de la repetición (prueba, reingreso o doble toque): muestra los datos para que el equipo lo decida. La atribución de las métricas sigue siendo por primer contacto (Data_Deduplicada).
- Pruebas: 4 nuevas (104 en total) y 6 de base en `tests/db/contactos-repetidos.dbtest.mjs` (18 en `npm run test:db`). El ensayo `exportes/ensayo-032.sql` se corrió también contra el Postgres local antes de entregarlo (la primera versión tenía un paréntesis de menos). **Pendiente:** ensayar y aplicar db/032.

## 4 tricies duodecies. PR #57 — Leyendas explicativas en Overview (2026-10-26)

- **Pedido (reunión con la PO del 22/10):** que cada métrica de Overview explique su sigla, porque habrá usuarios que no vienen de marketing; en particular CPMI, CPME y la forma de calcular la tasa de fuga.
- **Qué cambia:** botón "i" junto a cada tarjeta de Overview (inversión, conversaciones, CPMI, entradas, miembros efectivos, CPME, tasa de fuga) y junto a cada encabezado de la tabla de distribución (Mi, entradas, bajas, Mf, % participación). Usa el mismo globo flotante que Control_Comunidades. Las explicaciones están juntas en un solo glosario (`AYUDAS_OVERVIEW`) y la de CPMI coincide con la de Control_Comunidades.
- No hay cambios de base. Pruebas: 4 nuevas (108 en total).

## 4 tricies terdecies. PR #58 — Filtros de fecha y comunidad en Overview, Base_Limpia, Data_Deduplicada y Data_Cruda (2026-10-26)

- **Pedido (reunión con la PO del 22/10):** filtros de fecha y comunidad en Overview, Data_Deduplicada, Data_Cruda y Base_Limpia, para controlar duplicados y montos.
- **Overview:** comunidad, desde/hasta y período rápido. Usa las mismas filas por comunidad que Control_Comunidades para el período elegido (`comunidad_performance_rango`) y calcula los totales con ellas (`kpisDesdeComunidades`); el período y la comunidad se comparten con Control_Comunidades. Sin fechas, el resultado es el de siempre (todo el histórico).
- **Base_Limpia, Data_Deduplicada y Data_Cruda:** un solo filtro compartido (comunidad, desde, hasta). Se aplica en la base, no en el navegador: Data_Cruda deja de limitarse a "los últimos 200 de todo" y pasa a "los últimos 200 del período y la comunidad elegidos"; el CSV completo respeta los filtros; el bloque de contactos repetidos usa el mismo filtro (se le quitó su selector propio). Las fechas son de Argentina y el día "hasta" está incluido. Base_Limpia y Data_Deduplicada filtran por la fecha del primer contacto. Los rechazados de Data_Cruda se filtran por el id de comunidad que mandó el flow.
- **Error encontrado y corregido:** las vistas de la base devuelven `comunidad_id` pero el panel buscaba `id`, así que el selector de comunidad de Control_Comunidades y de Base_Limpia no filtraba (recibía "undefined") y el botón Guardar de Mi/Mf en Overview no tenía a qué comunidad apuntar. Ahora las filas llevan `id` (`conIdComunidad`).
- **Aviso nuevo:** la API entrega hasta 1000 filas por pedido; Base_Limpia y Data_Deduplicada ahora piden el total real y avisan cuando la lista está recortada.
- No hay cambios de base. Pruebas: 7 nuevas (115 en total); se ajustó una de `panel-roles` por el cambio de Overview.

## 4 tricies quaterdecies. PR #59 — CTR del botón "Me sumo" en Control_Comunidades (2026-10-26)

- **Pedido (minuta del 20/10):** CTR del botón = clics en "Me sumo" ÷ triggers entregados.
- **Qué cambia:** columna nueva **CTR del botón "Me sumo"** en el grupo ManyChat de Control_Comunidades, por comunidad y en el total del cliente. Se divide por canal con el filtro de Canal (igual que triggers y clics). Sin triggers o sin clics registrados muestra "Sin fuente", no 0 %. La ayuda aclara que los clics se registran desde el 09/10: un período que empieza antes da un valor más bajo que el real.
- Quien ya tenía un orden de columnas guardado la ve al final; el botón "Restablecer" del panel Columnas la acomoda junto a las de ManyChat.
- No hay cambios de base. Pruebas: 3 nuevas (118 en total).
- **Pendiente de definir:** el "doble CPA" (Meta y efectivo).

## 4 tricies sexdecies. PR #61 — Campañas por cliente (2026-10-27)

- **Pedido:** en la sección Campañas aparecían las campañas de todas las cuentas de Windsor (de todos los clientes de Taquion) y, al elegir un cliente, pedía una comunidad aunque la campaña sea global: en las campañas de WhatsApp el prospecto elige su comunidad dentro del flow.
- **Por cliente:** el modal abre en el cliente elegido arriba y muestra solo sus campañas: las que nombran al cliente (por el nombre o el slug, sin importar mayúsculas, tildes ni guiones bajos) y las que ya tienen una regla suya. Las de otros clientes quedan ocultas y se avisa cuántas; "Todos los clientes" las muestra. Con un cliente elegido, el selector de destino ofrece solo sus destinos.
- **Corrección (27/10):** una primera versión de esta PR ofrecía "Global" apuntando a la comunidad "(general)". Estaba mal: **"(general)" es una comunidad real** (el grupo y el bot que dispara los triggers de WhatsApp, con su pestaña `Cortado-General`, sus miembros y sus bajas; ya constaba en la PR #40). Mezclarle gasto contamina sus métricas. Se sacó.
- **Qué queda:** solo el filtro por cliente y los destinos del cliente elegido; un aviso dice que las campañas globales todavía no tienen destino propio y que no se asignen a "(general)".
- **Pendiente (próxima PR):** destino "global del cliente" sin comunidad (gasto a nivel cliente, fila propia en Control_Comunidades, incluido en los totales y en el desglose). Necesita migración.
- Pruebas: 4 nuevas (122 en total). Sin migración ni ensayo.

## 4 tricies septemdecies. PR #62 — Campañas globales del cliente: el gasto a nivel cliente, no en una comunidad (2026-10-27)

- **Pedido y decisiones del usuario (27/10):** las campañas de WhatsApp son globales, el prospecto elige su comunidad dentro del flow; la fila de campañas globales en Control_Comunidades "no sirve tanto pero no se oculta ni se borra"; **sin reparto** del gasto entre comunidades. Qué campañas de Cortado son globales (la de leads de Instagram y la de tráfico a WhatsApp, que hoy tiene conjuntos por barrio) lo quiere chequear el usuario antes de asignarlas.
- **Base (`db/034_campanas_globales.sql`, requiere 032):** una regla de campaña puede no tener comunidad (campaña global del cliente). `meta_ads_metrica_global` guarda el gasto por cliente y día; `ads_campana_dia` admite filas sin comunidad (el desglose las llama "Campañas globales (sin comunidad)"); `_windsor_aplicar` las escribe y las limpia igual que lo demás; `guardar_regla_campana` suma la acción `cuenta_global` (cambia la firma: se reemplaza la anterior); `metricas_globales_cliente` devuelve lo global de un período (Marketing ve la inversión; General solo los conteos). Lo ya asignado a comunidades no cambia.
- **Panel:** en Campañas, cada cliente ofrece **"Global · cliente (sin comunidad)"** primero y las comunidades aparte ("solo si apunta a una comunidad"). Control_Comunidades suma la fila "Campañas globales (sin comunidad)" al final, que cuenta en "Total del cliente"; Overview incluye ese gasto en sus KPIs (CPMI global y CPME) pero no en la tabla de comunidades. Con una comunidad elegida la fila no aparece.
- **Por qué no la "(general)":** es una comunidad real (el grupo y el bot que dispara los triggers); recibir gasto que no es suyo contaminaba su costo por miembro y su crecimiento.
- **Límite:** el costo por entrada y por clic de cada comunidad no incluye el gasto global (no se reparte); el del total del cliente sí.
- **Pestaña Objetivos (PR #60):** suma el gasto y las conversaciones globales en el chequeo "desglose vs tabla", en el total de conversaciones del triaje y en el CPME (resuelto al fusionar esa PR con master).
- Pruebas: 8 de base nuevas (`tests/db/campanas-globales.dbtest.mjs`, 26 de base) y 6 de panel (128 de Node). Ensayo: `exportes/ensayo-034.sql` (corrido también contra el Postgres local). **Pendiente:** ensayar y aplicar db/034.

## 4 tricies quindecies. PR #60 — Sección "Objetivos", chequeos de integridad y auditoría de métricas (2026-10-26)

- **Pedido:** una sección con los objetivos del puesto (los tres números del mes 3 y los del motor) y asegurar que las métricas de todo el CRM sean correctas.
- **Base (`db/033_objetivos_puesto.sql`, requiere 032):** `objetivos_puesto(cliente, desde, hasta)` devuelve (solo conteos, solo Marketing) el % de ingresos sin toque humano, la tasa de triaje por comunidad (I3 ingresos al grupo según las listas, sin la lista de partida, ÷ I1 entradas al flow; I2 clics en "Me sumo" como paso intermedio), las horas manuales registradas y 8 chequeos de integridad. Tabla nueva `registro_horas_manuales` (minutos de trabajo manual, solo Marketing) para levantar la línea de base de "horas de carga manual eliminadas".
- **Panel:** pestaña **Objetivos** (solo Marketing): tarjetas de los tres números, tabla de triaje por comunidad (nunca promediada; el total suma), estado de los cuatro números del motor (CPME, TRG propuesto, CPMR y K-Factor sin fuente), formulario para registrar minutos manuales y lista de chequeos. Comparte el período con Overview y Control_Comunidades.
- **Auditoría:** `docs/reference/auditoria-de-metricas.md` revisa cada métrica (fórmula, fuente, límites). Hallazgos: el alias `id` (ya corregido en #58), el tope de 1000 filas (#58), "Entradas ÷ conversaciones" mal nombrada como tasa de triaje (se aclara en su ayuda) y la falta de controles automáticos (los 8 chequeos).
- **Decisión del usuario (27/10):** las campañas son de WhatsApp y el disparador es una frase armada, así que el KPI principal es la **entrada al flow de ManyChat**, no las conversaciones de Meta (dato de contexto). La tasa de triaje pasa a ser I3 ÷ I1 y reemplaza a la definición v0 (entradas ÷ conversaciones); la sección Objetivos muestra las entradas como KPI principal y las conversaciones como contexto.
- **Para decidir:** definición de TRG, fecha real de las bajas, separar entradas orgánicas de las pagas, y sacar la v1 del documento de líneas de base.
- Pruebas: 8 de panel nuevas y 6 de base (126 de Node y 24 de base). Ensayo: `exportes/ensayo-033.sql` (se corrió también contra el Postgres local). **Pendiente:** ensayar y aplicar db/033.
