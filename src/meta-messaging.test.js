import assert from "node:assert/strict";
import test from "node:test";
import { readFacebookEvents, sendMetaMessage } from "./meta-messaging.js";

test("el webhook de Facebook normaliza mensajes y descarta ecos", () => {
  const events = readFacebookEvents({
    object: "page",
    entry: [{
      id: "page-1",
      messaging: [
        { sender: { id: "42" }, message: { mid: "m.1", text: "Hola" } },
        { sender: { id: "page-1" }, message: { mid: "m.2", text: "Eco", is_echo: true } },
      ],
    }],
  });
  assert.deepEqual(events, [{ pageId: "page-1", senderId: "42", displayName: "42", text: "Hola", externalId: "msg-fb-m.1" }]);
});

test("Meta envía una respuesta sin poner el token en el cuerpo", async () => {
  let call;
  const result = await sendMetaMessage(
    { ajustes: { facebook_page_token: "token-prueba" } },
    { canal: "facebook_messenger", direccionCliente: "42", borrador: "Con gusto" },
    async (url, options) => {
      call = { url, options };
      return { ok: true, async json() { return { message_id: "mid-3" }; } };
    },
  );
  assert.match(call.url, /^https:\/\/graph\.facebook\.com\/v27\.0\/me\/messages/);
  assert.equal(call.options.body.includes("token-prueba"), false);
  assert.deepEqual(JSON.parse(call.options.body), { recipient: { id: "42" }, message: { text: "Con gusto" } });
  assert.deepEqual(result, { providerMessageId: "mid-3" });
});
