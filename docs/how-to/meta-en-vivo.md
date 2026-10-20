# Meta en vivo: traer de Windsor, a pedido y para el rango elegido

Hasta ahora Windsor escribía una vez por día y el panel mostraba eso. Con **"Traer de Meta ahora"** (Control_Comunidades) el CRM le pregunta a Windsor **en el momento**, para el rango de fechas que elegiste, y actualiza el gasto y las conversaciones de Meta. Aplica las mismas reglas de siempre: solo suman las campañas que cuentan y cada una va a su comunidad (ver `configurar-windsor-ai.md`).

## Cómo se usa
1. En Control_Comunidades elegí **Desde** y **Hasta** (hasta **31 días** por vez; no se aceptan fechas futuras). Si dejás las dos vacías, trae los **últimos 7 días hasta ayer**.
2. Tocá **Traer de Meta ahora**. Tarda entre unos segundos y **1 minuto** (Windsor demora unos 15 a 30 segundos por cada 14 días de datos).
3. Al terminar, el panel muestra un resumen ("Windsor devolvió N filas… se actualizaron M registros · no cuenta por regla: …") y se recarga con los números nuevos.
4. Se puede volver a usar pasados **45 segundos**. Cada consulta queda en **Consultas** como una conversión ("windsor_raw.en_vivo desde a hasta").

**Para traer un período más largo, hacerlo en tramos** de hasta 31 días (por ejemplo, del 14/08 al 13/09, y después del 14/09 al 14/10).

## Qué hace por dentro
1. El panel llama a la función del servidor `meta-en-vivo` con el rango.
2. La función pide a Windsor (conector Facebook) el rango en ventanas de 14 días y en paralelo.
3. Le pasa las filas a la base (`meta_en_vivo_aplicar`, `db/027`), que usa **la misma lógica de asignación** que la sincronización diaria: reglas de `comunidad_meta_origen`, campañas que no cuentan, y limpieza de lo que ya no corresponde **solo en las fechas pedidas**.
4. La actualización diaria sigue funcionando igual.

## Puesta en marcha (una vez)
1. **Cargar la clave de Windsor como secreto** de la función. En Supabase → Edge Functions → Secrets, agregar `WINDSOR_API_KEY` (o `supabase secrets set WINDSOR_API_KEY=...`). La clave **nunca** va en el panel, en el repositorio ni en el chat. La función no la devuelve ni la registra: la enmascara en cualquier mensaje de error.
2. **Aplicar `db/027_meta_en_vivo.sql`** (con su ensayo con rollback primero).
3. **Desplegar la función** (sin verificación de token, porque el panel todavía no tiene login):

   ```bash
   supabase functions deploy meta-en-vivo --use-api --no-verify-jwt
   ```
4. Probar con un rango corto (por ejemplo, los últimos 3 días) y revisar el resumen y Consultas.

## Seguridad (excepción hasta el SSO)
- La función se despliega **sin verificación de token** y cualquiera con el enlace del panel puede pedir una consulta. Los límites que la acotan: **31 días por pedido** y **una consulta cada 45 segundos** (se controla en la base).
- Consume cuota de la API de Windsor. No devuelve teléfonos ni datos de personas: solo un resumen de cuántas filas se actualizaron.
- Con el SSO, la función pasa a exigir usuario.

## Si algo falla
| Mensaje | Causa | Qué hacer |
|---|---|---|
| "Falta cargar la clave de Windsor como secreto de la función" (501) | No está `WINDSOR_API_KEY` | Cargarla como secreto y volver a intentar |
| "Esperá un momento: ya se consultó Windsor hace instantes" (429) | Hubo otra consulta hace menos de 45 s | Esperar un poco |
| "El máximo es de 31 días por vez" | Rango demasiado largo | Traerlo en tramos |
| "Windsor respondió HTTP 429 / 5xx" o "timeout" | Windsor está lento o saturado | Probar con un rango más corto o más tarde |
| La función no existe (404) | No se desplegó | Desplegarla con el comando de arriba |

## Desglose por campaña (debajo de la tabla)

Desde la migración `db/029`, cada vez que se trae Meta (la corrida diaria o "Traer de Meta ahora") se guarda también el detalle por campaña y conjunto de **lo que cuenta**. En Control_Comunidades aparece debajo de la tabla como "Desglose de campañas contempladas": agrupado por medio (hoy Meta Ads), con cada campaña desplegable para ver sus conjuntos y la comunidad a la que suman.

- Muestra solo lo que suma en la tabla de arriba; lo que no cuenta se ve en "Consultas".
- Respeta el período y la comunidad elegidos.
- Los días anteriores a la migración no tienen detalle hasta volver a traerlos: elegí esas fechas y tocá "Traer de Meta ahora" (de a 31 días como máximo). El panel avisa cuánto falta cuando el desglose no coincide con la inversión de la tabla.
