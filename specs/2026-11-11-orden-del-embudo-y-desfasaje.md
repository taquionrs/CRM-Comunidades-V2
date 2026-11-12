# Spec — Orden por etapas de Control_Comunidades, clics en el enlace y desfasaje del tracking

Estado: **implementada en la PR #65 (2026-11-11), pendiente de aplicar `db/036` y de agregar el campo en Windsor.**
Pedido de Juan Marroncle (2026-11-11), a partir de la conversación con la PO del 11/11 ("hay algo roto en WhatsApp que no estamos pudiendo ver").

## Para qué

El cruce del 11/11 mostró que **Meta cuenta 201 conversaciones iniciadas y el CRM registra 62 entradas al flow (57 personas)** del 02 al 10/11: el 31 % de los chats queda registrado. El problema no está en el envío al CRM (no hay rechazos desde el 09/10), está **antes de la entrada al flow**, y el panel no lo mostraba:

- El panel ordenaba las columnas por **fuente** (Meta, ManyChat, CRM...), no por el **recorrido de la persona**.
- Los clics del anuncio eran **todos los clics**, no los del enlace (el CTR sale inflado).
- Existía "Entradas / conversaciones" (cobertura) pero sin la cantidad de chats que se pierden ni el detalle por zona.

Hallazgos que motivan el diseño (02 al 10/11, Meta + Data_Cruda):

| Zona | Clics enlace | Chats Meta | Entradas CRM | Clic → chat | Cobertura | Lectura |
|---|---|---|---|---|---|---|
| Boedo | 3.346 | 93 | 15 | 2,8 % | 16 % | hueco de **tracking** (78 chats sin registrar) |
| Devoto | 3.090 | 72 | 42 | 2,3 % | 58 % | funciona razonablemente |
| Palermo | 5.179 | 36 | 5 | 0,7 % | 14 % | hueco de **pauta** (muchos clics sin intención) |

## Decisiones (2026-11-11)

1. **Las conversaciones de Meta se muestran**, pero siguen sin ser el KPI principal. El KPI de entrada sigue siendo la **entrada al flow**; las conversaciones sirven para medir cuánto del tracking se pierde. No se usan como numerador ni denominador de la tasa de triaje.
2. **Se agrega el desfasaje** (% y cantidad) entre conversaciones iniciadas y entradas al flow, pegado a las entradas.
3. **Se prioriza el clic en el enlace** sobre el clic total.
4. **El orden de las columnas sigue el recorrido de la persona.**
5. **La etapa "Valor" (K-Factor, prescriptores) queda para el final del roadmap del mes.** No entra en esta PR.

## El orden (de izquierda a derecha)

| Etapa | Columnas | Fuente |
|---|---|---|
| **1. Alcanzar** | Inversión · **Clics en el enlace** · **CTR del enlace** · **Costo por clic en el enlace** · CTR (todos los clics) | Meta (Windsor) |
| **2. Intención** | Conversaciones · CPMI · **Clic → conversación** · Clientes potenciales (Meta) · Costo por cliente potencial | Meta (Windsor) |
| **3. Control del tracking** | Entradas al flow · **Desfasaje conversaciones → flow** · **Chats sin registrar** · **Sin clasificar** · Costo por entrada al flow | ManyChat → CRM |
| **4. Activación** | Trigger entregados · Clics en "Me sumo" · CTR del botón · Clic en "Me sumo" / entradas · Costo por clic en "Me sumo" | ManyChat → CRM |
| **5. Ingreso** | Miembros iniciales (MI) · Miembros finales (MF) · Crecimiento neto · Costo por miembro neto | Carga de miembros |
| **6. Permanencia** | Bajas · Tasa de fuga | Carga de miembros |

En negrita, lo nuevo. Se retira "Entradas / conversaciones" (cobertura): el desfasaje es su complemento (100 % − cobertura).

**La fuente de cada métrica se conserva** (pedido de Juan, 11/11): aunque el encabezado de grupo ahora es la etapa, cada columna muestra chica, arriba de su nombre, de dónde sale el dato (punto de color + nombre: Meta Ads, ManyChat, CRM, Meta Ads + CRM, WhatsApp & Salud o Financiera). Las columnas que ya existían mantienen la fuente de su grupo anterior; el botón "i" empieza con "Fuente: ..." y el panel "Columnas" muestra "etapa · fuente".

## Definiciones

| Métrica | Fórmula | Reglas |
|---|---|---|
| **Clics en el enlace** | Suma de `actions_link_click` de Windsor | `NULL` = el día todavía no trae el dato ("Sin fuente"); **nunca 0**. 0 es un dato real |
| **CTR del enlace** | Clics en el enlace ÷ impresiones | Solo con los días que traen el dato |
| **Costo por clic en el enlace** | Inversión ÷ clics en el enlace | Solo con los días que traen el dato. Columna de plata (solo rol Marketing) |
| **Clic → conversación** | Conversaciones ÷ clics en el enlace | Solo si **todos** los días del período traen el dato (si no, "Sin dato") |
| **Desfasaje** | (Conversaciones − entradas al flow) ÷ conversaciones | Puede ser **negativo** (más entradas que conversaciones). Sin conversaciones: "Sin dato". El total **no incluye** la fila de campañas globales (no tiene entradas propias) |
| **Chats sin registrar** | Conversaciones − entradas al flow | Misma regla de signo y de campañas globales. Evita leer mal un porcentaje con pocos casos |
| **Sin clasificar** | Personas que escribieron al número y no eligieron comunidad (db/035) | No pertenece a ninguna comunidad: cada fila dice "Sin comunidad" y el número va en el total del cliente |

**Semáforo (propuesta, no implementada):** cobertura (100 % − desfasaje) mayor a 85 % verde, entre 60 y 85 % amarillo, menor a 60 % rojo. Hoy Devoto estaría en amarillo y Boedo y Palermo en rojo. Falta que la PO apruebe los umbrales antes de pintarlos.

**Límites que quedan escritos:**
- El desfasaje compara conversaciones de Meta (ventana de atribución de 7 días, con un día de retraso) con entradas de primer contacto del CRM: es un indicador, no una igualdad. Con filtro de canal las columnas que usan Meta dicen "No se divide".
- No distingue por qué se pierde el chat (persona que no toca la pregunta, plantilla distinta, flow roto). Eso se investiga con ManyChat.

## Cambios técnicos

| Pieza | Cambio |
|---|---|
| `db/036_clics_enlace.sql` | Columna `clics_enlace` (int, nullable) en `meta_ads_metrica`, `meta_ads_metrica_global` y `ads_campana_dia`. `_windsor_normalizar` la lee de `windsor_raw.facebook_ads` **si la columna existe** (si no, NULL); `_windsor_normalizar_json` lee `lc`; `_windsor_aplicar` la guarda. `comunidad_performance_rango` devuelve `clics_enlace`, `ctr_enlace_pct`, `cpc_enlace`, `dias_sin_clics_enlace`, `impresiones_enlace` e `inversion_enlace`. `metricas_globales_cliente` y `desglose_campanas` devuelven también los clics en el enlace. Se recrean (cambia el tipo de retorno) con los mismos permisos que tenían |
| `supabase/functions/meta-en-vivo` | Pide `actions_link_click` a Windsor. Si Windsor responde 400 o 422 reintenta **sin** ese campo y avisa (`clics_enlace_omitidos`): "Traer de Meta ahora" no se rompe por un nombre mal escrito |
| `scripts/windsor-importar.mjs` y `scripts/lib/windsor-mapeo.mjs` | Importan `actions_link_click` del CSV o de la API; columna ausente o vacía = NULL |
| `public/index.html` | Grupos de columnas por etapa, columnas nuevas, `entradas_conv` retirada, desglose con "Clics enlace", aviso de días sin el dato, total de "Sin clasificar" desde `entradas_flow_cliente`. El orden y las columnas ocultas guardados en cada navegador se **reinician** (clave nueva `..._v2`) |
| Windsor | Agregar el campo a la tarea: [agregar-clics-en-el-enlace-a-windsor.md](../docs/how-to/agregar-clics-en-el-enlace-a-windsor.md) |

## Orden de despliegue

1. **CRM primero:** aplicar `db/036` (el archivo `aplicar-036.sql`; antes, el ensayo `ensayo-036.sql`, que no deja rastros). Es compatible hacia atrás: el panel viejo ignora las columnas nuevas.
2. Desplegar `meta-en-vivo`: `supabase functions deploy meta-en-vivo --use-api --no-verify-jwt`.
3. Fusionar la PR (el panel sale con Vercel). Hasta que lleguen los datos, las columnas de clics en el enlace dicen "Sin fuente".
4. **Windsor:** agregar el campo y volver a traer los últimos 30 días (guía paso a paso).
5. Comprobar contra Ads Manager: 11.615 clics en el enlace de la campaña de WhatsApp de Cortado del 02 al 10/11.

## Cómo se probó

- 151 pruebas del panel y de las funciones (`npm test`) y 46 de la base con Postgres local (`npm run test:db`): incluyen que un día sin dato queda en NULL y no en 0, que el CTR y el costo usan solo los días con dato, que el rol General no ve el costo por clic, que el desglose es solo para Marketing y que la tarea diaria funciona antes y después de que exista la columna.
- No se probó en un navegador contra datos reales ni se desplegó la función `meta-en-vivo`; el nombre `actions_link_click` en Windsor todavía no está confirmado con una consulta real (por eso el reintento sin el campo).

## Fuera de esta PR (siguientes pasos)

| Qué | Por qué no está |
|---|---|
| **Etapa "Valor"** (K-Factor, prescriptores) | Decisión del 11/11: final del roadmap del mes |
| **Tasa de triaje por comunidad** (ingresos al grupo ÷ entradas al flow) y miembros nuevos del período | Hoy el panel solo tiene crecimiento neto (MF − MI). Hace falta una función de ingresos por período (la v0 se retiró con la PR #63) |
| **Alcance y frecuencia** | No se pueden sumar día por día: hay que pedirlos a Windsor por ventana (ver la spec del embudo de comunidad) |
| **Retención a 30 y 60 días y CPMR** | Dependen de los pulsos de ManyChat |
| **Semáforo de cobertura** | Esperar la aprobación de los umbrales |
| **Flow de "sin clasificar" en ManyChat** | Pendiente del lado de ManyChat; mientras tanto la columna dice 0 |
| **Arreglar el hueco de Boedo y la pauta de Palermo** | Son decisiones de operación (probar el anuncio desde un celular, plantilla y flow en ManyChat, objetivo de la campaña); el panel ahora lo hace visible |

## Ajuste del 12/11 (PR #67): el CTR sale de los clics en el enlace

Pedido de Juan (2026-11-12): el CTR se arma con los **clics en el enlace**, no con todos los clics.

| Qué | Cambio |
|---|---|
| Control_Comunidades | Se retira la columna "CTR (todos los clics)". El único CTR es **"CTR del enlace"** (clics en el enlace ÷ impresiones, solo días con dato) |
| Desglose por campaña | Se retira "Clics (todos)". La columna CTR pasa a ser "CTR del enlace" y el total dice "clics en el enlace" |
| `db/037` | `desglose_campanas` devuelve también `impresiones_enlace` (impresiones de los días con clics en el enlace) para que el CTR del desglose no salga bajo cuando hay días sin el dato. Mismos permisos: solo Marketing |
| Se mantiene | La base sigue guardando `clics` y `ctr_anuncio_pct`; la sección Campañas (lista de campañas de Windsor) sigue mostrando los clics totales que trae el campo `clicks` |

**Windsor:** el CTR ya no necesita el campo `clicks`, pero la lista de Campañas sí lo lee. Si se saca `clicks` de la tarea, esa lista muestra 0 clics para los días nuevos. Conviene dejarlo.

## Ajuste del 12/11 (PR #68): un día sin el dato no borra los clics en el enlace guardados

Los clics en el enlace entran por dos caminos: "Traer de Meta ahora" (consulta directa a Windsor) y la tarea diaria (tabla `windsor_raw.facebook_ads`). Si la tarea no entrega `actions_link_click`, la conversión de las 06:30 reescribía los días con NULL y las columnas volvían a "Sin fuente".

`db/038` ajusta `_windsor_aplicar`: si el dato nuevo viene vacío se conserva el que ya estaba (en `meta_ads_metrica`, `meta_ads_metrica_global` y `ads_campana_dia`). Un día que nunca lo tuvo sigue en NULL, y un 0 real sí pisa el valor anterior. Orden: aplicar `db/038`; no requiere cambios en el panel.
