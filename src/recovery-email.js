import nodemailer from "nodemailer";

function clean(value, max = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function port(value) {
  const number = Number(value || 587);
  return Number.isInteger(number) && number > 0 && number <= 65535 ? number : 587;
}

function enabled(value) {
  return ["1", "true", "yes"].includes(String(value || "").toLowerCase());
}

export function recoveryEmailConfiguration(env = process.env) {
  const host = clean(env.PULSE_RECOVERY_SMTP_HOST, 255);
  const user = clean(env.PULSE_RECOVERY_SMTP_USER, 254);
  const password = String(env.PULSE_RECOVERY_SMTP_PASSWORD || "");
  const from = clean(env.PULSE_RECOVERY_EMAIL_FROM || user, 320);
  if (!host || !from || (user && !password)) return null;
  return {
    transport: {
      host,
      port: port(env.PULSE_RECOVERY_SMTP_PORT),
      secure: enabled(env.PULSE_RECOVERY_SMTP_SECURE) || Number(env.PULSE_RECOVERY_SMTP_PORT) === 465,
      ...(user ? { auth: { user, pass: password } } : {}),
    },
    from,
  };
}

export function createRecoveryMailer({ env = process.env, transportFactory = nodemailer.createTransport } = {}) {
  const configuration = recoveryEmailConfiguration(env);
  return {
    configured: Boolean(configuration),
    async send({ to, link }) {
      if (!configuration) throw Object.assign(new Error("El remitente de recuperación no está configurado."), { status: 503 });
      const recipient = clean(to, 254).toLowerCase();
      const recoveryLink = clean(link, 4000);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw Object.assign(new Error("El correo de recuperación no es válido."), { status: 400 });
      const parsed = new URL(recoveryLink);
      if (parsed.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(parsed.hostname)) {
        throw Object.assign(new Error("El enlace de recuperación no es seguro."), { status: 500 });
      }
      const transport = transportFactory(configuration.transport);
      await transport.sendMail({
        from: configuration.from,
        to: recipient,
        subject: "Recupera tu acceso a Jokma Pulse",
        text: `Recibimos una solicitud para cambiar tu clave de Jokma Pulse. Abre este enlace durante la próxima hora:\n\n${recoveryLink}\n\nSi no hiciste esta solicitud, ignora este correo.`,
        html: `<h2>Recupera tu acceso a Jokma Pulse</h2><p>Recibimos una solicitud para cambiar tu clave.</p><p><a href="${recoveryLink.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">Elegir una clave nueva</a></p><p>Este enlace vence en una hora. Si no hiciste esta solicitud, ignora este correo.</p>`,
      });
      return { ok: true };
    },
  };
}
