# Informe: contactos sin etiqueta ni registro en el CRM (4 al 11 de noviembre de 2026)

Cliente: Cortado en Jarrito (cuenta de ManyChat `fb5616665`). Revisión hecha con acceso de solo lectura (conector de Meta Ads, historial de versiones de Google Sheets y consultas al CRM); los únicos cambios fueron los de la sección 5. Complementa a [`how-to/configurar-webhook-manychat.md`](../how-to/configurar-webhook-manychat.md).

## 1. Qué se reportó

El equipo avisó que ManyChat "no levantaba la etiqueta ni el tracking de hacia dónde se dirigió el usuario" en algunos contactos, cuando hasta hacía unos días funcionaba. Ejemplo: un contacto sin etiqueta y con `Estado_Comunidad` y `Localidad_CABA` en "No establecido".

## 2. Conclusiones

1. **El tracking no estaba roto.** El CRM siguió registrando a todos los que entraron con la frase de su comunidad; las etiquetas siguieron funcionando.
2. **El contacto reportado nunca entró al flow:** escribió "¡Hola! Quiero más información" (el saludo por defecto de Meta), que no activa ningún flow. Quien escribe otra cosa queda en ManyChat como contacto suscrito, sin etiqueta, sin evento en el CRM y **sin respuesta**: un hueco de diseño. Resuelto en la sección 5.
3. **La planilla de ManyChat dejó de guardar la fecha el 16/10.** No fue un cambio de configuración: la columna estaba conectada al campo "Última interacción" de **Instagram**, y ese día dejaron de entrar contactos de Instagram.
4. **El origen exacto del contacto reportado no se determinó** (sección 6).

## 3. Qué se verificó

| Capa | Resultado |
|---|---|
| CRM y webhook | Eventos al día, **sin rechazos desde el 10/10**. Cruce del 04/11 entre ManyChat, planilla de n8n y CRM: coinciden por comunidad; la única pérdida son ~14 contactos anteriores al 10/10 (no recuperados) |
| Etiquetas | Funcionan (Boedo 170 → 172 en esos días). 509 etiquetas contra 496 personas en el CRM: la diferencia son esos ~14 |
| Flow de comunidades | Una sola acción final ("Acciones #8") para las tres ramas: 362 contactos únicos, 407 activaciones. Se dispara por **palabra clave** (el mensaje contiene Boedo, Palermo…), no solo por la frase completa |
| Anuncios (Meta, solo lectura) | Campaña de tráfico a WhatsApp: 3 conjuntos y 12 anuncios activos, creados el 16/10 y **sin editar desde entonces**; la campaña de interacción lleva al perfil de Instagram; la de leads de Instagram está pausada. Las demás cuentas accesibles no tienen anuncios de Cortado que lleven a WhatsApp |
| Planilla de ManyChat | Historial de versiones: solo filas agregadas por ManyChat, **sin ediciones manuales ni columnas movidas**. Última fila con fecha: 16/10 14:35 (último contacto de Instagram); primera sin fecha: 15:22 |

## 4. Causas y qué se descartó

| Hallazgo | Causa |
|---|---|
| Contactos sin etiqueta ni evento | Escriben al número sin la frase: ningún flow se activa. La respuesta predeterminada era una **plantilla en inglés con el disparador sin configurar** (nunca se activaba) |
| Planilla sin fecha desde el 16/10 | Fecha ← "Última interacción" de Instagram; hay un campo por canal con el mismo nombre. Antes del corte entraban 180 contactos de Instagram y 4 de WhatsApp; desde entonces solo WhatsApp |
| Planilla sin teléfono | La columna usaba el campo de sistema "Teléfono", que en WhatsApp llega vacío (el campo útil es **WhatsApp ID**) |

**Descartado:** falla del CRM o del webhook · falla de etiquetas · un anuncio editado recientemente que perdió el texto prellenado · otras campañas o cuentas que lleven a WhatsApp · la campaña de leads de Instagram (pausada, sin gasto) · un cambio de mapeo o de columnas en la planilla · una columna "Estado" corrida (es la fecha de suscripción, siempre lo fue) · pérdida de datos entre sistemas (salvo los ~14 previos al 10/10). El aviso "JSON no válido" del editor de ManyChat es normal sin contacto de prueba.

## 5. Qué se resolvió

- **CRM (PR #64):** tabla `ingreso_sin_clasificar` y aviso `"evento": "sin_clasificar"` en el webhook (sin tocar la atribución), tarjetas en Overview y filtro "Sin clasificar" en Data_Cruda. `db/035` aplicada y webhook desplegado el 2026-11-06.
- **ManyChat:** flow **"Consultas generales - wsp"** como respuesta predeterminada (documentado en el how-to). Verificado de punta a punta el 2026-11-11: aviso *sin clasificar* → *trigger* → evento **Aceptado** en la comunidad → *clic en Me sumo*, sin rechazos.
- **Planilla:** Fecha ← "Última interacción" de WhatsApp y Teléfono ← "WhatsApp ID" (probado el 08/11).
- **Datos históricos** reconstruidos en archivos aparte, sin escribir en la planilla: **384 de 391** fechas faltantes y **393** filas de WhatsApp con teléfono (368 personas); 178 filas de Instagram sin teléfono (se informa el usuario) y 2 sin dato (filas 41 y 188).
- Se corrigió un error de tipeo en una publicación ("u barrio") y se registró el estado anterior de la respuesta predeterminada.

## 6. Abierto

- **Origen del contacto reportado:** no coincide con ninguna campaña ni cuenta revisada. Hipótesis sin verificar: el botón de contacto de WhatsApp de la página de Facebook, el enlace de la biografía de Instagram o un enlace directo. Falta revisar esos botones; el **número anterior** (+54 9 11 2753-5622) no debe quedar en ninguno. Desde ahora los avisos *sin clasificar* guardan el mensaje, así que el patrón se va a ver en Data_Cruda.
- **Pegado en la planilla:** al 2026-11-11 los teléfonos se habían pegado **corridos una fila** (la primera celda del bloque estaba vacía y la selección salta las vacías) y las fechas del bloque A189:A571 no estaban. Corrección: cortar C2:C573 y pegar en C3; pegar las fechas de C4:C386 en A189. Control: C2 vacía, C3 y C189 con número, C188 vacía, C574 con número.
- **Dos decisiones:** qué reciben los miembros que escriban al número (hoy el "Gracias por escribirnos") y si se suma la opción "Otra consulta" con atención humana (hay que definir quién la atiende).

## 7. Observaciones de la campaña de WhatsApp (no se cambió nada)

Datos de los 14 días del 22/10 al 04/11, para decidir:

- Optimiza **clics en el enlace**, no conversaciones: 18.805 clics ($77,7 cada uno, $1.461.219 de gasto) contra unas 203 entradas al flow (~1 %).
- Ubicaciones automáticas con **Audience Network**: 23 % del gasto y 32 % de los clics (alta probabilidad de clics accidentales).
- Segmentación distinta por barrio (barrio completo, punto de 1 km, barrio más círculo; audiencia Advantage+ activa en dos de tres) y presupuesto de $42.000 en Palermo contra $30.000 en los otros dos.
- Entre el 60 y el 82 % del gasto de cada barrio se concentra en un anuncio; siete de los doce casi no se entregan.
- Las plantillas de mensaje (saludo + preguntas frecuentes) llevaban el nombre de la persona, que WhatsApp deja vacío ("¡Hola, !"); ya hay una plantilla "Todas las opciones" sin nombre.

## 8. Hallazgos operativos para tener en cuenta

- El flow de comunidades manda a **la última rama (Villa Devoto)** todo mensaje que no coincide exacto: hay tres casos de prueba (dos de "La Toma" y uno con un error de tipeo que decía Palermo).
- Tocar un botón de respuesta de un flow **no** dispara los flows por palabra clave.
- Si cambia el texto de las preguntas frecuentes de los anuncios, hay que cambiarlo también en las condiciones del flow de comunidades y en los links del flow "Consultas generales".
