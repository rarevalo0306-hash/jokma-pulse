export const AGENT_TYPE = "atencion";

export const CHANNELS = [
  "google_reviews",
  "instagram_dm",
  "facebook_messenger",
  "instagram_comment",
  "facebook_comment",
  "x_post",
  "x_dm",
  "email",
];

export const CHANNEL_LABELS = {
  google_reviews: "Reseñas de Google",
  instagram_dm: "Instagram DM",
  facebook_messenger: "Facebook Messenger",
  instagram_comment: "Comentario de Instagram",
  facebook_comment: "Comentario de Facebook",
  x_post: "Publicación en X",
  x_dm: "Mensaje directo en X",
  email: "Correo electrónico",
};

export const TONE_BY_CHANNEL = {
  google_reviews:
    "Público y permanente. Con 4 o 5 estrellas, agradece y cita un detalle concreto de la reseña. Con 1 a 3 estrellas, discúlpate sin discutir y deriva al soporte en privado. Párrafos cortos y pocos emojis.",
  instagram_dm:
    "Cercano y breve. Uno o dos emojis como máximo. Siempre un solo llamado a la acción.",
  facebook_messenger:
    "Cercano y breve. Uno o dos emojis como máximo. Siempre un solo llamado a la acción.",
  instagram_comment:
    "Una o dos líneas. Si hace falta un dato personal, avisa que se continúa por mensaje privado.",
  facebook_comment:
    "Una o dos líneas. Si hace falta un dato personal, avisa que se continúa por mensaje privado.",
  x_post:
    "Ultra breve. Si es un reclamo público, da seguimiento inmediato y continúa por DM.",
  x_dm: "Ultra breve.",
  email:
    "Formal, sin emojis. Saludo, cuerpo, llamado a la acción y despedida.",
};

export function isChannel(value) {
  return CHANNELS.includes(value);
}
