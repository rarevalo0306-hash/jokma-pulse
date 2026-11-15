function fail(status, message) {
  return Object.assign(new Error(message), { status });
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

export function createAccountSecurity({ admin, authenticate } = {}) {
  if (!admin?.auth?.admin || typeof authenticate !== "function") {
    throw new Error("La seguridad de la cuenta necesita Supabase Auth.");
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

  return { changePassword };
}
