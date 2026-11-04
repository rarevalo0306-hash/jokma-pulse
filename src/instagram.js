import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeSettings } from "./settings.js";
import { GRAPH_VERSION, readState, requestOrigin, signState } from "./facebook.js";

export const REDIRECT_PATH = "/api/instagram/callback";
export const WEBHOOK_PATH = "/api/instagram/webhook";
export const PULSE_APP_ID = "1036513856135777";
export const VERIFY_TOKEN = process.env.PULSE_INSTAGRAM_VERIFY_TOKEN || "jokma-pulse-instagram";
export const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
].join(",");

function motivoError(motivo) {
  return Object.assign(new Error(motivo), { motivo });
}

function same(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export function redirectUri(origin) {
  return `${String(origin || "").replace(/\/$/, "")}${REDIRECT_PATH}`;
}

export function appCredentials(company) {
  const settings = normalizeSettings(company?.ajustes, company);
  const appId = settings.meta_app_id || PULSE_APP_ID;
  const secret = settings.meta_app_secret;
  if (!secret) return { motivo: "sin_app" };
  return { appId, secret };
}

export function beginLogin(company, origin, now = Date.now()) {
  const creds = appCredentials(company);
  if (!creds.appId) return { motivo: "sin_app" };
  if (!creds.secret) return creds;
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", creds.appId);
  url.searchParams.set("redirect_uri", redirectUri(origin));
  url.searchParams.set("state", signState(company.id, now));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  return { url: url.toString(), appId: creds.appId };
}

export { readState, requestOrigin };

function assertGraph(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw motivoError("instagram");
  }
  if (url.protocol !== "https:" || url.hostname !== "graph.facebook.com") throw motivoError("instagram");
  return url.toString();
}

async function readGraph(response) {
  if (response.status >= 300 && response.status < 400) throw motivoError("instagram");
  let data;
  try {
    data = await response.json();
  } catch {
    throw motivoError("instagram");
  }
  if (!response.ok || data?.error || !data || typeof data !== "object") throw motivoError("instagram");
  return data;
}

async function graphPost(path, body, fetchImpl) {
  const target = assertGraph(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  const response = await fetchImpl(target, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  return readGraph(response);
}

async function graphGet(path, query, fetchImpl) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const target = assertGraph(url.toString());
  const response = await fetchImpl(target, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  return readGraph(response);
}

export function settingsWithInstagram(company, account) {
  const current = normalizeSettings(company?.ajustes, company);
  return {
    ...current,
    meta_app_id: current.meta_app_id || PULSE_APP_ID,
    instagram_user_id: String(account.igUserId || ""),
    instagram_access_token: String(account.igToken || ""),
  };
}

async function subscribe(pageId, igUserId, token, fetchImpl) {
  const attempts = [
    [pageId, "messages"],
    [igUserId, "messages,comments"],
  ];
  for (const [id, fields] of attempts) {
    if (!id) continue;
    try {
      await graphPost(
        `${id}/subscribed_apps`,
        { subscribed_fields: fields, access_token: token },
        fetchImpl,
      );
    } catch (error) {
      if (error?.motivo !== "instagram") throw motivoError("instagram");
    }
  }
}

export async function completeLogin({
  code,
  appId,
  appSecret,
  origin,
  organization,
  fetchImpl = fetch,
}) {
  const authCode = String(code || "").trim();
  if (!authCode || authCode.length > 2048) throw motivoError("instagram");
  const short = await graphPost(
    "oauth/access_token",
    {
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri(origin),
      code: authCode,
    },
    fetchImpl,
  );
  if (!short.access_token) throw motivoError("instagram");
  let userToken = String(short.access_token);
  try {
    const long = await graphPost(
      "oauth/access_token",
      {
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: userToken,
      },
      fetchImpl,
    );
    if (long.access_token) userToken = String(long.access_token);
  } catch (error) {
    if (error?.motivo !== "instagram") throw motivoError("instagram");
  }
  const accounts = await graphGet(
    "me/accounts",
    {
      fields: "id,name,access_token,instagram_business_account{id,username}",
      access_token: userToken,
    },
    fetchImpl,
  );
  const pages = Array.isArray(accounts.data) ? accounts.data : [];
  const linked = pages
    .map((page) => ({ page, ig: page?.instagram_business_account }))
    .filter((item) => item.page?.id && item.page?.access_token && item.ig?.id);
  if (!linked.length) throw motivoError("sin_instagram");
  const wanted = String(organization || "").trim().toLowerCase();
  const match =
    linked.find((item) => String(item.page.name || "").trim().toLowerCase() === wanted) || linked[0];
  const igToken = String(match.page.access_token);
  const igUserId = String(match.ig.id);
  await subscribe(String(match.page.id), igUserId, igToken, fetchImpl);
  const username = String(match.ig.username || "").replace(/^@/, "").trim();
  return { igUserId, igToken, username };
}

export function verifySignature(raw, header, secret) {
  const signature = String(header || "");
  if (!raw || !signature.startsWith("sha256=") || !secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  return same(signature, expected);
}

export function acceptedSignature(companies, raw, header) {
  return (companies || []).some((company) =>
    verifySignature(raw, header, company?.ajustes?.meta_app_secret || ""),
  );
}

export function webhookChallenge(query, token = VERIFY_TOKEN) {
  if (query?.["hub.mode"] !== "subscribe") return null;
  if (!same(query?.["hub.verify_token"], token)) return null;
  const challenge = query?.["hub.challenge"];
  if (typeof challenge !== "string" || !challenge || challenge.length > 256) return null;
  return challenge;
}

function eventId(prefix, value) {
  const clean = String(value || "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80);
  return clean ? `${prefix}${clean}` : "";
}

export function readInstagramEvents(body) {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  const events = [];
  for (const entry of entries) {
    const igId = String(entry?.id || "");
    if (!igId) continue;
    for (const item of Array.isArray(entry.messaging) ? entry.messaging : []) {
      if (item?.message?.is_echo) continue;
      const senderId = String(item?.sender?.id || "");
      if (!senderId || senderId === igId) continue;
      const text = String(item?.message?.text || "").trim();
      if (!text) continue;
      events.push({
        igId,
        canal: "instagram_dm",
        nombreCliente: senderId,
        texto: text,
        externalId: eventId("msg-ig-", item?.message?.mid),
        cuenta: `@${igId}`,
      });
    }
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      if (change?.field !== "comments") continue;
      const value = change.value || {};
      const senderId = String(value.from?.id || "");
      if (senderId && senderId === igId) continue;
      const text = String(value.text || "").trim();
      if (!text) continue;
      const username = String(value.from?.username || senderId || "Instagram").replace(/^@/, "");
      events.push({
        igId,
        canal: "instagram_comment",
        nombreCliente: username,
        texto: text,
        externalId: eventId("msg-igc-", value.id),
        cuenta: `@${igId}`,
      });
    }
  }
  return events;
}
