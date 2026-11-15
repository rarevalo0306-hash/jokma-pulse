import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer-core";
import { createSupabaseAdmin } from "../src/supabase-admin.js";

const rootUrl = process.env.PULSE_VERIFY_URL || "http://127.0.0.1:4318";
const status = spawnSync("supabase", ["status", "-o", "env"], { encoding: "utf8" });
if (status.status !== 0) throw new Error("Supabase local no está activo.");
const local = {};
for (const line of status.stdout.split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (!match) continue;
  local[match[1]] = match[2].startsWith('"') ? JSON.parse(match[2]) : match[2];
}

const suffix = randomBytes(6).toString("hex");
const email = `recuperacion-${suffix}@pulse.local.invalid`;
const oldPassword = "anterior1";
const newPassword = "recuperada2";
const admin = createSupabaseAdmin({ SUPABASE_URL: local.API_URL, SUPABASE_SECRET_KEY: local.SERVICE_ROLE_KEY });
const auth = createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let userId = "";
let browser;

async function json(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status}: ${body.error || "Error"}`);
  return body;
}

async function recoveryMessage() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const list = await json(`${local.MAILPIT_URL}/api/v1/messages`);
    const message = list.messages?.find((item) => item.To?.some((recipient) => recipient.Address === email));
    if (message) return json(`${local.MAILPIT_URL}/api/v1/message/${message.ID}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Mailpit no recibió el correo de recuperación.");
}

try {
  await fetch(`${local.MAILPIT_URL}/api/v1/messages`, { method: "DELETE" });
  const created = await admin.auth.admin.createUser({ email, password: oldPassword, email_confirm: true });
  if (created.error || !created.data?.user) throw created.error || new Error("No se creó el usuario sintético.");
  userId = created.data.user.id;

  const requested = await json(`${rootUrl}/api/cuenta/recuperar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identificador: email }),
  });
  assert.equal(requested.ok, true);
  const message = await recoveryMessage();
  const source = `${message.HTML || ""}\n${message.Text || ""}`.replaceAll("&amp;", "&");
  const link = source.match(/https?:\/\/[^\s"'<>]+confirmar-recuperacion\?token_hash=[^\s"'<>]*/i)?.[0];
  assert.ok(link, "El correo no contiene el enlace de recuperación.");
  const verified = await fetch(link, { redirect: "manual" });
  assert.ok([302, 303].includes(verified.status));
  const location = verified.headers.get("location");
  assert.ok(location);
  const fragment = new URLSearchParams(new URL(location).hash.replace(/^#/, ""));
  assert.equal(fragment.get("type"), "recovery");
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.goto(location, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="reset-password-submit"]');
  const shots = decodeURIComponent(new URL("../.impeccable/review/", import.meta.url).pathname);
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: `${shots}mobile-password-recovery.png`, fullPage: true });
  await page.type("#recovery-password", newPassword);
  await page.type("#recovery-confirm", newPassword);
  const [resetResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/cuenta/restablecer")),
    page.click('[data-testid="reset-password-submit"]'),
  ]);
  assert.equal(resetResponse.status(), 200);
  await page.waitForFunction(() => document.querySelector('[data-testid="login-form"]')?.textContent.includes("Clave actualizada"));
  assert.ok((await auth.auth.signInWithPassword({ email, password: oldPassword })).error);
  assert.equal((await auth.auth.signInWithPassword({ email, password: newPassword })).data?.user?.id, userId);
  console.log(JSON.stringify({ ok: true, emailCaptured: true, recoveryLink: true, recoveryUi: true, passwordUpdated: true }));
} finally {
  await browser?.close().catch(() => {});
  await auth.auth.signOut().catch(() => {});
  if (!userId) {
    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = users.data?.users?.find((user) => user.email === email)?.id || "";
  }
  if (userId) await admin.auth.admin.deleteUser(userId);
  await fetch(`${local.MAILPIT_URL}/api/v1/messages`, { method: "DELETE" }).catch(() => {});
}
