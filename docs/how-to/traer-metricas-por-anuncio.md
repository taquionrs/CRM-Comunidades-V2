# Cómo: traer las métricas de Meta por anuncio (PR #71)

**Para qué:** tener, por día y por anuncio, el gasto, las impresiones, los clics, los clics en el enlace y las conversaciones iniciadas de Meta. Es la base del bloque "Rendimiento" que va dentro de Control_Comunidades (etapa 3 de `specs/2026-11-13-centro-de-rendimiento-por-anuncio.md`).

**Qué no cambia:** `meta_ads_metrica` (lo que ya ve Control_Comunidades) ni la tarea de Windsor. Esto es un detalle aparte y se consulta a pedido.

## Qué hace falta
- La clave `WINDSOR_API_KEY` cargada como secreto de Supabase. Ya está (la usa "Traer de Meta ahora"). No hay que tocar nada en la cuenta de Windsor.
- Aplicar `db/040_metricas_por_anuncio.sql` y desplegar la función:

```bash
supabase functions deploy meta-anuncios --use-api --no-verify-jwt
```

## Cómo se consulta
La función recibe un rango (hasta 31 días, sin fechas futuras) y reemplaza esos días en `meta_ads_anuncio_metrica`:

```
POST /functions/v1/meta-anuncios     { "desde": "2026-11-02", "hasta": "2026-11-13" }
```

La llama una sesión con rol Marketing (el botón del bloque Rendimiento, en la etapa 3) o la clave de servicio (uso interno). Entre una consulta y la siguiente hay que esperar 45 segundos.

La respuesta informa: filas que devolvió Windsor, registros guardados, filas sin comunidad (con su gasto), filas sin `ad_id` y si Windsor no devolvió los clics en el enlace.

## Cómo comprobar que quedó bien
Comparar, por comunidad, la suma de los anuncios contra lo que ya mostraba Control_Comunidades (SQL Editor de Supabase):

```sql
select * from crm_comunidades_v2.meta_anuncios_cuadre(
  (select id from crm_comunidades_v2.cliente where slug = 'cortado-en-jarrito'),
  date '2026-11-02', date '2026-11-13');
```

- **Gasto, conversaciones y clics en el enlace** de cada comunidad tienen que dar lo mismo en las dos columnas (salvo centavos de redondeo).
- Si el gasto de anuncios es menor: hay un anuncio sin `ad_id` o un conjunto sin comunidad (la respuesta de la función lo informa).
- Si las conversaciones no coinciden: Meta puede asignar distinto a nivel anuncio. Se anota la diferencia y se decide qué número manda.

Ver los anuncios cargados:

```sql
select fecha, ad_nombre, adset_nombre, inversion, clics_enlace, conversaciones_meta
  from crm_comunidades_v2.meta_ads_anuncio_metrica
 where cliente_id = (select id from crm_comunidades_v2.cliente where slug = 'cortado-en-jarrito')
 order by fecha desc, inversion desc;
```

## Si algo sale mal
| Qué ves | Qué significa | Qué hacer |
|---|---|---|
| Error 501 | Falta `WINDSOR_API_KEY` | Cargarla como secreto de Supabase |
| Error 502 | Windsor no respondió o rechazó los campos | Reintentar; si insiste, mandar el mensaje (no incluye la clave) |
| Error 429 "Esperá un momento" | Hubo otra consulta hace menos de 45 segundos | Esperar y repetir |
| `clics_enlace_omitidos: true` | Windsor no reconoció el campo de clics en el enlace | El resto se guardó; los clics quedan vacíos (no en 0) |
| `filas_sin_anuncio` mayor que 0 | Windsor devolvió filas sin `ad_id` | No se guardan; avisar para revisar el conector |
| `filas_sin_comunidad` mayor que 0 | Un conjunto nuevo sin comunidad | Agregarlo a `comunidad_meta_origen` y volver a traer |

## Volver atrás
La tabla es solo de lectura para el panel y no la usa nada todavía. Para dejarla vacía: `delete from crm_comunidades_v2.meta_ads_anuncio_metrica;`. No afecta a `meta_ads_metrica`.
