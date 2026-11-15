import assert from "node:assert/strict";
import test from "node:test";
import { createRecoveryMailer, recoveryEmailConfiguration } from "./recovery-email.js";

test("la configuración de recuperación exige remitente y protege la contraseña", () => {
  assert.equal(recoveryEmailConfiguration({}), null);
  assert.equal(recoveryEmailConfiguration({ PULSE_RECOVERY_SMTP_HOST: "smtp.example.com", PULSE_RECOVERY_SMTP_USER: "pulse@example.com" }), null);
  const configuration = recoveryEmailConfiguration({
    PULSE_RECOVERY_SMTP_HOST: "smtp.example.com",
    PULSE_RECOVERY_SMTP_PORT: "465",
    PULSE_RECOVERY_SMTP_USER: "pulse@example.com",
    PULSE_RECOVERY_SMTP_PASSWORD: "private-test-value",
    PULSE_RECOVERY_EMAIL_FROM: "Jokma Pulse <pulse@example.com>",
  });
  assert.equal(configuration.transport.secure, true);
  assert.equal(configuration.transport.auth.user, "pulse@example.com");
  assert.equal(configuration.from, "Jokma Pulse <pulse@example.com>");
});

test("envía un enlace HTTPS sin filtrar credenciales en el mensaje", async () => {
  let transportConfiguration;
  let message;
  const mailer = createRecoveryMailer({
    env: {
      PULSE_RECOVERY_SMTP_HOST: "smtp.example.com",
      PULSE_RECOVERY_SMTP_USER: "pulse@example.com",
      PULSE_RECOVERY_SMTP_PASSWORD: "private-test-value",
    },
    transportFactory(configuration) {
      transportConfiguration = configuration;
      return { async sendMail(input) { message = input; return { messageId: "test" }; } };
    },
  });
  await mailer.send({ to: "person@example.com", link: "https://pulse.jokma.app/api/cuenta/confirmar-recuperacion?token_hash=abc" });
  assert.equal(mailer.configured, true);
  assert.equal(transportConfiguration.auth.pass, "private-test-value");
  assert.equal(message.to, "person@example.com");
  assert.equal(message.html.includes("token_hash=abc"), true);
  assert.equal(JSON.stringify(message).includes("private-test-value"), false);
});
