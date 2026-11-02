import path from "node:path";
import express from "express";
import { fileURLToPath } from "node:url";
import { clearSessionCookie, publicCompany, readSessionCookie, sessionCookie } from "./src/auth.js";
import { auditReply, generateReply } from "./src/replies.js";
import { createStore } from "./src/store.js";
import { acceptReply, deliverInbound } from "./src/n8n.js";
import { beginLogin, callbackMotivo, completeLogin, readState, settingsWithPage } from "./src/facebook.js";
import { CONNECTIONS, MODELS, PARAMETERS } from "./src/settings.js";
import { AGENT_TYPE, CHANNEL_LABELS, CHANNELS, TONE_BY_CHANNEL } from "./src/tones.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath =
  process.env.PULSE_DATA ||
  (process.env.VERCEL
    ? path.join("/tmp", "jokma-pulse", "pulse.json")
    : path.join(__dirname, "data", "pulse.json"));
const store = createStore(dataPath);
const app = express();

app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: "100kb" }));

function fail(res, error) {
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: error.message || "Error interno" });
}

function meta() {
  return {
    tipoAgente: AGENT_TYPE,
    canales: CHANNELS.map((id) => ({
      id,
      etiqueta: CHANNEL_LABELS[id],
      tono: TONE_BY_CHANNEL[id],
    })),
    modelos: MODELS,
    parametros: PARAMETERS,
    conexiones: CONNECTIONS,
  };
}

function sessionCompany(req) {
  const companyId = readSessionCookie(req.headers.cookie);
  if (!companyId) return null;
  const company = store.getState().companies.find((item) => item.id === companyId);
  return company || null;
}

function requireSession(req, res, next) {
  const company = sessionCompany(req);
  if (!company) {
    res.status(401).json({ error: "Inicia sesión para ver tu empresa." });
    return;
  }
  req.empresa = company;
  next();
}

function forbidOther(req, empresaId) {
  if (req.empresa.id !== empresaId) {
    throw Object.assign(new Error("Esa empresa no está en tu sesión."), { status: 403 });
  }
}

function accountFor(req, accountId) {
  const account = store.getState().accounts.find((item) => item.id === accountId);
  if (!account || account.empresaId !== req.empresa.id) {
    throw Object.assign(new Error("Esa cuenta no está en tu sesión."), { status: 404 });
  }
  return account;
}

function messageFor(req, messageId) {
  const message = store.getState().messages.find((item) => item.id === messageId);
  if (!message || message.empresaId !== req.empresa.id) {
    throw Object.assign(new Error("Ese mensaje no está en tu sesión."), { status: 404 });
  }
  return message;
}

app.get("/api/salud", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/sesion", (req, res) => {
  const company = store.authenticate(req.body?.usuario, req.body?.clave);
  if (!company) {
    res.status(401).json({ error: "Usuario o clave incorrectos." });
    return;
  }
  res.setHeader("Set-Cookie", sessionCookie(company.id));
  res.json({ empresa: company });
});

app.delete("/api/sesion", (_req, res) => {
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.json({ ok: true });
});

app.get("/api/sesion", requireSession, (req, res) => {
  res.json({ empresa: publicCompany(req.empresa) });
});

app.get("/api/estado", requireSession, (req, res) => {
  res.json({ ...store.scopedState(req.empresa.id), ...meta() });
});

app.post("/api/empresas", requireSession, (_req, res) => {
  res.status(403).json({ error: "Cada empresa entra con su propio acceso." });
});

app.put("/api/empresas/:id/ajustes", requireSession, (req, res) => {
  try {
    forbidOther(req, req.params.id);
    res.json(store.updateSettings(req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

app.put("/api/empresas/:id", requireSession, (req, res) => {
  try {
    forbidOther(req, req.params.id);
    res.json(publicCompany(store.updateCompany(req.params.id, req.body || {})));
  } catch (error) {
    fail(res, error);
  }
});

app.delete("/api/empresas/:id", requireSession, (req, res) => {
  try {
    forbidOther(req, req.params.id);
    const result = store.deleteCompany(req.params.id);
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.json(result);
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/empresas/:id/cuentas", requireSession, (req, res) => {
  try {
    forbidOther(req, req.params.id);
    res.status(201).json(store.createAccount(req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

app.put("/api/cuentas/:id", requireSession, (req, res) => {
  try {
    accountFor(req, req.params.id);
    res.json(store.updateAccount(req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

app.delete("/api/cuentas/:id", requireSession, (req, res) => {
  try {
    accountFor(req, req.params.id);
    res.json(store.deleteAccount(req.params.id));
  } catch (error) {
    fail(res, error);
  }
});

function publicOrigin(req) {
  if (process.env.VERCEL) return "https://jokma-pulse.vercel.app";
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers.host || "127.0.0.1:4317";
  return `${proto}://${host}`;
}

app.post("/api/mensajes", requireSession, async (req, res) => {
  try {
    accountFor(req, req.body?.cuentaId);
    const message = store.createMessage(req.body || {});
    const company = store.getState().companies.find((item) => item.id === message.empresaId);
    const n8n = await deliverInbound({ company, message, origin: publicOrigin(req) });
    res.status(201).json({ ...message, n8nEnviado: n8n.enviado });
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/n8n/respuesta", (req, res) => {
  try {
    const saved = acceptReply(store, req.body || {});
    res.json({ ok: true, mensajeId: saved.message.id });
  } catch (error) {
    fail(res, error);
  }
});

function facebookRedirect(res, motivo) {
  const target = motivo ? `/?facebook=error&motivo=${encodeURIComponent(motivo)}` : "/?facebook=ok";
  res.redirect(302, target);
}

app.get("/api/facebook/iniciar", (req, res) => {
  const company = sessionCompany(req);
  if (!company) {
    res.redirect(302, "/");
    return;
  }
  const started = beginLogin(company, publicOrigin(req));
  if (!started.url) {
    facebookRedirect(res, started.motivo || "sin_app");
    return;
  }
  res.redirect(302, started.url);
});

app.get("/api/facebook/callback", async (req, res) => {
  const denied = callbackMotivo(req.query);
  if (denied) {
    facebookRedirect(res, denied);
    return;
  }
  const companyId = readState(typeof req.query.state === "string" ? req.query.state : "");
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!companyId || !code) {
    facebookRedirect(res, "facebook");
    return;
  }
  const company = store.getState().companies.find((item) => item.id === companyId);
  const appId = company?.ajustes?.meta_app_id;
  const appSecret = company?.ajustes?.meta_app_secret;
  if (!company || !appId || !appSecret) {
    facebookRedirect(res, "sin_app");
    return;
  }
  try {
    const page = await completeLogin({
      code,
      appId,
      appSecret,
      origin: publicOrigin(req),
      organization: company.ajustes?.organization || company.nombre,
    });
    store.updateSettings(company.id, settingsWithPage(company, page));
    facebookRedirect(res);
  } catch (error) {
    facebookRedirect(res, error.motivo === "sin_pagina" ? "sin_pagina" : "facebook");
  }
});

app.delete("/api/mensajes/:id", requireSession, (req, res) => {
  try {
    messageFor(req, req.params.id);
    res.json(store.deleteMessage(req.params.id));
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/mensajes/:id/respuesta", requireSession, (req, res) => {
  try {
    const message = messageFor(req, req.params.id);
    const account = accountFor(req, message.cuentaId);
    const respuesta = generateReply(account, message);
    const saved = store.saveReply(message.id, respuesta);
    res.json({
      message: saved.message,
      revision: auditReply(saved.account, saved.message, respuesta),
    });
  } catch (error) {
    fail(res, error);
  }
});

app.use(express.static(path.join(__dirname, "public")));

export default app;

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT) || 4317;
  const host = process.env.HOST || "0.0.0.0";
  app.listen(port, host, () => {
    console.log(`Jokma Pulse en http://127.0.0.1:${port}`);
  });
}
