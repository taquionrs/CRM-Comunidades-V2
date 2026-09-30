// Genera config.js a partir de variables de entorno en tiempo de build.
// Mismo patrón que crm-comunidades V1 (scripts/generate-config.js) —
// la URL/clave de Supabase nunca quedan commiteadas en el repo.
const fs = require('fs');
const path = require('path');

const url = process.env.SUPABASE_URL || '';
const anonKey = process.env.SUPABASE_ANON_KEY || '';

if (!url || !anonKey) {
  console.warn(
    '[generate-config] SUPABASE_URL y/o SUPABASE_ANON_KEY no están seteadas. ' +
    'El sitio se va a deployar igual, pero va a mostrar el aviso de "no configurado" ' +
    'hasta que se agreguen esas variables de entorno y se vuelva a deployar.'
  );
}

const out = `// Generado automáticamente en build time por scripts/generate-config.js — no editar a mano.
window.CRM_COMUNIDADES_V2_CONFIG = {
  SUPABASE_URL: ${JSON.stringify(url)},
  SUPABASE_ANON_KEY: ${JSON.stringify(anonKey)},
};
`;

const outPath = path.join(__dirname, '..', 'public', 'config.js');
fs.writeFileSync(outPath, out);
console.log('[generate-config] public/config.js generado (' + (url ? 'con' : 'SIN') + ' credenciales).');
