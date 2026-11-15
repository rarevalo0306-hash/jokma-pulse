import assert from "node:assert/strict";
import test from "node:test";
import { emailConfiguration, sendEmailReply, syncEmailInbox } from "./email.js";

const company = {
  nombre: "Cafetería Lumen",
  ajustes: {
    smtp_host: "smtp.example.com",
    smtp_port: "465",
    smtp_secure: "true",
    smtp_user: "hola@example.com",
    smtp_password: "credencial-de-prueba",
    imap_host: "imap.example.com",
    imap_port: "993",
    imap_secure: "true",
  },
};

test("la configuración directa separa SMTP e IMAP", () => {
  const configuration = emailConfiguration(company);
  assert.equal(configuration.smtp.host, "smtp.example.com");
  assert.equal(configuration.smtp.secure, true);
  assert.equal(configuration.imap.host, "imap.example.com");
  assert.equal(configuration.from, "hola@example.com");
});

test("el correo solo envía un borrador aprobado a una dirección válida", async () => {
  let sent;
  const result = await sendEmailReply({
    company,
    message: {
      nombreCliente: "cliente@example.net",
      asunto: "Consulta",
      borrador: "Gracias por escribirnos.",
      estadoRespuesta: "aprobado",
    },
    transportFactory: (options) => ({
      async sendMail(message) {
        sent = { options, message };
        return { messageId: "smtp-id-prueba" };
      },
    }),
  });
  assert.equal(sent.message.to, "cliente@example.net");
  assert.equal(sent.message.subject, "Re: Consulta");
  assert.equal(sent.options.auth.pass, "credencial-de-prueba");
  assert.deepEqual(result, { providerMessageId: "smtp-id-prueba" });
  await assert.rejects(
    () => sendEmailReply({ company, message: { nombreCliente: "Ada", borrador: "Hola", estadoRespuesta: "aprobado" } }),
    (error) => error.status === 409,
  );
});

test("la sincronización IMAP normaliza mensajes nuevos y los marca como leídos", async () => {
  const marked = [];
  const client = {
    async connect() {},
    async getMailboxLock() { return { release() {} }; },
    async search() { return [7]; },
    async *fetch() { yield { uid: 7, source: Buffer.from("mensaje"), envelope: { subject: "Ayuda" } }; },
    async messageFlagsAdd(uid) { marked.push(uid); },
    async logout() {},
  };
  const events = await syncEmailInbox({
    company,
    clientFactory: () => client,
    parseMessage: async () => ({
      from: { value: [{ name: "Ada", address: "ada@example.net" }] },
      subject: "Ayuda",
      text: "Necesito información",
      messageId: "mail-7",
    }),
  });
  assert.equal(events[0].fromAddress, "ada@example.net");
  assert.equal(events[0].text, "Necesito información");
  assert.deepEqual(marked, [7]);
});
