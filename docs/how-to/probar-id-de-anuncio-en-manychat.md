# Cómo: probar si ManyChat entrega el ID del anuncio (PR #73)

**Para qué:** hoy todos los anuncios de una zona mandan el mismo mensaje ("Hola, quiero unirme a la comunidad de Cortado en Jarrito Palermo ☕"), y el contacto llega a ManyChat como "Directo", sin ningún dato de anuncio. Si ManyChat pudiera darnos el **ID del anuncio de origen**, el CRM lo vincularía solo con el catálogo (que ya tiene el ID de cada anuncio, traído de Windsor) y **no haría falta ningún código ni plantilla nueva por anuncio**.

Esta prueba responde una sola pregunta: **¿aparece el ID del anuncio en los datos del contacto cuando alguien entra desde un anuncio?**

**Quién lo hace:** vos, en ManyChat. Tiempo: 15 a 20 minutos, más lo que tardes en tocar el anuncio desde tu teléfono.

> Los nombres de los botones de ManyChat pueden variar. Si algo no se parece a lo que dice acá, no cambies nada y mandame una captura.

## Qué toca y qué no
- Se arma **una automatización nueva de prueba**, atada a **un solo anuncio**. No se tocan los flows de las comunidades ni el flow "Consultas generales".
- La automatización **no manda ningún mensaje** a la persona. Solo envía los datos del contacto al CRM.
- **No uses la opción de conectar "toda la cuenta publicitaria"**: se dispararía con todos los anuncios y con personas reales. Usá solo el ID de un anuncio.

## Qué anuncio usar
Elegí **uno** de poco gasto, por ejemplo `PALERMO_03` (ID `120252390568990568`). Los IDs de todos los anuncios están en el bloque Rendimiento, columna **ID**.

El anuncio tiene que estar **entregando** para poder tocarlo. Hoy Meta informa la campaña de Cortado WhatsApp como **pausada**: si querés hacer la prueba, hay que activarla un rato (decisión tuya; con un anuncio de poco gasto alcanza con unos minutos).

## Paso a paso

1. En ManyChat abrí **Automation** y creá una **automatización nueva** (canal WhatsApp). Poneles de nombre "PRUEBA ID de anuncio".
2. En el disparador (**trigger**) elegí **WhatsApp Ads** y conectá el anuncio **por su ID** (pegá el ID del anuncio elegido). Meta puede tardar hasta 30 segundos en mostrarlo.
3. Agregá una acción **External Request** (la misma clase de bloque que usa el flow "Consultas generales"):
   - Método y URL: los mismos que ese flow (ver `docs/how-to/configurar-webhook-manychat.md`).
   - Headers: `x-cliente` y `x-webhook-secret`, los mismos de siempre.
   - Cuerpo (JSON): `{ "evento": "sin_clasificar", "contact": <los datos completos del contacto> }`, igual que en "Consultas generales".
4. **No agregues ningún mensaje.** Publicá (activá) la automatización.
5. Desde tu teléfono, **tocá ese anuncio** (en Facebook o Instagram) y mandá el mensaje de WhatsApp tal cual viene.
6. Avisame cuando lo hayas hecho. Yo leo ese contacto en el CRM (queda en "sin clasificar", con todos sus datos) y busco cualquier campo de anuncio.
   - Vos también podés mirar el contacto en ManyChat (Audience → abrí el contacto) y ver si aparece un campo con el ID o el nombre del anuncio.
7. Al terminar, **pausá o borrá** la automatización de prueba y volvé a pausar la campaña si la habías activado.

## Cómo se lee el resultado

| Qué pasa | Qué significa | Qué sigue |
|---|---|---|
| Aparece un campo con el ID del anuncio | ManyChat lo entrega | Armo la lectura en el CRM (una PR chica) y se vincula solo con el catálogo. No hace falta código en el mensaje |
| La automatización se dispara pero no hay ningún dato de anuncio | ManyChat detecta el anuncio pero no lo expone en los datos | Se consulta a ManyChat si hay otra forma; plan B: el código en el mensaje |
| La automatización no se dispara | El mensaje precargado del anuncio puede impedir que se detecte el anuncio (hay reportes así en la comunidad de ManyChat) | Plan B |

## Plan B (si ManyChat no lo entrega)
- **Código en el mensaje:** cada anuncio ya tiene su código en el catálogo (`PAL-01`, `BOE-04`...). Se agrega al final del mensaje precargado. Es un paso por anuncio nuevo.
- **Estimación:** repartir las entradas de cada zona entre sus anuncios según los chats que Meta cuenta por anuncio. No identifica personas, y por eso no detecta anuncios que traen chats que no entran: sirve como aproximación, no como medida.
- **Conectar WhatsApp directo a la API de Meta:** entrega la fuente de cada mensaje, pero reemplaza a ManyChat como proveedor y rompería los flows actuales. No se recomienda.
