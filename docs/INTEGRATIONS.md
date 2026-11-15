# Conexiones directas

Pulse no usa n8n. Cada empresa conserva sus identificadores públicos en `companies.settings` y sus tokens cifrados en `private.integration_credentials`.

## Meta

- Facebook OAuth: `/api/facebook/iniciar` y `/api/facebook/callback`.
- Facebook webhook: `https://pulse.jokma.app/api/facebook/webhook` con token `jokma-pulse-facebook`.
- Instagram OAuth: `/api/instagram/iniciar` y `https://pulse.jokma.app/api/instagram/callback`.
- Instagram webhook: `https://pulse.jokma.app/api/instagram/webhook` con token `jokma-pulse-instagram`.
- Los dos webhooks validan `X-Hub-Signature-256` antes de aceptar eventos.
- Messenger e Instagram Direct conservan el identificador del remitente y permiten enviar un borrador aprobado mediante la API oficial.

El usuario todavía debe completar el whitelist de OAuth de Instagram en Meta. No se solicita App Review, acceso avanzado ni verificación desde Pulse.

## Correo

La bandeja lee mensajes no vistos por IMAP y envía respuestas aprobadas por SMTP. Se configuran host, puerto, TLS, usuario, contraseña y remitente desde Ajustes. La contraseña nunca vuelve al navegador.

El correo de recuperación de acceso es un servicio distinto del correo de cada empresa. Supabase Auth necesita un remitente SMTP global y `PULSE_EMAIL_RECOVERY_ENABLED=true`; no debe reutilizar automáticamente la cuenta de una empresa. En desarrollo, Mailpit captura estos correos sin enviarlos a Internet.

## Google Reviews

Pulse renueva el acceso con el `refresh_token`, importa las reseñas de la cuenta y ubicación configuradas y publica respuestas aprobadas con la API de Google Business Profile. La cuenta real necesita acceso previo a esa API por parte de Google.

## X

Pulse firma solicitudes con OAuth 1.0a, importa eventos de mensajes directos y envía una respuesta aprobada al participante conservado. La cuenta real necesita un proyecto de X con acceso a lectura y escritura de DM.

## Verificación pendiente con proveedores

Los clientes y sus pruebas simuladas están completos localmente. La validación real de correo, Google, X y Meta requiere las credenciales de cada empresa y un callback HTTPS accesible; no se deben pegar secretos en chats, archivos versionados ni capturas.
