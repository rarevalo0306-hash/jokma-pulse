import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { createSupabaseAdmin } from "../src/supabase-admin.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const base = process.env.BASE_URL || "http://127.0.0.1:4317";
const status = spawnSync("supabase", ["status", "-o", "env"], { cwd: root, encoding: "utf8" });
if (status.status !== 0) throw new Error("Supabase local no está activo.");

const local = {};
for (const line of status.stdout.split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (!match) continue;
  let value = match[2].trim();
  if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value);
  local[match[1]] = value;
}

const suffix = randomBytes(6).toString("hex");
const email = `verificacion-${suffix}@pulse.local.invalid`;
const username = `verificacion-${suffix}`;
const password = "abc123";
const inviteResult = spawnSync("/usr/bin/security", ["find-generic-password", "-a", process.env.USER, "-s", "app.jokma.pulse.signup-invite", "-w"], { encoding: "utf8" });
if (inviteResult.status !== 0 || !inviteResult.stdout.trim()) throw new Error("Falta el código de invitación en el llavero.");
const admin = createSupabaseAdmin({ SUPABASE_URL: local.API_URL, SUPABASE_SECRET_KEY: local.SERVICE_ROLE_KEY });
const sql = postgres(local.DB_URL, { max: 1, prepare: false });
let userId = null;
let organizationId = null;
let companyId = null;

try {
  const configResponse = await fetch(`${base}/api/configuracion-publica`);
  assert.equal(configResponse.status, 200);
  assert.equal((await configResponse.json()).registroHabilitado, true);

  const response = await fetch(`${base}/api/registro`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nombre: "Verificación",
      apellido: "Pulse",
      organizacion: "Organización Sintética Pulse",
      empresa: "Empresa Sintética Pulse",
      industria: "Pruebas automatizadas",
      usuario: username,
      correo: email,
      clave: password,
      invitacion: inviteResult.stdout.trim(),
    }),
  });
  const responseText = await response.text();
  assert.equal(response.status, 201, responseText);
  const created = JSON.parse(responseText);
  userId = created.usuario.id;
  organizationId = created.organizacion?.id || null;
  companyId = created.empresa.id;
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);

  const stateResponse = await fetch(`${base}/api/estado`, { headers: { Cookie: cookie } });
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.equal(state.user.usuario, username);
  assert.deepEqual(state.companies.map((company) => company.id), [companyId]);
  assert.equal(state.accounts.length, 0);
  assert.equal(state.messages.length, 0);
  assert.equal(JSON.stringify(state).includes(password), false);

  const loginResponse = await fetch(`${base}/api/sesion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario: username, clave: password }),
  });
  assert.equal(loginResponse.status, 200);
  console.log(JSON.stringify({ ok: true, isolatedCompany: true, emptyWorkspace: true }));
} finally {
  if (!userId) {
    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = listed.data?.users?.find((user) => user.email === email)?.id || null;
  }
  if (userId && !companyId) {
    const rows = await sql`select default_company_id from public.profiles where id = ${userId}`;
    companyId = rows[0]?.default_company_id || null;
  }
  if (companyId) await sql`delete from public.companies where id = ${companyId}`;
  if (organizationId) await sql`delete from public.organizations where id = ${organizationId}`;
  if (userId) await admin.auth.admin.deleteUser(userId);
  await sql.end({ timeout: 2 });
}
