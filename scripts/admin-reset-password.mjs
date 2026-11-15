import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const email = String(process.argv[2] || "").trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Uso: npm run admin:reset-password -- correo@ejemplo.com");
  process.exit(2);
}

const status = spawnSync("/opt/homebrew/bin/supabase", ["status", "-o", "env"], {
  cwd: process.cwd(),
  encoding: "utf8",
});
if (status.status !== 0) {
  console.error("Supabase local no está disponible.");
  process.exit(1);
}

const local = {};
for (const line of status.stdout.split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (!match) continue;
  let value = match[2].trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      value = JSON.parse(value);
    } catch {
      value = value.slice(1, -1);
    }
  }
  local[match[1]] = value;
}

if (!local.API_URL || !local.SERVICE_ROLE_KEY) {
  console.error("Supabase local no devolvió las credenciales administrativas necesarias.");
  process.exit(1);
}

const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (users.error) {
  console.error("No se pudo consultar Auth local.");
  process.exit(1);
}

const user = users.data.users.find((candidate) => candidate.email?.toLowerCase() === email);
if (!user) {
  console.error("No existe una cuenta local con ese correo.");
  process.exit(1);
}

const password = `P9${randomBytes(24).toString("base64url")}`;
const updated = await admin.auth.admin.updateUserById(user.id, { password });
if (updated.error) {
  console.error("No se pudo restablecer la contraseña.");
  process.exit(1);
}

const authClient = createClient(local.API_URL, local.PUBLISHABLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const verified = await authClient.auth.signInWithPassword({ email, password });
if (verified.error || verified.data.user?.id !== user.id) {
  console.error("La contraseña cambió, pero la verificación de acceso falló.");
  process.exit(1);
}
await authClient.auth.signOut();

const keychain = spawnSync("/usr/bin/security", [
  "add-generic-password",
  "-U",
  "-a",
  email,
  "-s",
  "Jokma Pulse",
  "-w",
  password,
]);
const clipboard = spawnSync("/usr/bin/pbcopy", [], { input: password });
if (keychain.status !== 0 || clipboard.status !== 0) {
  console.error("La contraseña cambió, pero no pudo guardarse de forma segura en esta Mac.");
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, email, verified: true, keychain: true, clipboard: true }));
