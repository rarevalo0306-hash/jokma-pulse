import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import postgres from "postgres";
import { createSupabaseAdmin } from "../src/supabase-admin.js";

const base = process.env.PULSE_VERIFY_URL || "http://127.0.0.1:4317";
const status = spawnSync("supabase", ["status", "-o", "env"], { encoding: "utf8" });
if (status.status !== 0) throw new Error("Supabase local no está activo.");
const local = {};
for (const line of status.stdout.split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (!match) continue;
  local[match[1]] = match[2].startsWith('"') ? JSON.parse(match[2]) : match[2];
}

const suffix = randomBytes(6).toString("hex");
const email = `equipo-${suffix}@pulse.local.invalid`;
const username = `equipo-${suffix}`;
const password = "abc123";
const admin = createSupabaseAdmin({ SUPABASE_URL: local.API_URL, SUPABASE_SECRET_KEY: local.SERVICE_ROLE_KEY });
const sql = postgres(local.DB_URL, { max: 1, prepare: false });
let ownerCookie = "";
let memberCookie = "";
let ownerId = "";
let memberId = "";
let organizationId = "";

async function request(path, options = {}, session = "owner") {
  const cookie = session === "member" ? memberCookie : ownerCookie;
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) },
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    if (session === "member") memberCookie = setCookie.split(";", 1)[0];
    else ownerCookie = setCookie.split(";", 1)[0];
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(`${response.status}: ${payload.error || "Error"}`), { status: response.status, payload });
  return payload;
}

function ownerPassword() {
  const result = spawnSync("/usr/bin/security", ["find-generic-password", "-a", "rarevalo0306@gmail.com", "-s", "Jokma Pulse", "-w"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error("No se encontró la clave de verificación en el llavero.");
  return result.stdout.trim();
}

try {
  await request("/api/sesion", { method: "POST", body: JSON.stringify({ usuario: "rarevalo0306", clave: ownerPassword() }) });
  const ownerState = await request("/api/estado");
  ownerId = ownerState.user.id;
  const organization = ownerState.organizations.find((item) => ownerState.user.rolesOrganizacion?.[item.id] === "owner");
  assert.ok(organization, "La cuenta de verificación necesita una organización propia.");
  organizationId = organization.id;
  const companies = ownerState.companies.filter((company) => company.organizacionId === organizationId);
  assert.ok(companies.length > 0);

  const invitation = await request(`/api/organizaciones/${organizationId}/invitaciones`, {
    method: "POST",
    body: JSON.stringify({ correo: email, rol: "agent", empresaIds: [companies[0].id] }),
  });
  const invitationUrl = new URL(invitation.enlace);
  const token = invitationUrl.searchParams.get("invitacion");
  assert.ok(token && token.length >= 32);
  const preview = await request(`/api/invitaciones/vista?token=${encodeURIComponent(token)}`, {}, "public");
  assert.equal(preview.organizacion.id, organizationId);
  assert.equal(preview.empresas.length, 1);

  const registered = await request("/api/registro-invitado", {
    method: "POST",
    body: JSON.stringify({
      nombre: "Miembro",
      apellido: "Sintético",
      usuario: username,
      correo: email,
      clave: password,
      invitacion: token,
    }),
  }, "member");
  memberId = registered.usuario.id;
  const memberState = await request("/api/estado", {}, "member");
  assert.equal(memberState.user.rolesOrganizacion[organizationId], "agent");
  assert.deepEqual(memberState.companies.map((company) => company.id), [companies[0].id]);

  let team = await request(`/api/organizaciones/${organizationId}/equipo`);
  assert.equal(team.members.find((member) => member.id === memberId)?.rol, "agent");
  await request(`/api/organizaciones/${organizationId}/miembros/${memberId}`, {
    method: "PUT",
    body: JSON.stringify({ rol: "admin", activo: true, empresaIds: [companies[0].id] }),
  });
  team = await request(`/api/organizaciones/${organizationId}/equipo`);
  assert.equal(team.members.find((member) => member.id === memberId)?.empresaIds.length, companies.length);

  await request(`/api/organizaciones/${organizationId}/miembros/${memberId}`, {
    method: "PUT",
    body: JSON.stringify({ rol: "agent", activo: false, empresaIds: [] }),
  });
  await assert.rejects(() => request("/api/estado", {}, "member"), (error) => error.status === 401);
  await request(`/api/organizaciones/${organizationId}/miembros/${memberId}`, {
    method: "PUT",
    body: JSON.stringify({ rol: "agent", activo: true, empresaIds: [companies[0].id] }),
  });

  await request(`/api/organizaciones/${organizationId}/transferir`, {
    method: "POST",
    body: JSON.stringify({ usuarioId: memberId }),
  });
  await request(`/api/organizaciones/${organizationId}/transferir`, {
    method: "POST",
    body: JSON.stringify({ usuarioId: ownerId }),
  }, "member");
  team = await request(`/api/organizaciones/${organizationId}/equipo`);
  assert.equal(team.members.find((member) => member.id === ownerId)?.rol, "owner");
  console.log(JSON.stringify({ ok: true, invitation: true, registration: true, companyScope: true, suspension: true, ownershipTransfer: true }));
} finally {
  if (organizationId && ownerId) {
    await sql.begin(async (transaction) => {
      await transaction`
        update public.organization_memberships set role = 'owner', active = true
        where organization_id = ${organizationId} and user_id = ${ownerId}
      `;
      await transaction`
        update public.company_memberships membership set role = 'owner', active = true
        from public.companies company
        where membership.company_id = company.id and company.organization_id = ${organizationId} and membership.user_id = ${ownerId}
      `;
      await transaction`delete from public.organization_invitations where organization_id = ${organizationId} and lower(email) = ${email}`;
    });
  }
  if (!memberId) {
    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    memberId = users.data?.users?.find((user) => user.email === email)?.id || "";
  }
  if (memberId) await admin.auth.admin.deleteUser(memberId);
  await sql.end({ timeout: 2 });
}
