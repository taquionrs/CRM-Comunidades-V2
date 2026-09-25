# CRM de Comunidades V2

Implementación literal del documento de Jaz ("DOCUMENTO COMPLETO DE ESPECIFICACIONES TÉCNICAS Y DISEÑO", 2026-09-24) — un CRM de atribución y tracking de comunidades, con 5 tabs: **Overview**, **Control_Comunidades**, **Base_Limpia**, **Data_Deduplicada** y **Data_Cruda**.

Hermano de [`crm-comunidades`](https://github.com/MarketingTaquion/CRM-Comunidades) (V1), pero con un modelo de datos distinto a propósito — ver [`specs/2026-09-25-v2-desde-cero.md`](specs/2026-09-25-v2-desde-cero.md) para el porqué de cada decisión y los 4 conflictos de arquitectura frente a V1.

## Qué es (y qué no es)

- **Atribución "First-Contact"**: el teléfono es la llave primaria global — si un usuario pasa por varias comunidades, el 100% del origen publicitario se le asigna a la primera.
- **3 niveles de persistencia**: Crudo (`evento_crudo`, todo insert, incluye duplicados) → Deduplicado (vista `evento_deduplicado`, primer evento por teléfono) → Curado (`usuario_curado` + `base_limpia`, enriquecido con nombre/email real de ManyChat).
- **Sin roles ni gobernanza de identidad progresiva** — eso es de V1, no de este documento. Un solo tipo de usuario autenticado.

## Estado actual

- **Frontend**: `index.html` — HTML/CSS/JS estático, sin build, sin framework (mismo enfoque que V1). Conectado a Supabase real.
- **Base de datos**: schema `crm_comunidades_v2`, en el **mismo proyecto Supabase que V1** (`crm-comunidades`, org `Marketing-Taquion-IGNITE`) — aislado por schema, no por proyecto. Ver [`docs/reference/esquema-de-base-de-datos.md`](docs/reference/esquema-de-base-de-datos.md).
- **Integraciones externas — código escrito, sin credenciales reales todavía**:
  - `manychat-webhook`: recibe eventos en vivo de ManyChat → `evento_crudo`. Necesita `MANYCHAT_WEBHOOK_SECRET`.
  - `windsor-sync`: trae spend/impresiones/conversaciones de Meta Ads vía Windsor.ai → `meta_ads_metrica`. Necesita `WINDSOR_API_KEY`.
  - `nominacion-sync`: cruza teléfonos contra el reporte de suscriptores de ManyChat para completar nombre/email → `usuario_curado`. Necesita `MANYCHAT_API_KEY`.
  - `panel-data`: endpoint JSON de solo lectura con el contrato exacto de la Sección 4.C del documento de Jaz — no necesita ninguna de las credenciales de arriba, ya funciona (devuelve todo en cero/vacío hasta que las otras tres se configuren).

Sin esas 3 credenciales, el panel funciona igual — muestra el estado vacío real, nunca datos fabricados.

## Qué falta (backlog)

1. Deployar las 4 Edge Functions (`supabase functions deploy <nombre>`) — ver [`docs/how-to/desplegar.md`](docs/how-to/desplegar.md).
2. Cargar `WINDSOR_API_KEY`, `MANYCHAT_WEBHOOK_SECRET`, `MANYCHAT_API_KEY` como secrets de Supabase.
3. Configurar el flow de ManyChat para llamar a `manychat-webhook` (ver [`docs/how-to/configurar-webhook-manychat.md`](docs/how-to/configurar-webhook-manychat.md)).
4. Confirmar contra la documentación vigente de ManyChat el endpoint que usa `nominacion-sync` — no se pudo verificar contra la API real en este entorno (ver spec fundacional).
5. Decidir si `windsor-sync` corre en un cron o queda 100% manual.
6. Cargar al menos una `comunidad` real (con `adset_name`, `miembros_iniciales`, `miembros_finales`) desde la tab Overview del panel.

## Documentación

Organizada con [Diátaxis](https://diataxis.fr/) en [`docs/`](docs/index.md).

## Local

```bash
npm run build   # genera config.js desde SUPABASE_URL / SUPABASE_ANON_KEY
```

Después, abrir `index.html` con un server estático cualquiera (o directo desde el filesystem, funciona igual al no tener build real de framework).
