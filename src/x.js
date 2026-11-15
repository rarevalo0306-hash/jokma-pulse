import { createHmac, randomBytes } from "node:crypto";
import { normalizeSettings } from "./settings.js";

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function encode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function credentials(company) {
  const settings = normalizeSettings(company?.ajustes, company);
  const keys = ["x_api_key", "x_api_secret", "x_access_token", "x_access_token_secret"];
  if (keys.some((key) => !String(settings[key] || "").trim())) throw fail(409, "Completa la conexión de X.");
  return settings;
}

export function oauthHeader(method, rawUrl, settings, { nonce, timestamp } = {}) {
  const url = new URL(rawUrl);
  const oauth = {
    oauth_consumer_key: settings.x_api_key,
    oauth_nonce: nonce || randomBytes(18).toString("base64url"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp || Math.floor(Date.now() / 1000)),
    oauth_token: settings.x_access_token,
    oauth_version: "1.0",
  };
  const params = [...url.searchParams.entries(), ...Object.entries(oauth)]
    .map(([key, value]) => [encode(key), encode(value)])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
  const base = [method.toUpperCase(), encode(baseUrl), encode(params.map(([key, value]) => `${key}=${value}`).join("&"))].join("&");
  const signingKey = `${encode(settings.x_api_secret)}&${encode(settings.x_access_token_secret)}`;
  oauth.oauth_signature = createHmac("sha1", signingKey).update(base).digest("base64");
  return `OAuth ${Object.entries(oauth).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${encode(key)}="${encode(value)}"`).join(", ")}`;
}

async function request(company, method, url, body, fetchImpl) {
  const settings = credentials(company);
  const response = await fetchImpl(url, {
    method,
    headers: {
      authorization: oauthHeader(method, url, settings),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  let payload;
  try { payload = await response.json(); } catch { throw fail(502, "X devolvió una respuesta inválida."); }
  if (!response.ok) throw fail(502, "X rechazó la solicitud.");
  return { payload, settings };
}

export async function listXMessages(company, fetchImpl = fetch) {
  const url = "https://api.x.com/2/dm_events?event_types=MessageCreate&dm_event.fields=id,text,created_at,dm_conversation_id&expansions=sender_id&user.fields=id,name,username&max_results=100";
  const { payload, settings } = await request(company, "GET", url, null, fetchImpl);
  const users = new Map((payload.includes?.users || []).map((user) => [String(user.id), user]));
  return (Array.isArray(payload.data) ? payload.data : [])
    .filter((event) => event?.event_type === "MessageCreate" && event?.text && String(event.sender_id) !== String(settings.x_user_id || ""))
    .map((event) => {
      const user = users.get(String(event.sender_id));
      return {
        externalId: String(event.id),
        participantId: String(event.sender_id || ""),
        displayName: String(user?.name || user?.username || event.sender_id || "Cliente de X").slice(0, 160),
        text: String(event.text).slice(0, 4000),
      };
    })
    .filter((event) => /^\d{1,19}$/.test(event.participantId));
}

export async function sendXMessage(company, message, fetchImpl = fetch) {
  const participantId = String(message?.direccionCliente || "").trim();
  const text = String(message?.borrador || message?.respuesta || "").trim();
  if (!/^\d{1,19}$/.test(participantId) || !text) throw fail(409, "El mensaje de X no conserva el destinatario o la respuesta aprobada.");
  const url = `https://api.x.com/2/dm_conversations/with/${participantId}/messages`;
  const { payload } = await request(company, "POST", url, { text }, fetchImpl);
  return { providerMessageId: String(payload.data?.dm_event_id || payload.data?.id || "") };
}
