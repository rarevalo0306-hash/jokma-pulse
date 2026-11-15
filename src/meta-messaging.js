import { GRAPH_VERSION } from "./facebook.js";
import { normalizeSettings } from "./settings.js";

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function eventId(prefix, value) {
  const cleaned = String(value || "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 120);
  return cleaned ? `${prefix}${cleaned}` : "";
}

export function readFacebookEvents(body) {
  if (body?.object !== "page") return [];
  const events = [];
  for (const entry of Array.isArray(body.entry) ? body.entry : []) {
    const pageId = String(entry?.id || "");
    if (!pageId) continue;
    for (const item of Array.isArray(entry.messaging) ? entry.messaging : []) {
      if (item?.message?.is_echo) continue;
      const senderId = String(item?.sender?.id || "");
      const text = String(item?.message?.text || "").trim();
      if (!senderId || !text) continue;
      events.push({
        pageId,
        senderId,
        displayName: senderId,
        text,
        externalId: eventId("msg-fb-", item?.message?.mid),
      });
    }
  }
  return events;
}

export async function sendMetaMessage(company, message, fetchImpl = fetch) {
  const settings = normalizeSettings(company?.ajustes, company);
  const channel = String(message?.canal || "");
  const token = channel === "facebook_messenger" ? settings.facebook_page_token : settings.instagram_access_token;
  const recipientId = String(message?.direccionCliente || "").trim();
  const text = String(message?.borrador || message?.respuesta || "").trim();
  if (!token) throw fail(409, "La cuenta de Meta no conserva un token de envío.");
  if (!recipientId || !text) throw fail(409, "El mensaje no conserva el destinatario o la respuesta aprobada.");
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/me/messages`);
  url.searchParams.set("access_token", token);
  const response = await fetchImpl(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  let payload;
  try { payload = await response.json(); } catch { throw fail(502, "Meta devolvió una respuesta inválida."); }
  if (!response.ok || payload?.error) throw fail(502, "Meta rechazó el envío.");
  return { providerMessageId: String(payload.message_id || "") };
}
