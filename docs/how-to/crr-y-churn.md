# Cómo: leer y mantener el CRR y el churn (PR #74)

## Qué es
- **CRR** (tasa de retención de miembros) = (miembros al final − miembros nuevos) ÷ miembros al inicio × 100.
- **Churn** = 100 − CRR: de cada 100 miembros que había al inicio, cuántos ya no están.

Aparecen en **Control_Comunidades**, en el bloque **"Retención de miembros (CRR) y churn"**, debajo del semáforo de cobertura. Los ven todos los roles (son solo conteos).

## De dónde salen los números
De las **cargas de lista completa** del grupo (Overview → Cargar miembros → "lista completa"). Cada una es una foto exacta de quién está en el grupo ese día. El CRR se mide **entre dos cargas seguidas** de la misma comunidad:

| Dato | De dónde sale |
|---|---|
| Miembros al inicio | Miembros de la carga anterior |
| Miembros al final | Miembros de la carga que cierra el período |
| Nuevos | Personas que aparecen por primera vez o vuelven en esa carga |
| Bajas | Personas del grupo anterior que ya no están |

No se estima nada. Una comunidad que no tiene dos cargas de lista completa **no tiene CRR**, y el bloque lo dice.

La columna **"no cuadra"** aparece si *inicio + nuevos − bajas* no da *final*: significa que alguna carga tiene un problema (por ejemplo, no era realmente la lista completa) y conviene revisarla.

## Qué períodos muestra
Los intervalos cuya carga de cierre cae dentro de las fechas elegidas arriba. Sin fechas, muestra todo el historial.

## Cada cuánto cargar
El CRR es tan fino como las cargas: con una carga de lista completa por semana, hay un CRR por semana. Si una comunidad no se carga en una semana, esa semana no tiene CRR.

## Diferencia con la "fuga" de Overview
La **fuga** usa bajas ÷ (bajas + miembros finales). El **CRR** usa solo a los miembros del inicio como base. Son medidas distintas y los números no coinciden: usá el CRR para reportar retención.

## Ejemplo real (Cortado en Jarrito, 14/10 al 26/10)
| Comunidad | Inicio | Nuevos | Bajas | Final | CRR | Churn |
|---|---|---|---|---|---|---|
| Boedo | 11 | 40 | 0 | 51 | 100,0 % | 0,0 % |
| Palermo | 32 | 10 | 1 | 41 | 96,9 % | 3,1 % |
| Villa Devoto | 26 | 25 | 2 | 49 | 92,3 % | 7,7 % |

## Un aviso sobre el Excel de "Nominizados"
La columna **"Tasa de retención"** de ese Excel es *miembros reales ÷ entradas al flow*. Eso no es retención: divide un total acumulado (los miembros del grupo) por un flujo del período (las entradas), y por eso da 3,9, 15 o 28. Conviene reemplazarla por el CRR de este bloque.
