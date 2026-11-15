import test from "node:test";
import assert from "node:assert/strict";
import { createAccountSecurity, validateNewPassword } from "./account-security.js";

test("validateNewPassword acepta seis caracteres con letras y números", () => {
  assert.equal(validateNewPassword("pulse1"), "pulse1");
  assert.throws(() => validateNewPassword("123456"), /letras y números/);
  assert.throws(() => validateNewPassword("abc12"), /al menos 6/);
});

test("changePassword verifica la clave actual antes de actualizar", async () => {
  const updates = [];
  const security = createAccountSecurity({
    admin: { auth: { admin: { updateUserById: async (...args) => (updates.push(args), { error: null }) } } },
    authenticate: async (username, password) => username === "ricardo" && password === "actual1"
      ? { user: { id: "usr-1" } }
      : null,
    createAuthClient: () => ({ auth: {} }),
    sendRecoveryEmail: async () => {},
  });
  await assert.rejects(
    security.changePassword({ id: "usr-1", usuario: "ricardo" }, { claveActual: "mala", claveNueva: "nueva1" }),
    /no es correcta/,
  );
  assert.equal(updates.length, 0);
  assert.deepEqual(
    await security.changePassword({ id: "usr-1", usuario: "ricardo" }, { claveActual: "actual1", claveNueva: "nueva1" }),
    { ok: true },
  );
  assert.deepEqual(updates[0], ["usr-1", { password: "nueva1" }]);
});

test("requestPasswordReset acepta usuario o correo sin revelar cuentas inexistentes", async () => {
  const sent = [];
  const admin = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: { id: "usr-1" }, error: null }; },
      };
    },
    auth: { admin: {
      async getUserById() { return { data: { user: { email: "ricardo@example.com" } }, error: null }; },
      async updateUserById() { return { error: null }; },
      async generateLink({ email }) { return { data: { properties: { hashed_token: `hash-${email}` } }, error: null }; },
    } },
  };
  const security = createAccountSecurity({
    admin,
    authenticate: async () => null,
    createAuthClient: () => ({ auth: {} }),
    async sendRecoveryEmail(input) { sent.push(input); },
  });
  const linkFactory = (token) => `https://pulse.jokma.app/api/cuenta/confirmar-recuperacion?token_hash=${token}`;
  assert.deepEqual(await security.requestPasswordReset({ identificador: "Ricardo" }, linkFactory), { ok: true });
  assert.deepEqual(sent[0], {
    to: "ricardo@example.com",
    link: "https://pulse.jokma.app/api/cuenta/confirmar-recuperacion?token_hash=hash-ricardo@example.com",
  });
  await security.requestPasswordReset({ identificador: "otra@example.com" }, linkFactory);
  assert.equal(sent[1].to, "otra@example.com");
});

test("requestPasswordReset conserva la respuesta genérica cuando falla el SMTP", async () => {
  const security = createAccountSecurity({
    admin: { auth: { admin: {
      async generateLink() {
        return { data: { properties: { hashed_token: "hash-seguro" } }, error: null };
      },
    } } },
    authenticate: async () => null,
    createAuthClient: () => ({ auth: {} }),
    async sendRecoveryEmail() {
      throw new Error("SMTP de prueba no disponible");
    },
  });
  assert.deepEqual(
    await security.requestPasswordReset(
      { identificador: "persona@example.com" },
      (token) => `https://pulse.jokma.app/api/cuenta/confirmar-recuperacion?token_hash=${token}`,
    ),
    { ok: true, deliveryFailed: true },
  );
});

test("resetPassword exige una sesión del enlace y actualiza mediante Supabase Auth", async () => {
  const calls = [];
  const security = createAccountSecurity({
    admin: { auth: { admin: { async updateUserById() { return { error: null }; } } } },
    authenticate: async () => null,
    createAuthClient: () => ({ auth: {
      async setSession(tokens) { calls.push(["session", tokens]); return { data: { user: { id: "usr-1" } }, error: null }; },
      async updateUser(input) { calls.push(["update", input]); return { data: {}, error: null }; },
      async signOut(input) { calls.push(["signout", input]); return { error: null }; },
    } }),
    sendRecoveryEmail: async () => {},
  });
  assert.deepEqual(await security.resetPassword({ accessToken: "access", refreshToken: "refresh", claveNueva: "nueva1" }), { ok: true });
  assert.deepEqual(calls, [
    ["session", { access_token: "access", refresh_token: "refresh" }],
    ["update", { password: "nueva1" }],
    ["signout", { scope: "local" }],
  ]);
});

test("confirmPasswordReset intercambia el hash por una sesión de recuperación", async () => {
  const security = createAccountSecurity({
    admin: { auth: { admin: { async updateUserById() { return { error: null }; } } } },
    authenticate: async () => null,
    createAuthClient: () => ({ auth: {
      async verifyOtp(input) {
        assert.deepEqual(input, { token_hash: "hash-seguro", type: "recovery" });
        return { data: { session: { access_token: "access", refresh_token: "refresh" } }, error: null };
      },
    } }),
    sendRecoveryEmail: async () => {},
  });
  assert.deepEqual(await security.confirmPasswordReset("hash-seguro"), { accessToken: "access", refreshToken: "refresh" });
});
