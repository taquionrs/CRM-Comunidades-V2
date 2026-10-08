-- ============================================================================
-- Carga de datos (PR #10): cuenta publicitaria, comunidades "generales" y mapeo campaña / conjunto de anuncios → comunidad.
-- Requiere db/010. Idempotente: se puede volver a correr sin duplicar nada. Fuente del mapeo: exportación de Windsor del
-- 2026-10-08 (cuenta "TQN - Growing 2 - LC", conector facebook) y confirmación del equipo (SAN_LUIS = San Luis Capital).
--
-- Comunidad "general" de cada cliente: recibe la inversión de las campañas que NO distinguen barrio (adset NULL = toda la
-- campaña). Para Todo un País se crea igual pero queda sin campaña asignada hasta conocer el nombre de esa campaña.
-- ============================================================================
begin;

update crm_comunidades_v2.cliente set meta_cuenta_id = '1669338306456901' where slug in ('cortado-en-jarrito', 'todo-un-pais');

insert into crm_comunidades_v2.comunidad (cliente_id, nombre)
select c.id, v.nombre
from crm_comunidades_v2.cliente c
join (values ('cortado-en-jarrito', 'Cortado en Jarrito (general)'), ('todo-un-pais', 'Todo un País (general)')) v(slug, nombre) on v.slug = c.slug
where not exists (select 1 from crm_comunidades_v2.comunidad x where x.cliente_id = c.id and x.nombre = v.nombre);

with m(slug, comunidad, campana, adset) as (values
  ('cortado-en-jarrito', 'Boedo',        'TQN_AON_META_CON_LEADS_MANUAL_CORTADO_EN_JARRITO_WHATSAPP', 'TQN_AON_META_CON_INTE_MANUAL_CORTADO_EN_JARRITO_WHATSAPP_BOEDO'),
  ('cortado-en-jarrito', 'Palermo',      'TQN_AON_META_CON_LEADS_MANUAL_CORTADO_EN_JARRITO_WHATSAPP', 'TQN_AON_META_CON_INTE_MANUAL_CORTADO_EN_JARRITO_WHATSAPP_PALERMO'),
  ('cortado-en-jarrito', 'Villa Devoto', 'TQN_AON_META_CON_LEADS_MANUAL_CORTADO_EN_JARRITO_WHATSAPP', 'TQN_AON_META_CON_INTE_MANUAL_CORTADO_EN_JARRITO_WHATSAPP_DEVOTO'),
  ('cortado-en-jarrito', 'Cortado en Jarrito (general)', 'TQN_AON_META_CON_INTE_MANUAL_CORTADO_EN_JARRITO', null::text),
  ('todo-un-pais', 'La Toma',          'TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS', 'TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS_LA_TOMA'),
  ('todo-un-pais', 'Quines',           'TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS', 'TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS_QUINES'),
  ('todo-un-pais', 'San Luis Capital', 'TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS', 'TQN_META_CON_LEADS_MANUAL_COMUNIDADES_TODO_UN_PAÍS_SAN_LUIS')
)
insert into crm_comunidades_v2.comunidad_meta_origen (cliente_id, comunidad_id, campana_nombre, adset_nombre)
select c.id, co.id, m.campana, m.adset
from m
join crm_comunidades_v2.cliente c on c.slug = m.slug
join crm_comunidades_v2.comunidad co on co.cliente_id = c.id and co.nombre = m.comunidad
where not exists (
  select 1 from crm_comunidades_v2.comunidad_meta_origen o
  where o.cliente_id = c.id
    and crm_comunidades_v2.normalizar_nombre(o.campana_nombre) = crm_comunidades_v2.normalizar_nombre(m.campana)
    and coalesce(crm_comunidades_v2.normalizar_nombre(o.adset_nombre), '') = coalesce(crm_comunidades_v2.normalizar_nombre(m.adset), '')
);

select c.slug, co.nombre as comunidad, count(*) as reglas
from crm_comunidades_v2.comunidad_meta_origen o
join crm_comunidades_v2.cliente c on c.id = o.cliente_id
join crm_comunidades_v2.comunidad co on co.id = o.comunidad_id
group by 1, 2 order by 1, 2;
commit;
