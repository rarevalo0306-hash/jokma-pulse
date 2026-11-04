import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStore } from "./store.js";
import {
  PULSE_APP_ID,
  beginLogin,
  completeLogin,
  readInstagramEvents,
  settingsWithInstagram,
  verifySignature,
  webhookChallenge,
} from "./instagram.js";

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jokma-instagram-"));
  return createStore(path.join(dir, "pulse.json"));
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

test("el enlace de Instagram usa la app de Pulse y no lleva el secreto", () => {
  const now = 1_700_000_000_000;
  const started = beginLogin(
    {
      id: "co-lumen",
      nombre: "Cafetería Lumen",
      ajustes: { meta_app_secret: "secreto-de-prueba" },
    },
    "https://pulse.jokma.app",
    now,
  );
  const url = new URL(started.url);
  assert.equal(url.searchParams.get("client_id"), PULSE_APP_ID);
  assert.equal(url.searchParams.get("redirect_uri"), "https://pulse.jokma.app/api/instagram/callback");
  assert.match(url.searchParams.get("scope"), /instagram_business_manage_messages/);
  assert.match(url.searchParams.get("scope"), /instagram_business_manage_comments/);
  assert.equal(started.url.includes("secreto-de-prueba"), false);
  assert.equal(beginLogin({ id: "co-lumen", nombre: "Cafetería Lumen" }, "https://pulse.jokma.app").motivo, "sin_app");
  assert.equal(webhookChallenge({ "hub.mode": "subscribe", "hub.verify_token": "jokma-pulse-instagram", "hub.challenge": "reto-1" }), "reto-1");
  assert.equal(webhookChallenge({ "hub.mode": "subscribe", "hub.verify_token": "otro", "hub.challenge": "reto-1" }), null);
});

test("el canje guarda la cuenta de Instagram y no toca Facebook ni el correo", async () => {
  const store = tempStore();
  store.updateSettings("co-lumen", {
    organization: "Cafetería Lumen",
    meta_app_id: PULSE_APP_ID,
    meta_app_secret: "secreto-de-prueba",
    facebook_page_id: "999",
    facebook_page_token: "token-pagina",
    n8n_webhook_url: "https://n8n.example/webhook/demo",
  });
  const account = await completeLogin({
    code: "codigo-de-prueba",
    appId: PULSE_APP_ID,
    appSecret: "secreto-de-prueba",
    origin: "https://pulse.jokma.app",
    organization: "Cafetería Lumen",
    fetchImpl: async (target, options) => {
      assert.equal(String(target).includes("secreto-de-prueba"), false);
      if (String(options.body || "").includes("subscribed_fields")) return jsonResponse({ success: true });
      if (String(options.body || "").includes("fb_exchange_token")) return jsonResponse({ access_token: "user-largo" });
      if (String(target).includes("/me/accounts")) {
        return jsonResponse({
          data: [
            { id: "111", name: "Otra", access_token: "token-otra" },
            {
              id: "222",
              name: "Cafetería Lumen",
              access_token: "token-ig-de-prueba",
              instagram_business_account: { id: "1789001", username: "cafelumen" },
            },
          ],
        });
      }
      return jsonResponse({ access_token: "user-corto" });
    },
  });
  assert.equal(account.igUserId, "1789001");
  assert.equal(account.username, "cafelumen");
  const company = store.getState().companies.find((item) => item.id === "co-lumen");
  const saved = store.updateSettings("co-lumen", settingsWithInstagram(company, account));
  assert.equal(saved.ajustes.instagram_user_id, "1789001");
  assert.equal(saved.ajustes.instagram_access_token, "token-ig-de-prueba");
  assert.equal(saved.ajustes.meta_app_id, PULSE_APP_ID);
  assert.equal(saved.ajustes.facebook_page_id, "999");
  assert.equal(saved.ajustes.facebook_page_token, "token-pagina");
  assert.equal(saved.ajustes.n8n_webhook_url, "https://n8n.example/webhook/demo");
  assert.equal(saved.ajustes.x_api_key, "");
});

test("un DM y un comentario entran en la empresa de esa cuenta y no se duplican", () => {
  const store = tempStore();
  store.updateSettings("co-lumen", {
    organization: "Cafetería Lumen",
    instagram_user_id: "1789001",
  });
  const events = readInstagramEvents({
    object: "instagram",
    entry: [
      {
        id: "1789001",
        messaging: [
          { sender: { id: "1789001" }, message: { mid: "eco", text: "eco", is_echo: true } },
          { sender: { id: "555" }, recipient: { id: "1789001" }, message: { mid: "mid.1", text: "¿Abren hoy?" } },
        ],
        changes: [
          { field: "comments", value: { id: "c.9", text: "Me encantó", from: { id: "777", username: "sofia" } } },
          { field: "comments", value: { id: "propia", text: "gracias", from: { id: "1789001", username: "cafelumen" } } },
        ],
      },
    ],
  });
  assert.equal(events.length, 2);
  const first = store.recordInstagramMessage(events[0]);
  const again = store.recordInstagramMessage(events[0]);
  const comment = store.recordInstagramMessage(events[1]);
  assert.equal(first.id, again.id);
  assert.equal(first.canal, "instagram_dm");
  assert.equal(first.nombreCliente, "555");
  assert.equal(first.cuentaId, "ac-lumen-ig-dm");
  assert.equal(comment.canal, "instagram_comment");
  assert.equal(comment.nombreCliente, "sofia");
  assert.equal(comment.cuentaId, "ac-lumen-ig-comment");
  const other = store.recordInstagramMessage({ ...events[0], igUserId: "otra-cuenta" });
  assert.equal(other, null);
  const secret = "secreto-de-prueba";
  const raw = Buffer.from("{\"ok\":true}");
  const header = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  assert.equal(verifySignature(raw, header, secret), true);
  assert.equal(verifySignature(raw, header, "otro"), false);
});

test("el webhook público acepta la verificación y un mensaje firmado", async () => {
  process.env.VERCEL = "1";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jokma-instagram-http-"));
  process.env.PULSE_DATA = path.join(dir, "pulse.json");
  const { default: app } = await import(`../server.js?instagram=${Date.now()}`);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const bad = await fetch(`${base}/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=no&hub.challenge=x`);
    assert.equal(bad.status, 403);
    const ok = await fetch(`${base}/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=jokma-pulse-instagram&hub.challenge=reto-live`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "reto-live");
    const login = await fetch(`${base}/api/sesion`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ usuario: "lumen", clave: "lumen123" }),
    });
    const cookie = (login.headers.getSetCookie?.() || []).map((item) => item.split(";")[0]).join("; ");
    const secret = "secreto-de-prueba";
    const saved = await fetch(`${base}/api/empresas/co-lumen/ajustes`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        organization: "Cafetería Lumen",
        meta_app_id: PULSE_APP_ID,
        meta_app_secret: secret,
        instagram_user_id: "1789001",
      }),
    });
    assert.equal(saved.status, 200);
    const payload = JSON.stringify({
      object: "instagram",
      entry: [
        {
          id: "1789001",
          messaging: [{ sender: { id: "555" }, message: { mid: "mid.http", text: "Hola desde Instagram" } }],
        },
      ],
    });
    const header = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
    const unsigned = await fetch(`${base}/api/instagram/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    assert.equal(unsigned.status, 403);
    const posted = await fetch(`${base}/api/instagram/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": header },
      body: payload,
    });
    assert.equal(posted.status, 200);
    const state = await (await fetch(`${base}/api/estado`, { headers: { cookie } })).json();
    const message = state.messages.find((item) => item.texto === "Hola desde Instagram");
    assert.equal(message.canal, "instagram_dm");
    assert.equal(message.nombreCliente, "555");
    assert.equal(state.companies[0].ajustes.instagram_access_token, "");
    assert.equal(state.companies[0].ajustes.meta_app_secret, secret);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
