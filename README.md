# CRM de Comunidades V2

Implementación del documento de Jaz ("DOCUMENTO COMPLETO DE ESPECIFICACIONES TÉCNICAS Y DISEÑO", 2026-09-24) — un CRM de atribución y tracking de comunidades, con 5 tabs: **Overview**, **Control_Comunidades**, **Base_Limpia**, **Data_Deduplicada** y **Data_Cruda**.

Hermano de [`crm-comunidades`](https://github.com/MarketingTaquion/CRM-Comunidades) (V1), pero con un modelo de datos distinto a propósito — ver [`specs/2026-09-25-v2-desde-cero.md`](specs/2026-09-25-v2-desde-cero.md) para el porqué de cada decisión y los 4 conflictos de arquitectura frente a V1. El estado vigente y el backlog están en la sección 3 terdecies de [`specs/2026-09-29-estado-hacia-spec-final.md`](specs/2026-09-29-estado-hacia-spec-final.md).

## Qué es (y qué no es)

- **Multi-cliente**: un solo CRM con selector de cliente. Cada cliente es una cuenta de ManyChat con sus propias comunidades; los datos se separan por cliente.
- **Atribución "First-Contact"**: la persona se identifica por su **teléfono** (WhatsApp) o por su **ID de Instagram** (`ig:<id>`). Si pasa por varias comunidades **del mismo cliente**, el 100% del origen publicitario se le asigna a la primera. La misma persona en WhatsApp e Instagram cuenta como dos.
- **3 niveles de persistencia**: Crudo (`evento_crudo`, todo insert, incluye duplicados) → Deduplicado (vista `evento_deduplicado`, primer evento por cliente y persona) → Curado (`usuario_curado` + `base_limpia`, enriquecido con el nombre de ManyChat).
- **Sin roles ni gobernanza de identidad progresiva** — eso es de V1, no de este documento. Un solo tipo de usuario autenticado, con acceso a los clientes que tenga asignados.

## Estado actual (2026-10-05)

- **Producción**: el panel está en `crm-comunidades-v2.vercel.app` (Vercel, se despliega solo al fusionar en `master`).
- **Clientes**: **Cortado en Jarrito**, probado de punta a punta por WhatsApp e Instagram, y **Todo un País**, configurado pero sin tráfico (su WhatsApp no está activo).
- **Frontend**: `public/index.html` — HTML/CSS/JS estático, sin build ni framework. Selector de cliente, filtro por fechas en Control_Comunidades, Data_Cruda como registro de eventos con filtro Aceptados / Rechazados y exportación a CSV de toda la historia del cliente, etiqueta de canal (WhatsApp / Instagram) y todo el HTML dinámico escapado.
- **Login**: **todavía no tiene**; se agrega al final del proyecto. Hasta entonces el panel lee con la lectura abierta de `db/003`: quien tenga la URL ve teléfonos y nombres. No compartirla fuera del equipo.
- **Base de datos**: schema `crm_comunidades_v2`, en el **mismo proyecto Supabase que V1**. Migraciones `001` a `004` y `006` a `015` aplicadas; `005` (acceso por usuario, con el login) **escrita y sin aplicar**. Ver [`docs/reference/esquema-de-base-de-datos.md`](docs/reference/esquema-de-base-de-datos.md).
- **Edge Functions**:
  - `manychat-webhook` — deployada. Recibe el contacto completo de ManyChat (WhatsApp o Instagram), valida el secreto del cliente, guarda el evento y registra los rechazos.
  - `windsor-sync` — deployada, **sin `WINDSOR_API_KEY` cargada**: todavía no trae gasto, clics ni conversaciones de Meta Ads.
  - `nominacion-sync` — deployada, opcional. Necesita `MANYCHAT_API_KEY`.
  - `panel-data` — endpoint JSON de solo lectura con el contrato de la Sección 4.C del documento de Jaz. **No deployada**: espera al login.

## Qué falta (backlog resumido)

El detalle y las prioridades están en el [spec](specs/2026-09-29-estado-hacia-spec-final.md), sección 3 terdecies.

1. **Antes de abrir los flows al público**: rotar los secretos del webhook. (Las condiciones de los flows usan la frase completa del formulario de anuncios a propósito: no se cambian.)
2. **Puesta en marcha de clientes**: activar Todo un País, dar de alta Growing Ideas, recargar el monedero de WhatsApp de Cortado.
3. **Datos de Meta Ads**: ya se importan por comunidad desde la computadora del equipo (`scripts/windsor-importar.mjs`, ver [cómo configurar Windsor](docs/how-to/configurar-windsor-ai.md)); falta automatizarlo cuando Tecnología cierre la seguridad.
4. **Miembros iniciales y finales** (carga manual) y mejoras de sus cuadros en el panel.
5. **Decisiones con Jaz**: estadios posteriores a `clic_en_grupo`, fechas para MI / MF, eventos intermedios del bot, nominación por API o por POST.
6. **Al final**: login, aplicar `005` y autenticar `panel-data`.

## Cómo trabajamos

- **Un cambio, una PR numerada**: se trabaja y se prueba en una rama, y recién después se fusiona en `master`.
- **Dar de alta un cliente**: seguir el [SOP-001](docs/sop/SOP-001-alta-de-cliente.pdf) (fuente editable en [HTML](docs/sop/SOP-001-alta-de-cliente.html)). La prueba final se verifica en la pestaña Data_Cruda.

## Documentación

Organizada con [Diátaxis](https://diataxis.fr/) en [`docs/`](docs/index.md).

## Local

```bash
npm run build   # genera public/config.js desde SUPABASE_URL / SUPABASE_ANON_KEY
```

Después, servir la carpeta `public/` con un servidor estático cualquiera (o abrir `public/index.html` directo desde el filesystem).
