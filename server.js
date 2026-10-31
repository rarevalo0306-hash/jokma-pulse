import path from "node:path";
import express from "express";
import { fileURLToPath } from "node:url";
import { auditReply, generateReply } from "./src/replies.js";
import { createStore } from "./src/store.js";
import { AGENT_TYPE, CHANNEL_LABELS, CHANNELS, TONE_BY_CHANNEL } from "./src/tones.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = process.env.PULSE_DATA || path.join(__dirname, "data", "pulse.json");
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
  };
}

app.get("/api/salud", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/estado", (_req, res) => {
  res.json({ ...store.getState(), ...meta() });
});

app.post("/api/empresas", (req, res) => {
  try {
    res.status(201).json(store.createCompany(req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

app.put("/api/empresas/:id", (req, res) => {
  try {
    res.json(store.updateCompany(req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

app.delete("/api/empresas/:id", (req, res) => {
  try {
    res.json(store.deleteCompany(req.params.id));
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/empresas/:id/cuentas", (req, res) => {
  try {
    res.status(201).json(store.createAccount(req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

app.put("/api/cuentas/:id", (req, res) => {
  try {
    res.json(store.updateAccount(req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

app.delete("/api/cuentas/:id", (req, res) => {
  try {
    res.json(store.deleteAccount(req.params.id));
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/mensajes", (req, res) => {
  try {
    res.status(201).json(store.createMessage(req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

app.delete("/api/mensajes/:id", (req, res) => {
  try {
    res.json(store.deleteMessage(req.params.id));
  } catch (error) {
    fail(res, error);
  }
});

app.post("/api/mensajes/:id/respuesta", (req, res) => {
  try {
    const state = store.getState();
    const message = state.messages.find((item) => item.id === req.params.id);
    if (!message) {
      res.status(404).json({ error: "No encontramos ese mensaje." });
      return;
    }
    const account = state.accounts.find((item) => item.id === message.cuentaId);
    if (!account) {
      res.status(404).json({ error: "La cuenta de este mensaje ya no existe." });
      return;
    }
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

const port = Number(process.env.PORT) || 4317;
const host = process.env.HOST || "0.0.0.0";
app.listen(port, host, () => {
  console.log(`Jokma Pulse en http://127.0.0.1:${port}`);
});
