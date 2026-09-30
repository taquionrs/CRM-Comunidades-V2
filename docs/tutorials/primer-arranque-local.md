# Tutorial: primer arranque en local

1. Clonar el repo.
2. Pedir las credenciales del proyecto Supabase compartido (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) — es el mismo proyecto que usa `crm-comunidades` V1.
3. Generar `public/config.js`:
   ```bash
   SUPABASE_URL=https://tu-proyecto.supabase.co SUPABASE_ANON_KEY=tu-anon-key npm run build
   ```
4. Servir la carpeta `public/` con cualquier servidor estático, o abrir `public/index.html` en el navegador (no hay build de framework real, es HTML/JS estático).
5. Por ahora el panel **no tiene login** (se agrega al final del proyecto): entra directo. Arriba a la izquierda está el selector de cliente.
6. Si el selector dice "Sin clientes": falta dar de alta al menos un cliente. Ver [agregar un cliente](../how-to/agregar-un-cliente.md).
7. Si las 5 tabs cargan pero todo está vacío: es el comportamiento esperado hasta que se cargue al menos una `comunidad` del cliente y se configuren las integraciones externas (ver [`docs/how-to/`](../how-to/)).
