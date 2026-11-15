import assert from "node:assert/strict";
import test from "node:test";
import { listXMessages, oauthHeader, sendXMessage } from "./x.js";

const settings = {
  x_api_key: "api-key",
  x_api_secret: "api-secret",
  x_access_token: "access-token",
  x_access_token_secret: "access-secret",
  x_user_id: "99",
};
const company = { nombre: "Lumen", ajustes: settings };

function response(payload) {
  return { ok: true, async json() { return payload; } };
}

test("la firma OAuth 1.0 de X es determinista y no expone secretos", () => {
  const header = oauthHeader("GET", "https://api.x.com/2/dm_events?max_results=100", settings, { nonce: "nonce-prueba", timestamp: 1700000000 });
  assert.match(header, /^OAuth /);
  assert.match(header, /oauth_consumer_key="api-key"/);
  assert.match(header, /oauth_signature=/);
  assert.equal(header.includes("api-secret"), false);
  assert.equal(header.includes("access-secret"), false);
});

test("X normaliza mensajes entrantes y excluye los propios", async () => {
  const events = await listXMessages(company, async (_url, options) => {
    assert.match(options.headers.authorization, /^OAuth /);
    return response({
      data: [
        { id: "1", event_type: "MessageCreate", sender_id: "42", text: "Necesito ayuda" },
        { id: "2", event_type: "MessageCreate", sender_id: "99", text: "Eco" },
      ],
      includes: { users: [{ id: "42", name: "Ada", username: "ada" }] },
    });
  });
  assert.deepEqual(events, [{ externalId: "1", participantId: "42", displayName: "Ada", text: "Necesito ayuda" }]);
});

test("X envía un DM al participante conservado", async () => {
  let call;
  const result = await sendXMessage(company, { direccionCliente: "42", borrador: "Con gusto", estadoRespuesta: "aprobado" }, async (url, options) => {
    call = { url, options };
    return response({ data: { dm_event_id: "dm-3" } });
  });
  assert.match(call.url, /\/with\/42\/messages$/);
  assert.deepEqual(JSON.parse(call.options.body), { text: "Con gusto" });
  assert.deepEqual(result, { providerMessageId: "dm-3" });
});
