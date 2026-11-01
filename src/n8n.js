import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";

const SECRET = process.env.PULSE_N8N_SECRET || "jokma-pulse-demo-cookie";

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

export function messageToken(empresaId, mensajeId) {
  return createHmac("sha256", SECRET).update(`${empresaId}.${mensajeId}`).digest("base64url");
}

function sameToken(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export function isBlockedAddress(address) {
  const raw = String(address || "").toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = raw.startsWith("::ffff:") ? raw.slice(7) : raw;
  if (net.isIPv4(mapped)) {
    const [a, b] = mapped.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (raw === "::1" || raw === "::") return true;
  if (raw.startsWith("fc") || raw.startsWith("fd") || raw.startsWith("fe80")) return true;
  return false;
}

function blockedHost(hostname) {
  const host = String(hostname || "").replace(/\.$/, "").toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal" ||
    host === "metadata.google.com"
  );
}

export async function assertWebhookUrl(raw, lookupImpl = dnsLookup) {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    throw fail(400, "La URL del webhook no es válida.");
  }
  if (url.protocol !== "https:") throw fail(400, "El webhook de n8n tiene que usar https.");
  if (url.username || url.password) throw fail(400, "La URL del webhook no es válida.");
  if (blockedHost(url.hostname)) throw fail(400, "Esa URL de webhook no está permitida.");
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(literal)) {
    if (isBlockedAddress(literal)) throw fail(400, "Esa URL de webhook no está permitida.");
    return url.toString();
  }
  let records;
  try {
    records = await lookupImpl(url.hostname, { all: true, verbatim: true });
  } catch {
    throw fail(400, "No se pudo resolver el webhook de n8n.");
  }
  if (!records?.length || records.some((item) => isBlockedAddress(item.address))) {
    throw fail(400, "Esa URL de webhook no está permitida.");
  }
  return url.toString();
}

export function gmailPayload(message, origin) {
  return {
    evento: "mensaje_entrante",
    red: "gmail",
    canal: "email",
    mensajeId: message.id,
    empresaId: message.empresaId,
    nombreCliente: message.nombreCliente,
    texto: message.texto,
    token: messageToken(message.empresaId, message.id),
    respuestaUrl: `${origin}/api/n8n/respuesta`,
  };
}

export async function deliverInbound({ company, message, origin, fetchImpl = fetch, lookupImpl }) {
  if (message?.canal !== "email") return { enviado: false, motivo: "no_es_gmail" };
  const webhook = company?.ajustes?.n8n_webhook_url || "";
  if (!webhook.trim()) return { enviado: false, motivo: "sin_webhook" };
  let target;
  try {
    target = await assertWebhookUrl(webhook, lookupImpl);
  } catch {
    return { enviado: false, motivo: "url_invalida" };
  }
  try {
    const response = await fetchImpl(target, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify(gmailPayload(message, origin)),
    });
    if (response.status >= 300 && response.status < 400) return { enviado: false, motivo: "webhook_rechazo" };
    if (!response.ok) return { enviado: false, motivo: "webhook_rechazo" };
    return { enviado: true };
  } catch {
    return { enviado: false, motivo: "webhook_rechazo" };
  }
}

export function acceptReply(store, body) {
  const mensajeId = String(body?.mensajeId || "").trim();
  const respuesta = String(body?.respuesta ?? "").trim().slice(0, 4000);
  const token = String(body?.token || "");
  if (!mensajeId || !respuesta) throw fail(400, "La respuesta de n8n necesita el mensaje y el texto.");
  const state = store.getState();
  const message = state.messages.find((item) => item.id === mensajeId);
  if (!message) throw fail(404, "No encontramos ese mensaje.");
  if (message.canal !== "email") throw fail(400, "n8n solo responde Gmail por ahora.");
  if (!sameToken(token, messageToken(message.empresaId, message.id))) {
    throw fail(401, "No se pudo aceptar la respuesta.");
  }
  return store.saveReply(message.id, respuesta);
}
