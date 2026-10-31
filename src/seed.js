import { snapshotFicha } from "./ficha.js";
import { AGENT_TYPE, TONE_BY_CHANNEL } from "./tones.js";

const LUMEN = {
  id: "co-lumen",
  nombre: "Cafetería Lumen",
  industria: "Alimentos y bebidas",
  servicios: "Café de especialidad, pastelería artesanal y desayunos",
  horarios: "Lunes a viernes 7:30–19:00, sábados 8:00–14:00",
  telefono: "+52 55 1200 4410",
  correoOficial: "hola@cafelumen.mx",
  sitioWeb: "https://cafelumen.mx",
  soporte: "soporte@cafelumen.mx",
  usuario: "lumen",
  clave: "lumen123",
};

const ARCE = {
  id: "co-arce",
  nombre: "Clínica Dental Arce",
  industria: "Salud",
  servicios: "Limpieza dental, ortodoncia y urgencias",
  horarios: "Lunes a viernes 9:00–19:00, sábados 9:00–14:00",
  telefono: "+52 33 4500 2288",
  correoOficial: "contacto@dentalarce.mx",
  sitioWeb: "https://dentalarce.mx",
  soporte: "+52 33 4500 2290",
  usuario: "arce",
  clave: "arce123",
};

function account(company, { id, canal, cuenta, agente }) {
  return {
    id,
    empresaId: company.id,
    canal,
    cuenta,
    agente: {
      tipo: AGENT_TYPE,
      nombre: agente,
      industria: company.industria,
      tono: TONE_BY_CHANNEL[canal],
      ficha: snapshotFicha(company),
    },
  };
}

function message({ id, cuentaId, empresaId, canal, nombreCliente, texto, calificacion, muestra, createdAt }) {
  return {
    id,
    cuentaId,
    empresaId,
    canal,
    nombreCliente,
    texto,
    calificacion,
    muestra,
    respuesta: null,
    respondidoEn: null,
    createdAt,
  };
}

export const DEMO_LOGINS = [
  { id: "co-lumen", nombre: "Cafetería Lumen", usuario: "lumen", clave: "lumen123" },
  { id: "co-arce", nombre: "Clínica Dental Arce", usuario: "arce", clave: "arce123" },
];

export function buildSeed() {
  const companies = [structuredClone(LUMEN), structuredClone(ARCE)];
  const accounts = [
    account(LUMEN, {
      id: "ac-lumen-reviews",
      canal: "google_reviews",
      cuenta: "Cafetería Lumen en Google",
      agente: "Lumen Reseñas",
    }),
    account(LUMEN, {
      id: "ac-lumen-ig-dm",
      canal: "instagram_dm",
      cuenta: "@cafelumen",
      agente: "Lumen Directo",
    }),
    account(LUMEN, {
      id: "ac-lumen-ig-comment",
      canal: "instagram_comment",
      cuenta: "@cafelumen",
      agente: "Lumen Comentarios",
    }),
    account(LUMEN, {
      id: "ac-lumen-email",
      canal: "email",
      cuenta: "hola@cafelumen.mx",
      agente: "Lumen Correo",
    }),
    account(LUMEN, {
      id: "ac-lumen-x-dm",
      canal: "x_dm",
      cuenta: "@cafelumen",
      agente: "Lumen X",
    }),
    account(ARCE, {
      id: "ac-arce-reviews",
      canal: "google_reviews",
      cuenta: "Clínica Dental Arce en Google",
      agente: "Arce Reseñas",
    }),
    account(ARCE, {
      id: "ac-arce-fb-dm",
      canal: "facebook_messenger",
      cuenta: "Dental Arce",
      agente: "Arce Messenger",
    }),
    account(ARCE, {
      id: "ac-arce-fb-comment",
      canal: "facebook_comment",
      cuenta: "Dental Arce",
      agente: "Arce Comentarios",
    }),
    account(ARCE, {
      id: "ac-arce-x-post",
      canal: "x_post",
      cuenta: "@dentalarce",
      agente: "Arce X",
    }),
  ];

  const messages = [
    message({
      id: "msg-lumen-review-pos",
      cuentaId: "ac-lumen-reviews",
      empresaId: "co-lumen",
      canal: "google_reviews",
      nombreCliente: "Mariana López",
      texto:
        "El latte de vainilla estaba delicioso. Me explicaron el origen del café con mucha paciencia.",
      calificacion: 5,
      muestra: "Reseña positiva",
      createdAt: "2026-10-31T15:00:00.000Z",
    }),
    message({
      id: "msg-arce-review-neg",
      cuentaId: "ac-arce-reviews",
      empresaId: "co-arce",
      canal: "google_reviews",
      nombreCliente: "Jorge Ramírez",
      texto:
        "Me citaron a las 10 y salí a las 12 sin que me vieran. Nadie explicó la espera.",
      calificacion: 2,
      muestra: "Reseña negativa",
      createdAt: "2026-10-31T15:05:00.000Z",
    }),
    message({
      id: "msg-lumen-ig-dm",
      cuentaId: "ac-lumen-ig-dm",
      empresaId: "co-lumen",
      canal: "instagram_dm",
      nombreCliente: "Sofía Herrera",
      texto: "Hola, ¿a qué hora abren los sábados?",
      calificacion: null,
      muestra: "Pregunta de horario",
      createdAt: "2026-10-31T15:10:00.000Z",
    }),
    message({
      id: "msg-arce-fb-dm",
      cuentaId: "ac-arce-fb-dm",
      empresaId: "co-arce",
      canal: "facebook_messenger",
      nombreCliente: "Luis Ortega",
      texto: "¿Hacen limpieza dental los sábados?",
      calificacion: null,
      muestra: "Consulta de servicio",
      createdAt: "2026-10-31T15:15:00.000Z",
    }),
    message({
      id: "msg-lumen-ig-comment",
      cuentaId: "ac-lumen-ig-comment",
      empresaId: "co-lumen",
      canal: "instagram_comment",
      nombreCliente: "Daniela Cruz",
      texto:
        "Mi pedido de pasteles llegó incompleto y pagué con la tarjeta terminada en 4421. ¿Me lo reponen?",
      calificacion: null,
      muestra: "Seguimiento privado",
      createdAt: "2026-10-31T15:20:00.000Z",
    }),
    message({
      id: "msg-arce-fb-comment",
      cuentaId: "ac-arce-fb-comment",
      empresaId: "co-arce",
      canal: "facebook_comment",
      nombreCliente: "Camila Ruiz",
      texto: "¿Tienen urgencias los domingos?",
      calificacion: null,
      muestra: "Pregunta pública breve",
      createdAt: "2026-10-31T15:25:00.000Z",
    }),
    message({
      id: "msg-arce-x-post",
      cuentaId: "ac-arce-x-post",
      empresaId: "co-arce",
      canal: "x_post",
      nombreCliente: "Elena Vargas",
      texto: "Pésima atención, llevo dos días con dolor y nadie contesta el teléfono.",
      calificacion: null,
      muestra: "Reclamo público",
      createdAt: "2026-10-31T15:30:00.000Z",
    }),
    message({
      id: "msg-lumen-x-dm",
      cuentaId: "ac-lumen-x-dm",
      empresaId: "co-lumen",
      canal: "x_dm",
      nombreCliente: "Carmen Díaz",
      texto: "¿Me pasan el menú de desayunos de mañana?",
      calificacion: null,
      muestra: "Dato que no está en la ficha",
      createdAt: "2026-10-31T15:35:00.000Z",
    }),
    message({
      id: "msg-lumen-email",
      cuentaId: "ac-lumen-email",
      empresaId: "co-lumen",
      canal: "email",
      nombreCliente: "Roberto Salinas",
      texto:
        "Buenos días, quisiera conocer sus horarios y el correo para facturar un evento de la oficina.",
      calificacion: null,
      muestra: "Correo formal",
      createdAt: "2026-10-31T15:40:00.000Z",
    }),
  ];

  return { companies, accounts, messages };
}
