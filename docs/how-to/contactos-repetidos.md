# Contactos repetidos

En **Data_Cruda**, arriba del registro de eventos, el bloque **Contactos repetidos** cuenta las personas que tienen más de un registro en el CRM: por pruebas, porque entraron a una comunidad, salieron y volvieron a ingresar, o tocaron más de una vez.

## Qué cuenta
- Un **registro** es un evento aceptado. Los rechazados no cuentan.
- Se cuenta toda la historia del cliente, no solo los últimos 200 eventos que muestra la tabla de abajo.
- Cada contacto se cuenta una sola vez. **Registros de más** = eventos − 1 por cada contacto repetido.
- **Misma comunidad:** todos sus registros son de una comunidad (reingresos, pruebas, doble toque). **Más de una comunidad:** intentó unirse a varias.
- Las fechas se toman en hora de Buenos Aires.

## Cómo se usa
- **Comunidad, Desde y Hasta** acotan el conteo. Con una comunidad elegida solo se cuentan los eventos de esa comunidad (así se ven los reingresos a esa comunidad).
- Los botones **Todos / En una misma comunidad / En más de una comunidad** filtran la lista.
- **Exportar CSV** baja la lista que estás viendo, completa (la pantalla muestra los 100 con más registros).

## Lo que no hace
El CRM no puede saber **por qué** una persona está repetida: prueba, reingreso o doble toque. El bloque muestra los datos (cuántas veces, entre qué fechas, en qué comunidades) para que el equipo lo decida. Las métricas siguen atribuyendo cada persona a su **primer contacto** (Data_Deduplicada).

Solo lo ve el rol Marketing, porque muestra teléfonos y nombres.
