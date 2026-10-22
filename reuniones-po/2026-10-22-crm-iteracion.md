# Reunión 2026-10-22 — CRM iteración

**Participantes:** Juan Marroncle (marketing), Jazleidis Lesmes (PO).
**Fuente:** notas y transcripción de Gemini, "CRM iteración" del 22/10/2026 (transcripción en Google Drive, adjunta al evento del calendario).
**Próxima reunión:** el jueves siguiente (29/10, a confirmar).

## Resumen

Juan mostró los avances desde la reunión anterior: el flujo de n8n que registra todos los contactos con teléfono (Instagram y WhatsApp), el desglose por campaña en Control_Comunidades, la sección Campañas, la consulta a Windsor en vivo por rango de fechas y el avance del SSO. Se acordaron mejoras de claridad (leyendas en las métricas) y filtros en varias pestañas. Al contrastar el CRM con el chat de Palermo aparecieron diferencias de volumen que hay que armonizar.

## Decisiones

1. **Selección de campañas de conversión a WhatsApp** desde la sección Campañas: agregar la asignación y la selección, incluida la campaña de Instagram.
2. **Leyendas en las métricas:** un subtítulo o un signo de pregunta que explique cada sigla (CPMI = costo por mensaje iniciado, CPME, CPL y las demás), pensando en usuarios que no vienen de marketing.
3. **Filtros de fecha y de comunidad** en Data_Deduplicada, Data_Cruda, Overview y Base_Limpia.
4. **MCP de Meta:** funciona solo con Claude y no aporta utilidad práctica al CRM del día a día. No se incorpora.
5. **Atribución** sigue como maqueta en construcción.

## Próximos pasos

| Tarea | Responsable | Estado en el CRM al 22/10 |
|---|---|---|
| Agregar la campaña de Instagram a Campañas, para sumar sus métricas y presupuesto | Juan | La sección Campañas ya existe (PR #49): se puede asignar. Falta definir a qué suma (ver la duda sobre la sección "global") |
| Poder elegir la cuenta publicitaria a la que pertenece cada campaña | Juan | Pendiente. La lista ya trae el id de la cuenta; falta mostrarlo y poder elegirlo |
| Leyendas explicativas de CPMI, CPME, CPL y otras siglas | Juan | En Control_Comunidades las columnas ya tienen el signo "i" (CPL pasó a CPMI en la PR #53). Falta en las tarjetas de Overview |
| Explicar cómo se calcula la tasa de fuga (desde la 2ª carga de la lista completa) | Juan | Ya está en la "i" de la columna en Control_Comunidades. Falta en Overview |
| Filtros de fecha y comunidad en Data_Deduplicada, Data_Cruda, Overview y Base_Limpia | Juan | Pendiente. Base_Limpia ya filtra por comunidad, no por fecha. Overview no filtra por fecha |
| Completar el SSO cuando Tecnología termine su parte | Juan | En curso: PR #54 de Tecnología, con los 5 secretos ya cargados en Supabase. Ver [`specs/2026-10-21-sso-cloudflare-y-roles.md`](../specs/2026-10-21-sso-cloudflare-y-roles.md) |
| Verificar con una skill que los contactos registrados por n8n coinciden con los del grupo | Juan | Pendiente |

## Lo que se mostró

- **n8n → planilla:** el flujo que registra los contactos con teléfono, sea de una campaña de Instagram o de WhatsApp, está activo y registra todo. La automatización quedó marcada como lista en el tablero de tareas.
- **Control_Comunidades con desglose por campaña** y **sección Campañas** para incluir o excluir campañas. Una campaña en "destino sin asignar" no suma presupuesto ni métricas.
- **Windsor en vivo:** el CRM consulta a Windsor por el rango de fechas elegido. Mejoró el problema anterior de la selección de fechas. En la prueba, al cambiar el rango cambiaron los números (la campaña de tráfico empezó a gastar hace pocos días).
- **SSO:** Tecnología implementó varias piezas. Juan hizo algunos pasos de la lista que le pasaron y necesita apoyo de Tecnología para el resto.

## Hallazgos y dudas abiertas

- **Palermo no coincide con el chat.** Juan comparó el CRM con ManyChat para los contactos con última interacción posterior al 19/10:
  - Con "última vez visto" coincide (13 o 14 personas). Con otros filtros baja (por ejemplo, el opt-in).
  - En el CRM, "Entradas al flow" mostraba 10 y en el chat deberían ser 12 o 13.
  - Hay contactos que entran más de una vez (duplicados), más de los que parecía.
  - Hay que decidir qué campo manda para las entradas: última vez visto, opt-in o la fecha de entrada al flow, y armonizar las tres definiciones.
- **Juan dijo que "ya no estamos midiendo por conversaciones de Meta, sino por…"**, pero la frase queda cortada en la transcripción. Confirmar con él por qué se mide ahora y revisar que la tabla lo refleje.
- **Una sección o comunidad "global".** Juan dijo que ahí "tiene que estar una global" para la campaña de Instagram, y las notas de Gemini hablan de integrarla "en una sección global". No quedó claro qué es: ¿una comunidad nueva, o un total aparte? Hoy una campaña solo se puede asignar a una comunidad concreta o dejar sin asignar.
- **Al hacer clic en Palermo** hay que verificar que efectivamente filtre.
- **Revisar que los datos mostrados sean correctos** una vez hecho el filtro de fecha en Overview.

## Para la próxima reunión

- Tener el SSO funcionando en producción, o saber qué falta.
- Filtros y leyendas hechos (o por lo menos las leyendas).
- Una propuesta para la comunidad "global" y para la definición de "entrada".
- Más datos de Palermo contrastados contra el chat.
