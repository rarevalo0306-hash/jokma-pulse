import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { publicCompany, sameSecret } from "./auth.js";
import { snapshotFicha } from "./ficha.js";
import { buildSeed, DEMO_LOGINS } from "./seed.js";
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
    if (ensureDemoLogins(parsed)) save(parsed);
    return parsed;
  }

  function ensureDemoLogins(state) {
    let changed = false;
    for (const demo of DEMO_LOGINS) {
      const company = state.companies.find((item) => item.id === demo.id);
      if (!company) continue;
      if (!company.usuario || !company.clave) {
        company.usuario = demo.usuario;
        company.clave = demo.clave;
        changed = true;
      }
    }
    return changed;
  }

  function scopedState(empresaId) {
    const state = load();
    return {
      companies: state.companies.filter((item) => item.id === empresaId).map(publicCompany),
      accounts: state.accounts.filter((item) => item.empresaId === empresaId),
      messages: state.messages.filter((item) => item.empresaId === empresaId),
    };
  }

  function authenticate(usuario, clave) {
    const user = clean(usuario, 80).toLowerCase();
    const password = String(clave ?? "").trim();
    if (!user || !password) return null;
    const state = load();
    const company = state.companies.find(
      (item) => String(item.usuario || "").toLowerCase() === user,
    );
    if (!company || !sameSecret(company.clave || "\0", password)) return null;
    return publicCompany(company);
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
    syncAgents(state, company);
    save(state);
    return company;
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
      respondidoEn: null,
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
    message.respondidoEn = new Date().toISOString();
    save(state);
    return { message, account };
  }

  return {
    getState,
    createCompany,
    updateCompany,
    deleteCompany,
    createAccount,
    updateAccount,
    deleteAccount,
    createMessage,
    deleteMessage,
    saveReply,
    scopedState,
    authenticate,
    channels: CHANNELS,
  };
}
