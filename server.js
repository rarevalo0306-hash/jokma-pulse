import path from "node:path";
import express from "express";
import { fileURLToPath } from "node:url";
import { assertSessionConfiguration, clearSessionCookie, publicCompany, readSessionCookie, sessionCookie } from "./src/auth.js";
import { auditReply, generateReply } from "./src/replies.js";
import { createStore } from "./src/store.js";
import { createSupabaseAdmin, createSupabaseAuthClient, supabaseStoreEnabled } from "./src/supabase-admin.js";
import { createSupabaseStore } from "./src/supabase-store.js";
import { createCredentialStore } from "./src/credentials.js";
import { createRegistrationService, registrationEnabled } from "./src/registration.js";
import { createAccountSecurity } from "./src/account-security.js";
import { createTeamService } from "./src/team.js";
import { sendEmailReply, syncEmailInbox } from "./src/email.js";
import { listGoogleReviews, replyGoogleReview } from "./src/google-reviews.js";
import { listXMessages, sendXMessage } from "./src/x.js";
import { readFacebookEvents, sendMetaMessage } from "./src/meta-messaging.js";
import { beginLogin, callbackMotivo, completeLogin, readState, requestOrigin, settingsWithPage } from "./src/facebook.js";
import {
  PULSE_APP_ID,
  acceptedSignature,
  appCredentials,
  beginLogin as beginInstagramLogin,
  completeLogin as completeInstagramLogin,
  readState as readInstagramState,
  readInstagramEvents,
  settingsWithInstagram,
  webhookChallenge,
} from "./src/instagram.js";
import { CONNECTIONS, MODELS, PARAMETERS } from "./src/settings.js";
import { AGENT_TYPE, CHANNEL_LABELS, CHANNELS, TONE_BY_CHANNEL } from "./src/tones.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
assertSessionConfiguration();
const dataPath =
  process.env.PULSE_DATA ||
  (process.env.VERCEL
    ? path.join("/tmp", "jokma-pulse", "pulse.json")
    : path.join(__dirname, "data", "pulse.json"));
const jsonStore = createStore(dataPath);
const usingSupabase = supabaseStoreEnabled();
const credentialStore = usingSupabase ? createCredentialStore() : null;
const supabaseAdmin = usingSupabase ? createSupabaseAdmin() : null;
const store = usingSupabase
  ? createSupabaseStore(supabaseAdmin, jsonStore, {
      createAuthClient: () => createSupabaseAuthClient(),
      credentialStore,
    })
  : jsonStore;
const allowRegistration = registrationEnabled();
const emailRecoveryEnabled = usingSupabase && String(process.env.PULSE_EMAIL_RECOVERY_ENABLED || "").toLowerCase() === "true";
const registration = allowRegistration ? createRegistrationService({ admin: supabaseAdmin }) : null;
const accountSecurity = usingSupabase
  ? createAccountSecurity({
      admin: supabaseAdmin,
      authenticate: (username, password) => store.authenticate(username, password),
      createAuthClient: () => createSupabaseAuthClient(),
    })
  : null;
const team = usingSupabase ? createTeamService({ admin: supabaseAdmin }) : null;
const app = express();
const FACEBOOK_VERIFY_TOKEN = process.env.PULSE_FACEBOOK_VERIFY_TOKEN || "jokma-pulse-facebook";

app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use(
  express.json({
    limit: "100kb",
    verify(req, _res, buf) {
      req.rawBody = buf;
    },
  }),
);

function routeLimiter({ attempts, windowMs }) {
  const visits = new Map();
  return (req, res, next) => {
    const client = String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.ip || "local").split(",")[0].trim();
    const now = Date.now();
    const current = visits.get(client);
    const record = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
    record.count += 1;
    visits.set(client, record);
    if (record.count > attempts) {
      res.setHeader("Retry-After", String(Math.ceil((record.resetAt - now) / 1000)));
      res.status(429).json({ error: "Demasiados intentos. Espera unos minutos antes de volver a probar." });
      return;
    }
    next();
  };
}

const limitLogin = routeLimiter({ attempts: 20, windowMs: 15 * 60 * 1000 });
const limitRegistration = routeLimiter({ attempts: 5, windowMs: 60 * 60 * 1000 });
const limitRecovery = routeLimiter({ attempts: 5, windowMs: 60 * 60 * 1000 });

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

async function sessionCompany(req) {
  const session = readSessionCookie(req.headers.cookie);
  if (!session) return null;
  return await store.sessionAccess(session.userId, session.companyId);
}

async function requireSession(req, res, next) {
  try {
    const access = await sessionCompany(req);
    if (!access) {
      res.status(401).json({ error: "Inicia sesión para ver tu empresa." });
      return;
    }
    req.usuario = access.user;
    req.empresa = access.company;
    next();
  } catch (error) {
    fail(res, error);
  }
}

function forbidOther(req, empresaId) {
  if (req.empresa.id !== empresaId) {
    throw Object.assign(new Error("Esa empresa no está en tu sesión."), { status: 403 });
  }
}

async function accountFor(req, accountId) {
  const account = (await store.getState()).accounts.find((item) => item.id === accountId);
  if (!account || account.empresaId !== req.empresa.id) {
    throw Object.assign(new Error("Esa cuenta no está en tu sesión."), { status: 404 });
  }
  return account;
}

async function messageFor(req, messageId) {
  const message = (await store.getState()).messages.find((item) => item.id === messageId);
  if (!message || message.empresaId !== req.empresa.id) {
    throw Object.assign(new Error("Ese mensaje no está en tu sesión."), { status: 404 });
  }
  return message;
}

app.get("/api/salud", (_req, res) => {
  res.json({ ok: true, persistencia: store.backend || "json" });
});

app.get("/api/configuracion-publica", (_req, res) => {
  res.json({
    registroHabilitado: allowRegistration,
    codigoInvitacionRequerido: Boolean(process.env.PULSE_SIGNUP_INVITE),
    recuperacionCorreoHabilitada: emailRecoveryEnabled,
  });
});

app.post("/api/registro", limitRegistration, async (req, res) => {
  if (!registration) {
    res.status(404).json({ error: "El registro no está habilitado en este entorno." });
    return;
  }
  try {
    const created = await registration.register(req.body || {});
    res.setHeader("Set-Cookie", sessionCookie(created.user.id, created.company.id));
    res.status(201).json({ usuario: created.user, organizacion: created.organization, empresa: created.company });
  } catch (error) {
    fail(res, error);
  }
});

app.get("/api/invitaciones/vista", async (req, res) => {
  try {
    if (!team) throw Object.assign(new Error("Las invitaciones necesitan Supabase local."), { status: 503 });
    res.json(await team.preview(req.query?.token));
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/registro-invitado", limitRegistration, async (req, res) => {
  try {
    if (!team) throw Object.assign(new Error("Las invitaciones necesitan Supabase local."), { status: 503 });
    const created = await team.registerInvited(req.body || {});
    res.setHeader("Set-Cookie", sessionCookie(created.user.id, created.company.id));
    res.status(201).json({ usuario: created.user, organizacion: created.organization, empresa: created.company });
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/cuenta/recuperar", limitRecovery, async (req, res) => {
  try {
    if (!emailRecoveryEnabled || !accountSecurity) {
      throw Object.assign(new Error("La recuperación por correo todavía no está disponible."), { status: 503 });
    }
    const origin = requestOrigin(req.headers.host, {
      vercel: Boolean(process.env.VERCEL),
      proto: req.headers["x-forwarded-proto"] || req.protocol,
    });
    await accountSecurity.requestPasswordReset(req.body || {}, `${origin}/?recuperar=1`);
    res.json({ ok: true, mensaje: "Si la cuenta existe, recibirás un enlace para elegir una clave nueva." });
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/cuenta/restablecer", limitRecovery, async (req, res) => {
  try {
    if (!emailRecoveryEnabled || !accountSecurity) {
      throw Object.assign(new Error("La recuperación por correo todavía no está disponible."), { status: 503 });
    }
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.json(await accountSecurity.resetPassword(req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/sesion", limitLogin, async (req, res) => {
  try {
    const access = await store.authenticate(req.body?.usuario, req.body?.clave);
    if (!access) {
      res.status(401).json({ error: "Usuario o clave incorrectos." });
      return;
    }
    res.setHeader("Set-Cookie", sessionCookie(access.user.id, access.companyId));
    res.json({ usuario: access.user, empresaId: access.companyId, empresas: access.companies });
  } catch (error) {
    fail(res, error);
  }
});

app.delete("/api/sesion", (_req, res) => {
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.json({ ok: true });
});

app.get("/api/sesion", requireSession, (req, res) => {
  res.json({ usuario: req.usuario, empresa: publicCompany(req.empresa) });
});

app.get("/api/estado", requireSession, async (req, res) => {
  try {
    res.json({ ...(await store.scopedState(req.usuario.id, req.empresa.id)), ...meta() });
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/sesion/empresa", requireSession, async (req, res) => {
  try {
    const companyId = String(req.body?.empresaId || "");
    const access = await store.sessionAccess(req.usuario.id, companyId);
    if (!access) {
      res.status(403).json({ error: "No tienes acceso a esa empresa." });
      return;
    }
    res.setHeader("Set-Cookie", sessionCookie(req.usuario.id, companyId));
    res.json({ ok: true, empresa: publicCompany(access.company) });
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/organizaciones", requireSession, async (req, res) => {
  try {
    if (!store.createOrganization) throw Object.assign(new Error("Esta función necesita Supabase local."), { status: 503 });
    const created = await store.createOrganization(req.usuario.id, req.body || {});
    res.setHeader("Set-Cookie", sessionCookie(req.usuario.id, created.company.id));
    res.status(201).json(created);
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/organizaciones/:id/empresas", requireSession, async (req, res) => {
  try {
    const company = await store.createCompany({
      ...(req.body || {}),
      organizacionId: req.params.id,
      usuarioId: req.usuario.id,
    });
    res.setHeader("Set-Cookie", sessionCookie(req.usuario.id, company.id));
    res.status(201).json(company);
  } catch (error) {
    fail(res, error);
  }
});

app.get("/api/organizaciones/:id/equipo", requireSession, async (req, res) => {
  try {
    if (!team) throw Object.assign(new Error("La administración de equipo necesita Supabase local."), { status: 503 });
    res.json(await team.list(req.params.id, req.usuario.id));
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/organizaciones/:id/invitaciones", requireSession, async (req, res) => {
  try {
    if (!team) throw Object.assign(new Error("La administración de equipo necesita Supabase local."), { status: 503 });
    const invitation = await team.createInvitation(req.params.id, req.usuario.id, req.body || {});
    const origin = requestOrigin(req.headers.host, {
      vercel: Boolean(process.env.VERCEL),
      proto: req.headers["x-forwarded-proto"] || req.protocol,
    });
    const invitationUrl = `${origin}/?invitacion=${encodeURIComponent(invitation.token)}`;
    res.status(201).json({ id: invitation.id, venceEn: invitation.venceEn, enlace: invitationUrl });
  } catch (error) {
    fail(res, error);
  }
});

app.delete("/api/organizaciones/:id/invitaciones/:invitationId", requireSession, async (req, res) => {
  try {
    if (!team) throw Object.assign(new Error("La administración de equipo necesita Supabase local."), { status: 503 });
    res.json(await team.revokeInvitation(req.params.id, req.params.invitationId, req.usuario.id));
  } catch (error) {
    fail(res, error);
  }
});

app.put("/api/organizaciones/:id/miembros/:userId", requireSession, async (req, res) => {
  try {
    if (!team) throw Object.assign(new Error("La administración de equipo necesita Supabase local."), { status: 503 });
    res.json(await team.updateMember(req.params.id, req.usuario.id, req.params.userId, req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/organizaciones/:id/transferir", requireSession, async (req, res) => {
  try {
    if (!team) throw Object.assign(new Error("La administración de equipo necesita Supabase local."), { status: 503 });
    res.json(await team.transfer(req.params.id, req.usuario.id, req.body?.usuarioId));
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/invitaciones/aceptar", requireSession, async (req, res) => {
  try {
    if (!team) throw Object.assign(new Error("Las invitaciones necesitan Supabase local."), { status: 503 });
    const accepted = await team.accept(req.usuario.id, req.body?.invitacion);
    res.setHeader("Set-Cookie", sessionCookie(req.usuario.id, accepted.companyId));
    res.json({ ok: true, organizacionId: accepted.organizationId, empresaId: accepted.companyId });
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/cuenta/cambiar-clave", requireSession, limitLogin, async (req, res) => {
  try {
    if (!accountSecurity) throw Object.assign(new Error("Esta función necesita Supabase Auth."), { status: 503 });
    const result = await accountSecurity.changePassword(req.usuario, req.body || {});
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.json(result);
  } catch (error) {
    fail(res, error);
  }
});

app.put("/api/empresas/:id/ajustes", requireSession, async (req, res) => {
  try {
    forbidOther(req, req.params.id);
    res.json(await store.updateSettings(req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

app.put("/api/empresas/:id", requireSession, async (req, res) => {
  try {
    forbidOther(req, req.params.id);
    res.json(publicCompany(await store.updateCompany(req.params.id, req.body || {})));
  } catch (error) {
    fail(res, error);
  }
});

app.delete("/api/empresas/:id", requireSession, async (req, res) => {
  try {
    forbidOther(req, req.params.id);
    const result = await store.deleteCompany(req.params.id);
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.json(result);
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/empresas/:id/cuentas", requireSession, async (req, res) => {
  try {
    forbidOther(req, req.params.id);
    res.status(201).json(await store.createAccount(req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

app.put("/api/cuentas/:id", requireSession, async (req, res) => {
  try {
    await accountFor(req, req.params.id);
    res.json(await store.updateAccount(req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

app.delete("/api/cuentas/:id", requireSession, async (req, res) => {
  try {
    await accountFor(req, req.params.id);
    res.json(await store.deleteAccount(req.params.id));
  } catch (error) {
    fail(res, error);
  }
});

function facebookOrigin(req) {
  const forwarded = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "http";
  return requestOrigin(forwarded, { vercel: Boolean(process.env.VERCEL), proto });
}

app.post("/api/mensajes", requireSession, async (req, res) => {
  try {
    await accountFor(req, req.body?.cuentaId);
    const message = await store.createMessage(req.body || {});
    res.status(201).json(message);
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/email/sincronizar", requireSession, async (req, res) => {
  try {
    const company = await store.getCompanyWithSecrets(req.empresa.id);
    const before = (await store.scopedState(req.usuario.id, req.empresa.id)).messages.length;
    const events = await syncEmailInbox({ company });
    for (const event of events) {
      await store.recordEmailMessage(event);
    }
    const imported = (await store.scopedState(req.usuario.id, req.empresa.id)).messages.length - before;
    res.json({ ok: true, recibidos: events.length, importados: imported });
  } catch (error) {
    if (!error.status) error.status = 502;
    fail(res, error);
  }
});

app.post("/api/google-reviews/sincronizar", requireSession, async (req, res) => {
  try {
    const company = await store.getCompanyWithSecrets(req.empresa.id);
    const before = (await store.scopedState(req.usuario.id, req.empresa.id)).messages.length;
    const reviews = await listGoogleReviews(company);
    for (const review of reviews) await store.recordGoogleReview(req.empresa.id, review);
    const imported = (await store.scopedState(req.usuario.id, req.empresa.id)).messages.length - before;
    res.json({ ok: true, recibidos: reviews.length, importados: imported });
  } catch (error) {
    if (!error.status) error.status = 502;
    fail(res, error);
  }
});

app.post("/api/x/sincronizar", requireSession, async (req, res) => {
  try {
    const company = await store.getCompanyWithSecrets(req.empresa.id);
    const before = (await store.scopedState(req.usuario.id, req.empresa.id)).messages.length;
    const messages = await listXMessages(company);
    for (const message of messages) await store.recordXMessage(req.empresa.id, message);
    const imported = (await store.scopedState(req.usuario.id, req.empresa.id)).messages.length - before;
    res.json({ ok: true, recibidos: messages.length, importados: imported });
  } catch (error) {
    if (!error.status) error.status = 502;
    fail(res, error);
  }
});

function facebookRedirect(res, motivo) {
  const target = motivo ? `/?facebook=error&motivo=${encodeURIComponent(motivo)}` : "/?facebook=ok";
  res.redirect(302, target);
}

app.get("/api/facebook/iniciar", async (req, res) => {
  const access = await sessionCompany(req);
  const company = access ? await store.getCompanyWithSecrets(access.company.id) : null;
  if (!company) {
    res.redirect(302, "/");
    return;
  }
  const started = beginLogin(company, facebookOrigin(req));
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
  const company = await store.getCompanyWithSecrets(companyId);
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
      origin: facebookOrigin(req),
      organization: company.ajustes?.organization || company.nombre,
    });
    await store.updateSettings(company.id, settingsWithPage(company, page));
    facebookRedirect(res);
  } catch (error) {
    facebookRedirect(res, error.motivo === "sin_pagina" ? "sin_pagina" : "facebook");
  }
});

app.get("/api/facebook/webhook", (req, res) => {
  const challenge = webhookChallenge(req.query, FACEBOOK_VERIFY_TOKEN);
  if (!challenge) {
    res.sendStatus(403);
    return;
  }
  res.type("text/plain").send(challenge);
});

app.post("/api/facebook/webhook", async (req, res) => {
  const companies = await store.getCompaniesWithSecrets();
  if (!acceptedSignature(companies, req.rawBody, req.get("x-hub-signature-256"))) {
    res.sendStatus(403);
    return;
  }
  for (const event of readFacebookEvents(req.body)) await store.recordFacebookMessage(event);
  res.sendStatus(200);
});

function instagramRedirect(res, motivo) {
  const target = motivo ? `/?instagram=error&motivo=${encodeURIComponent(motivo)}` : "/?instagram=ok";
  res.redirect(302, target);
}

app.get("/api/instagram/iniciar", async (req, res) => {
  const access = await sessionCompany(req);
  const company = access ? await store.getCompanyWithSecrets(access.company.id) : null;
  if (!company) {
    res.redirect(302, "/");
    return;
  }
  const started = beginInstagramLogin(company, facebookOrigin(req));
  if (!started.url) {
    instagramRedirect(res, started.motivo || "sin_app");
    return;
  }
  res.redirect(302, started.url);
});

app.get("/api/instagram/callback", async (req, res) => {
  const oauthError = typeof req.query.error === "string" ? req.query.error : "";
  if (oauthError) {
    instagramRedirect(res, oauthError === "access_denied" ? "denegado" : "instagram");
    return;
  }
  const companyId = readInstagramState(typeof req.query.state === "string" ? req.query.state : "");
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!companyId || !code) {
    instagramRedirect(res, "instagram");
    return;
  }
  const company = await store.getCompanyWithSecrets(companyId);
  const creds = appCredentials(company);
  if (!company || !creds.secret) {
    instagramRedirect(res, "sin_app");
    return;
  }
  const appId = creds.appId || PULSE_APP_ID;
  const appSecret = creds.secret;
  try {
    const account = await completeInstagramLogin({
      code,
      appId,
      appSecret,
      origin: facebookOrigin(req),
      organization: company.ajustes?.organization || company.nombre,
    });
    await store.updateSettings(company.id, settingsWithInstagram(company, account));
    instagramRedirect(res);
  } catch (error) {
    instagramRedirect(res, error.motivo === "sin_instagram" ? "sin_instagram" : "instagram");
  }
});

app.get("/api/instagram/webhook", (req, res) => {
  const challenge = webhookChallenge(req.query);
  if (!challenge) {
    res.sendStatus(403);
    return;
  }
  res.type("text/plain").send(challenge);
});

app.post("/api/instagram/webhook", async (req, res) => {
  const companies = await store.getCompaniesWithSecrets();
  if (!acceptedSignature(companies, req.rawBody, req.get("x-hub-signature-256"))) {
    res.sendStatus(403);
    return;
  }
  for (const event of readInstagramEvents(req.body)) {
    await store.recordInstagramMessage(event);
  }
  res.sendStatus(200);
});

app.delete("/api/mensajes/:id", requireSession, async (req, res) => {
  try {
    await messageFor(req, req.params.id);
    res.json(await store.deleteMessage(req.params.id));
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/mensajes/:id/respuesta", requireSession, async (req, res) => {
  try {
    const message = await messageFor(req, req.params.id);
    const account = await accountFor(req, message.cuentaId);
    const respuesta = generateReply(account, message);
    const saved = await store.saveReply(message.id, respuesta);
    res.json({
      message: saved.message,
      revision: auditReply(saved.account, saved.message, respuesta),
    });
  } catch (error) {
    fail(res, error);
  }
});

app.put("/api/mensajes/:id/borrador", requireSession, async (req, res) => {
  try {
    await messageFor(req, req.params.id);
    res.json(await store.saveDraft(req.params.id, req.body?.borrador));
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/mensajes/:id/aprobar", requireSession, async (req, res) => {
  try {
    await messageFor(req, req.params.id);
    res.json(await store.approveDraft(req.params.id, req.usuario.id));
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/mensajes/:id/enviar", requireSession, async (req, res) => {
  let message;
  try {
    message = await messageFor(req, req.params.id);
    const account = await accountFor(req, message.cuentaId);
    if (!["email", "google_reviews", "x", "facebook_messenger", "instagram_dm"].includes(account.canal)) {
      throw Object.assign(new Error("El envío directo de este canal todavía no está disponible."), { status: 409 });
    }
    if (!["aprobado", "error"].includes(message.estadoRespuesta)) {
      throw Object.assign(new Error("Aprueba el borrador antes de enviarlo."), { status: 409 });
    }
    const company = await store.getCompanyWithSecrets(req.empresa.id);
    await store.markDelivery(message.id, "sending");
    let delivery;
    if (account.canal === "email") delivery = await sendEmailReply({ company, message });
    else if (account.canal === "google_reviews") delivery = await replyGoogleReview(company, message);
    else if (account.canal === "x") delivery = await sendXMessage(company, message);
    else delivery = await sendMetaMessage(company, message);
    res.json(await store.markDelivery(message.id, "sent", delivery));
  } catch (error) {
    if (message) {
      await store.markDelivery(message.id, "error", { error: "El proveedor de correo rechazó el envío." }).catch(() => {});
    }
    if (!error.status) error.status = 502;
    fail(res, error);
  }
});

app.put("/api/mensajes/:id/conversacion", requireSession, async (req, res) => {
  try {
    await messageFor(req, req.params.id);
    res.json(await store.updateConversation(req.params.id, req.body || {}, req.usuario.id));
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/mensajes/:id/notas", requireSession, async (req, res) => {
  try {
    await messageFor(req, req.params.id);
    res.status(201).json(await store.addConversationNote(req.params.id, req.body?.texto, req.usuario.id));
  } catch (error) {
    fail(res, error);
  }
});

const legalPages = {
  "/privacidad": "privacidad.html",
  "/eliminar-datos": "eliminar-datos.html",
  "/terminos": "terminos.html",
};
for (const [route, file] of Object.entries(legalPages)) {
  app.get(route, (_req, res) => {
    res.type("html").sendFile(path.join(__dirname, "public", file));
  });
}

app.use(express.static(path.join(__dirname, "public")));

export default app;

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT) || 4317;
  const host = process.env.HOST || "0.0.0.0";
  app.listen(port, host, () => {
    console.log(`Jokma Pulse en http://127.0.0.1:${port}`);
  });
}
