---
name: Jokma Pulse
description: Mesa de prioridades omnicanal, calmada, densa y adaptable.
colors:
  mineral-canvas: "#eef2f0"
  clear-surface: "#ffffff"
  mist-surface: "#f6f8f7"
  ink-text: "#101714"
  quiet-text: "#66706b"
  precise-divider: "#dce3df"
  pulse-mint: "#18bfa7"
  deep-mint: "#087d6c"
  mint-wash: "#dff8f2"
  operational-red: "#b42318"
  operational-amber: "#925f00"
  shell-ink: "#0d1713"
  shell-text: "#eef7f3"
  shell-muted: "#b9c7c1"
  shell-divider: "#26342f"
  shell-hover: "#17251f"
  shell-selected: "#23352e"
  dark-canvas: "#0c1210"
  dark-surface: "#131b18"
  dark-surface-muted: "#19231f"
  dark-text: "#f1f7f4"
  dark-quiet-text: "#9eaaa4"
  dark-divider: "#2a3731"
  dark-pulse-mint: "#31d8bd"
  dark-deep-mint: "#84ebd9"
  dark-mint-wash: "#173b34"
  dark-operational-red: "#ff8a80"
  dark-operational-amber: "#f4c66a"
  accent-ink: "#07120f"
  review-stars: "#b77900"
typography:
  display:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "42px"
    fontWeight: 800
    lineHeight: 1.18
    letterSpacing: "-0.06em"
  headline:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(26px, 3vw, 38px)"
    fontWeight: 760
    lineHeight: 1.18
    letterSpacing: "-0.025em"
  title:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "21px"
    fontWeight: 700
    lineHeight: 1.18
    letterSpacing: "-0.025em"
  body:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 800
    lineHeight: 1.5
    letterSpacing: "0.08em"
rounded:
  xs: "4px"
  sm: "8px"
  md: "14px"
  lg: "20px"
  pill: "999px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
  s7: "48px"
components:
  button-primary:
    backgroundColor: "{colors.pulse-mint}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "10px 15px"
    height: "44px"
  button-ghost:
    backgroundColor: "{colors.clear-surface}"
    textColor: "{colors.ink-text}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "10px 15px"
    height: "44px"
  field:
    backgroundColor: "{colors.clear-surface}"
    textColor: "{colors.ink-text}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
    height: "44px"
  chip-filter:
    backgroundColor: "{colors.clear-surface}"
    textColor: "{colors.ink-text}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "7px 10px"
    height: "36px"
  chip-filter-selected:
    backgroundColor: "{colors.mint-wash}"
    textColor: "{colors.deep-mint}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "7px 10px"
    height: "36px"
---

# Design System: Jokma Pulse

## Overview

**Creative North Star: "Mesa de prioridades / Priority Workbench"**

Jokma Pulse se siente como una mesa de trabajo operacional: calmada, densa y legible. Las superficies minerales y de tinta ordenan la cola, la conversación, el borrador editable y el contexto sin competir por atención; la marca aparece en el pulso menta y en la precisión del estado seleccionado.

La identidad se adapta visualmente a web, iOS y Android mediante la misma jerarquía, color semántico y lenguaje de estado, respetando en cada plataforma sus controles, navegación y métricas nativas. Esto es una dirección durable de adaptación visual, no una afirmación de que hoy existan aplicaciones nativas.

**Key Characteristics:**

- Calm operational density.
- Matte ink and mineral surfaces.
- Mint reserved for selection and primary action.
- Explicit workflow state without visual drama.
- List-to-detail adaptation that preserves work context.

## Colors

La paleta combina superficies minerales claras u oscuras con tinta de alto contraste; menta identifica acción y selección, mientras ámbar y rojo comunican estados operacionales.

### Primary

- **Pulse Mint:** Marca la selección actual, el foco de trabajo y la acción primaria; no se usa como decoración extensa.
- **Deep Mint:** Da contraste a texto activo, confirmaciones y estados aprobados sobre superficies claras.
- **Mint Wash:** Sostiene avatares, contadores y chips seleccionados sin convertirlos en llamadas dominantes.

### Secondary

- **Operational Amber:** Señala trabajo pendiente o en revisión.
- **Operational Red:** Señala errores y fallos que requieren intervención.

### Neutral

- **Mineral Canvas:** Fondo general que separa el producto del área operativa.
- **Clear Surface / Mist Surface:** Alternan trabajo activo y contexto secundario con capas mates.
- **Ink Text / Quiet Text:** Separan contenido principal de metadatos, explicaciones y marcas temporales.
- **Precise Divider:** Traza límites de un píxel entre cola, conversación, compositor y contexto.
- **Shell Ink:** Mantiene la navegación como un ancla estable y oscura en ambos temas.
- **Dark Canvas / Dark Surface / Dark Surface Muted:** Replican la jerarquía tonal, no una inversión automática, en tema oscuro.

### Named Rules

**The Mint Means Action Rule.** Mint marks selection, focus, approval, or the primary action; it is not ambient decoration.

**The Operational Color Rule.** Amber means pending or review, and red means an error that requires intervention; neither color is used for branding.

## Typography

**Display Font:** UI Sans (with system sans-serif fallback)
**Body Font:** UI Sans (with system sans-serif fallback)
**Label Font:** UI Sans (with system sans-serif fallback)

**Character:** Una sola sans de trabajo mantiene rapidez y coherencia entre datos, conversación y controles. El contraste nace de peso, tamaño, caso y espaciado, no de mezclar familias tipográficas.

### Hierarchy

- **Display** (800, 42px, 1.18): Lockup de acceso y momentos de marca poco frecuentes.
- **Headline** (760, clamp(26px, 3vw, 38px), 1.18): Títulos principales de bandeja y pantallas operacionales.
- **Title** (700, 21px, 1.18): Persona activa y cabeceras de sección.
- **Body** (400, 15px, 1.5): Mensajes, borradores y contenido funcional.
- **Label** (800, 12px, 0.08em): Eyebrows y metadatos breves en mayúsculas; los labels de formulario usan un peso menos enfático.

### Named Rules

**The One Workhorse Rule.** Use the system sans stack everywhere; hierarchy comes from weight, size, case, and spacing rather than a second typeface.

## Layout

El escritorio usa una mesa de cuatro zonas: navegación oscura fija de 156px, cola priorizada, conversación central dominante y panel de contexto. La bandeja aplica una cuadrícula proporcional de `minmax(270px, 0.78fr) minmax(420px, 1.45fr) minmax(230px, 0.72fr)` dentro de una sola superficie recortada; el encabezado de empresa activa permanece sticky y el compositor queda unido a la conversación.

El ritmo sigue una escala compacta de siete pasos, de 4px a 48px. Controles y targets web parten de 44px de altura. A 1180px o menos desaparece el inspector lateral y quedan cola más conversación. A 899px o menos la navegación pasa al borde inferior y la bandeja adopta navegación lista-a-detalle: se muestra la cola o la conversación, nunca ambas comprimidas. A 480px o menos las acciones del compositor se apilan y se eliminan metadatos no esenciales.

Para una futura adaptación visual a iOS o Android, conservar esta prioridad y el paso lista-a-detalle, pero mapearlos a navegación, áreas seguras, escalado tipográfico y targets nativos en lugar de copiar píxeles web.

**The Conversation Owns the Center Rule.** The queue identifies the next task, but the active conversation and its editable draft remain the dominant work surface.

**The Context Yields First Rule.** At constrained widths, remove the inspector before compressing the conversation; at mobile width, switch to list-to-detail navigation.

## Elevation & Depth

El sistema es mate y plano por defecto. La jerarquía depende de contraste tonal y divisores precisos; las sombras se reservan para el contenedor principal, paneles de acceso y mensajes elevados sobre el hilo.

### Shadow Vocabulary

- **Workbench Ambient:** (`box-shadow: 0 12px 32px rgba(16, 23, 20, 0.08)`): Eleva la bandeja completa o un panel de acceso en tema claro.
- **Workbench Ambient Dark:** (`box-shadow: 0 18px 44px rgba(0, 0, 0, 0.26)`): Mantiene la separación del mismo contenedor en tema oscuro.
- **Message Lift:** (`box-shadow: 0 4px 14px rgba(16, 23, 20, 0.05)`): Separa una unidad de conversación de la superficie tonal del hilo.

### Named Rules

**The Matte-by-Default Rule.** Use tonal layering and one-pixel dividers first; shadows belong only to the workbench boundary, access panels, and message surfaces.

## Shapes

Las formas son contenidas y funcionales: 8px en controles, 14px en paneles y mensajes, y 20px en el contenedor general. Los chips y avatares usan siluetas circulares; el mensaje conserva una esquina superior izquierda de 4px para sugerir dirección sin convertirse en una burbuja decorativa. Los bordes son de un píxel y siguen el divisor semántico del tema.

**The Restrained Radius Rule.** Use 8–14px corners for working controls and surfaces, 20px only for the enclosing workbench, and pill geometry only for chips, counts, and avatars.

## Components

Todos los componentes se sienten precisos y editables: superficies mates, estados claros, targets de 44px y transición rápida de 160ms. El foco visible usa un anillo menta de 3px con offset de 2px; con reducción de movimiento, animaciones y transiciones caen a 1ms.

### Buttons

- **Shape:** Rectángulo suavemente curvado (8px), altura mínima de 44px y padding compacto de 10px por 15px.
- **Primary:** Fondo Pulse Mint, texto Accent Ink y peso alto para aprobar, guardar o conectar.
- **Hover / Focus:** El hover aclara sutilmente el menta; el foco mantiene el anillo visible y el active se desplaza 1px hacia abajo.
- **Ghost / Tiny:** Las acciones secundarias usan superficie y divisor; las acciones pequeñas bajan a 36px solo cuando no son el target principal.

### Chips

- **Style:** Forma pill, borde preciso y fondo de superficie.
- **State:** La selección cambia a Mint Wash con texto Deep Mint; el contador permanece secundario.

### Cards / Containers

- **Corner Style:** 14px para paneles y 20px para la mesa completa.
- **Background:** Clear Surface para trabajo activo y Mist Surface para contexto o cola.
- **Shadow Strategy:** Sigue la elevación mate; la sombra no sustituye divisores internos.
- **Border:** Un píxel con Precise Divider.
- **Internal Padding:** 16px en densidad operacional y 24px en paneles secundarios.

### Inputs / Fields

- **Style:** Superficie clara, borde de un píxel, radio de 8px, altura mínima de 44px y padding de 10px por 12px.
- **Focus:** Anillo menta visible de 3px con offset; nunca depender solo de un cambio de color.
- **Error / Disabled:** Rojo operacional para error; disabled conserva estructura y baja a 52% de opacidad.

### Navigation

La navegación de escritorio vive en una barra Shell Ink, con texto apagado en reposo y una superficie más clara en hover o selección. A 899px se convierte en barra inferior de tres destinos; la prioridad y el nombre de las secciones se conservan.

### Priority Queue Row

Cada fila mantiene avatar, persona, canal, adelanto y estado en una estructura estable de al menos 104px. La selección añade una marca menta interior de 3px sin mover la fila; el estado avanza por pendiente, aprobado, enviado, entregado o error sin perder su posición.

### Conversation Message

El mensaje se limita a 84% del ancho en escritorio y 94% en móvil. El canal, fecha y tipo forman una línea secundaria; el mensaje seleccionado cambia el borde a menta, no el tamaño ni la elevación.

## Do's and Don'ts

### Do:

- Do keep the active company, channel, selection, and delivery state visible at the point of work.
- Do reserve mint for selection, focus, approval, and primary action.
- Do preserve the queue-to-conversation-to-draft hierarchy across responsive adaptations.
- Do use matte tonal layers, one-pixel dividers, and the real shadow vocabulary to express depth.
- Do adapt the durable hierarchy to web, iOS, and Android conventions without implying native apps already exist.

### Don't:

- Don't let settings, profile data, or integration plumbing dominate the daily inbox.
- Don't compress queue, conversation, and context into three narrow mobile columns.
- Don't use amber or red as decorative brand colors.
- Don't mark generated text as final before human review and approval are visible.
- Don't replace platform-native navigation and controls with a pixel-for-pixel web port.
