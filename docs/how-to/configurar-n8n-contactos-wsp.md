# Contactos de WhatsApp a Google Sheets (n8n)

Cada vez que entra una persona por WhatsApp a un flow de ManyChat, el CRM avisa a n8n y n8n agrega su número en la pestaña de su comunidad. Una pestaña por comunidad, sin cargar nada a mano. Además, n8n le cuenta al CRM cómo le fue con cada contacto, y eso se ve en **Data_Cruda → columna "Planilla"**.

Flujo para importar: [`docs/n8n/contactos-wsp-a-sheet.workflow.json`](../n8n/contactos-wsp-a-sheet.workflow.json).

## Qué hace
1. Se dispara con cada fila nueva de `evento_crudo` (cada entrada al flow).
2. **Instagram no va a la planilla**: solo sigue si el identificador son solo dígitos (un teléfono). Los de Instagram empiezan con `ig:`.
3. Busca la comunidad y escribe en la pestaña que le corresponde (ver la tabla de abajo).
4. **No duplica**: busca por la columna `Teléfono`; si el número ya está en esa pestaña, actualiza su fila.
5. Avisa al CRM el resultado: **Registrado**, **Ignorado (Instagram)** o **Error** (con el motivo).

## 1. La planilla de Google
Una pestaña por comunidad, con estos nombres exactos (están escritos en el nodo "Armar fila"; si cambiás uno, cambialo ahí también):

| Cliente | Comunidad | Pestaña |
|---|---|---|
| Cortado en Jarrito | Boedo | `Cortado-Boedo` |
| Cortado en Jarrito | Villa Devoto | `Cortado-Devoto` |
| Cortado en Jarrito | Palermo | `Cortado-Palermo` |
| Cortado en Jarrito | Cortado en Jarrito (general) | `Cortado-General` |
| Todo un País | La Toma | `Todounpais-LaToma` |
| Todo un País | Quines | `Todounpais-Quines` |
| Todo un País | San Luis Capital | `Todounpais-SanLuis` |
| Todo un País | Todo un País (general) | `Todounpais-General` |

En la **fila 1 de cada pestaña**, un encabezado por celda, de A a D: `Fecha`, `Hora`, `Teléfono` (con tilde), `Nombre`.
Si llega una comunidad que no está en la tabla, la pestaña queda como `SIN-HOJA` y el nodo da error (queda registrado como "Error" en el CRM). Una comunidad nueva necesita su pestaña y una línea nueva en la tabla del nodo "Armar fila".

## 2. Credenciales en n8n
- **Header Auth** ("Webhook CRM (Header Auth)"): nombre del encabezado `x-crm-secret` (también se acepta `Webhook-crm-secret`; lo importante es usar **el mismo nombre y el mismo valor** en la credencial de n8n y en el encabezado del webhook de Supabase) y, como valor, un secreto largo que inventes. Se usa en el nodo Webhook, en "Buscar comunidad y cliente" y en los tres nodos "Avisar al CRM".
- ~~**Custom Auth** ("Supabase CRM")~~: ya no hace falta. Desde el login del CRM (2026-10), la clave pública no lee las tablas y "Buscar comunidad y cliente" usa la credencial Header Auth (ver [el cambio](#cambio-por-el-login-del-crm-2026-10)).
- **Google Sheets**: recomendado **Service Account** (no vence). En Google Cloud: activar *Google Sheets API* y *Google Drive API*, crear una cuenta de servicio, bajar su clave en JSON y pegar en n8n el `client_email` y el `private_key` completo (de `-----BEGIN PRIVATE KEY-----` a `-----END PRIVATE KEY-----`, sin comillas). Después **compartir la planilla con ese correo como Editor**. El archivo JSON es un secreto: no se sube a ningún lado.

## 3. Nodos del flujo
Importar el JSON y completar:
- **Agregar o actualizar en la hoja de la comunidad:** pegar el ID de la planilla (lo que está entre `/d/` y `/edit` en la URL, sin el `d/`); *Sheet* en modo **By Name** con la expresión `{{ $json.Hoja }}`; *Mapping Column Mode* = manual con los 4 campos (`Fecha`, `Hora`, `Teléfono`, `Nombre`); *Column to match on* = `Teléfono`; en *Options* → *Cell Format* = **Use format from n8n** (así el `+` del teléfono se conserva y la búsqueda para no duplicar funciona). El nodo tiene activada la salida de error.
- **"Buscar comunidad y cliente" y los tres nodos "Avisar al CRM":** reemplazar `PEGAR_PUBLISHABLE_KEY` por la Publishable key y usar la credencial Header Auth de arriba.

Si ya tenías el flujo armado y no querés reimportar, agregá a mano esos tres nodos (HTTP Request, POST a `https://<proyecto>.supabase.co/rest/v1/rpc/registrar_envio_planilla`, encabezados `apikey` y `Content-Profile: crm_comunidades_v2`, cuerpo JSON con `p_evento_id` = `{{ $('Webhook (desde Supabase)').first().json.body.record.id }}` y `p_estado` = `registrado`, `ignorado` o `error` según la rama; el de error suma `p_motivo`), y poné el nodo de Sheets en *Settings → On Error → Continue (using error output)*.

## Cambio por el login del CRM (2026-10)

Con el login con SSO, `db/031` le saca a la clave pública la lectura de las tablas. El nodo **Buscar comunidad y cliente (Supabase)** ya no puede leer `comunidad` con ella: pasa a usar la función `datos_comunidad_planilla` (db/030), que exige el mismo secreto que `registrar_envio_planilla`. **Hacer este cambio antes de aplicar `031`** (orden completo en [configurar el login](configurar-sso-cloudflare.md#orden-de-despliegue)).

Si no reimportás el JSON, cambiá a mano:
- **Buscar comunidad y cliente (Supabase):**
  - *Method* `POST`, URL `https://<proyecto>.supabase.co/rest/v1/rpc/datos_comunidad_planilla`.
  - *Authentication* → *Generic Credential Type* → **Header Auth**, con la misma credencial "Webhook CRM (Header Auth)".
  - Encabezados `apikey` (la Publishable key) y `Content-Profile: crm_comunidades_v2`. Sacar `Accept-Profile`.
  - *Send Body* → JSON: `{{ JSON.stringify({ p_comunidad: $('Webhook (desde Supabase)').first().json.body.record.comunidad_id }) }}`.
- **Armar fila:** la respuesta ahora trae `comunidad`, `cliente` y `cliente_slug`. Cambiar estas dos líneas:
  - `const cliente = com.cliente || '';`
  - `const hoja = HOJAS[cliente + ' / ' + (com.comunidad || '')] || 'SIN-HOJA';`

Probar con un contacto de prueba: tiene que caer en su pestaña (no en `SIN-HOJA`) y quedar "registrado" en Data_Cruda.

## 4. Base de datos (una vez)
1. Aplicar `db/023_envio_planilla.sql` (tabla `envio_planilla` y función `registrar_envio_planilla`) y después `db/024_envio_planilla_encabezados.sql`, que hace que la función acepte el secreto con cualquiera de los dos nombres de encabezado.
2. Cargar el hash del secreto, con **el mismo valor** que pusiste en la credencial Header Auth (escribilo vos en el SQL Editor; no lo compartas). Para comprobar que quedó igual: `select encode(extensions.digest('EL_VALOR', 'sha256'), 'hex') = (select clave_hash from crm_comunidades_v2.config_n8n);` tiene que dar `true`.

   ```sql
   insert into crm_comunidades_v2.config_n8n (clave_hash)
   values (encode(extensions.digest('EL_MISMO_VALOR_DE_x-crm-secret', 'sha256'), 'hex'))
   on conflict (id) do update set clave_hash = excluded.clave_hash, cambiada_en = now();
   ```

## 5. Webhook de Supabase
1. En Supabase → **Integrations → Database Webhooks**, tocar **Install integration** (la primera vez; crea el esquema interno y activa `pg_net`).
2. **Create a new hook**: tabla `crm_comunidades_v2.evento_crudo`, solo **Insert**, tipo **HTTP Request**, método **POST**, URL = la **Production URL** del nodo Webhook de n8n (no la de prueba), *Timeout* 5000 ms, y un encabezado `x-crm-secret` con el mismo valor.
3. En n8n, **publicar** el flujo.

## 6. Probar sin escribir datos reales
- En el nodo Webhook, fijar datos de ejemplo (*set mock data*) con una comunidad real, un teléfono inventado y un nombre de prueba; ejecutar los nodos de a uno. Ejecutar el flujo completo escribe una fila de prueba en esa pestaña: borrarla después, **sacar los datos fijados** y publicar.
- Ejecutarlo dos veces seguidas con el mismo teléfono tiene que dejar **una sola fila**.

## Dónde se ve el resultado
**Data_Cruda → columna "Planilla"** (Registrado / Ignorado (Instagram) / Error con el motivo / Sin registro) y el filtro **"Error en planilla"**. "Sin registro" significa que n8n no avisó: evento anterior a la integración o n8n caído.

## Datos personales
La planilla guarda el número real y el nombre. Compartirla solo con quien la necesita. La tabla `envio_planilla` guarda solo estado y motivo, nunca teléfonos.

## Límites
- Solo registra a las personas que entran desde que el webhook está activo: no carga las que ya estaban.
- Registra la entrada al flow, no el ingreso real al grupo (eso se carga con "Cargar miembros", ver `cargar-miembros-de-un-grupo.md`).
- Si n8n está caído cuando entra una persona, Supabase no reintenta: esa persona queda "Sin registro" y no se escribe en la planilla.

## Si algo falla (lo que se aprendió al implementarlo)
Primero, mirar **qué le contestó n8n a Supabase**. En el SQL Editor:

```sql
select id, status_code, error_msg, left(content::text, 200) as respuesta, created
from net._http_response
order by created desc
limit 10;
```

| Qué se ve | Causa | Qué hacer |
|---|---|---|
| `403` "Authorization data is wrong!" en todos los avisos | El encabezado secreto del webhook de Supabase no coincide con la credencial Header Auth de n8n. El **nombre del encabezado** es el que figura en el campo *Name* de esa credencial (por ejemplo `Webhook-crm-secret`), no necesariamente `x-crm-secret` | Editar el webhook en Supabase (Integrations → Database Webhooks → Edit) para que el encabezado se llame **igual** que en la credencial y tenga el mismo valor |
| `404` | La URL del webhook es la de prueba (`/webhook-test/...`) o tiene un error | Usar la **Production URL** del nodo Webhook |
| `200`, pero el contacto no aparece en la planilla | El aviso llega bien y falla más adelante | Abrir la pestaña **Executions** de n8n y ver en qué nodo termina |
| No hay filas | Supabase no está enviando | Revisar que el webhook exista sobre `evento_crudo` con el evento *Insert* |

En los nodos "Avisar al CRM":

| Mensaje en n8n | Causa | Qué hacer |
|---|---|---|
| `404 … PGRST202 … Could not find the function public.registrar_envio_planilla` | Falta el encabezado `Content-Profile: crm_comunidades_v2` en ese nodo (sin él, Supabase busca la función en el esquema `public`) | Agregarlo junto a `apikey`. Hacerlo en los **tres** nodos |
| `401 … Clave incorrecta` | El secreto no coincide con el guardado en la base, o el nombre del encabezado de la credencial no es ninguno de los dos aceptados (`x-crm-secret`, `webhook-crm-secret`) | Comprobar con la consulta de coincidencia de la sección 4 y revisar el nombre en la credencial |
| `400 … El evento no existe` | Es lo **esperado** con el id falso de la prueba | Nada: indica que todo el camino funciona |

En el nodo de Google Sheets:

| Mensaje | Causa | Qué hacer |
|---|---|---|
| "No columns found in Google Sheets" | Falta la pestaña o no tiene los encabezados en la fila 1. Con una expresión en *Sheet* también pasa si el nodo no tiene datos de entrada | Crear la pestaña con los 4 encabezados; para configurar el nodo, fijar datos de ejemplo en el nodo **anterior** ("Armar fila") |
| Se agregan filas duplicadas | El teléfono se guarda sin el `+` y la búsqueda no lo encuentra | En *Options* poner *Cell Format* = *Use format from n8n* |
| "Private key validation failed" al crear la credencial | La clave privada se copió incompleta o con comillas | Pegar el valor de `private_key` completo, de `-----BEGIN PRIVATE KEY-----` a `-----END PRIVATE KEY-----`, sin comillas |

En el nodo **"Avisar al CRM: ignorado"** no hace falta el campo `p_motivo` (solo lo usa el de error).

Una **fila duplicada o de más** en una pestaña no afecta al CRM: el CRM guarda cada evento en su base y la planilla es una copia.
