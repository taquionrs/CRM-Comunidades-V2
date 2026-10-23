# Cargar los miembros de un grupo

Sirve para completar las métricas de salud (miembros finales, crecimiento, bajas, costo por miembro, fuga) y para ver quiénes están en cada grupo de WhatsApp, sin depender de ninguna planilla externa. Cada fila lleva **solo Fecha y Teléfono**.

## Cómo se usa
1. En **Overview**, tarjeta "Comunidades", tocá **Cargar miembros**.
2. Elegí el **cliente** (aparecen todos; si se suma uno nuevo, aparece solo) y la **comunidad** (todas las del cliente, incluida la "general" si la tiene). Escribí la **clave de carga** y tu nombre (queda registrado en Consultas).
   - **Todas las comunidades:** si tu archivo junta las hojas de varias comunidades, elegí esta opción. El archivo necesita una columna **Comunidad** (también sirve Hoja, Localidad o Barrio) con el nombre de cada una: `Comunidad, Fecha, Teléfono`. El panel reparte las filas, muestra la vista previa de cada comunidad y guarda una por una. Las filas con una comunidad que no se reconoce quedan afuera y se listan.
   - Si elegís una sola comunidad y el archivo trae la columna Comunidad, solo se usan las filas de esa comunidad (las demás se ignoran y se cuentan).
3. Elegí **qué subís**: la lista completa del grupo, o solo las personas nuevas.
4. Subí el CSV (Fecha, Teléfono), pegá las filas, o agregá una persona con su fecha y teléfono en el mini formulario.
5. Tocá **Vista previa**. Muestra cuántos teléfonos son válidos, cuántos son nuevos, cuántos **ya estaban cargados**, cuántos quedarían como salidas y cuántos nuevos coinciden con contactos del CRM.
6. Si hay **duplicados**, la vista previa los lista (con la fecha que tienen y la del archivo) y tenés que elegir: **ignorarlos** (se queda la fecha anterior) o **actualizar su fecha**. Hasta que elijas, no se puede guardar. Si preferís revisar el archivo, no confirmes.
7. Si cargás la lista completa y hay personas que ya estaban y no aparecen, quedarían como **salidas**: hay que tildar la confirmación para guardar.
8. **Confirmar y guardar.** Los **miembros finales (Mf)** pasan a ser los que siguen en el grupo. Marcá "usar como miembros iniciales (Mi)" solo la primera vez.
9. **Ver miembros del grupo** muestra la lista: teléfono, fecha, estado (en el grupo / salió), y el nombre y la primera entrada si la persona pasó por el flow.

Cada carga queda en **Consultas** con el tipo "Carga de miembros" (archivo, modo, cuántos números, nuevos, duplicados, salidas, quién la hizo). Esa línea de tiempo no muestra teléfonos.

## Qué lee del archivo
- CSV con coma, punto y coma o tabulación, con o sin encabezado, o filas pegadas. Las columnas pueden venir en cualquier orden.
- **Fecha:** `AAAA-MM-DD`, `DD/MM/AAAA`, `DD-MM-AAAA` o `DD/MM/AA` (día primero), con hora opcional. Es la fecha de ingreso al grupo si la sabés, o la fecha en que registraste a la persona. Si una fila no tiene fecha, se usa la de hoy y el panel lo avisa.
- **Teléfono:** con o sin `+`, espacios o guiones. Si falta el código de país se asume Argentina (`11 5555-1234` → `5491155551234`) y el panel lo avisa.
- Un número repetido dentro del archivo cuenta una vez, con su fecha más antigua. Las filas sin teléfono válido se descartan y se cuentan.
- Si alguien que había salido vuelve a aparecer, se reactiva como nuevo ingreso.

## Seguridad
- Las tablas con teléfonos no se pueden leer ni escribir desde el panel: solo las funciones de `db/019` y `db/020`.
- Con el login con SSO (`db/031`), esas funciones exigen además un usuario con rol **Marketing**.
- Todas piden también la **clave de carga**. La clave se guarda como hash en la base y el valor real no está en el repositorio: compartirla solo con quien la necesita.
- La clave se mantiene por ahora. Se saca en una PR aparte cuando el SSO esté estable (decisión del 22/10/2026).

## Límites
- La lista de miembros se carga a mano (no hay forma automática de leer un grupo de WhatsApp).
- Si siempre cargás solo personas nuevas, las salidas no se detectan: para medir bajas hay que cargar la lista completa de vez en cuando.
- Solo se puede cruzar con los contactos que entraron por WhatsApp: los de Instagram no traen teléfono (ver el pendiente de pedir el número en los flows de Instagram).

## Cómo se calculan las bajas y la fuga
- **Bajas:** las personas que quedaron como salidas al cargar la **lista completa** del grupo (con fecha de salida dentro del período elegido). Se pueden calcular **desde la segunda carga de lista completa** de la comunidad: antes no hay con qué comparar y el panel dice "No calculable".
- **Tasa de fuga** = bajas ÷ (bajas + miembros finales): de todas las personas que estuvieron en el grupo, cuántas se fueron.
- Antes se estimaban con una cuenta (Mi + entradas al flow − Mf) que daba negativo si el grupo tenía gente que no pasó por el flow. Esa estimación se reemplazó (`db/021`).
- Para medir bajas hay que cargar la lista completa del grupo cada tanto (por ejemplo, una vez por semana).
