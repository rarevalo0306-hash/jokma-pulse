import assert from "node:assert/strict";
import test from "node:test";
import { createTeamService, invitationTokenHash, validateInvitedRegistration } from "./team.js";

const TOKEN = "test-token-00000000000000000000000000000000";

function admin(email = "persona@example.com") {
  return {
    auth: { admin: {
      async getUserById() { return { data: { user: { email } }, error: null }; },
      async createUser(input) { return { data: { user: { id: "user-new", email: input.email } }, error: null }; },
      async deleteUser() { return { error: null }; },
    } },
  };
}

test("la invitación persiste solo el hash y devuelve el token una vez", async () => {
  let record;
  const persistence = {
    async createInvitation(input) { record = input; return { id: "invite-1", venceEn: "mañana" }; },
  };
  const service = createTeamService({ admin: admin(), persistence, tokenFactory: () => TOKEN });
  const result = await service.createInvitation("org-1", "owner-1", {
    correo: "PERSONA@example.com",
    rol: "agent",
    empresaIds: ["company-1"],
  });
  assert.equal(result.token, TOKEN);
  assert.equal(record.email, "persona@example.com");
  assert.equal(record.tokenHash, invitationTokenHash(TOKEN));
  assert.equal(record.tokenHash.includes(TOKEN), false);
});

test("valida el alta de un invitado con clave de seis caracteres", () => {
  const value = validateInvitedRegistration({
    nombre: "Ana",
    apellido: "Pérez",
    usuario: "ana.perez",
    correo: "ANA@example.com",
    clave: "abc123",
  });
  assert.equal(value.email, "ana@example.com");
  assert.equal(value.displayName, "Ana Pérez");
  assert.throws(() => validateInvitedRegistration({
    nombre: value.firstName,
    apellido: value.lastName,
    usuario: value.username,
    correo: value.email,
    clave: "abcdef",
  }), /letras y números/);
});

test("acepta con el correo real de Auth y no con datos del navegador", async () => {
  let accepted;
  const persistence = {
    async accept(record) { accepted = record; return { organizationId: "org-1", companyId: "company-1" }; },
  };
  const service = createTeamService({ admin: admin("Persona@Example.com"), persistence });
  await service.accept("user-1", TOKEN);
  assert.equal(accepted.email, "persona@example.com");
  assert.equal(accepted.tokenHash, invitationTokenHash(TOKEN));
});

test("el alta invitada rechaza un correo diferente", async () => {
  const persistence = {
    async preview() {
      return {
        email: "invitada@example.com",
        organization_id: "org-1",
        organization_name: "Jokma",
        companies: [{ id: "company-1", name: "Pulse" }],
      };
    },
  };
  const service = createTeamService({ admin: admin(), persistence });
  await assert.rejects(() => service.registerInvited({
    nombre: "Ana",
    apellido: "Pérez",
    usuario: "ana.perez",
    correo: "otra@example.com",
    clave: "abc123",
    invitacion: TOKEN,
  }), /mismo correo/);
});

test("el alta invitada crea el perfil y acepta la organización", async () => {
  let registered;
  const persistence = {
    async preview() {
      return {
        email: "persona@example.com",
        organization_id: "org-1",
        organization_name: "Jokma",
        companies: [{ id: "company-1", name: "Pulse" }],
      };
    },
    async registerInvited(record) {
      registered = record;
      return { organizationId: "org-1", companyId: "company-1" };
    },
  };
  const service = createTeamService({ admin: admin(), persistence });
  const result = await service.registerInvited({
    nombre: "Ana",
    apellido: "Pérez",
    usuario: "ana.perez",
    correo: "persona@example.com",
    clave: "abc123",
    invitacion: TOKEN,
  });
  assert.equal(registered.userId, "user-new");
  assert.equal(result.company.id, "company-1");
  assert.equal(result.organization.nombre, "Jokma");
});
