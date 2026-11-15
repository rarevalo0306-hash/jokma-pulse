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
