# Preparación móvil

La interfaz ya es adaptativa y el sitio incluye manifiesto, icono instalable, color de sistema, áreas seguras y un service worker que solo almacena el shell público; nunca guarda respuestas de `/api/`.

## Bloqueo actual

El backend activo vive en Supabase local. Un iPhone o Android publicado no puede usar `127.0.0.1` de esta computadora ni depender de que el equipo de desarrollo permanezca encendido. Por eso todavía no se debe crear ni firmar un binario de tienda: sería una carcasa sin un servicio permanente y verificable.

## Secuencia para publicar

1. Elegir un servidor autoalojado permanente con HTTPS, Postgres/Supabase, copias externas y monitoreo.
2. Migrar la copia local y ejecutar las siete migraciones sin exponer llaves.
3. Validar login, cambio de empresa, sincronización, aprobación y envío desde una red externa.
4. Añadir notificaciones push y enlaces universales con identificadores definitivos de iOS y Android.
5. Empaquetar la interfaz con una capa nativa, probar cámara/archivos/teclado, accesibilidad y modo suspendido.
6. Ejecutar TestFlight y una pista cerrada de Google Play antes de enviar a revisión pública.

La publicación también necesitará cuentas de Apple Developer y Google Play Console, certificados y decisiones de privacidad que no existen en este repositorio. Pulse no iniciará sesión en esas cuentas ni publicará sin autorización específica.
