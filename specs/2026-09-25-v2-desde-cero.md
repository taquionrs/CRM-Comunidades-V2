# Spec fundacional — CRM de Comunidades V2

Estado: **construido, sin deploy verificado end-to-end con credenciales reales de Windsor.ai/ManyChat**. Este documento registra por qué existe este repo y las decisiones de arquitectura tomadas para construirlo.

## Origen

Jaz mandó un documento propio, "DOCUMENTO COMPLETO DE ESPECIFICACIONES TÉCNICAS Y DISEÑO" (2026-09-24), con una arquitectura de CRM distinta a la de [`crm-comunidades`](https://github.com/MarketingTaquion/CRM-Comunidades) (V1): 5 tabs (Overview, Control_Comunidades, Base_Limpia, Data_Deduplicada, Data_Cruda), atribución "First-Contact" por teléfono como llave global entre comunidades, 3 niveles de persistencia (Crudo → Deduplicado → Curado), integración con Windsor.ai (Meta Ads) y ManyChat (webhook + módulo de nominación), y un endpoint JSON consolidado.

Ese documento se auditó contra V1 en [`specs/2026-09-24-auditoria-doc-jaz-vs-implementado.md`](https://github.com/MarketingTaquion/CRM-Comunidades/blob/master/specs/2026-09-24-auditoria-doc-jaz-vs-implementado.md) y se detectaron 4 conflictos de arquitectura entre lo que V1 ya resolvió y lo que pide el documento (aislamiento entre comunidades vs. atribución global, gobernanza de identidad, niveles de persistencia, plataforma de deploy). En vez de forzar esos dos modelos a convivir en un mismo repo, se decidió construir **este repo nuevo, V2, que implementa el documento de Jaz literalmente — sin nada adicional a lo que pide**.

## Decisiones de arquitectura (2026-09-25)

1. **Repo nuevo**, separado de V1 — cero riesgo de mezclar los dos modelos de datos.
2. **App hosteada normal** (HTML/JS estático sin build + Supabase + Vercel, mismo patrón que V1) — no un Claude Artifact real. Un Artifact es una página del lado del cliente: no puede recibir un webhook de ManyChat en vivo ni sondear Windsor.ai por su cuenta, así que el "backend processing engine" que pide el documento necesita sí o sí un backend real corriendo en algún lado. El endpoint JSON de la Sección 4.C se construye igual (queda consumible desde un Artifact si se arma uno más adelante), pero el propio panel V2 lo consume directamente.
3. **Windsor.ai y ManyChat (webhook + nominación) se escriben completos, con gate explícito** — sin la credencial real (`WINDSOR_API_KEY`, `MANYCHAT_WEBHOOK_SECRET`, `MANYCHAT_API_KEY`), cada función responde 501 con un mensaje claro en vez de fallar en silencio o insertar datos fabricados. Mismo patrón que `activacion-manychat` en V1.
4. **Mismo proyecto Supabase que V1**, no uno nuevo — decisión explícita del usuario para no multiplicar infraestructura. El aislamiento se logra con un schema Postgres propio, `crm_comunidades_v2`, hermano de `crm_comunidades` (V1) y de `public` (`pulso-ignite`). Cero tablas/vistas/RLS/GRANTs compartidos con V1 — lo único realmente compartido es la instancia de Postgres y `auth.users` (Supabase Auth es global al proyecto).

## Qué NO tiene este proyecto, a propósito

Nada de lo que sigue está en el documento de Jaz, así que no está acá: roles (`admin_taquion`/`am_estratega`/`cliente`), `estado_identificacion`, arquetipos, activaciones, tratos, temporada/informe de decisión, gobernanza de visibilidad progresiva de identidad, modo oscuro/claro, panel responsive para mobile. Un solo tipo de usuario autenticado, con acceso completo.

## Decisiones de diseño no especificadas literalmente por el documento (y por qué)

El documento describe el *qué* pero no siempre el *cómo* a nivel de esquema — estas son las decisiones tomadas para llenar esos huecos, siempre en la dirección de "lo mínimo que hace falta para cumplir la letra del documento":

- **`evento_deduplicado` es una vista, no una tabla**: siempre se recalcula sobre `evento_crudo`, así la atribución nunca puede desincronizarse del log crudo que le da origen.
- **`usuario_curado` no guarda la atribución de comunidad**: esa información vive únicamente en `evento_deduplicado`. `usuario_curado` guarda solo lo que esa vista no puede saber — nombre/email reales y etiquetado manual. La vista `base_limpia` junta las dos mitades. Ver el comentario en `db/001_init.sql` para el detalle.
- **`miembros_iniciales` y `miembros_finales` son campos manuales en `comunidad`**: el documento no describe una fuente automática para ninguno de los dos (son conteos del stock real del grupo de WhatsApp) — `clics_unicos` y `bajas_estimadas` sí se calculan siempre, nunca se cargan.
- **CTR de anuncio / "Trigger entregados" / "Envíos de enlace efectivos"**: el documento los pide en la matriz de Control_Comunidades, pero ni el payload del webhook de ManyChat (`phone`, `community_id`, `timestamp`) ni la integración de Windsor.ai descripta traen esos datos. El panel muestra "— sin fuente" en esas celdas en vez de fabricar un número — se documenta como gap abierto, no como bug.
- **`tasa_fuga` en el JSON de `panel-data` se expresa como fracción** (0.26), replicando literalmente el ejemplo de la Sección 4.C del documento, aunque la fórmula narrativa de la Sección 3.B la describe multiplicada por 100 — las vistas SQL internas sí la dejan en porcentaje (más usable en las tablas del panel), y la Edge Function la convierte a fracción solo al armar ese JSON puntual.

## Próximos pasos (no bloqueantes para este PR)

- Cargar `WINDSOR_API_KEY`, `MANYCHAT_WEBHOOK_SECRET` y `MANYCHAT_API_KEY` como secrets de Supabase, y configurar el flow de ManyChat para llamar a `manychat-webhook` con el header `x-webhook-secret`.
- Confirmar contra la documentación vigente de ManyChat el endpoint exacto que usa `nominacion-sync` (`GET /wa/subscriber/getInfo`) — no se pudo verificar contra la API real en este entorno.
- Decidir si se programa `windsor-sync` con un cron (Supabase Scheduled Functions / pg_cron) o se deja 100% manual (botón en el panel).
