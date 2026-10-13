# Pulsos de retención: flow nuevo en ManyChat (paso a paso)

**Estado:** diseño aprobado el 2026-10-13. Falta construir la recepción en el CRM (ver "Qué se construye en el CRM") antes de publicar los nodos en ManyChat.

## Para qué sirve
Medir **cuánta gente sigue en el grupo** días después de entrar, **sin ninguna carga manual**, para calcular retención por comunidad: CPMR, TRG por grupo y la cohorte de cada anuncio. El bot le pregunta a cada persona, a los 7 y 30 días, si sigue en el grupo, y la respuesta llega sola al CRM.

La respuesta es **declarada por la persona** y no todas responden. Por eso el CRM siempre muestra la **cobertura** (respondieron ÷ a quienes se les preguntó) junto a la retención.

## Restricciones de las plataformas (verificadas el 2026-10-13)
| Canal | Regla | Qué implica |
|---|---|---|
| **WhatsApp** | Pasadas 24 h de la última respuesta de la persona, solo se puede escribir con una **plantilla aprobada por Meta**, y cada plantilla enviada **tiene costo** | Hay que crear y aprobar una plantilla para cada pulso y cargar un medio de pago |
| **Instagram** | Fuera de las 24 h hace falta que la persona haya aceptado **notificaciones recurrentes** (semanales o mensuales, una por período) | Hay que pedir el permiso en el momento de "Me sumo". **Verificar en tu ManyChat si las notificaciones recurrentes de Instagram están disponibles** (las fuentes se contradicen) |

Si en algún canal no se puede escribir a los 7 días, el pulso de ese canal no se manda y la cobertura lo va a reflejar: no se inventan datos.

## Cómo funciona
1. La persona toca **"Me sumo"** (el CRM ya registra ese clic).
2. En ese mismo momento, dentro de las 24 h, el bot le pide permiso: *"¿Te escribo en una semana para saber cómo te va en la comunidad?"* (Instagram: bloque de notificación recurrente semanal. WhatsApp: la persona ya inició la conversación).
3. A los **7 días** el bot manda: *"Hola {{nombre}}. Pasó una semana desde que te sumaste a la comunidad de {{barrio}}. ¿Seguís en el grupo?"* con dos botones: **Sí, sigo** y **Ya no estoy**.
4. Cada botón dispara un nodo que avisa al CRM. Se repite a los **28 a 30 días**.

## Paso a paso en ManyChat
Se hace **por cada flow y por cada canal** (Cortado y Todo un País, WhatsApp e Instagram).

**A. Permiso (dentro del flow actual)**
1. En el nodo `*_clic_me_sumo` (la salida propia del botón "Me sumo"), agregá a la misma rama un mensaje que pida el permiso del punto 2.
2. Instagram: usá el bloque de **notificación recurrente** con frecuencia **semanal**. WhatsApp: no necesita permiso aparte.
3. Si la persona acepta, agregá la etiqueta `pulso_acepto`. Esa etiqueta **solo** la aplica este paso.

**B. Automatización nueva "Pulso 7 días · <cliente> · <canal>"**
1. Disparador: se aplicó la etiqueta `pulso_acepto`.
2. Retraso de **7 días**.
3. Mensaje del pulso (WhatsApp: plantilla aprobada; Instagram: notificación recurrente) con los dos botones de respuesta rápida.
4. Dos nodos de Acciones, uno por botón. Nombres sugeridos: `Pulso7_sigue_<barrio>` y `Pulso7_salio_<barrio>`.
5. En cada nodo, agregá la **solicitud externa** al webhook del CRM: tipo `POST`, la misma URL y los mismos encabezados (`x-cliente` y `x-webhook-secret` del cliente).
6. Cuerpo del nodo "sigue":
```json
{"evento": "pulso_retencion", "dia": 7, "respuesta": "sigue", "community_id": "<pastilla Localidad>", "contact": <pastilla Full Contact Data>}
```
7. Cuerpo del nodo "salio": igual, con `"respuesta": "salio"`.
8. En ambos nodos, guardá la respuesta en un campo de la persona (por ejemplo `Pulso_7d`) para poder segmentar después.

**C. Pulso de 30 días**
1. Duplicá la automatización y cambiá el retraso a **28 días** (para quedar dentro de la ventana del permiso semanal y mensual).
2. En los cuerpos, cambiá `"dia": 7` por `"dia": 30`, y el nombre de los nodos por `Pulso30_…`.

**D. Prueba antes de publicar**
1. Cambiá temporalmente el retraso a **2 minutos** en una copia, para probar dentro de las 24 h.
2. Respondé desde tu cuenta de prueba y avisá la hora: se revisa en el CRM que llegó el aviso y quedó en la comunidad correcta.
3. Dejá el retraso real y publicá.

## Reglas de los nombres de los nodos
`Pulso<días>_<respuesta>_<barrio>`, por ejemplo `Pulso7_sigue_Palermo`. Los nombres sirven para mapear qué falta configurar.

## Qué se construye en el CRM (antes de publicar en ManyChat)
- El webhook acepta el tipo de aviso `pulso_retencion` con `dia` (7 o 30) y `respuesta` (`sigue` o `salio`), y rechaza cualquier valor distinto.
- Una tabla de pulsos, sin tocar `evento_crudo` ni las entradas.
- Columnas en Control_Comunidades: **Retención día 7**, **Retención día 30** y **Cobertura del pulso**, siempre por comunidad y nunca promediadas.
- Con eso se calculan después CPMR y TRG.

**No publiques los nodos de pulso en ManyChat hasta que el CRM esté listo:** hoy el webhook rechaza cualquier tipo de aviso que no conoce, y los avisos quedarían como rechazos.

## Cómo se lee el resultado
- **Retención día N** = personas que respondieron "sigue" ÷ personas que respondieron (entre quienes aceptaron el pulso).
- **Cobertura** = personas que respondieron ÷ personas a quienes se les preguntó.
- Una retención con cobertura baja no se declara como número: se reporta con su cobertura al lado.
