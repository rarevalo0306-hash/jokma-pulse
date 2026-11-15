import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { normalizeSettings } from "./settings.js";

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function port(value, fallback) {
  const parsed = Number(value || fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw fail(400, "El puerto de correo no es válido.");
  return parsed;
}

function email(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : "";
}

export function emailConfiguration(company) {
  const settings = normalizeSettings(company?.ajustes, company);
  const user = email(settings.smtp_user);
  const password = settings.smtp_password;
  const smtpHost = String(settings.smtp_host || "").trim();
  const imapHost = String(settings.imap_host || smtpHost).trim();
  if (!smtpHost || !user || !password) throw fail(409, "Completa servidor, usuario y contraseña de correo.");
  return {
    smtp: {
      host: smtpHost,
      port: port(settings.smtp_port, 587),
      secure: String(settings.smtp_secure || "").toLowerCase() === "true" || Number(settings.smtp_port) === 465,
      auth: { user, pass: password },
    },
    imap: {
      host: imapHost,
      port: port(settings.imap_port, 993),
      secure: String(settings.imap_secure || "true").toLowerCase() !== "false",
      auth: { user, pass: password },
      logger: false,
    },
    from: email(settings.email_from) || user,
    accountAddress: user,
  };
}

export async function sendEmailReply({ company, message, transportFactory = nodemailer.createTransport }) {
  const recipient = email(message?.direccionCliente || message?.nombreCliente);
  if (!recipient) throw fail(409, "Este mensaje no conserva una dirección de correo válida para responder.");
  const body = String(message?.borrador || message?.respuesta || "").trim();
  if (!body) throw fail(409, "El mensaje necesita un borrador aprobado.");
  if (message?.estadoRespuesta !== "aprobado" && message?.estadoRespuesta !== "error") {
    throw fail(409, "Aprueba el borrador antes de enviarlo.");
  }
  const configuration = emailConfiguration(company);
  const transport = transportFactory(configuration.smtp);
  const result = await transport.sendMail({
    from: configuration.from,
    to: recipient,
    subject: message.asunto ? `Re: ${String(message.asunto).replace(/^re:\s*/i, "")}` : "Respuesta de atención al cliente",
    text: body,
  });
  return { providerMessageId: String(result?.messageId || "") };
}

export async function verifyEmailConnection({
  company,
  transportFactory = nodemailer.createTransport,
  clientFactory = (options) => new ImapFlow(options),
}) {
  const configuration = emailConfiguration(company);
  const transport = transportFactory(configuration.smtp);
  await transport.verify();
  const client = clientFactory(configuration.imap);
  try {
    await client.connect();
  } finally {
    await client.logout().catch(() => {});
  }
  return { address: configuration.accountAddress, smtp: true, imap: true };
}

export async function syncEmailInbox({
  company,
  clientFactory = (options) => new ImapFlow(options),
  parseMessage = simpleParser,
}) {
  const configuration = emailConfiguration(company);
  const client = clientFactory(configuration.imap);
  const events = [];
  await client.connect();
  let lock;
  try {
    lock = await client.getMailboxLock("INBOX");
    const uids = await client.search({ seen: false }, { uid: true });
    if (!uids.length) return events;
    for await (const item of client.fetch(uids, { uid: true, envelope: true, source: true }, { uid: true })) {
      const parsed = await parseMessage(item.source);
      const sender = parsed.from?.value?.[0] || {};
      const fromAddress = email(sender.address);
      const text = String(parsed.text || parsed.html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000);
      if (!fromAddress || !text) continue;
      events.push({
        accountAddress: configuration.accountAddress,
        fromAddress,
        displayName: String(sender.name || fromAddress).trim().slice(0, 160),
        subject: String(parsed.subject || item.envelope?.subject || "").trim().slice(0, 300),
        text,
        externalId: String(parsed.messageId || `imap-${item.uid}`).trim().slice(0, 240),
      });
      await client.messageFlagsAdd(item.uid, ["\\Seen"], { uid: true });
    }
    return events;
  } finally {
    lock?.release();
    await client.logout().catch(() => {});
  }
}
