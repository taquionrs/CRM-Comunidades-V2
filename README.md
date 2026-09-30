# CRM de Comunidades V2

Implementación del documento de Jaz ("DOCUMENTO COMPLETO DE ESPECIFICACIONES TÉCNICAS Y DISEÑO", 2026-09-24) — un CRM de atribución y tracking de comunidades, con 5 tabs: **Overview**, **Control_Comunidades**, **Base_Limpia**, **Data_Deduplicada** y **Data_Cruda**.

Hermano de [`crm-comunidades`](https://github.com/MarketingTaquion/CRM-Comunidades) (V1), pero con un modelo de datos distinto a propósito — ver [`specs/2026-09-25-v2-desde-cero.md`](specs/2026-09-25-v2-desde-cero.md) para el porqué de cada decisión y los 4 conflictos de arquitectura frente a V1. El estado actual y lo que falta para el spec final está en [`specs/2026-09-29-estado-hacia-spec-final.md`](specs/2026-09-29-estado-hacia-spec-final.md).

## Qué es (y qué no es)

- **Multi-cliente**: un solo CRM con selector de cliente. Cada cliente es una cuenta de ManyChat con sus propias comunidades; los datos se separan por cliente.
- **Atribución "First-Contact"**: el teléfono identifica a la persona; si pasa por varias comunidades **del mismo cliente**, el 100% del origen publicitario se le asigna a la primera.
- **3 niveles de persistencia**: Crudo (`evento_crudo`, todo insert, incluye duplicados) → Deduplicado (vista `evento_deduplicado`, primer evento por cliente y teléfono) → Curado (`usuario_curado` + `base_limpia`, enriquecido con el nombre de ManyChat).
- **Sin roles ni gobernanza de identidad progresiva** — eso es de V1, no de este documento. Un solo tipo de usuario autenticado, con acceso a los clientes que tenga asignados.

## Estado actual

- **Frontend**: `public/index.html` — HTML/CSS/JS estático, sin build ni framework. Selector de cliente, filtro por fechas en Control_Comunidades y todo el HTML dinámico escapado.
- **Login**: **todavía no tiene**; se agrega al final del proyecto. Hasta entonces el panel lee con la lectura abierta de `db/003` (datos personales legibles con la anon key): no cargar datos reales de miembros antes del login.
- **Base de datos**: schema `crm_comunidades_v2`, en el **mismo proyecto Supabase que V1**. Migraciones `001`–`004` y `006` aplicadas (la `004`, de clientes, y la `006`, de fechas, clics y teléfono, el 2026-09-30); `005` (acceso por usuario, con el login) **escrita y sin aplicar**. Ver [`docs/reference/esquema-de-base-de-datos.md`](docs/reference/esquema-de-base-de-datos.md).
- **Integraciones externas — código escrito, sin credenciales ni deploy verificado**:
  - `manychat-webhook`: recibe el contacto completo de ManyChat, normaliza el teléfono, copia el nombre y guarda el evento. Un secreto por cliente.
  - `windsor-sync`: trae gasto, impresiones, clics y conversaciones de Meta Ads vía Windsor.ai, por cliente.
  - `nominacion-sync`: opcional; completa nombre/email desde la API de ManyChat, por cliente. Necesita `MANYCHAT_API_KEY`.
  - `panel-data`: endpoint JSON de solo lectura con el contrato de la Sección 4.C del documento de Jaz, por cliente. **Sin autenticar todavía.**

## Qué falta (backlog)

1. Dar de alta los clientes ([agregar un cliente](docs/how-to/agregar-un-cliente.md)).
2. Deployar las 4 Edge Functions y el frontend ([desplegar](docs/how-to/desplegar.md)).
3. Armar en ManyChat el POST hacia `manychat-webhook` ([configurar el webhook](docs/how-to/configurar-webhook-manychat.md)), empezando por una comunidad de prueba en Todo un País.
4. Cargar `WINDSOR_API_KEY` y confirmar el nombre del campo de conversaciones ([configurar Windsor.ai](docs/how-to/configurar-windsor-ai.md)).
5. Definir los estadios de la persona posteriores a `clic_en_grupo`, y si la nominación va por API o alcanza con el nombre del POST.
6. **Al final:** login, aplicar `005` y autenticar `panel-data`.

## Documentación

Organizada con [Diátaxis](https://diataxis.fr/) en [`docs/`](docs/index.md).

## Local

```bash
npm run build   # genera public/config.js desde SUPABASE_URL / SUPABASE_ANON_KEY
```

Después, servir la carpeta `public/` con un servidor estático cualquiera (o abrir `public/index.html` directo desde el filesystem).
