# Contactos de WhatsApp a Google Sheets (n8n)

Cada vez que entra una persona por WhatsApp a un flow de ManyChat, el CRM avisa a n8n y n8n agrega su número en la hoja de su comunidad. Una hoja (pestaña) por comunidad. No hace falta cargar nada a mano.

Flujo para importar: [`docs/n8n/contactos-wsp-a-sheet.workflow.json`](../n8n/contactos-wsp-a-sheet.workflow.json).

## Qué hace
- Se dispara con cada fila nueva de `evento_crudo` (cada entrada al flow).
- **Ignora Instagram**: solo sigue si el identificador son solo dígitos (un número de teléfono). Los de Instagram empiezan con `ig:`.
- Busca la comunidad y escribe en la pestaña que se llama **igual que la comunidad**.
- **No duplica**: si el número ya está en esa pestaña, actualiza su fila en vez de agregar otra.
- Columnas: `Fecha`, `Hora` (hora de Buenos Aires), `Teléfono` (con `+`), `Nombre`, `Cliente`.

## Una vez, antes de activarlo
1. **Google Sheets:** crear una planilla y, por cada comunidad, una pestaña con **el nombre exacto de la comunidad** (por ejemplo `Cortado Palermo`; si el nombre tuviera `[ ] * /  ? :`, que Google no admite en una pestaña, se reemplazan por un espacio). En la fila 1 de cada pestaña, los encabezados: `Fecha`, `Hora`, `Teléfono`, `Nombre`, `Cliente`. Si falta la pestaña, n8n da error y esa persona no queda registrada; si se suma una comunidad nueva, hay que crear su pestaña.
2. **n8n:** importar el flujo. Crear las credenciales (Header Auth para el webhook, Supabase con la clave de servicio, Google Sheets) y pegar el ID de la planilla en el nodo de Google Sheets. Activar el flujo y copiar la URL de producción del webhook.
3. **Supabase:** en Database → Webhooks, crear uno sobre la tabla `evento_crudo`, evento `Insert`, método `POST`, con la URL de n8n y el mismo encabezado de autenticación.

## Datos personales
Esta versión guarda el número real y el nombre (la anterior los ocultaba). Conviene compartir la planilla solo con quien la necesita.

## Límites
- Solo registra las personas que entran desde ahora: no carga las que ya estaban.
- No registra el ingreso real al grupo (eso sigue sin fuente): registra la entrada al flow.
