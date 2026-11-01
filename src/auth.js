import { createHmac, createHash, timingSafeEqual } from "node:crypto";

const COOKIE = "pulse_sesion";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const SECRET = "jokma-pulse-demo-cookie";

export function publicCompany(company) {
  if (!company) return null;
  const copy = { ...company };
  delete copy.clave;
  return copy;
}

export function sameSecret(left, right) {
  const a = createHash("sha256").update(String(left)).digest();
  const b = createHash("sha256").update(String(right)).digest();
  return timingSafeEqual(a, b);
}

export function createSession(companyId) {
  const exp = Date.now() + WEEK_MS;
  const body = `${companyId}.${exp}`;
  const sig = createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [companyId, exp, sig] = parts;
  const expected = createHmac("sha256", SECRET).update(`${companyId}.${exp}`).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  if (!Number.isFinite(Number(exp)) || Number(exp) < Date.now()) return null;
  return companyId;
}

function cookieFlags() {
  const secure = process.env.VERCEL ? "; Secure" : "";
  return `HttpOnly; SameSite=Lax; Path=/; Max-Age=${WEEK_SECONDS}${secure}`;
}

export function sessionCookie(companyId) {
  return `${COOKIE}=${createSession(companyId)}; ${cookieFlags()}`;
}

export function clearSessionCookie() {
  const secure = process.env.VERCEL ? "; Secure" : "";
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export function readSessionCookie(header) {
  const parts = String(header || "").split(";").map((part) => part.trim());
  const raw = parts.find((part) => part.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  return verifySession(decodeURIComponent(raw.slice(COOKIE.length + 1)));
}
