# Cómo: agregar un cliente

Un cliente es una cuenta de ManyChat con sus propias comunidades. Aparece en el selector de cliente del panel. Requiere haber aplicado [`db/004_cliente.sql`](../../db/004_cliente.sql).

1. Elegir un secreto largo para el webhook de ese cliente (por ejemplo, `openssl rand -hex 32`) y guardarlo donde guardan las credenciales. No se guarda en la base.
2. En el SQL Editor de Supabase, dar de alta el cliente con el **hash** del secreto:

   ```sql
   insert into crm_comunidades_v2.cliente (nombre, slug, manychat_account_id, webhook_secret_hash)
   values (
     'Todo un País',
     'todo-un-pais',
     'fb5616672',
     encode(sha256('EL-SECRETO-ELEGIDO'::bytea), 'hex')
   );
   ```

   `slug` va en minúsculas, números y guiones. `manychat_account_id` es el ID que aparece en la URL de la cuenta de ManyChat.
3. Recargar el panel: el cliente aparece en el selector.
4. Cargar las comunidades del cliente desde la tab Overview (con el cliente elegido en el selector).
5. Configurar el flow de ManyChat de esa cuenta: ver [configurar el webhook de ManyChat](configurar-webhook-manychat.md).

Para rotar el secreto, actualizar `webhook_secret_hash` con el hash del nuevo y cambiar el header en ManyChat.
