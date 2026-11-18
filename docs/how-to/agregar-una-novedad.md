# Agregar una novedad a la campanita del CRM

La campanita del encabezado (arriba a la derecha, como en Pulso) muestra lo que cambió en el CRM y las comunicaciones para el equipo. La lista vive en `public/index.html`, en el bloque `NOVEDADES` (entre `/* NOVEDADES:INICIO */` y `/* NOVEDADES:FIN */`). No hay base de datos: **cada PR que cambia algo que el equipo ve, o cada comunicación que haya que dar, agrega una entrada**.

## Cómo
Agregá un objeto **arriba de todo** en `NOVEDADES`:

```js
{ id: '2026-11-20-nombre-corto', fecha: '2026-11-20', tipo: 'nuevo', area: 'control', marketing: true, ruta: 'control',
  titulo: 'Qué cambió, en pocas palabras',
  detalle: 'Una o dos frases para quien usa el CRM: qué ve ahora y para qué le sirve.' },
```

| Campo | Qué poner |
|---|---|
| `id` | Único y estable: empieza con la fecha (`AAAA-MM-DD-...`). No se cambia ni se reutiliza: la campanita recuerda en el navegador cuál fue la última que se vio. |
| `fecha` | `AAAA-MM-DD`. |
| `tipo` | `nuevo`, `mejora`, `cambio`, `arreglo` o `aviso`. **`aviso` es para comunicaciones**: fechas (conteos, cierres), pedidos, recordatorios, cambios de reglas. |
| `area` | `general`, `overview`, `control`, `atribucion`, `datos` o `reportes`. |
| `ruta` | Opcional: la pestaña donde se ve el cambio (`overview`, `control`, `atribucion`...). Agrega el botón «Ir a…». |
| `marketing` | Opcional: `true` si habla de plata o de una función solo de Marketing. El rol General no la ve. |

## Cómo escribirla
- **Lenguaje simple**, para quien usa el CRM, no para quien lo programa: «Ahora ves…», «Antes… ahora…».
- Una novedad por cambio que el equipo note. Los arreglos internos que nadie ve no hacen falta.
- **Sin datos de clientes, teléfonos ni claves.** Una prueba automática lo controla.
- Las comillas dobles dentro del texto se evitan: usá «así».

## Cómo funciona lo de «sin ver»
El puntito con el número cuenta las novedades **más nuevas que la última que esa persona vio**. Al abrir la campanita se marcan como vistas y el puntito se apaga; dentro del panel, las que eran nuevas se resaltan con «Sin ver» hasta que se cierra.

⚠️ Lo visto se recuerda **en cada navegador** (no por usuario). En otro navegador o en una ventana privada vuelve a aparecer todo como nuevo. Como el CRM ya tiene login con SSO, más adelante se podría guardar por persona.

## Qué se verifica (`tests/panel-novedades.test.mjs`)
Ids únicos y con la fecha adelante, tipos y áreas válidos, lista de la más nueva a la más vieja (si no, el contador da mal), rutas que existen como pestañas, sin claves ni teléfonos, y que el rol General no vea las de Marketing.
