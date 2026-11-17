# El centro de acciones: "Para completar" (PR #77)

**Para qué sirve:** el CRM necesita algunos datos tuyos para calcular sus propias métricas (por ejemplo, una carga de miembros reciente para el CRR). En lugar de esperar a que te acuerdes, **te lo pide**: arriba de **Overview** y de **Control_Comunidades** aparece una franja **"Para completar"**, con el mensaje directo y el botón que lo resuelve. Si no falta nada, dice **"Todo al día"**.

La ven los usuarios con rol **Marketing** (son tareas que solo Marketing puede hacer).

## Qué te puede pedir

| Aviso | Cuándo aparece | Botón |
|---|---|---|
| **Cargá la lista de ...** | Una comunidad lleva **más de 8 días** sin carga de lista completa | **Cargar miembros** (se abre con la comunidad ya elegida, o con "Todas las comunidades" si son varias) |
| **... no tiene ninguna carga** | Una comunidad no tiene ninguna carga de lista completa | **Cargar miembros** |
| **... tiene una sola carga** | Con una sola carga reciente no se puede calcular el CRR: hace falta otra | **Cargar miembros** |
| **La última carga no cuadra** | Miembros al inicio + nuevos − bajas no da los miembros al final | **Ver las cargas** |
| **La sincronización con Meta no corre desde ...** | La sincronización automática no corre hace más de 48 horas | **Traer de Meta ahora** |
| **Hay $X de gasto sin comunidad** | Un conjunto de anuncios nuevo no está asignado a ninguna comunidad | **Campañas** |
| **N personas escribieron y no eligieron comunidad** | 3 o más personas distintas, en los últimos 7 días | **Ver en Data_Cruda** |

Si varias comunidades tienen el mismo problema, es **un solo aviso** ("Cargá la lista de miembros de Palermo y Villa Devoto: llevan 22 días sin actualizarse"), no uno por comunidad.

## Cómo se ordena
- **Rojo (prioridad 1):** afecta directamente a las métricas: lista vencida, carga que no cuadra, Meta sin sincronizar.
- **Naranja (prioridad 2):** falta algo para poder medir: comunidad sin cargas, una sola carga, gasto sin asignar.
- **Gris (prioridad 3):** informativo: personas sin clasificar.
- Se muestran **hasta 5** a la vez. Si hay más, avisa cuántas quedan y aparecen cuando resuelvas estas.
- Lo resuelto **desaparece solo**: no hay que marcar nada.

## Posponer
Cada aviso tiene **Posponer**: elegís un motivo (*Ya lo estoy haciendo*, *Campañas apagadas a propósito* o *No aplica por ahora*) y el aviso se queda en silencio **7 días**. Pasado ese tiempo, si sigue pendiente, vuelve. El motivo y quién lo pospuso quedan registrados.

## Lo que no te va a pedir
**No avisa por campañas apagadas a propósito.** "Meta sin sincronizar" mira **cuándo corrió la sincronización**, no cuál es el último día con gasto: si apagás las campañas, no hay gasto nuevo y eso no es un problema.

## Para quien mantiene el CRM
- Las acciones las calcula la función `acciones_pendientes(cliente)` (`db/045`), que devuelve **el mensaje ya escrito**, el texto del botón, a dónde lleva y las comunidades involucradas. El panel solo las muestra, así que n8n puede usar la misma función para avisos.
- Para sumar una acción nueva: agregar el bloque en `acciones_pendientes`, el código en la lista de `posponer_accion` y el destino en `ejecutarAccion` (panel).
- **Todavía no incluye:** reporte semanal sin bajar, anuncios sin código y campañas pausadas (necesitan registrar las descargas o leer el estado de las campañas de Meta). Están en el plan, sección 7.1.
