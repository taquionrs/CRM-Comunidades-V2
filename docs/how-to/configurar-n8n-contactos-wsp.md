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
- **Header Auth** ("Webhook CRM (Header Auth)"): nombre del encabezado `x-crm-secret` (también se acepta `Webhook-crm-secret`; lo importante es usar **el mismo nombre y el mismo valor** en la credencial de n8n y en el encabezado del webhook de Supabase) y, como valor, un secreto largo que inventes. Se usa en el nodo Webhook y en los tres nodos "Avisar al CRM".
- **Custom Auth** ("Supabase CRM"), para el nodo "Buscar comunidad y cliente". Con la **Publishable key** del proyecto (Project Settings → API Keys; nunca la Secret):

  ```json
  {"headers": {"apikey": "TU_PUBLISHABLE_KEY"}}
  ```
  Si da error 401, usar la clave anon antigua (pestaña Legacy API keys) con `{"headers": {"apikey": "TU_CLAVE_ANON", "Authorization": "Bearer TU_CLAVE_ANON"}}`.
- **Google Sheets**: recomendado **Service Account** (no vence). En Google Cloud: activar *Google Sheets API* y *Google Drive API*, crear una cuenta de servicio, bajar su clave en JSON y pegar en n8n el `client_email` y el `private_key` completo (de `-----BEGIN PRIVATE KEY-----` a `-----END PRIVATE KEY-----`, sin comillas). Después **compartir la planilla con ese correo como Editor**. El archivo JSON es un secreto: no se sube a ningún lado.

## 3. Nodos del flujo
Importar el JSON y completar:
- **Agregar o actualizar en la hoja de la comunidad:** pegar el ID de la planilla (lo que está entre `/d/` y `/edit` en la URL, sin el `d/`); *Sheet* en modo **By Name** con la expresión `{{ $json.Hoja }}`; *Mapping Column Mode* = manual con los 4 campos (`Fecha`, `Hora`, `Teléfono`, `Nombre`); *Column to match on* = `Teléfono`; en *Options* → *Cell Format* = **Use format from n8n** (así el `+` del teléfono se conserva y la búsqueda para no duplicar funciona). El nodo tiene activada la salida de error.
- **Los tres nodos "Avisar al CRM":** reemplazar `PEGAR_PUBLISHABLE_KEY` por la Publishable key y usar la credencial Header Auth de arriba.

Si ya tenías el flujo armado y no querés reimportar, agregá a mano esos tres nodos (HTTP Request, POST a `https://<proyecto>.supabase.co/rest/v1/rpc/registrar_envio_planilla`, encabezados `apikey` y `Content-Profile: crm_comunidades_v2`, cuerpo JSON con `p_evento_id` = `{{ $('Webhook (desde Supabase)').first().json.body.record.id }}` y `p_estado` = `registrado`, `ignorado` o `error` según la rama; el de error suma `p_motivo`), y poné el nodo de Sheets en *Settings → On Error → Continue (using error output)*.

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
