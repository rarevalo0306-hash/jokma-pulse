import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import postgres from "postgres";

const base = process.env.PULSE_VERIFY_URL || "http://127.0.0.1:4317";
let cookie = "";
let organizationId = "";

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

function databaseUrl() {
  const status = spawnSync("supabase", ["status", "-o", "env"], { encoding: "utf8" });
  if (status.status !== 0) throw new Error("Supabase local no está activo.");
  const line = status.stdout.split(/\r?\n/).find((item) => item.startsWith("DB_URL="));
  return JSON.parse(line.slice("DB_URL=".length));
}

function verificationPassword() {
  const result = spawnSync("/usr/bin/security", ["find-generic-password", "-a", "rarevalo0306@gmail.com", "-s", "Jokma Pulse", "-w"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error("No se encontró la clave de verificación en el llavero.");
  return result.stdout.trim();
}

try {
  await request("/api/sesion", { method: "POST", body: JSON.stringify({ usuario: "rarevalo0306", clave: verificationPassword() }) });
  const state = await request("/api/estado");
  assert.ok(state.organizations.length > 0);
  assert.ok(state.companies.every((company) => company.organizacionId));
  console.log(`Estado: ${state.organizations.length} organización(es), ${state.companies.length} empresa(s), selectores vinculados.`);

  const created = await request("/api/organizaciones", {
    method: "POST",
    body: JSON.stringify({ nombre: "Organización Sintética Pulse", empresa: "Empresa Sintética Uno", industria: "Pruebas" }),
  });
  organizationId = created.organization.id;
  const company = await request(`/api/organizaciones/${organizationId}/empresas`, {
    method: "POST",
    body: JSON.stringify({ nombre: "Empresa Sintética Dos", industria: "Pruebas" }),
  });
  assert.equal(company.organizacionId, organizationId);
  console.log("Creación: organización y segunda empresa verificadas.");
} finally {
  if (organizationId) {
    const sql = postgres(databaseUrl(), { max: 1, prepare: false });
    await sql`delete from public.organizations where id = ${organizationId}`;
    await sql.end({ timeout: 2 });
    console.log("Limpieza: datos sintéticos eliminados.");
  }
}
