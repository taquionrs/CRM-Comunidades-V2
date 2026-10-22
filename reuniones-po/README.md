# Reuniones con la PO

Notas ordenadas de la reunión semanal 1 a 1 entre Juan Marroncle (marketing) y Jazleidis Lesmes (PO) sobre el CRM de Comunidades: avances, prioridades y features nuevas. Es el contexto de producto que entra al proyecto cada semana.

## Cómo se usa

1. Después de cada reunión, Juan pasa las notas de Gemini (el `.md` completo).
2. El original se copia a `originales/AAAA-MM-DD-notas-gemini-completas.md` y se ordena en **un archivo por reunión**, `AAAA-MM-DD-tema.md`, con las secciones de la plantilla de abajo.
3. Se agrega una fila a la tabla de este índice.
4. Lo que se decide y lo que queda para hacer se cruza con lo que ya está en el CRM (PRs, bitácora de `specs/`), para no duplicar trabajo ni perder pedidos.

**Se guarda todo.** El archivo original de Gemini (resumen, decisiones y transcripción completa) se copia tal cual en [`originales/`](originales/), y la nota ordenada se arma leyendo también la transcripción, no solo el resumen: ahí aparecen detalles que Gemini no resume y que sirven para el roadmap semanal y quincenal. Los originales contienen los correos de los participantes y el enlace del evento del calendario (el repositorio es privado). Las notas de Gemini pueden traer errores de transcripción (por ejemplo "Winsor" por Windsor o "Cloud" por Claude): en la nota ordenada se corrigen y se marca lo que no está claro; el original no se modifica.

## Reuniones

| Fecha | Tema | Nota ordenada | Original completo |
|---|---|---|---|
| 2026-10-22 | CRM iteración: campañas, leyendas de métricas, filtros, SSO, contraste con el chat | [2026-10-22-crm-iteracion.md](2026-10-22-crm-iteracion.md) | [originales/2026-10-22-notas-gemini-completas.md](originales/2026-10-22-notas-gemini-completas.md) |

## Plantilla de una nota

```markdown
# Reunión AAAA-MM-DD — tema

Participantes · Fuente (enlace al original completo en originales/)

## Resumen            (3 a 5 líneas)
## Decisiones         (lo acordado, una línea cada una)
## Próximos pasos     (tabla: tarea · responsable · estado en el CRM)
## Lo que se mostró / avances
## Hallazgos y dudas abiertas   (datos que no coinciden, preguntas sin responder)
## Para la próxima reunión
```
