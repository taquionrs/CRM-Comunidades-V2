# Cómo: configurar el webhook y la nominación de ManyChat

## Webhook en vivo (`manychat-webhook`)

1. Elegir un secret propio (cualquier string largo) y cargarlo en Supabase: `supabase secrets set MANYCHAT_WEBHOOK_SECRET=...`.
2. En el flow de ManyChat (el que dispara cuando el usuario clickea el botón del grupo), agregar una acción **"External Request"**:
   - Método: `POST`
   - URL: `https://<tu-proyecto>.supabase.co/functions/v1/manychat-webhook`
   - Headers: `x-webhook-secret: <el mismo secret de arriba>`, `content-type: application/json`
   - Body: `{"phone": "{{system field: phone}}", "community_id": "<nombre exacto de la comunidad en el panel, o su uuid>", "timestamp": "{{system field: last_interaction}}"}`
3. Probar con un clic real y confirmar en la tab **Data_Cruda** del panel que llegó el evento.

## Módulo de Nominación (`nominacion-sync`)

1. Generar una API key de ManyChat con permiso de lectura de suscriptores y cargarla: `supabase secrets set MANYCHAT_API_KEY=...`.
2. Desde la tab **Base_Limpia**, botón "Sincronizar nombres" — completa `nombre`/`email` de todo teléfono que todavía figure como "Usuario WA".

⚠️ El endpoint que usa `nominacion-sync` (`GET /wa/subscriber/getInfo`) es el que documenta ManyChat para integraciones de WhatsApp al momento de escribir esto — no se pudo probar contra la API real en este entorno. Confirmar contra la documentación oficial vigente de ManyChat antes del primer uso.

**Alternativa que menciona el documento de Jaz si la API no alcanza**: exportar el reporte de suscriptores de ManyChat como `.csv` y cargarlo a mano semanalmente — no está implementado como feature en este repo (es una tarea operativa, no una integración), pero es la salida de emergencia si el endpoint de arriba cambió.
