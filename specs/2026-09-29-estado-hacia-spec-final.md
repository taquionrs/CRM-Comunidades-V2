---
id: crm-v2-estado-2026-09-29
título: CRM de Comunidades V2 — recapitulación de estado hacia el spec final
estado: borrador — para revisión
última actualización: 2026-09-29
fuente(s): carpeta local SDD-TAQUION, repo MarketingTaquion/CRM-Comunidades-V2, cuenta de ManyChat (workspace fb5616665), documento de Jaz (2026-09-24)
---

# CRM de Comunidades V2 — dónde estamos y qué falta para el spec final

Este documento no reemplaza a [`2026-09-25-v2-desde-cero.md`](2026-09-25-v2-desde-cero.md) (spec fundacional). Es una fotografía del 2026-09-29 que cruza tres fuentes: el código y las specs locales, el repo en GitHub y la cuenta de ManyChat. Termina con lo que hay que resolver para poder cerrar el spec final.

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
