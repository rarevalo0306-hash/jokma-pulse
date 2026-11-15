# Persistencia durable de Jokma Pulse

## Estado

Desde el 14 de noviembre de 2026, Jokma Pulse trabaja únicamente con Supabase local. El proyecto administrado de Supabase Cloud fue eliminado por decisión del propietario después de confirmar que estaba vacío y que producción no lo utilizaba. No se deben ejecutar migraciones ni configurar variables contra un proyecto remoto mientras esta decisión siga vigente.

Las nueve migraciones de `supabase/migrations/` están aplicadas al Postgres local:

- `20261114143058_pulse_multitenant_core.sql`
- `20261114162947_harden_private_credentials_and_fk_indexes.sql`
- `20261114191723_add_profile_login_aliases.sql`
- `20261114235258_grant_service_role_server_access.sql`
- `20261115010749_harden_company_credentials_uniqueness.sql`
- `20261115011924_add_conversation_notes_and_audit_events.sql`
- `20261115012103_index_conversation_notes_foreign_keys.sql`
- `20261115022451_add_organizations_and_company_ownership.sql`
- `20261115033626_add_profile_name_parts.sql`

La base local contiene empresas de demostración y los espacios creados por usuarios reales. Supabase Auth, los perfiles y las membresías son la fuente actual de acceso; no se deben fijar cantidades en esta guía porque cambian con cada alta. El servidor iniciado con `npm run start:local` autentica, lee y escribe mediante Supabase local. El JSON permanece como reversión del modo `PULSE_STORE=json`, pero ya no participa en el login cuando el backend activo es Supabase.

La verificación local confirmó RLS en las ocho tablas públicas y en `private.integration_credentials`, 14 políticas y cero permisos de cliente sobre el esquema privado. `private.integration_credentials` no tiene políticas para clientes deliberadamente; solo el rol de servicio tiene permisos. Las credenciales se cifran con AES-256-GCM antes de entrar en Postgres; nunca se copian a `companies.settings` ni vuelven al navegador. El esquema superó lint, asesores de seguridad y rendimiento, una prueba de aislamiento entre dos empresas y una importación idempotente.

El importador `scripts/import-supabase.mjs` genera UUID v8 deterministas, separa las credenciales de los ajustes públicos y se ejecuta en modo ensayo por defecto. Las llaves locales se obtienen dinámicamente del CLI y no se guardan en archivos del proyecto.

## Modelo

- `profiles`: perfil de la persona autenticada en Supabase Auth.
- `organizations`: espacio administrativo que agrupa usuarios y empresas.
- `organization_memberships`: relación muchos-a-muchos entre usuarios y organizaciones, con rol `owner`, `admin` o `agent`.
- `companies`: ficha y parámetros no secretos de cada empresa; cada empresa pertenece a una organización.
- `company_memberships`: acceso operativo del usuario a cada empresa. Un usuario nunca queda limitado estructuralmente a una sola organización o empresa.
- `channel_accounts`: cuentas conectadas por canal.
- `contacts` y `contact_identities`: identidad estable por empresa y plataforma; no se identifica una persona solo por su nombre.
- `conversations`: cola operativa, asignación y estado.
- `messages`: mensajes, borrador, aprobación y estados de entrega.
- `conversation_notes`: notas internas por conversación y autor.
- `audit_events`: historial de cambios operativos sin contenido secreto.
- `private.integration_credentials`: credenciales cifradas por la aplicación, inaccesibles para clientes públicos.

Todas las tablas expuestas tienen RLS. Las políticas se basan en `company_memberships` y `auth.uid()`. Los campos usados por las políticas, la cola y la cronología tienen índices.

## Variables necesarias

Usa `.env.example` como inventario. Nunca expongas `SUPABASE_SECRET_KEY` ni `PULSE_CREDENTIALS_KEY` al navegador o a una app móvil. `PULSE_SESSION_SECRET` debe contener al menos 32 caracteres en producción.

## Ejecución local

El entorno local usa los puertos `56320`–`56329` para no colisionar con otros servicios de esta computadora. Pulse necesita Postgres, Auth, PostgREST y Kong; los demás servicios pueden permanecer apagados durante el desarrollo de la bandeja.

Con Supabase local activo, ejecuta `npm run start:local`. El lanzador obtiene las llaves locales directamente del CLI, no las escribe en archivos y establece `PULSE_STORE=supabase` solo para ese proceso. El login, las membresías, empresas, cuentas, contactos, conversaciones y mensajes se resuelven en Supabase local.

El lanzador habilita `PULSE_ALLOW_SIGNUP=true`. En desarrollo local el alta funciona directamente; en el servicio público de producción también exige `PULSE_SIGNUP_INVITE`, guardado en el llavero de macOS y comparado sin exponerlo. Vercel no ofrece el endpoint porque solo redirige al servicio autoalojado. La opción **Crear cuenta** presenta primero el registro del usuario y después la organización con su primera empresa. Al confirmar, Supabase Auth crea el usuario y una transacción de Postgres crea la organización, la empresa, el perfil y ambas membresías `owner`. Si la transacción falla, el usuario recién creado en Auth se elimina.

El formulario exige nombre, apellido, organización, empresa, industria, usuario, correo y una clave de al menos seis caracteres que incluya letras y números. Nombre y apellido se guardan por separado en `profiles` y también forman el nombre visible. La clave viaja directamente al endpoint local y no se registra ni se devuelve al navegador. `npm run verify:registration` prueba el alta, el inicio de sesión y el aislamiento de la empresa; `npm run verify:account-access` también prueba el cambio de clave; ambos usan datos sintéticos y los eliminan al terminar.

La vista **Espacios** permite crear organizaciones independientes y agregar empresas dentro de una organización cuando la membresía es `owner` o `admin`. Los selectores de organización y empresa son distintos y el servidor siempre vuelve a verificar la membresía antes de cambiar la sesión.

Después de restaurar una copia de la base, ejecuta `npm run supabase:auth:repair-sequences` antes de aceptar usuarios nuevos. Esto sincroniza la secuencia interna de `auth.refresh_tokens` con los datos restaurados y evita colisiones al crear la primera sesión.

`npm run supabase:backup:local` crea una copia de datos con permisos restringidos dentro de `backups/`, que Git ignora. `npm run supabase:backup:verify` ejecuta un ensayo transaccional de restauración y revierte todos los cambios al terminar.

## Próximos pasos locales

1. Completar credenciales reales y pruebas contra cuentas de IMAP/SMTP, X y Google Business Profile.
2. Verificar concurrencia antes de retirar el JSON.
3. Completar notificaciones push y adjuntos.
4. Elegir un servidor autoalojado permanente antes de compilar y publicar iOS o Android.

Las credenciales `lumen` y `arce` son exclusivamente de demostración local. Auth local acepta un mínimo de seis caracteres con letras y números. Antes de cualquier entorno público conviene elevar este mínimo; Supabase no recomienda contraseñas menores de ocho caracteres.
