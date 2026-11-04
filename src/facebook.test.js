import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  beginLogin,
  callbackMotivo,
  completeLogin,
  readState,
  requestOrigin,
  settingsWithPage,
} from "./facebook.js";
import { createStore } from "./store.js";

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jokma-facebook-"));
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

test("el enlace de Facebook no incluye el secreto y el estado vuelve a la empresa", () => {
  const now = 1_700_000_000_000;
  const started = beginLogin(
    {
      id: "co-lumen",
      nombre: "Cafetería Lumen",
      ajustes: { meta_app_id: "app-id-de-prueba", meta_app_secret: "secreto-de-prueba" },
    },
    "https://jokma-pulse.vercel.app",
    now,
  );
  const url = new URL(started.url);
  assert.equal(url.origin, "https://www.facebook.com");
  assert.equal(url.pathname, "/v21.0/dialog/oauth");
  assert.equal(url.searchParams.get("client_id"), "app-id-de-prueba");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://jokma-pulse.vercel.app/api/facebook/callback",
  );
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.match(url.searchParams.get("scope"), /pages_show_list/);
  assert.match(url.searchParams.get("scope"), /pages_messaging/);
  assert.equal(started.url.includes("secreto-de-prueba"), false);
  assert.equal(readState(url.searchParams.get("state"), now), "co-lumen");
  assert.equal(readState(url.searchParams.get("state"), now + 11 * 60 * 1000), null);
  assert.equal(readState(`${url.searchParams.get("state")}x`, now), null);
  assert.equal(beginLogin({ id: "co-lumen", nombre: "Cafetería Lumen" }, "https://jokma-pulse.vercel.app").motivo, "sin_app");
  assert.equal(callbackMotivo({ error: "access_denied" }), "denegado");
  assert.equal(callbackMotivo({ error: "server_error" }), "facebook");
  assert.equal(callbackMotivo({}), null);
  assert.equal(requestOrigin("pulse.jokma.app"), "https://pulse.jokma.app");
  assert.equal(requestOrigin("jokma-pulse.vercel.app"), "https://jokma-pulse.vercel.app");
  assert.equal(requestOrigin("Pulse.jokma.app:443"), "https://pulse.jokma.app");
  assert.equal(requestOrigin("evil.example", { vercel: true }), "https://jokma-pulse.vercel.app");
  assert.equal(requestOrigin("127.0.0.1:4317", { proto: "http" }), "http://127.0.0.1:4317");
  const pulse = beginLogin(
    {
      id: "co-lumen",
      nombre: "Cafetería Lumen",
      ajustes: { meta_app_id: "app-id-de-prueba", meta_app_secret: "secreto-de-prueba" },
    },
    "https://pulse.jokma.app",
    now,
  );
  assert.equal(
    new URL(pulse.url).searchParams.get("redirect_uri"),
    "https://pulse.jokma.app/api/facebook/callback",
  );
});

test("el canje guarda la página que coincide y conserva el resto de ajustes", async () => {
  const store = tempStore();
  store.updateSettings("co-lumen", {
    organization: "Cafetería Lumen",
    meta_app_id: "app-id-de-prueba",
    meta_app_secret: "secreto-de-prueba",
    n8n_webhook_url: "https://n8n.example/webhook/demo",
  });
  const calls = [];
  const page = await completeLogin({
    code: "codigo-de-prueba",
    appId: "app-id-de-prueba",
    appSecret: "secreto-de-prueba",
    origin: "https://jokma-pulse.vercel.app",
    organization: "Cafetería Lumen",
    fetchImpl: async (target, options) => {
      calls.push({ target, method: options.method, body: options.body || "", redirect: options.redirect });
      assert.equal(target.startsWith("https://graph.facebook.com/"), true);
      assert.equal(target.includes("secreto-de-prueba"), false);
      if (String(options.body || "").includes("fb_exchange_token")) {
        return jsonResponse({ access_token: "user-largo" });
      }
      if (target.includes("/me/accounts")) {
        assert.equal(target.includes("access_token=user-largo"), true);
        return jsonResponse({
          data: [
            { id: "111", name: "Otra", access_token: "token-otra" },
            { id: "222", name: "Cafetería Lumen", access_token: "token-pagina-de-prueba" },
          ],
        });
      }
      return jsonResponse({ access_token: "user-corto" });
    },
  });
  assert.equal(page.pageId, "222");
  assert.equal(page.pageToken, "token-pagina-de-prueba");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].redirect, "manual");
  assert.equal(String(calls[0].body).includes("secreto-de-prueba"), true);
  const company = store.getState().companies.find((item) => item.id === "co-lumen");
  const longToken = `${"p".repeat(800)}`;
  const saved = store.updateSettings("co-lumen", settingsWithPage(company, { ...page, pageToken: longToken }));
  assert.equal(saved.ajustes.facebook_page_id, "222");
  assert.equal(saved.ajustes.facebook_page_token, longToken);
  assert.equal(saved.ajustes.meta_app_id, "app-id-de-prueba");
  assert.equal(saved.ajustes.meta_app_secret, "secreto-de-prueba");
  assert.equal(saved.ajustes.n8n_webhook_url, "https://n8n.example/webhook/demo");
  assert.equal(saved.clave, undefined);
});

test("sin páginas o con una redirección no se guarda un token", async () => {
  await assert.rejects(
    () =>
      completeLogin({
        code: "codigo-de-prueba",
        appId: "app-id-de-prueba",
        appSecret: "secreto-de-prueba",
        origin: "https://jokma-pulse.vercel.app",
        organization: "Cafetería Lumen",
        fetchImpl: async (target, options) => {
          if (String(options.body || "").includes("fb_exchange_token")) {
            return jsonResponse({ access_token: "user-largo" });
          }
          if (target.includes("/me/accounts")) return jsonResponse({ data: [] });
          return jsonResponse({ access_token: "user-corto" });
        },
      }),
    (error) => error.motivo === "sin_pagina",
  );
  await assert.rejects(
    () =>
      completeLogin({
        code: "codigo-de-prueba",
        appId: "app-id-de-prueba",
        appSecret: "secreto-de-prueba",
        origin: "https://jokma-pulse.vercel.app",
        fetchImpl: async () => jsonResponse({}, 302),
      }),
    (error) => error.motivo === "facebook",
  );
  await assert.rejects(
    () =>
      completeLogin({
        code: "",
        appId: "app-id-de-prueba",
        appSecret: "secreto-de-prueba",
        origin: "https://jokma-pulse.vercel.app",
        fetchImpl: async () => {
          throw new Error("no debia llamar");
        },
      }),
    (error) => error.motivo === "facebook",
  );
});
