# Tutorial: primer arranque en local

1. Clonar el repo.
2. Pedir las credenciales del proyecto Supabase compartido (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) — es el mismo proyecto que usa `crm-comunidades` V1.
3. Generar `config.js`:
   ```bash
   SUPABASE_URL=https://tu-proyecto.supabase.co SUPABASE_ANON_KEY=tu-anon-key npm run build
   ```
4. Abrir `index.html` en el navegador (doble clic alcanza — no hay build de framework real, es HTML/JS estático).
5. Loguearse con el mismo usuario admin de V1 (`marketing@taquion.com.ar`) — Supabase Auth es compartido a nivel de proyecto, no hace falta invitación nueva.
6. Si las 5 tabs cargan pero todo está vacío: es el comportamiento esperado hasta que se cargue al menos una `comunidad` desde Overview y se configuren las integraciones externas (ver [`docs/how-to/`](../how-to/)).
