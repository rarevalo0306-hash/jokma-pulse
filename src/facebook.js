import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeSettings } from "./settings.js";

export const GRAPH_VERSION = "v21.0";
export const REDIRECT_PATH = "/api/facebook/callback";
export const PRODUCTION_REDIRECT = "https://jokma-pulse.vercel.app/api/facebook/callback";

const STATE_SECRET = process.env.PULSE_FACEBOOK_STATE_SECRET || "jokma-pulse-demo-cookie";
const STATE_MS = 10 * 60 * 1000;
const SCOPES = [
  "pages_show_list",
  "pages_messaging",
  "pages_read_engagement",
  "pages_manage_engagement",
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

export function signState(companyId, now = Date.now()) {
  const exp = now + STATE_MS;
  const body = `${companyId}.${exp}`;
  const sig = createHmac("sha256", STATE_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readState(token, now = Date.now()) {
  const parts = String(token || "").split(".");
  if (parts.length < 3) return null;
  const sig = parts.pop();
  const exp = parts.pop();
  const companyId = parts.join(".");
  if (!companyId || !/^\d+$/.test(exp)) return null;
  const expected = createHmac("sha256", STATE_SECRET).update(`${companyId}.${exp}`).digest("base64url");
  if (!same(sig, expected)) return null;
  if (Number(exp) < now) return null;
  return companyId;
}

export function loginUrl({ appId, origin, companyId, now }) {
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri(origin));
  url.searchParams.set("state", signState(companyId, now));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  return url.toString();
}

export function beginLogin(company, origin, now = Date.now()) {
  const settings = normalizeSettings(company?.ajustes, company);
  const appId = settings.meta_app_id;
  const secret = settings.meta_app_secret;
  if (!appId || !secret) return { motivo: "sin_app" };
  return { url: loginUrl({ appId, origin, companyId: company.id, now }) };
}

export function callbackMotivo(query) {
  const error = typeof query?.error === "string" ? query.error : "";
  if (!error) return null;
  return error === "access_denied" ? "denegado" : "facebook";
}

function assertGraph(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw motivoError("facebook");
  }
  if (url.protocol !== "https:" || url.hostname !== "graph.facebook.com") {
    throw motivoError("facebook");
  }
  return url.toString();
}

async function readGraph(response) {
  if (response.status >= 300 && response.status < 400) throw motivoError("facebook");
  let data;
  try {
    data = await response.json();
  } catch {
    throw motivoError("facebook");
  }
  if (!response.ok || data?.error || !data || typeof data !== "object") throw motivoError("facebook");
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

export function settingsWithPage(company, page) {
  const current = normalizeSettings(company?.ajustes, company);
  return {
    ...current,
    facebook_page_id: String(page.pageId || ""),
    facebook_page_token: String(page.pageToken || ""),
  };
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
  if (!authCode || authCode.length > 2048) throw motivoError("facebook");
  const redirect = redirectUri(origin);
  const short = await graphPost(
    "oauth/access_token",
    {
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirect,
      code: authCode,
    },
    fetchImpl,
  );
  if (!short.access_token) throw motivoError("facebook");
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
    if (error?.motivo !== "facebook") throw motivoError("facebook");
  }
  const accounts = await graphGet(
    "me/accounts",
    { fields: "id,name,access_token", access_token: userToken },
    fetchImpl,
  );
  const pages = Array.isArray(accounts.data)
    ? accounts.data.filter((page) => page?.id && page?.access_token)
    : [];
  if (!pages.length) throw motivoError("sin_pagina");
  const wanted = String(organization || "").trim().toLowerCase();
  const match =
    pages.find((page) => String(page.name || "").trim().toLowerCase() === wanted) || pages[0];
  return { pageId: String(match.id), pageToken: String(match.access_token) };
}
