import assert from "node:assert/strict";
import test from "node:test";
import { createRegistrationService, registrationEnabled, validateRegistration } from "./registration.js";

const VALID = {
  nombre: "Ricardo",
  apellido: "Arévalo",
  organizacion: "Jokma",
  empresa: "Jokma Pulse",
  industria: "Tecnología",
  usuario: "Ricardo.Pulse",
  correo: "RICARDO@example.com",
  clave: "una-clave-local-123",
};

test("el registro solo se habilita explícitamente en Supabase local", () => {
  assert.equal(registrationEnabled({ PULSE_STORE: "supabase", PULSE_ALLOW_SIGNUP: "true" }), true);
  assert.equal(registrationEnabled({ PULSE_STORE: "supabase", PULSE_ALLOW_SIGNUP: "true", VERCEL: "1" }), false);
  assert.equal(registrationEnabled({ PULSE_STORE: "supabase", PULSE_ALLOW_SIGNUP: "true", NODE_ENV: "production" }), false);
  assert.equal(registrationEnabled({ PULSE_STORE: "json", PULSE_ALLOW_SIGNUP: "true" }), false);
});

test("normaliza el alta y exige una clave de seis caracteres con letras y números", () => {
  const values = validateRegistration(VALID);
  assert.equal(values.username, "ricardo.pulse");
  assert.equal(values.email, "ricardo@example.com");
  assert.equal(values.firstName, "Ricardo");
  assert.equal(values.lastName, "Arévalo");
  assert.equal(values.displayName, "Ricardo Arévalo");
  assert.throws(() => validateRegistration({ ...VALID, apellido: "" }), /apellido/);
  assert.doesNotThrow(() => validateRegistration({ ...VALID, clave: "abc123" }));
  assert.throws(() => validateRegistration({ ...VALID, clave: "corta" }), /6 caracteres/);
  assert.throws(() => validateRegistration({ ...VALID, clave: "abcdef" }), /letras y números/);
  assert.throws(() => validateRegistration({ ...VALID, usuario: "dos palabras" }), /usuario necesita/);
});

test("crea Auth antes del perfil y devuelve una sesión utilizable", async () => {
  const calls = [];
  const admin = {
    auth: { admin: {
      async createUser(input) {
        calls.push(["auth", input.email, input.password.length]);
        return { data: { user: { id: "user-local" } }, error: null };
      },
      async deleteUser() {
        calls.push(["delete"]);
        return { error: null };
      },
    } },
  };
  const persistence = {
    async save(record) { calls.push(["db", record.companyId, record.username]); },
  };
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  const service = createRegistrationService({ admin, persistence, idFactory: () => ids.shift() });
  const result = await service.register(VALID);
  assert.deepEqual(calls, [
    ["auth", "ricardo@example.com", 19],
    ["db", "22222222-2222-4222-8222-222222222222", "ricardo.pulse"],
  ]);
  assert.equal(result.user.usuario, "ricardo.pulse");
  assert.equal(result.organization.id, "11111111-1111-4111-8111-111111111111");
  assert.equal(result.company.id, "22222222-2222-4222-8222-222222222222");
});

test("borra el usuario de Auth si falla la transacción de empresa", async () => {
  const deleted = [];
  const admin = {
    auth: { admin: {
      async createUser() { return { data: { user: { id: "user-fallido" } }, error: null }; },
      async deleteUser(id) { deleted.push(id); return { error: null }; },
    } },
  };
  const persistence = { async save() { throw Object.assign(new Error("duplicado"), { code: "23505" }); } };
  const ids = ["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
  const service = createRegistrationService({ admin, persistence, idFactory: () => ids.shift() });
  await assert.rejects(() => service.register(VALID), /ya está en uso/);
  assert.deepEqual(deleted, ["user-fallido"]);
});
