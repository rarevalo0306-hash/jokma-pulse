import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const COOKIE = "pulse_sesion";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const DEVELOPMENT_SECRET = "jokma-pulse-local-development-only";
const PASSWORD_PREFIX = "scrypt";
const PASSWORD_BYTES = 64;

function sessionSecret(env = process.env) {
  const configured = String(env.PULSE_SESSION_SECRET || "");
  if (configured) return configured;
  if (env.VERCEL || env.NODE_ENV === "production") {
    throw new Error("PULSE_SESSION_SECRET es obligatorio en producción.");
  }
  return DEVELOPMENT_SECRET;
}

export function assertSessionConfiguration(env = process.env) {
  const secret = sessionSecret(env);
  if ((env.VERCEL || env.NODE_ENV === "production") && secret.length < 32) {
    throw new Error("PULSE_SESSION_SECRET debe tener al menos 32 caracteres en producción.");
  }
  return true;
}

export function publicCompany(company) {
  if (!company) return null;
  const copy = { ...company };
  delete copy.clave;
  delete copy.usuario;
  delete copy.passwordHash;
  return copy;
}

export function hashPassword(password, salt = randomBytes(16).toString("base64url")) {
  const normalized = String(password ?? "");
  if (normalized.length < 6) throw new Error("La clave necesita al menos 6 caracteres.");
  const digest = scryptSync(normalized, salt, PASSWORD_BYTES).toString("base64url");
  return `${PASSWORD_PREFIX}$${salt}$${digest}`;
}

export function verifyPassword(password, encoded) {
  const [prefix, salt, expected] = String(encoded || "").split("$");
  if (prefix !== PASSWORD_PREFIX || !salt || !expected) return false;
  try {
    const actual = scryptSync(String(password ?? ""), salt, PASSWORD_BYTES);
    const stored = Buffer.from(expected, "base64url");
    return actual.length === stored.length && timingSafeEqual(actual, stored);
  } catch {
    return false;
  }
}

export function createSession(userId, companyId = userId) {
  const exp = Date.now() + WEEK_MS;
  const subject = Buffer.from(JSON.stringify({ userId, companyId })).toString("base64url");
  const body = `${subject}.${exp}`;
  const sig = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [subject, exp, sig] = parts;
  const expected = createHmac("sha256", sessionSecret()).update(`${subject}.${exp}`).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  if (!Number.isFinite(Number(exp)) || Number(exp) < Date.now()) return null;
  try {
    const parsed = JSON.parse(Buffer.from(subject, "base64url").toString("utf8"));
    if (!parsed.userId || !parsed.companyId) return null;
    return { userId: parsed.userId, companyId: parsed.companyId };
  } catch {
    return null;
  }
}

function cookieFlags() {
  const secure = process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `HttpOnly; SameSite=Lax; Path=/; Max-Age=${WEEK_SECONDS}${secure}`;
}

export function sessionCookie(userId, companyId = userId) {
  return `${COOKIE}=${createSession(userId, companyId)}; ${cookieFlags()}`;
}

export function clearSessionCookie() {
  const secure = process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export function readSessionCookie(header) {
  const parts = String(header || "").split(";").map((part) => part.trim());
  const raw = parts.find((part) => part.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  return verifySession(decodeURIComponent(raw.slice(COOKIE.length + 1)));
}
