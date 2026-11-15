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
    } },
  };
  const security = createAccountSecurity({
    admin,
    authenticate: async () => null,
    createAuthClient: () => ({ auth: {
      async resetPasswordForEmail(email, options) { sent.push([email, options.redirectTo]); return { error: null }; },
    } }),
  });
  assert.deepEqual(await security.requestPasswordReset({ identificador: "Ricardo" }, "https://pulse.jokma.app/?recuperar=1"), { ok: true });
  assert.deepEqual(sent[0], ["ricardo@example.com", "https://pulse.jokma.app/?recuperar=1"]);
  await security.requestPasswordReset({ identificador: "otra@example.com" }, "https://pulse.jokma.app/?recuperar=1");
  assert.equal(sent[1][0], "otra@example.com");
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
  });
  assert.deepEqual(await security.resetPassword({ accessToken: "access", refreshToken: "refresh", claveNueva: "nueva1" }), { ok: true });
  assert.deepEqual(calls, [
    ["session", { access_token: "access", refresh_token: "refresh" }],
    ["update", { password: "nueva1" }],
    ["signout", { scope: "local" }],
  ]);
});
