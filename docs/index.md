# Documentación — CRM de Comunidades V2

Organizada según [Diátaxis](https://diataxis.fr/): agrupa por lo que necesitás en el momento en que lo buscás, no por tema.

| Si necesitás... | Mirá en... |
|---|---|
| Levantar el proyecto por primera vez | [`tutorials/`](tutorials/) |
| Resolver una tarea concreta (deployar, configurar Windsor.ai/ManyChat) | [`how-to/`](how-to/) |
| El dato exacto — una columna, el contrato JSON, una variable de entorno | [`reference/`](reference/) |
| Entender **por qué** algo está hecho así | [`explanation/`](explanation/) |

## Tutoriales

- [Primer arranque en local](tutorials/primer-arranque-local.md)

## Guías prácticas

- [Desplegar](how-to/desplegar.md)
- [Configurar el login con SSO (Cloudflare) y los usuarios](how-to/configurar-sso-cloudflare.md)
- [Agregar un cliente](how-to/agregar-un-cliente.md)
- [Configurar Windsor.ai](how-to/configurar-windsor-ai.md)
- [Configurar el webhook y la nominación de ManyChat](how-to/configurar-webhook-manychat.md)
- [SOP-001: alta de un cliente en el CRM (PDF)](sop/SOP-001-alta-de-cliente.pdf), con la prueba final en Data_Cruda

## Referencia

- [Esquema de base de datos](reference/esquema-de-base-de-datos.md)
- [Contrato JSON de panel-data](reference/contrato-json-panel-data.md)
- [Variables de entorno](reference/variables-de-entorno.md)

## Explicación

- [Arquitectura](explanation/arquitectura.md)
- [Modelo First-Contact Attribution](explanation/modelo-first-contact.md)
- [Flujo de información: de la campaña al panel](explanation/flujo-de-informacion.md)

---

La spec fundacional (por qué existe este repo, decisiones de arquitectura) vive en [`specs/2026-09-25-v2-desde-cero.md`](../specs/2026-09-25-v2-desde-cero.md). El documento original de Jaz que originó este proyecto no vive en este repo.
