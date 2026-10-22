oct 22, 2026

## **CRM iteración**

Invitado [Jazleidis Lesmes](mailto:jazleidis.lesmes@taquion.com.ar) [Juan Marroncle](mailto:juan.marroncle@taquion.com.ar)

Archivos adjuntos [CRM iteración](https://calendar.google.com/calendar/event?eid=N3FianJpaTdvMDJ2bjFscGRzcGxqbWZtdmFfMjAyNjEwMjFUMTczMDAwWiBqdWFuLm1hcnJvbmNsZUB0YXF1aW9uLmNvbS5hcg)

Registros de la reunión [Transcripción](https://docs.google.com/document/d/1TEJr3AuuoWnskEKuk4FvY0VKqYLmVe_ZI7RIBKPK130/edit?usp=drive_web&tab=t.sfrhdallg775) 

### **Resumen**

Revisión de flujos N8N y métricas mediante análisis técnico y optimización.

**Flujo y control operativo**  
Implementación del flujo N8N para el registro exitoso de contactos y control de comunidades en campañas.

**Estandarización de métricas técnicas**  
Incorporación de subtítulos explicativos para definir siglas técnicas de marketing en el panel general.

**Optimización del conector Windsor**  
Optimización del conector Windsor para consultas en tiempo real y evaluación del protocolo MCP.

### **Decisiones**

## **Acordada**

* **Incorporación de selección de campañas en meta** Se acordó añadir la asignación y selección de campañas de conversión a WhatsApp en la sección de campañas de meta.  
* **Explicación de siglas de métricas de marketing** Se acordó incluir subtítulos y un icono de signo de interrogación en el overview para explicar las siglas de las métricas de marketing.  
* **Inclusión de filtros de fecha y comunidad** Se acordó agregar filtros de fecha y comunidad en las pestañas de datos duplicados, datos crudos, overview y base limpia.

### **Próximos pasos**

- [ ] \[Juan Marroncle\] Agregar Instagram: Añadir la campaña de Instagram a la sección de campañas para integrar sus métricas y presupuestos en el reporte.  
- [ ] \[Juan Marroncle\] Configurar campañas: Revisar la configuración de la sección campañas de Meta para habilitar la selección de la cuenta específica a la que pertenece cada campaña.  
- [ ] \[Juan Marroncle\] Definir métricas: Incluir leyendas explicativas en las métricas del dashboard para definir términos técnicos como CPMI, CPL y otras siglas de marketing.  
- [ ] \[Juan Marroncle\] Explicar fuga: Agregar un elemento informativo interactivo que explique el método de cálculo utilizado para la tasa de fuga.  
- [ ] \[Juan Marroncle\] Completar SSO: Ejecutar las tareas pendientes para la implementación de Single Sign-On una vez finalizado el soporte técnico de Fel.  
- [ ] \[Juan Marroncle\] Agregar filtros: Configurar los filtros de fecha y comunidad en las pestañas de datos duplicados, datos crudos, overview y base limpia.

### **Detalles**

**Flujo N8N y registro de contactos**: Juan Marroncle señala que el flujo N8N destinado al registro de contactos provenientes de campañas de Instagram y WhatsApp ya se encuentra funcional y activo, registrando correctamente todos los números ([00:00:00](#00:00:00)). Como paso siguiente, se debe verificar mediante una habilidad automatizada que dichos contactos coincidan con el grupo correspondiente ([00:19:51](#00:19:51)).

---

**Control de comunidades y gestión de campañas**: Juan Marroncle expone los avances en la sección de control de comunidades con el desglose por campaña ([00:20:23](#00:20:23)). Se implementó la funcionalidad para incluir o excluir campañas (como la de Instagram), asignándolas como destino sin asignar para evitar sumar presupuestos o métricas erróneas hasta integrarlas en una sección global ([00:21:25](#00:21:25)). Asimismo, se identificó la necesidad de revisar la selección de cuentas en campañas de meta y ajustar los filtros en el panel general ([00:22:48](#00:22:48)).

---

**Aclaración y estandarización de métricas de marketing**: Juan Marroncle plantea la necesidad de incorporar subtítulos explicativos o símbolos de interrogación en cada métrica del panel general para definir siglas técnicas propias del marketing, tales como CPMI (costo por mensaje iniciado), CPME o CPL, facilitando su interpretación para usuarios sin experiencia en métricas ([00:23:53](#00:23:53)). También se aborda la inclusión de guías sobre el cálculo de la tasa de fuga a partir de la segunda carga de la lista completa ([00:25:01](#00:25:01)).

---

**Avances en seguridad y autenticación**: En el ámbito de seguridad, Juan Marroncle informa que el inicio de sesión único (\*SSO\*) presenta importantes avances gracias a la colaboración de Fel. Faltan por completar algunos pasos operativos con asistencia externa para finalizar las tareas pendientes y actualizar los registros en el mapa de ruta ([00:25:27](#00:25:27)).

---

**Conector de Windsor y evaluación del protocolo MCP**: Juan Marroncle explica que el conector de Windsor fue optimizado para realizar consultas en tiempo real y solucionar problemas previos con las fechas ([00:26:28](#00:26:28)) ([00:28:10](#00:28:10)). Respecto al uso del protocolo de contexto de modelos (\*MCP\*) de Meta, se concluye que aunque opera con Cloud, no aporta una utilidad práctica relevante para la operación diaria del CRM ([00:27:07](#00:27:07)).

---

**Pruebas de interfaz y contraste de datos de chat**: Juan Marroncle realiza pruebas de selección de fechas en el CRM utilizando datos en tiempo real de la API de Windsor, constatando mejoras en el funcionamiento ([00:27:43](#00:27:43)). Al contrastar las métricas del CRM con los registros de chat de la comunidad de Palermo posterior al 19 de octubre, se detectan discrepancias en los volúmenes, registros duplicados y diferencias entre variables como última vez visto, opt-in y entradas al flujo, aspectos que deberán armonizarse en futuros bloques de trabajo ([00:28:41](#00:28:41)).

---

**Filtros en datos crudos, duplicados y base limpia**: Juan Marroncle revisa la integración de datos financieros, manuales y de WhatsApp, determinando que es indispensable agregar filtros de fecha y comunidad en las pestañas de datos crudos, datos duplicados y base limpia para un correcto control de duplicaciones y montos ([00:36:15](#00:36:15)). Por último, se confirma que la sección de atribución se mantiene como una maqueta en construcción ([00:37:56](#00:37:56)).

*Revisa las notas de Gemini para asegurarte de que sean precisas. [Obtén sugerencias y descubre cómo Gemini toma notas](https://support.google.com/meet/answer/14754931)*

*Cómo es la calidad de **estas notas específicas?** [Responde una breve encuesta](https://google.qualtrics.com/jfe/form/SV_5bXzKQfylMIhSXc?confid=1QQ22AuQguHiV6au1h0dDxIVOBEQAjIGCIoCIAAYBQg&detailLevel=standard&hasImages=False&entryPoint=footerMain&isGoogler=False&lang=es-US) para darnos tu opinión; por ejemplo, cuán útiles te resultaron las notas.*

oct 22, 2026

## **CRM iteración \- Transcripción**

### **00:00:00** {#00:00:00}

**Juan Marroncle:** Ah. Me muteo de todo. Listo. Listo. Ya. Perfecto. Bueno, de Voy a mostrar desde acá primero. Así vemos el avance. Tareas CRM. Ya voy. Eh, tareas CRM. Este, esta es la tarea. Bien. Bueno, últimas implementaciones. Últimas implementaciones.

### **00:18:22**

**Juan Marroncle:** Teníamos este flujo N8N que hace registro de los contactos que tiene el número de WhatsApp, ¿okay? Ya sea de de que sea una campaña de Instagram, que sea una campaña de WhatsApp. Mientras tenga número se registra y está funcional. Actualmente está activa y se registra todo acá. Este que cambia. Ah, me cambia mucho.

### **00:18:51**

**Juan Marroncle:** Sí, trabajo con mi monitor porque no. Ah, yo no tengo, nunca tuve, pero está está bueno. Sí, los martes puedes venir a trabajar acá arriba. Sí, es verdad. Acá. No, no, no es acá. Bueno, la lo tengo. en esta No, este no. Este automation en el acá ves.

### **00:19:51** {#00:19:51}

**Juan Marroncle:** Mira cómo se registran todos. Okay. Pura magia. Después hay que eh con una skill hay que verificar que estén todos estos más los que ya estaban antes y que coincidían todos con eh el grupo. Pero bueno, eso ya está. Después otros cambios que hice fue, bueno, esta acá registré la automatización del CRM que ya lo puse como listo.

### **00:20:23** {#00:20:23}

**Juan Marroncle:** Yo te añado siempre en todo. Sí, lo vi. Perfecto. Y ahí fui dejando también un poco el estatus cómo iba haciendo y todo. Te lo cierro. Bien, después de esto, eh, bueno, acá hay primeras pruebas. ¿Cómo iba funcionando? Acá errad map. Acá yo adjunté las últimas notas que tuvimos y en lo que me puse a trabajar fue a partir de esto me puse a trabajar en eh la sección eh control eh comunidades ¿La?

### **00:20:59**

**Juan Marroncle:** está acá. Claro, la primera. Sí, sí. Primero era la primera y acá había que ponerle el filtro de el filtro de periodo y demás, pero a mí me pareció que podía arrancar más importante, ¿no? Esto era más importante de hacer este desglose por la por campaña. Acá tengo la campaña seleccionada que es la correspondiente.

### **00:21:25** {#00:21:25}

**Juan Marroncle:** Falta la Instagram. Bueno, la la hay que añadirla porque también es una campaña de conversión y eh los levanto el CRM. Sí. Bien. Y acá tengo algo más que es campañas que acá tengo todo el desglos de todas las campañas. Esta es una sección nueva y acá es cuando yo puedo incluir o o excluir, como por ejemplo la que me decís vos, la de Instagram, la busco desde acá.

### **00:21:56**

**Juan Marroncle:** ¿Ves que dice destino sin asignar? No suma, no suma, se refiere a que no suma los presupuestos y ni las métricas. ¿Okay? Entonces ahí vos me decís, "Bueno, Instagram, busco Instagram." A ver, ¿ves? Acá la tengo. Entonces, esta hago así y la añado a e ves que dice cuenta cortajerrito.

### **00:22:20**

**Juan Marroncle:** Bueno, acá tiene que estar una global, una sección de global. Entonces, ahí ya la puedo ver. dice recalcular ahora para la IA eh lo de la global, ¿sí? O sea, para que la te tome ahora de las notas de esta reunión, cuando vas a campañas de meta, te permita sumar y seleccionar la campaña. O fíjate cómo seleccionaste la otra.

### **00:22:48** {#00:22:48}

**Juan Marroncle:** Sí, sí, eso lo puedo ver. Cerrar. Tengo solo la campaña que suman la tabla de arriba a todas por medio. Claro, pero entra a campañas arriba. Campañas. Ajá. Fíjate la que va, la que tienes. Mira, acá está mixto ver conjuntos. Okay, hay que chequear ahí cómo se puede seleccionar o que te permita seleccionar la cuenta a la cual pertenece esa campaña.

### **00:23:28**

**Juan Marroncle:** Bien, bien. Añadimos eso en la sección campañas de meta, que es donde se asignan o no las campañas. Las campañas de conversión a WhatsApp. Sí, exacto. Bieno. Y con ese cambio, que es como lo un poco lo más grande, quedaría nada lo del filtro en overview. Verificar también que la data esté correcta.

### **00:23:53** {#00:23:53}

**Juan Marroncle:** Igual acá ya cambió bastante. Sí, lo veo. Pero CPMI, ¿qué significa? El coste por el mensaje iniciado. Okay. Hay que dejarle ahí este esa leyenda chiquita porque entendiendo que hay otros usuarios que van a ser usuarios del CRM que no saben nada de métricas. Bien, dejamos entonces en cada métrica del overview un un subtítulo que especifique de que se trata la sigla CPMI o CPME o CPL o lo que métricas que son propias del marketing que nadie más entiende que no seamos

### **00:24:34**

**Juan Marroncle:** nosotros. Sí, el simbolito de eh signo de pregunta y que ahí no no lo puedes tomar acá abajo que la gente es floja. CPM costo por eh mensaje iniciado. Listo. Está bien. Sobre todo por eso, porque acá empieza el CPM, que esto es el mix de lo manual con lo automático. Exacto.

### **00:25:01** {#00:25:01}

**Juan Marroncle:** Lo mismo. Ahí está la tasa de fuga, ¿ves? Se calcula desde la segunda carga de la lista completa. Y ahí podríamos, sí, con el signito de pregunta mostrar cómo se calcula. Bien. como para con las métricas que te había pasado. Ahí tienes información. Está bien. Sí, te cuento más.

### **00:25:27** {#00:25:27}

**Juan Marroncle:** Desde desde lo que sería seguridad, el SSO ya está avanzado. Fel implementó varias cosas. Okay. Eh, yo tenía eh también él me pasa una serie de pasos que tengo que hacer. Ya hice algunos, me faltan otros y con eso cubierto, porque también necesito una mano de él para mañana porque ya no está conectado.

### **00:25:50**

**Juan Marroncle:** Sí, no. Eh, cuando él termine con lo que yo necesito, ahí ya termino de llenar el ro que tenemos en la tarea. Listo. Sí, que sería esto. Y bueno, yo dejé una última captura de esto último que estuve haciendo. Estuviste haciendo bien. Vuelve. Sí. Porque acá estaban las métricas que vamos hablado, las que seleccionamos y vea control de comunidades.

### **00:26:28** {#00:26:28}

**Juan Marroncle:** Okay. Estuve trabajando en el conector de Winsor también porque antes te traía la consulta una vez al día y había un tema acá con la fecha que lo pudiste ver. Sí, sí se puede conectar. Conectémoslo directo porque a veces hace eso, hay un zancudo por ahí dando vueltas. Hace las señales actualizadas y con el MCP de meta ya se puede hacer.

### **00:27:07** {#00:27:07}

**Juan Marroncle:** y que es es una es una buena opción, o sea, no es conectar Winsor. Es que igual en MCP funciona solo con Cloud, o sea, por eso sí, pero preguntándole a Cloud, "Che, dame las métricas puntuales acá." Madre, tienes razón. No, no, en realidad no le da una funcionalidad útil en el CRM. Tienes razón, tienes razón.

### **00:27:24**

**Juan Marroncle:** Por eso a mí me parecía que que bueno, si se quería incluir, se puede incluir, pero la realidad es que funciona el CRM, no le da. Sí, le da como una especie de herramienta cloud para que puedas ver la data desde cloud, pero la realidad es que en el día a día no nos sirve. Esto está actualizado.

### **00:27:43** {#00:27:43}

**Juan Marroncle:** Sí, está actualizado. Se selecciona las fechas. ¿Te acuerdas que habíamos visto que cuando se seleccionaba la fecha no funcionaba? Eso mejoró. Eso mejoró. A ver, del uno a hoy. Del un a hoy 21, ¿te parece? En vez 22\. No pas no camb. Ah, porque la campaña se activó hace poco.

### **00:28:10** {#00:28:10}

**Juan Marroncle:** Cambiemos del uno, ¿no? Sino de ayer a hoy. De ayer, del lunes a el 21\. El 19\. El 19\. Listo. Ahí cambió, ¿no? Hay cambio. Hay cambio. Bien. Y encima esto esto es todo data data que entra desde la API Winsor en tiempo real que eso es una mejora.

### **00:28:41** {#00:28:41}

**Juan Marroncle:** Hay que chequear para ves que algunas méas tienen ya el Sí, sí el desglose de cómo se arma cada médica. Está bien, pero navega. Contrástalo con el chat un momento, porfa. Don contactos. Chao. Palermo. Palermo 108 y filtra. A ver. La fecha, última interacción es acá después del primero.

### **00:29:51**

**Juan Marroncle:** Después ponele después del 19, que es la métrica que estamos midiendo en el otro lado. Después del 19 de octubre. Yeah. Listo. Ajá. Dos personas no está levantando el dato en el chat. Instagram. ¿Seleccionaste Instagram? No, pero dice última interacción, por eso lo tomáis así. Vuelve a ver.

### **00:30:25**

**Juan Marroncle:** Claro. Si Instagram baja porque te sale WhatsApp. Acá WhatsApp. Última. Última interacción después del 19\. Son dos también. Esos mismos dos. Hay algo que no está bien. Hay algo que no está bien porque no fueron solo dos. Ver. A ver, han entrado de lunes a hoy.

### **00:31:19**

**Juan Marroncle:** 1 2 3 4 5 6 7 8 10 11 12 13 14 15 16 18 19 20 21 Hay duplicados igual. Mira, ¿viste por qué te decía lo de los duplicados? Sí. Cuando yo te decía algo de los duplicados en el CRM, porque hay muchos que entran varias veces, pero son mucho más que dos. Sí, pero capaz que es Y si es última vez visto.

### **00:31:59**

**Juan Marroncle:** Claro, eso última vez visto. O puede ser este el optim recibido también. A ver, última vez visto. Probemos después del 19\. Hay más. ¿Y cuántos son? 14\. está coincide. Ahí 14\. Entonces sí coincide hace tr semanas. Esto soy yo. El de hace tr semanas. Entonces son 13\. Coincide.

### **00:32:37**

**Juan Marroncle:** Pero cambiamos de filtro. El opt. El optim. Eh, este no, eso sí está. ¿Dónde está? Optadero. Sí. Yeah. Pero te va a salir todo. Baja. 20 son. Claro, pero baja porque 19 fue hace cuántos días acá. Entra para ver la fecha.

### **00:33:16**

**Juan Marroncle:** Qué hace 3 días. Ahí tienes fecha más larga. Sí, es por última vez visto igual campos del sistema y puedes seleccionar eh las etiquetas, ¿no? Acá. A ver, suscriptor, a ver. Pero están todos. Esto te da todos. 13\. Ti queo. Listo. Son 13\. Son 13\. A ver.

### **00:34:02**

**Juan Marroncle:** 1 2 3 4 5 6 7 8 9 10\. 11 12 igual es muy poquito de intención. A la gente no le gusta que abren, yo creo. Ay, la Ay, no. Ay, no. Ay, no. Uy, no me desespero. Bueno, y veamos el CRM que está correcta. Quiero ver el CRM.

### **00:34:59**

**Juan Marroncle:** Miembros iniciales 11\. No, eso eso, ¿eh? Vo Palermo 32\. Vuelve acá, acá, acá. No, no, acá ent flow 10 está mal tiene que ser 12 13 las que te levantan mi chat 13 entras a flow para a ver si no hay un 13 entrados 10 hay que empezar a chequear y a contrastar la información porque acá te dice que son 10 clientes y conversaciones ocho y ya no estamos midiendo por conversaciones de meta,

### **00:35:43**

**Juan Marroncle:** sino por Sí, igual ten en cuenta, yo no toqué esto todavía. No, pero como para que lo vayamos teniendo en cuenta bien cuando empieces a trabajar en bloque porque esta reunión va a volver a ocurrir el otro jueves. Sí, sí. Igual ahora con el SS2 cubierto ya voy a poder avanzar con todo esto. Bueno, esas cosas que el flujo coincida con Ya sabemos que es por suscrito o por última vez visto, porque ahí están las entradas al flow.

### **00:36:15** {#00:36:15}

**Juan Marroncle:** Bien. Y acá ya empieza lo manual que es WhatsApp y salud y bueno, lo financiero que sí es una mezcla se carga manual. Sí, es una mezcla entre Winson también y claro y lo manual, lo gente que existe todavía en la comunidad. Sí. Bueno, bien. Por ahora esto. A ver, eh, data crudas se puede filtrar por comunidad, ¿eh?

### **00:36:53**

**Juan Marroncle:** No, acá está todo en data cruda. El filtro de comunidad. Bueno, en data de sumos el filtro. Sí, porque necesitamos empezar a ver que de todo esto nos está saliendo plata duplicada, que acá el data de duplicada, que era lo que yo te decía que era importante de duplicarlo, también debería estar la etiqueta de fecha y de comunidad.

### **00:37:27**

**Juan Marroncle:** Bien, el filtro de fecha y de comunidad en la pestaña de data duplicada. En pestaña data duplicada, en pestaña data cruda y en pestaña overview. Sí. Y base limpia de Y base limpia, eh, base limpia también hay que sumarlo. Base limpia la tiene. Okay. Vamos a Palermo. Base limpia hay que ponerle el filtro de e fecha.

### **00:37:56** {#00:37:56}

**Juan Marroncle:** Okay. Igual acá, bueno, está pendiente ver que cuando les eh dale click a Palermo. Bueno, cuando le das clic a Palermo que efectivamente lo filtre. Son cosas que van a ir saliendo a medida que vayamos trabajando en el CRM, pero se va entendiendo. Sí, obvio. Atribución. Atribución no tiene nada. Es una maqueta. Era lo que habíamos hablado, que ya las tenemos haciendo de todas estas cosas. Listo. Modero en construcción. Listo. Okay. Algo más. No, puedo decir en bas. Listo. Trabajar acá. Yeah.

### **La transcripción finalizó después de 00:39:02**

*Esta transcripción editable se generó por computadora y puede contener errores. Los usuarios también pueden cambiar el texto después de que se cree.*