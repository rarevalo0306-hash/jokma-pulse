import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { hashPassword, publicCompany, verifyPassword } from "./auth.js";
import { snapshotFicha } from "./ficha.js";
import { buildSeed, DEMO_USERS } from "./seed.js";
import { SECRET_SETTING_KEYS, splitSettings } from "./credentials.js";
import { normalizeSettings } from "./settings.js";
import { AGENT_TYPE, CHANNELS, isChannel, TONE_BY_CHANNEL } from "./tones.js";

const COMPANY_FIELDS = [
  "nombre",
  "industria",
  "servicios",
  "horarios",
  "telefono",
  "correoOficial",
  "sitioWeb",
  "soporte",
];

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function clean(value, max = 400) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function readCompanyInput(input, { partial = false } = {}) {
  const company = {};
  for (const field of COMPANY_FIELDS) {
    if (partial && input[field] === undefined) continue;
    const max = field === "servicios" || field === "horarios" ? 600 : 240;
    company[field] = clean(input[field], max);
  }
  if (!partial || input.nombre !== undefined) {
    if (!company.nombre) throw fail(400, "La empresa necesita un nombre.");
  }
  if (!partial || input.industria !== undefined) {
    if (!company.industria) throw fail(400, "La empresa necesita una industria.");
  }
  return company;
}

function syncAgents(state, company) {
  const ficha = snapshotFicha(company);
  for (const account of state.accounts) {
    if (account.empresaId !== company.id) continue;
    account.agente.industria = company.industria;
    account.agente.ficha = structuredClone(ficha);
    account.agente.tono = TONE_BY_CHANNEL[account.canal];
    account.agente.tipo = AGENT_TYPE;
  }
}

export function createStore(dataPath) {
  function load() {
    if (!fs.existsSync(dataPath)) {
      const seeded = buildSeed();
      save(seeded);
      return seeded;
    }
    const parsed = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    parsed.companies ||= [];
    parsed.accounts ||= [];
    parsed.messages ||= [];
    parsed.notes ||= [];
    parsed.users ||= [];
    const loginChanged = migrateLegacyLogins(parsed);
    const usersChanged = ensureUsers(parsed);
    const messagesChanged = normalizeMessages(parsed);
    const changed = loginChanged || usersChanged || messagesChanged;
    if (changed) save(parsed);
    return parsed;
  }

  function ensureUsers(state) {
    if (state.users.length) return false;
    state.users = structuredClone(DEMO_USERS);
    return true;
  }

  function normalizeMessages(state) {
    let changed = false;
    for (const message of state.messages) {
      if (message.borrador === undefined) {
        message.borrador = message.respuesta || null;
        changed = true;
      }
      if (!message.estadoRespuesta) {
        message.estadoRespuesta = message.borrador ? "borrador" : "sin_borrador";
        changed = true;
      }
      if (message.aprobadoEn === undefined) {
        message.aprobadoEn = null;
        changed = true;
      }
    }
    return changed;
  }

  function migrateLegacyLogins(state) {
    let changed = false;
    for (const company of state.companies) {
      if (company.usuario !== undefined || company.clave !== undefined) {
        delete company.usuario;
        delete company.clave;
        changed = true;
      }
    }
    for (const user of state.users) {
      if (!user.passwordHash && user.clave) {
        user.passwordHash = hashPassword(user.clave);
        delete user.clave;
        changed = true;
      }
    }
    return changed;
  }

  function presentCompany(company) {
    const pub = publicCompany(company);
    const { publicSettings } = splitSettings(company?.ajustes);
    pub.ajustes = normalizeSettings(publicSettings, company);
    pub.credenciales = Object.fromEntries(
      [...SECRET_SETTING_KEYS].filter((key) => String(company?.ajustes?.[key] || "").trim()).map((key) => [key, true]),
    );
    return pub;
  }

  function getCompanyWithSecrets(id) {
    const company = load().companies.find((item) => item.id === id);
    return company ? structuredClone(company) : null;
  }

  function getCompaniesWithSecrets() {
    return load().companies.map((company) => structuredClone(company));
  }

  function userById(state, userId) {
    return state.users.find((item) => item.id === userId) || null;
  }

  function canAccess(user, empresaId) {
    return Boolean(user?.empresaIds?.includes(empresaId));
  }

  function scopedState(userId, empresaId) {
    const state = load();
    const user = userById(state, userId);
    if (!user || !canAccess(user, empresaId)) throw fail(403, "Esa empresa no está disponible para este usuario.");
    return {
      user: { id: user.id, nombre: user.nombre, usuario: user.usuario },
      activeCompanyId: empresaId,
      companies: state.companies.filter((item) => user.empresaIds.includes(item.id)).map(presentCompany),
      accounts: state.accounts.filter((item) => item.empresaId === empresaId),
      messages: state.messages.filter((item) => item.empresaId === empresaId),
    };
  }

  function authenticate(usuario, clave) {
    const user = clean(usuario, 80).toLowerCase();
    const password = String(clave ?? "").trim();
    if (!user || !password) return null;
    const state = load();
    const authenticated = state.users.find(
      (item) => String(item.usuario || "").toLowerCase() === user,
    );
    if (!authenticated || !verifyPassword(password, authenticated.passwordHash)) return null;
    const companyId = authenticated.empresaPredeterminadaId || authenticated.empresaIds[0];
    return {
      user: { id: authenticated.id, nombre: authenticated.nombre, usuario: authenticated.usuario },
      companyId,
      companies: state.companies
        .filter((item) => authenticated.empresaIds.includes(item.id))
        .map(presentCompany),
    };
  }

  function sessionAccess(userId, companyId) {
    const state = load();
    const user = userById(state, userId);
    const company = state.companies.find((item) => item.id === companyId);
    if (!user || !company || !canAccess(user, companyId)) return null;
    return { user, company: presentCompany(company) };
  }

  function save(state) {
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
    const tmp = `${dataPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, dataPath);
  }

  function getState() {
    return load();
  }

  function createCompany(input) {
    const state = load();
    const company = {
      id: `co-${randomUUID()}`,
      ...readCompanyInput(input),
    };
    for (const field of COMPANY_FIELDS) company[field] ||= "";
    state.companies.push(company);
    save(state);
    return company;
  }

  function updateCompany(id, input) {
    const state = load();
    const company = state.companies.find((item) => item.id === id);
    if (!company) throw fail(404, "No encontramos esa empresa.");
    const patch = readCompanyInput(input);
    Object.assign(company, patch);
    if (company.ajustes) {
      if (patch.nombre !== undefined) company.ajustes.organization = company.nombre;
      if (patch.servicios !== undefined) company.ajustes.products = company.servicios;
    }
    syncAgents(state, company);
    save(state);
    return company;
  }

  function updateSettings(id, input) {
    const state = load();
    const company = state.companies.find((item) => item.id === id);
    if (!company) throw fail(404, "No encontramos esa empresa.");
    const ajustes = normalizeSettings(input, company);
    if (!ajustes.organization) throw fail(400, "La organización necesita un nombre.");
    company.ajustes = ajustes;
    company.nombre = ajustes.organization;
    company.servicios = ajustes.products;
    syncAgents(state, company);
    save(state);
    return presentCompany(company);
  }

  function deleteCompany(id) {
    const state = load();
    const company = state.companies.find((item) => item.id === id);
    if (!company) throw fail(404, "No encontramos esa empresa.");
    state.messages = state.messages.filter((item) => item.empresaId !== id);
    state.accounts = state.accounts.filter((item) => item.empresaId !== id);
    state.companies = state.companies.filter((item) => item.id !== id);
    save(state);
    return { ok: true };
  }

  function createAccount(empresaId, input) {
    const state = load();
    const company = state.companies.find((item) => item.id === empresaId);
    if (!company) throw fail(404, "No encontramos esa empresa.");
    const canal = input.canal;
    if (!isChannel(canal)) throw fail(400, "El canal no es válido.");
    const cuenta = clean(input.cuenta, 160);
    const agenteNombre = clean(input.agenteNombre, 120);
    if (!cuenta) throw fail(400, "La cuenta necesita un identificador.");
    if (!agenteNombre) throw fail(400, "El agente necesita un nombre.");
    const duplicate = state.accounts.some(
      (item) =>
        item.empresaId === empresaId && item.canal === canal && item.cuenta === cuenta,
    );
    if (duplicate) {
      throw fail(409, "Esa empresa ya tiene un agente para esa cuenta y ese canal.");
    }
    const account = {
      id: `ac-${randomUUID()}`,
      empresaId,
      canal,
      cuenta,
      agente: {
        tipo: AGENT_TYPE,
        nombre: agenteNombre,
        industria: company.industria,
        tono: TONE_BY_CHANNEL[canal],
        ficha: snapshotFicha(company),
      },
    };
    state.accounts.push(account);
    save(state);
    return account;
  }

  function updateAccount(id, input) {
    const state = load();
    const account = state.accounts.find((item) => item.id === id);
    if (!account) throw fail(404, "No encontramos esa cuenta.");
    if (input.cuenta !== undefined) {
      const cuenta = clean(input.cuenta, 160);
      if (!cuenta) throw fail(400, "La cuenta necesita un identificador.");
      account.cuenta = cuenta;
    }
    if (input.agenteNombre !== undefined) {
      const agenteNombre = clean(input.agenteNombre, 120);
      if (!agenteNombre) throw fail(400, "El agente necesita un nombre.");
      account.agente.nombre = agenteNombre;
    }
    const duplicate = state.accounts.some(
      (item) =>
        item.id !== account.id &&
        item.empresaId === account.empresaId &&
        item.canal === account.canal &&
        item.cuenta === account.cuenta,
    );
    if (duplicate) {
      throw fail(409, "Esa empresa ya tiene un agente para esa cuenta y ese canal.");
    }
    save(state);
    return account;
  }

  function deleteAccount(id) {
    const state = load();
    const account = state.accounts.find((item) => item.id === id);
    if (!account) throw fail(404, "No encontramos esa cuenta.");
    const used = state.messages.some((item) => item.cuentaId === id);
    if (used) {
      throw fail(409, "Esta cuenta tiene mensajes. No se puede borrar todavía.");
    }
    state.accounts = state.accounts.filter((item) => item.id !== id);
    save(state);
    return { ok: true };
  }

  function ensureChannelAccount(state, company, canal, cuenta) {
    const label = clean(cuenta, 160) || canal;
    const sameChannel = state.accounts.filter(
      (item) => item.empresaId === company.id && item.canal === canal,
    );
    return (
      sameChannel.find((item) => item.cuenta === label) ||
      sameChannel[0] ||
      null
    );
  }

  function recordInstagramMessage({ igUserId, igId, senderId, canal, nombreCliente, texto, externalId, cuenta }) {
    if (!isChannel(canal)) return null;
    const linked = String(igUserId || igId || "");
    if (!linked) return null;
    const state = load();
    const company = state.companies.find(
      (item) => String(item.ajustes?.instagram_user_id || "") === linked,
    );
    if (!company) return null;
    const nombre = clean(nombreCliente, 160);
    const body = String(texto ?? "").trim().slice(0, 4000);
    if (!nombre || !body) return null;
    const id = /^msg-igc?-[A-Za-z0-9._-]{1,80}$/.test(String(externalId || "")) ? String(externalId) : "";
    if (id) {
      const existing = state.messages.find((item) => item.id === id);
      if (existing) return existing;
    }
    let account = ensureChannelAccount(state, company, canal, cuenta);
    if (!account) {
      account = {
        id: `ac-${randomUUID()}`,
        empresaId: company.id,
        canal,
        cuenta: clean(cuenta, 160) || canal,
        agente: {
          tipo: AGENT_TYPE,
          nombre: canal === "instagram_comment" ? "Instagram Comentarios" : "Instagram Directo",
          industria: company.industria,
          tono: TONE_BY_CHANNEL[canal],
          ficha: snapshotFicha(company),
        },
      };
      state.accounts.push(account);
    }
    const message = {
      id: id || `msg-${randomUUID()}`,
      cuentaId: account.id,
      empresaId: company.id,
      canal,
      nombreCliente: nombre,
      texto: body,
      direccionCliente: canal === "instagram_dm" ? clean(senderId, 80) : null,
      calificacion: null,
      muestra: null,
      respuesta: null,
      borrador: null,
      estadoRespuesta: "sin_borrador",
      respondidoEn: null,
      aprobadoEn: null,
      createdAt: new Date().toISOString(),
    };
    state.messages.push(message);
    save(state);
    return message;
  }

  function recordFacebookMessage({ pageId, senderId, displayName, text, externalId }) {
    const state = load();
    const company = state.companies.find((item) => String(item.ajustes?.facebook_page_id || "") === String(pageId || ""));
    if (!company) return null;
    const account = state.accounts.find((item) => item.empresaId === company.id && item.canal === "facebook_messenger");
    if (!account) return null;
    const existing = state.messages.find((item) => externalId && item.externalId === externalId);
    if (existing) return existing;
    const message = createMessage({ cuentaId: account.id, nombreCliente: displayName, texto: text });
    const refreshed = load();
    const stored = refreshed.messages.find((item) => item.id === message.id);
    stored.externalId = clean(externalId, 240) || null;
    stored.direccionCliente = clean(senderId, 80);
    save(refreshed);
    return stored;
  }

  function recordEmailMessage({ accountAddress, fromAddress, displayName, subject, text, externalId }) {
    const state = load();
    const account = state.accounts.find(
      (item) => item.canal === "email" && String(item.cuenta || "").trim().toLowerCase() === String(accountAddress || "").trim().toLowerCase(),
    );
    if (!account) return null;
    const existing = state.messages.find((item) => externalId && item.externalId === externalId);
    if (existing) return existing;
    const message = {
      id: `msg-${randomUUID()}`,
      cuentaId: account.id,
      empresaId: account.empresaId,
      canal: "email",
      nombreCliente: clean(displayName, 160) || clean(fromAddress, 160),
      direccionCliente: clean(fromAddress, 320).toLowerCase(),
      asunto: clean(subject, 300),
      externalId: clean(externalId, 240) || null,
      texto: String(text || "").trim().slice(0, 4000),
      calificacion: null,
      muestra: null,
      respuesta: null,
      borrador: null,
      estadoRespuesta: "sin_borrador",
      respondidoEn: null,
      aprobadoEn: null,
      createdAt: new Date().toISOString(),
    };
    if (!message.texto) return null;
    state.messages.push(message);
    save(state);
    return message;
  }

  function recordGoogleReview(companyId, { externalId, displayName, text, rating }) {
    const state = load();
    const account = state.accounts.find((item) => item.empresaId === companyId && item.canal === "google_reviews");
    if (!account) return null;
    const existing = state.messages.find((item) => externalId && item.externalId === externalId);
    if (existing) return existing;
    const message = createMessage({ cuentaId: account.id, nombreCliente: displayName, texto: text, calificacion: rating });
    const refreshed = load();
    const stored = refreshed.messages.find((item) => item.id === message.id);
    stored.externalId = clean(externalId, 240) || null;
    save(refreshed);
    return stored;
  }

  function recordXMessage(companyId, { externalId, participantId, displayName, text }) {
    const state = load();
    const account = state.accounts.find((item) => item.empresaId === companyId && item.canal === "x_dm");
    if (!account) return null;
    const existing = state.messages.find((item) => externalId && item.externalId === externalId);
    if (existing) return existing;
    const message = createMessage({ cuentaId: account.id, nombreCliente: displayName, texto: text });
    const refreshed = load();
    const stored = refreshed.messages.find((item) => item.id === message.id);
    stored.externalId = clean(externalId, 240) || null;
    stored.direccionCliente = clean(participantId, 40);
    save(refreshed);
    return stored;
  }

  function createMessage(input) {
    const state = load();
    const account = state.accounts.find((item) => item.id === input.cuentaId);
    if (!account) throw fail(404, "Elige una cuenta de canal.");
    const nombreCliente = clean(input.nombreCliente, 160);
    const texto = String(input.texto ?? "").trim().slice(0, 4000);
    if (!nombreCliente) throw fail(400, "El mensaje necesita el nombre del cliente.");
    if (!texto) throw fail(400, "El mensaje necesita texto.");
    let calificacion = null;
    if (account.canal === "google_reviews") {
      calificacion = Number(input.calificacion);
      if (!Number.isInteger(calificacion) || calificacion < 1 || calificacion > 5) {
        throw fail(400, "La reseña necesita una calificación de 1 a 5.");
      }
    }
    const message = {
      id: `msg-${randomUUID()}`,
      cuentaId: account.id,
      empresaId: account.empresaId,
      canal: account.canal,
      nombreCliente,
      texto,
      calificacion,
      muestra: null,
      respuesta: null,
      borrador: null,
      estadoRespuesta: "sin_borrador",
      respondidoEn: null,
      aprobadoEn: null,
      createdAt: new Date().toISOString(),
    };
    state.messages.push(message);
    save(state);
    return message;
  }

  function deleteMessage(id) {
    const state = load();
    const message = state.messages.find((item) => item.id === id);
    if (!message) throw fail(404, "No encontramos ese mensaje.");
    state.messages = state.messages.filter((item) => item.id !== id);
    save(state);
    return { ok: true };
  }

  function saveReply(id, respuesta) {
    const state = load();
    const message = state.messages.find((item) => item.id === id);
    if (!message) throw fail(404, "No encontramos ese mensaje.");
    const account = state.accounts.find((item) => item.id === message.cuentaId);
    if (!account) throw fail(404, "La cuenta de este mensaje ya no existe.");
    message.respuesta = respuesta;
    message.borrador = respuesta;
    message.estadoRespuesta = "borrador";
    message.respondidoEn = new Date().toISOString();
    message.aprobadoEn = null;
    save(state);
    return { message, account };
  }

  function saveDraft(id, draft) {
    const state = load();
    const message = state.messages.find((item) => item.id === id);
    if (!message) throw fail(404, "No encontramos ese mensaje.");
    const text = String(draft ?? "").trim().slice(0, 4000);
    if (!text) throw fail(400, "El borrador necesita texto.");
    message.borrador = text;
    message.respuesta = text;
    message.estadoRespuesta = "borrador";
    message.respondidoEn = new Date().toISOString();
    message.aprobadoEn = null;
    save(state);
    return message;
  }

  function approveDraft(id) {
    const state = load();
    const message = state.messages.find((item) => item.id === id);
    if (!message) throw fail(404, "No encontramos ese mensaje.");
    if (!String(message.borrador || "").trim()) throw fail(409, "Guarda un borrador antes de aprobarlo.");
    message.estadoRespuesta = "aprobado";
    message.aprobadoEn = new Date().toISOString();
    save(state);
    return message;
  }

  function markDelivery(id, deliveryState, { providerMessageId = "", error = "" } = {}) {
    const state = load();
    const message = state.messages.find((item) => item.id === id);
    if (!message) throw fail(404, "No encontramos ese mensaje.");
    const mapped = { sending: "enviando", sent: "enviado", delivered: "entregado", error: "error" }[deliveryState];
    if (!mapped) throw fail(400, "El estado de entrega no es válido.");
    message.estadoRespuesta = mapped;
    message.providerMessageId = clean(providerMessageId, 500) || null;
    message.errorEntrega = clean(error, 1000) || null;
    save(state);
    return message;
  }

  function updateConversation(messageId, input, userId) {
    const state = load();
    const message = state.messages.find((item) => item.id === messageId);
    if (!message) throw fail(404, "No encontramos ese mensaje.");
    const status = String(input?.status || "");
    if (!new Set(["open", "pending", "closed"]).has(status)) throw fail(400, "El estado de conversación no es válido.");
    message.estadoConversacion = status;
    if (input?.assignedToMe !== undefined) message.asignadoA = input.assignedToMe ? userId : null;
    save(state);
    return message;
  }

  function addConversationNote(messageId, body, userId) {
    const state = load();
    const message = state.messages.find((item) => item.id === messageId);
    if (!message) throw fail(404, "No encontramos ese mensaje.");
    const text = String(body || "").trim().slice(0, 2000);
    if (!text) throw fail(400, "La nota necesita texto.");
    message.notas ||= [];
    message.notas.push({ id: `note-${randomUUID()}`, texto: text, autor: userId, createdAt: new Date().toISOString() });
    save(state);
    return message;
  }

  return {
    getState,
    getCompanyWithSecrets,
    getCompaniesWithSecrets,
    createCompany,
    updateCompany,
    updateSettings,
    deleteCompany,
    createAccount,
    updateAccount,
    deleteAccount,
    createMessage,
    recordInstagramMessage,
    recordFacebookMessage,
    recordEmailMessage,
    recordGoogleReview,
    recordXMessage,
    deleteMessage,
    saveReply,
    saveDraft,
    approveDraft,
    markDelivery,
    updateConversation,
    addConversationNote,
    scopedState,
    authenticate,
    sessionAccess,
    channels: CHANNELS,
  };
}
