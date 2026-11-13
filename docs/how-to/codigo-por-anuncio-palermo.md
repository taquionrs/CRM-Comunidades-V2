# Código por anuncio — piloto en Palermo (PR #70)

## Para qué sirve

ManyChat no dice de qué anuncio viene cada persona: el contacto aparece como "Directo" y no trae anuncio ni fuente. Hoy el CRM sabe **la zona que eligió la persona**, no **el anuncio que vio**.

La solución es que cada anuncio de Meta tenga su propia plantilla de mensaje, y que la plantilla termine con un **código corto** (`P1`, `P2`, `P3`, `P4`). La persona manda el código dentro del primer mensaje, ManyChat ya lo entrega en `contact.last_input_text` y el CRM lo reconoce.

Es un **piloto en Palermo** (los 4 anuncios `PALERMO_01` a `PALERMO_04` de la campaña de tráfico a WhatsApp de Cortado en Jarrito). Si funciona, se repite en Devoto y Boedo.

## Qué cambia en el CRM

| Qué | Dónde |
|---|---|
| Catálogo de códigos (código → anuncio → comunidad) | tabla `anuncio_codigo` (db/039). Se carga a mano. |
| Código reconocido en cada entrada | columna `evento_crudo.anuncio_codigo` |
| Código reconocido en quien escribió sin elegir comunidad | columna `ingreso_sin_clasificar.anuncio_codigo` |
| Conteo de personas por código | función `entradas_por_anuncio(cliente, desde, hasta)` |
| Lectura del código al llegar el POST | Edge Function `manychat-webhook` |

**Qué no cambia:** la comunidad se sigue decidiendo por la frase, igual que hoy. El código es un dato extra. Si la persona lo borra o lo cambia, entra igual a la comunidad y queda "sin anuncio": nunca se pierde un contacto por esto. El POST completo sigue guardándose tal cual llegó.

El código solo cuenta si está en el catálogo y activo. Un texto parecido ("A1" en una dirección) se ignora.

## Códigos del piloto

| Código | Anuncio | Comunidad |
|---|---|---|
| `P1` | `PALERMO_01` | Palermo |
| `P2` | `PALERMO_02` | Palermo |
| `P3` | `PALERMO_03` | Palermo |
| `P4` | `PALERMO_04` | Palermo |

La migración los carga sola. Si el nombre de algún anuncio en Meta es distinto, se corrige el nombre en la tabla (el código no cambia).

## Orden de despliegue

1. Aplicar `db/039_codigo_por_anuncio.sql` (idempotente).
2. Desplegar la función: `supabase functions deploy manychat-webhook`.
3. Recién entonces cambiar las plantillas en Meta.

El orden 1 → 2 es el recomendado, pero la función no rompe si se despliega antes: solo escribe la columna cuando hay un código reconocido.

## Cambio en Meta (lo hace Juan)

En cada anuncio de Palermo, editar la **plantilla del mensaje** y agregar el código **al final**, separado por un espacio:

```
<frase actual de Palermo> P1
```

- `PALERMO_01` → termina en `P1`, `PALERMO_02` → `P2`, y así.
- No cambiar nada más de la frase: la comunidad se decide por ella.
- Un anuncio tiene que tener **un solo** código y **una sola** zona (la zona se define en el conjunto de anuncios).
- Editar el texto de un anuncio activo puede reiniciar su etapa de aprendizaje; conviene hacerlo de a un anuncio o aprovechar un anuncio nuevo.
- Si hay más de una plantilla por anuncio (por ejemplo Instagram y WhatsApp), todas llevan el mismo código.

## Cómo verificarlo

1. Abrí el anuncio en WhatsApp con tu teléfono y mandá el mensaje tal cual viene (con el código).
2. En Data_Cruda, el contacto nuevo tiene `anuncio_codigo = P1` (o consultá abajo).
3. Probá también sin el código y con un código inventado (`P9`): tiene que entrar igual y quedar sin anuncio.

Consulta de conteos (SQL Editor de Supabase):

```sql
select * from crm_comunidades_v2.entradas_por_anuncio(
  (select id from crm_comunidades_v2.cliente where slug = 'cortado-en-jarrito'),
  date '2026-11-16', current_date);
```

## Cómo se lee el resultado

- **entradas**: personas distintas que entraron a un flow de comunidad con ese código.
- **sin_clasificar**: personas que escribieron con ese código y todavía no eligieron comunidad.
- Una persona sin código no se asigna a ningún anuncio: sigue contando en la zona, no en el anuncio.
- El piloto mide **quién se animó a escribir** desde cada anuncio. Para comparar con la inversión, el dato de gasto y chats por anuncio de Meta se cruza después (ver "Falta").

## Límites

- **La persona puede borrar o editar el código** antes de mandar el mensaje. Se mide en el piloto qué porcentaje de las entradas de Palermo llega con código; si es bajo, se evalúa otra forma (por ejemplo, que el código vaya al principio).
- **Quien abre el chat y no manda nada** sigue sin aparecer: no es un problema de tracking sino de la campaña.
- **El código no sirve para las entradas históricas** (anteriores al piloto).

## Falta (próximas PRs, no incluido acá)

- Vista por anuncio en el panel.
- Datos por anuncio de Windsor (`ad_id`, `ad_name`: gasto, clics, conversaciones) y su cruce con estas entradas.
- Extender a Devoto y Boedo.

## Criterio de éxito del piloto

Al cabo de una semana con las 4 plantillas activas:

- Qué % de las entradas de Palermo trae código reconocido.
- Cuántas entradas y cuántos "sin clasificar" aparecen por anuncio, y cuánto gastó cada uno.
- Si algún anuncio concentra los chats pero no las entradas (señal de calidad del anuncio, no de tracking).
