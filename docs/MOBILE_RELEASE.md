# Preparación móvil

La interfaz ya es adaptativa y el sitio incluye manifiesto, icono instalable, color de sistema, áreas seguras y un service worker que solo almacena el shell público; nunca guarda respuestas de `/api/`.

## Estado actual

El backend activo vive en Supabase local y `https://pulse.jokma.app` llega a esta Mac mediante un túnel HTTPS. Ya existen proyectos nativos de Capacitor 8 para iOS y Android con el identificador `app.jokma.pulse`. Esta primera configuración abre el sitio público para permitir pruebas internas reales sin duplicar sesiones ni exponer la base local.

Esto todavía no equivale a una versión de tienda. El servicio depende de que la Mac, Colima, Supabase, Pulse y el túnel permanezcan activos. La configuración remota de Capacitor se considera una etapa de prueba; antes de revisión pública hay que decidir una arquitectura permanente y verificar que la experiencia aporta suficiente valor nativo.

## Comandos móviles

- `npm run mobile:sync`: actualiza iOS y Android con la configuración y los recursos web.
- `npm run mobile:ios`: abre el proyecto de Xcode.
- `npm run mobile:android`: abre el proyecto de Android Studio.
- `npm run mobile:build:ios`: compila una versión de simulador sin firma.
- `npm run mobile:build:android`: compila un APK de depuración con Java 21 y el SDK Android 36 instalados en esta Mac.

Los iconos y pantallas de inicio nativos se generaron desde `assets/icon.png`, que conserva la identidad visual de Pulse.

## Secuencia para publicar

1. Mantener esta Mac como servidor con reinicio automático, copias externas y monitoreo, o mover el mismo stack a un servidor permanente sin volver a Supabase Cloud.
2. Probar login, cambio de organización/empresa, sincronización, aprobación y envío desde un iPhone y un Android fuera de la red local.
3. Generar iconos, pantalla de inicio y textos de privacidad definitivos.
4. Añadir notificaciones push y enlaces universales con los identificadores definitivos.
5. Probar teclado, accesibilidad, suspensión, reconexión, llamadas y enlaces externos en dispositivos físicos.
6. Crear certificados y builds firmados; ejecutar TestFlight y una pista cerrada de Google Play antes de revisión pública.

La publicación también necesitará cuentas de Apple Developer y Google Play Console, certificados y decisiones de privacidad que no existen en este repositorio. Pulse no iniciará sesión en esas cuentas ni publicará sin autorización específica.
