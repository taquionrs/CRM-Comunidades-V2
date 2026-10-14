# Cargar los miembros de un grupo

Sirve para completar las métricas de salud (miembros finales, crecimiento, bajas, costo por miembro, fuga) y para ver quiénes están en cada grupo de WhatsApp, sin depender de ninguna planilla externa.

## Cómo se usa
1. En **Overview**, tarjeta "Comunidades", tocá **Cargar miembros**.
2. Elegí la comunidad, escribí la **clave de carga** y tu nombre (queda registrado en Consultas).
3. Subí el CSV del grupo o pegá los números, uno por línea. Si lo tenés en Google Sheets: Archivo → Descargar → Valores separados por comas (.csv).
4. Tocá **Vista previa**: muestra cuántos números son válidos, cuántos entraron y salieron respecto de la carga anterior y cuántos coinciden con contactos que ya entraron por el flow.
5. Tocá **Confirmar y guardar**. Se guarda una foto con fecha y los **miembros finales (Mf)** de la comunidad pasan al total. Marcá "usar como miembros iniciales (Mi)" solo la primera vez.
6. **Ver miembros del grupo** muestra la última foto: teléfono, nombre (si la persona entró por el flow) y cuándo entró.

Cada carga queda en **Consultas** con el tipo "Carga de miembros" (archivo, cuántos números, +entraron / −salieron, quién la hizo). Esa línea de tiempo no muestra números de teléfono.

## Qué lee del archivo
- Acepta CSV con coma, punto y coma o tabulación, con o sin encabezado, o una lista pegada.
- Usa la columna cuyo encabezado diga teléfono, celular, número, phone o whatsapp. Sin encabezado, toma el primer número válido de cada fila.
- Números con `+`, espacios o guiones están bien. Si falta el código de país se asume Argentina (`11 5555-1234` → `5491155551234`) y el panel lo avisa en la vista previa.
- Descarta repetidos y filas sin número válido, y los cuenta.

## Seguridad (excepción hasta que haya login)
Esto se construyó **antes del login**, por decisión del usuario del 14/10/2026. Hasta que exista el login (`db/005`):
- Las tablas con números no se pueden leer ni escribir desde el panel: solo las funciones de `db/019`, y todas piden la **clave de carga**.
- La clave se guarda como hash en la base. El valor real no está en el repositorio. Quien la sepa puede cargar y ver números: compartirla solo con quien lo necesita.
- Cuando haya login, esto se reemplaza por acceso por usuario y la clave deja de hacer falta.

## Límites
- Hoy la lista de miembros se carga a mano (no hay forma automática de leer un grupo de WhatsApp).
- Solo puede cruzar con los contactos que entraron por WhatsApp: los de Instagram no traen teléfono (ver el pendiente de pedir el número en los flows de Instagram).
