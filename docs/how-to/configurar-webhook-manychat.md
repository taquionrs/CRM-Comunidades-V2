# Cómo: configurar el webhook y la nominación de ManyChat

## Webhook en vivo (`manychat-webhook`)

1. Dar de alta el cliente con el hash de su secreto: ver [agregar un cliente](agregar-un-cliente.md). Cada cuenta de ManyChat tiene su propio secreto.
2. En el flow de ManyChat de esa cuenta (el paso posterior a que la persona responde "Me sumo" en la encuesta), agregar una acción **"External Request"**:
   - Método: `POST`
   - URL: `https://<tu-proyecto>.supabase.co/functions/v1/manychat-webhook`
   - Headers: `x-cliente: <slug del cliente>`, `x-webhook-secret: <el secreto en claro de ese cliente>`, `content-type: application/json`
   - Body (en JSON): `{"community_id": "<nombre exacto de la comunidad en ese cliente, o su uuid>", "contact": <Full Contact Data>}`. `<Full Contact Data>` se inserta con el botón **"+ Añadir Full Contact Data"** del editor de la solicitud (queda como una pastilla azul, sin comillas). Para `community_id`, usar una pastilla de campo personalizado (`Localidad_*`) entre comillas, o el texto fijo de esa rama.
   - `community_id` se busca solo dentro del cliente indicado en `x-cliente`; una comunidad de otro cliente nunca matchea. Si falta, el webhook usa el primer campo personalizado `Localidad*` con valor que venga dentro de `contact.custom_fields`.
   - **No usar el campo "Teléfono" ni `phone`**: para contactos de WhatsApp llegan vacíos. El número viene en `contact.whatsapp_phone` (`+549…`) y el webhook lo normaliza a solo dígitos.
   - **No mandar `timestamp`**: el momento del evento es la hora de recepción del servidor (`last_interaction` puede venir vacío). Si se manda, queda solo en el payload.
   - El nombre (`first_name` + `last_name`) se copia al usuario si todavía no tiene uno y si no es solo dígitos (contacto que no reveló su nombre). El email, si viniera, igual.
   - Formato plano anterior (`{"phone": "…", "community_id": "…"}`): sigue aceptado.
3. Probar con un clic real y confirmar en la tab **Data_Cruda** del panel que llegó el evento.

## Módulo de Nominación (`nominacion-sync`)

1. Generar una API key de ManyChat con permiso de lectura de suscriptores y cargarla: `supabase secrets set MANYCHAT_API_KEY=...`.
2. Desde la tab **Base_Limpia**, botón "Sincronizar nombres" — completa `nombre`/`email` de todo teléfono que todavía figure como "Usuario WA".

⚠️ El endpoint que usa `nominacion-sync` (`GET /wa/subscriber/getInfo`) es el que documenta ManyChat para integraciones de WhatsApp al momento de escribir esto — no se pudo probar contra la API real en este entorno. Confirmar contra la documentación oficial vigente de ManyChat antes del primer uso.

**Alternativa que menciona el documento de Jaz si la API no alcanza**: exportar el reporte de suscriptores de ManyChat como `.csv` y cargarlo a mano semanalmente — no está implementado como feature en este repo (es una tarea operativa, no una integración), pero es la salida de emergencia si el endpoint de arriba cambió.

## Flow de prueba ya armado (Todo un País)

En la cuenta de Todo un País (`fb5616672`) existe el flow **"TEST CRM V2 - POST webhook"**, en borrador y sin publicar. Tiene un solo paso, "Solicitud externa", armado así:

- Método `POST`.
- URL: `https://REEMPLAZAR-POR-TU-PROYECTO.supabase.co/functions/v1/manychat-webhook` — **hay que reemplazar el marcador por la URL real del proyecto de Supabase**.
- Encabezados: `x-cliente: todo-un-pais` y `x-webhook-secret: PEGAR-AQUI-EL-SECRETO-DEL-CLIENTE` — **hay que pegar el secreto real** (el mismo cuyo hash se cargó en `cliente.webhook_secret_hash`).
- Cuerpo: `{"community_id": <campo personalizado Localidad_Sanluis>, "contact": <Full Contact Data>}`.

Para probarlo, una vez deployada la función y dado de alta el cliente `todo-un-pais` con al menos una comunidad cuyo nombre coincida con el valor de `Localidad_Sanluis` (por ejemplo, "Quines"): en el editor de la solicitud, elegir un contacto de prueba en "Contacto para pruebas", revisar la vista previa del cuerpo y apretar "Probar solicitud". La respuesta esperada trae el evento guardado y `telefono_normalizado`. Después hay que ver el evento en la tab Data_Cruda del panel.

El flow no tiene disparador ni mensajes: cuando el POST esté probado, se copia esta acción al final del flow real de comunidades (después de las acciones de cada rama).

**URL real de la función** (proyecto `crm-comunidades`, ref `zyyxsammrryhfrgfwlxr`): `https://zyyxsammrryhfrgfwlxr.supabase.co/functions/v1/manychat-webhook`. Es la que va en lugar del marcador `REEMPLAZAR-POR-TU-PROYECTO`. Solo funciona una vez deployada la función: al 2026-09-29 el proyecto no tiene ninguna Edge Function deployada.

## Cliente en producción: Cortado en Jarrito (2026-10-01)

- **Cliente:** `cortado-en-jarrito`, cuenta de ManyChat `fb5616665`. Comunidades: `Boedo`, `Palermo`, `Villa Devoto`. El secreto del webhook está en un archivo local ignorado por Git (`SECRETO-cortado-en-jarrito.txt`); en la base solo se guarda su hash.
- **Flow:** "Test Comunidades Cortado en Jarrito", con la acción "Solicitud externa" en el nodo final ("Acciones #8"), junto a Google Sheets y el evento a la API de conversiones de Meta (canal WhatsApp).
- **Número de WhatsApp del cliente:** +54 9 11 2753-5622 (Configuración → WhatsApp de la cuenta).
- **Probado de punta a punta** el 2026-10-01: mensaje por WhatsApp → "Me sumo" → evento en Data_Cruda, asignado a Boedo.

### Cuidado con las condiciones por texto

Los flows de comunidades comparan `Localidad_<zona>` con una frase exacta. Si la condición usa el operador **"es"** y la frase termina con un emoji (en Cortado, ☕), cualquier texto escrito a mano sin ese emoji no coincide con ninguna rama y el flow cae en la última salida (Villa Devoto). Eso ensució la planilla anterior y el primer evento del CRM. Corrección aplicada en Cortado: condiciones de **"es" a "contiene"** con la palabra del barrio (`Boedo`, `Palermo`). Al armar flows nuevos, usar siempre "contiene".

Además, el POST tiene que salir **después** de las acciones de rama (nodo final), porque cada rama reescribe `Localidad_<zona>` con el nombre limpio de la comunidad; el cuerpo usa ese valor como `community_id`.
