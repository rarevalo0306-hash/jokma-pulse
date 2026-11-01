import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acceptReply, assertWebhookUrl, deliverInbound, isBlockedAddress, messageToken } from "./n8n.js";
import { createStore } from "./store.js";

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jokma-n8n-"));
  return createStore(path.join(dir, "pulse.json"));
}

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("la dirección local o de metadatos no se usa como webhook", () => {
  assert.equal(isBlockedAddress("127.0.0.1"), true);
  assert.equal(isBlockedAddress("10.1.2.3"), true);
  assert.equal(isBlockedAddress("169.254.169.254"), true);
  assert.equal(isBlockedAddress("::ffff:127.0.0.1"), true);
  assert.equal(isBlockedAddress("93.184.216.34"), false);
});

test("Gmail se envía al webhook y la respuesta de n8n se guarda", async () => {
  const store = tempStore();
  store.updateSettings("co-lumen", {
    organization: "Cafetería Lumen",
    n8n_webhook_url: "https://n8n.example/webhook/demo",
    smtp_password: "no-enviar",
  });
  const message = store.createMessage({
    cuentaId: "ac-lumen-email",
    nombreCliente: "Ada",
    texto: "¿Abren el sábado?",
  });
  let posted;
  const company = store.getState().companies.find((item) => item.id === "co-lumen");
  const sent = await deliverInbound({
    company,
    message,
    origin: "https://jokma-pulse.vercel.app",
    lookupImpl: publicLookup,
    fetchImpl: async (url, options) => {
      posted = { url, body: JSON.parse(options.body), redirect: options.redirect };
      return { ok: true, status: 200 };
    },
  });
  assert.equal(sent.enviado, true);
  assert.equal(posted.url, "https://n8n.example/webhook/demo");
  assert.equal(posted.redirect, "manual");
  assert.equal(posted.body.red, "gmail");
  assert.equal(posted.body.canal, "email");
  assert.equal(posted.body.respuestaUrl, "https://jokma-pulse.vercel.app/api/n8n/respuesta");
  assert.equal(posted.body.token, messageToken("co-lumen", message.id));
  assert.equal(JSON.stringify(posted.body).includes("no-enviar"), false);

  const saved = acceptReply(store, {
    mensajeId: message.id,
    respuesta: "Sí, el sábado abrimos.",
    token: posted.body.token,
  });
  assert.equal(saved.message.respuesta, "Sí, el sábado abrimos.");
  assert.throws(
    () => acceptReply(store, { mensajeId: message.id, respuesta: "otra", token: "no" }),
    (error) => error.status === 401,
  );
});

test("sin webhook o sin ser Gmail no hay envío", async () => {
  const store = tempStore();
  const email = store.createMessage({
    cuentaId: "ac-lumen-email",
    nombreCliente: "Ada",
    texto: "Hola",
  });
  const review = store.createMessage({
    cuentaId: "ac-lumen-reviews",
    nombreCliente: "Ada",
    texto: "Muy rico",
    calificacion: 5,
  });
  let calls = 0;
  const company = store.getState().companies.find((item) => item.id === "co-lumen");
  const empty = await deliverInbound({
    company,
    message: email,
    origin: "https://jokma-pulse.vercel.app",
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200 };
    },
  });
  const other = await deliverInbound({
    company,
    message: review,
    origin: "https://jokma-pulse.vercel.app",
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200 };
    },
  });
  assert.equal(empty.motivo, "sin_webhook");
  assert.equal(other.motivo, "no_es_gmail");
  assert.equal(calls, 0);
  await assert.rejects(
    () => assertWebhookUrl("http://n8n.example/hook", publicLookup),
    (error) => error.status === 400,
  );
  await assert.rejects(
    () => assertWebhookUrl("https://127.0.0.1/hook", publicLookup),
    (error) => error.status === 400,
  );
});
