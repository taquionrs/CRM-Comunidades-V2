# Rutina: contar los miembros de WhatsApp y cargarlos en el CRM (15 minutos, lunes y jueves)

**Para qué sirve:** el CRM calcula la retención (CRR), el churn, el costo por miembro nuevo y la tasa de triaje a partir de **fotos exactas de quién está en cada grupo**. Si la foto es vieja, esas métricas quedan viejas. Esta rutina saca la foto y la sube.

**Cuándo:** los lunes (temprano, antes de que el reporte semanal se arme a las 8:00) y los jueves. Como mínimo, una vez por semana. El CRM te lo va a pedir cuando pasen más de 8 días.

**Qué necesitás:**
- Tu computadora con **Chrome** y la extensión de Claude conectada.
- **WhatsApp Web** con la sesión abierta (si pide el código QR: en el teléfono, WhatsApp → Dispositivos vinculados → Vincular un dispositivo).
- La **clave de carga** del CRM.
- Rol **Marketing** en el CRM.

---

## Paso 1 — Anotar cuántos participantes tiene cada grupo (2 minutos)
Es el control que te dice si la lectura salió completa.
1. En WhatsApp Web, abrí la comunidad **Cortado en Jarrito**.
2. Entrá a cada grupo (**General, BOEDO, DEVOTO, PALERMO**; "Avisos" no cuenta), tocá el nombre arriba para abrir **Info del grupo** y anotá el número de **participantes**.

## Paso 2 — Pedir el conteo (5 minutos)
1. Abrí Claude Code con Chrome conectado y escribí: **"Hacé el conteo de miembros de la comunidad de WhatsApp"**.
2. Claude lee los 4 grupos desde WhatsApp Web (solo lectura: no envía ni modifica nada), compara con la planilla de conteo, agrega al final las personas nuevas y te muestra una **tabla por grupo**: existentes, nuevos, total y posibles salidas.
3. Al terminar deja el archivo **`exportes/conteo-miembros-AAAA-MM-DD.csv`** con todos los miembros actuales (columnas `Comunidad, Fecha, Teléfono`).

## Paso 3 — Revisar la tabla antes de cargar (2 minutos)
Compará con lo que anotaste en el paso 1:
- **El total de cada grupo** (números + contactos agendados + "Tú") tiene que dar los **participantes** que anotaste. Si no da, **no cargues**: pedile a Claude que lea de nuevo ese grupo.
- **Las posibles salidas:** unas pocas son normales. Si en un grupo hay más del 10 % de sus miembros (por ejemplo 5 o más en un grupo de 49), **no cargues todavía**. Puede ser una salida falsa: el conteo solo cuenta a quienes aparecen como **número**; si agendaste a alguien en tu teléfono entre un conteo y otro, aparece con su nombre y parece que se fue. Revisá esos números a mano.

## Paso 4 — Cargar en el CRM (5 minutos)
1. En el CRM, entrá a **Overview** y, en la tarjeta **Comunidades**, tocá **Cargar miembros**.
2. **Cliente:** Cortado en Jarrito. **Comunidad:** **Todas las comunidades** (el archivo ya trae la columna Comunidad).
3. Escribí la **clave de carga** y tu nombre.
4. Elegí **"Lista completa del grupo"**. *(Si subís solo los nuevos, las salidas no se detectan y el CRR no se puede calcular.)*
5. **No** marques "usar como miembros iniciales (Mi)": eso fue solo la primera carga, el 14/10.
6. Subí el archivo y tocá **Vista previa**. Para cada comunidad mirá:
   - **Ya estaban:** tiene que ser parecido a los miembros de la carga anterior, menos las salidas.
   - **Nuevos:** las personas que entraron desde la última vez.
   - **Salidas:** las que ya no están. **Si es más del 10 % del grupo, no guardes** sin entender por qué.
7. **Duplicados:** elegí **ignorarlos** (se mantienen las fechas originales).
8. Tildá la confirmación de salidas y tocá **Confirmar y guardar**.

## Paso 5 — Comprobar que quedó bien (1 minuto)
1. Entrá a **Control_Comunidades** y mirá, en la tabla **"Métricas por comunidad"**, las columnas **Período entre cargas**, **Retención (CRR)** y **Churn** (si las tenés ocultas, activalas desde el botón **Columnas**).
2. Cada comunidad que cargaste tiene que aparecer con su período nuevo (desde la carga anterior hasta hoy). Con "Todo el histórico" o un "Hasta" de hoy ves el último.
3. No tiene que aparecer la marca **"no cuadra"** (se ve en la columna Período o en las cargas; la avisa también "Para completar"). Si aparece, hay un problema con esa carga: avisá antes de usar el número.

---

## Qué hacer ahora con Palermo, Devoto y la general
Estas tres llevan más de 20 días sin carga, así que su CRR está viejo. **Hacé un conteo nuevo hoy** con esta rutina.

**No cargues el archivo del 13/11.** Se comparó con lo que tiene el CRM y las listas no coinciden: por ejemplo, Devoto tendría 12 salidas de 49 miembros y Boedo figura con 62 en el CRM contra 48 en el conteo de ese día. Cargarlo sin verificar bajaría el CRR por salidas que pueden ser falsas. Ver el detalle en el plan (sección 6, "Hallazgo del 17/11").

**Boedo:** la carga del 13/11 (62 miembros) no coincide con el conteo del mismo día (48). Con el conteo de hoy vas a poder ver cuál de los dos números era el correcto: comparalo con los participantes de "Info del grupo".

## Si algo falla
| Qué pasa | Qué hacer |
|---|---|
| WhatsApp Web pide el código QR | Escanealo desde el teléfono (Dispositivos vinculados). Claude frena hasta que entres |
| Un grupo no termina de cargar | Esperar 10 segundos y pedir que lo lea de nuevo. Nunca cargar una lista incompleta |
| El total del grupo no da los participantes | Pedir que lo lea de nuevo; si sigue sin dar, avisar |
| La vista previa muestra muchas salidas | No guardar. Revisar si son contactos agendados |
| Aparece "no cuadra" en el bloque CRR | No usar ese CRR; avisar para revisar la carga |
| Pasaron más de 8 días y nadie cargó | El CRM lo va a pedir (centro de acciones, fase 3 del plan) |

**Reglas que no cambian:** WhatsApp solo en lectura; la planilla de conteo solo se agrega al final; la clave de carga la escribís solo vos en el CRM (nunca se la pasás a Claude).
