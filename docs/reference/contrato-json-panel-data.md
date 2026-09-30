# Referencia: contrato JSON de `panel-data`

Réplica literal de la Sección 4.C del documento de Jaz ("Conexión a Claude Artifacts — JSON Schema"). `GET`/`POST` a la Edge Function `panel-data` (sin auth propia, uso interno del panel).

```json
{
  "timestamp_update": "2026-09-25T12:00:00Z",
  "kpis_macro": {
    "inversion_total": 300.00,
    "conversaciones_totales": 400,
    "cpl_global": 0.75,
    "clics_unicos_totales": 300,
    "miembros_efectivos_totales": 400,
    "cpme_global": 0.75,
    "tasa_fuga_global": 0.26
  },
  "comunidades_performance": [
    {
      "id_comunidad": "uuid-de-la-comunidad",
      "nombre": "San Luis",
      "inversion": 100.00,
      "conversaciones_meta": 150,
      "cpl": 0.66,
      "clics_unicos": 120,
      "miembros_iniciales": 100,
      "miembros_finales": 210,
      "cpmn": 0.90,
      "tasa_fuga": 0.266
    }
  ],
  "base_limpia_usuarios": [
    {
      "phone_id": "5491156171851",
      "nombre": "Juan Rivas",
      "email": "juan@email.com",
      "comunidad_atribuida": "San Luis",
      "fecha_primer_contacto": "2026-08-14T11:06:03Z",
      "estado": "clic_en_grupo"
    }
  ]
}
```

## Parámetro obligatorio: cliente

El CRM es multi-cliente y cada respuesta es de un solo cliente. Se indica con `?cliente=<slug o uuid>` (GET) o `{"cliente": "<slug o uuid>"}` en el body (POST). Sin él responde `400`; si no existe, `404`. La respuesta trae un objeto extra `cliente: { id, nombre, slug }` al nivel raíz.

## Notas de implementación

- `nombre` se agregó a cada objeto de `comunidades_performance` (no está en el ejemplo original del documento, pero `id_comunidad` es un uuid interno — sin el nombre, el JSON no es usable para render directo).
- `tasa_fuga`/`tasa_fuga_global` son **fracciones** (0.26), no porcentajes (26) — así los da el ejemplo de la Sección 4.C, aunque la fórmula narrativa del documento la describe multiplicada por 100. Las vistas SQL internas (`comunidad_performance`, `kpis_macro`) sí devuelven porcentaje — la conversión a fracción ocurre en la Edge Function, solo para este JSON.
- Sin datos cargados, todos los campos numéricos vuelven `0` o `null` (nunca se fabrican) y los arrays vuelven vacíos.
