function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function clean(value, max = 254) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function validateNewPassword(value) {
  const password = String(value ?? "");
  if (password.length < 6) throw fail(400, "La clave nueva necesita al menos 6 caracteres.");
  if (password.length > 128) throw fail(400, "La clave nueva no puede superar 128 caracteres.");
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) {
    throw fail(400, "La clave nueva debe incluir letras y números.");
  }
  return password;
}

export function createAccountSecurity({ admin, authenticate, createAuthClient } = {}) {
  if (!admin?.auth?.admin || typeof authenticate !== "function" || typeof createAuthClient !== "function") {
    throw new Error("La seguridad de la cuenta necesita Supabase Auth.");
  }

  async function recoveryEmail(identifier) {
    const value = clean(identifier).toLowerCase();
    if (!value) throw fail(400, "Escribe tu usuario o correo.");
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return value;
    const profile = await admin.from("profiles").select("id").eq("username", value).maybeSingle();
    if (profile.error || !profile.data?.id) return "";
    const user = await admin.auth.admin.getUserById(profile.data.id);
    return user.data?.user?.email?.toLowerCase() || "";
  }

  async function requestPasswordReset(input = {}, redirectTo) {
    const email = await recoveryEmail(input.identificador);
    if (!email) return { ok: true };
    const client = createAuthClient();
    const result = await client.auth.resetPasswordForEmail(email, { redirectTo });
    if (result.error) throw fail(503, "No pudimos enviar el correo de recuperación. Inténtalo nuevamente.");
    return { ok: true };
  }

  async function resetPassword(input = {}) {
    const accessToken = clean(input.accessToken, 5000);
    const refreshToken = clean(input.refreshToken, 5000);
    const nextPassword = validateNewPassword(input.claveNueva);
    if (!accessToken || !refreshToken) throw fail(400, "El enlace de recuperación está incompleto.");
    const client = createAuthClient();
    const session = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (session.error || !session.data?.user) throw fail(410, "El enlace de recuperación venció o ya no es válido.");
    const updated = await client.auth.updateUser({ password: nextPassword });
    if (updated.error) throw fail(400, "No pudimos guardar la clave nueva. Solicita otro enlace.");
    await client.auth.signOut({ scope: "local" }).catch(() => {});
    return { ok: true };
  }

  async function changePassword(user, input = {}) {
    const currentPassword = String(input.claveActual ?? "");
    const nextPassword = validateNewPassword(input.claveNueva);
    if (!currentPassword) throw fail(400, "Escribe tu clave actual.");
    if (currentPassword === nextPassword) throw fail(400, "La clave nueva debe ser diferente a la actual.");
    const access = await authenticate(user.usuario, currentPassword);
    if (!access || access.user.id !== user.id) throw fail(401, "La clave actual no es correcta.");
    const updated = await admin.auth.admin.updateUserById(user.id, { password: nextPassword });
    if (updated.error) throw fail(500, "No se pudo cambiar la clave. Inténtalo de nuevo.");
    return { ok: true };
  }

  return { changePassword, requestPasswordReset, resetPassword };
}
