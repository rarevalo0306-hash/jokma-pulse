import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const base = process.env.PULSE_VERIFY_URL || "http://127.0.0.1:4317";
const suffix = randomUUID().slice(0, 8);
let cookie = "";
let userId = "";
let organizationId = "";

function localEnvironment() {
  const status = spawnSync("supabase", ["status", "-o", "env"], { encoding: "utf8" });
  if (status.status !== 0) throw new Error("Supabase local no está activo.");
  return Object.fromEntries(status.stdout.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) return [];
    return [[match[1], JSON.parse(match[2])]];
  }));
}

function keychainSecret(service) {
  const result = spawnSync("/usr/bin/security", ["find-generic-password", "-a", process.env.USER, "-s", service, "-w"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error("Falta una credencial de verificación en el llavero.");
  return result.stdout.trim();
}

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) },
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";", 1)[0];
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status}: ${payload.error || "Error"}`);
  return payload;
}

const local = localEnvironment();
try {
  const created = await request("/api/registro", {
    method: "POST",
    body: JSON.stringify({
      nombre: "Prueba",
      apellido: "Pulse",
      organizacion: `Organización Acceso ${suffix}`,
      empresa: `Empresa Acceso ${suffix}`,
      industria: "Pruebas",
      usuario: `pulse.${suffix}`,
      correo: `pulse.${suffix}@example.test`,
      clave: "Inicio123",
      invitacion: keychainSecret("app.jokma.pulse.signup-invite"),
    }),
  });
  userId = created.usuario.id;
  organizationId = created.organizacion.id;
  await request("/api/cuenta/cambiar-clave", {
    method: "POST",
    body: JSON.stringify({ claveActual: "Inicio123", claveNueva: "Nueva456" }),
  });
  cookie = "";
  const login = await request("/api/sesion", {
    method: "POST",
    body: JSON.stringify({ usuario: `pulse.${suffix}`, clave: "Nueva456" }),
  });
  assert.equal(login.usuario.id, userId);
  console.log("Acceso: registro con invitación y cambio de clave verificados.");
} finally {
  if (organizationId) {
    const sql = postgres(local.DB_URL, { max: 1, prepare: false });
    await sql`delete from public.organizations where id = ${organizationId}`;
    await sql.end({ timeout: 2 });
  }
  if (userId) {
    const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    await admin.auth.admin.deleteUser(userId);
  }
  if (organizationId || userId) console.log("Limpieza: cuenta y espacio sintéticos eliminados.");
}
