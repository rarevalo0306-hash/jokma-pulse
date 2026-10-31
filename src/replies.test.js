import assert from "node:assert/strict";
import test from "node:test";
import { CHANNELS, TONE_BY_CHANNEL } from "./tones.js";
import { buildSeed } from "./seed.js";
import {
  auditReply,
  countEmojis,
  extractDetail,
  generateReply,
} from "./replies.js";

function pack(id, seed = buildSeed()) {
  const message = seed.messages.find((item) => item.id === id);
  const account = seed.accounts.find((item) => item.id === message.cuentaId);
  const reply = generateReply(account, message);
  const revision = auditReply(account, message, reply);
  return { seed, message, account, reply, revision };
}

test("la semilla cubre empresas, cuentas y canales", () => {
  const seed = buildSeed();
  assert.equal(seed.companies.length, 2);
  assert.notEqual(seed.companies[0].industria, seed.companies[1].industria);
  for (const company of seed.companies) {
    const accounts = seed.accounts.filter((item) => item.empresaId === company.id);
    assert.ok(accounts.length > 1, company.nombre);
    const names = new Set(accounts.map((item) => item.agente.nombre));
    assert.equal(names.size, accounts.length);
    for (const account of accounts) {
      assert.equal(account.agente.tipo, "atencion");
      assert.equal(account.agente.industria, company.industria);
      assert.equal(account.agente.ficha.nombre, company.nombre);
      assert.equal(account.agente.tono, TONE_BY_CHANNEL[account.canal]);
    }
  }
  const channels = new Set(seed.accounts.map((item) => item.canal));
  for (const channel of CHANNELS) assert.ok(channels.has(channel), channel);
  const messageChannels = new Set(seed.messages.map((item) => item.canal));
  for (const channel of CHANNELS) assert.ok(messageChannels.has(channel), channel);

  const lumenIg = seed.accounts.filter((item) => item.cuenta === "@cafelumen");
  assert.equal(lumenIg.length, 3);
  assert.equal(new Set(lumenIg.map((item) => item.agente.nombre)).size, 3);
});

test("reseña positiva cita un detalle literal", () => {
  const { reply, revision, message, account } = pack("msg-lumen-review-pos");
  assert.equal(revision.ok, true, revision.issues.join(","));
  const detail = extractDetail(message.texto);
  assert.equal(detail, "El latte de vainilla estaba delicioso");
  assert.ok(message.texto.includes(detail));
  assert.ok(reply.includes(detail));
  assert.match(reply, /5 estrellas/);
  assert.equal(countEmojis(reply), 0);
  assert.doesNotMatch(reply, /dentalarce|4500 2290|tarjeta|contraseña/i);
  assert.equal(account.agente.nombre, "Lumen Reseñas");
});

test("reseña negativa se disculpa y pasa a soporte privado", () => {
  const { reply, revision } = pack("msg-arce-review-neg");
  assert.equal(revision.ok, true, revision.issues.join(","));
  assert.match(reply, /lamentamos/i);
  assert.match(reply, /privado/);
  assert.ok(reply.includes("+52 33 4500 2290"));
  assert.doesNotMatch(reply, /\bpero\b|no es cierto|te equivocas/i);
  assert.doesNotMatch(reply, /cafelumen|salí a las 12/i);
  assert.equal(countEmojis(reply), 0);
});

test("sin soporte, la reseña negativa pide teléfono o correo", () => {
  const seed = buildSeed();
  const account = structuredClone(
    seed.accounts.find((item) => item.id === "ac-arce-reviews"),
  );
  account.agente.ficha.soporte = "";
  const message = seed.messages.find((item) => item.id === "msg-arce-review-neg");
  const reply = generateReply(account, message);
  assert.match(reply, /teléfono o un correo/i);
  assert.match(reply, /privado/);
  assert.doesNotMatch(reply, /4500 2290/);
  assert.equal(auditReply(account, message, reply).ok, true);
});

test("el DM de horario usa la ficha de esa cuenta y un solo llamado", () => {
  const { reply, revision } = pack("msg-lumen-ig-dm");
  assert.equal(revision.ok, true, revision.issues.join(","));
  assert.ok(reply.includes("Lunes a viernes 7:30–19:00, sábados 8:00–14:00"));
  assert.ok(reply.includes("hola@cafelumen.mx"));
  assert.equal(countEmojis(reply), 1);
  assert.doesNotMatch(reply, /dentalarce|limpieza dental/i);
});

test("la respuesta no toma datos de otra ficha", () => {
  const seed = buildSeed();
  const account = structuredClone(
    seed.accounts.find((item) => item.id === "ac-lumen-ig-dm"),
  );
  account.agente.ficha.horarios = "Solo los martes 10:00–11:00";
  account.agente.ficha.correoOficial = "unico-lumen@example.com";
  const message = seed.messages.find((item) => item.id === "msg-lumen-ig-dm");
  const reply = generateReply(account, message);
  assert.ok(reply.includes("Solo los martes 10:00–11:00"));
  assert.ok(reply.includes("unico-lumen@example.com"));
  assert.doesNotMatch(reply, /cafelumen\.mx|dentalarce|7:30/);
  assert.equal(auditReply(account, message, reply).ok, true);
});

test("messenger confirma el servicio sin inventar el cupo del sábado", () => {
  const { reply, revision } = pack("msg-arce-fb-dm");
  assert.equal(revision.ok, true, revision.issues.join(","));
  assert.ok(reply.includes("Limpieza dental, ortodoncia y urgencias"));
  assert.ok(reply.includes("Lunes a viernes 9:00–19:00, sábados 9:00–14:00"));
  assert.ok(reply.includes("+52 33 4500 2288"));
  assert.equal(countEmojis(reply), 1);
  assert.doesNotMatch(reply, /limpieza los sábados|sábados hay limpieza/i);
  assert.doesNotMatch(reply, /cafelumen/i);
});

test("el comentario con dato de pago se va a privado y no lo repite", () => {
  const { reply, revision, message } = pack("msg-lumen-ig-comment");
  assert.equal(revision.ok, true, revision.issues.join(","));
  assert.equal(reply.split("\n").filter((line) => line.trim()).length, 2);
  assert.match(reply, /mensaje privado/i);
  assert.equal(reply.includes("4421"), false);
  assert.doesNotMatch(reply, /contraseña|cvv|seguro social/i);
  assert.equal(message.texto.includes("4421"), true);
});

test("el comentario público responde con la ficha en una o dos líneas", () => {
  const { reply, revision } = pack("msg-arce-fb-comment");
  assert.equal(revision.ok, true, revision.issues.join(","));
  const lines = reply.split("\n").filter((line) => line.trim());
  assert.ok(lines.length >= 1 && lines.length <= 2);
  assert.ok(reply.includes("Lunes a viernes 9:00–19:00, sábados 9:00–14:00"));
  assert.ok(reply.includes("Limpieza dental, ortodoncia y urgencias"));
  assert.doesNotMatch(reply, /abiertos los domingos|sí, los domingos/i);
});

test("el reclamo en X se va a DM y cabe en una nota corta", () => {
  const { reply, revision } = pack("msg-arce-x-post");
  assert.equal(revision.ok, true, revision.issues.join(","));
  assert.match(reply, /lo sentimos/i);
  assert.match(reply, /\bDM\b/);
  assert.ok(reply.length <= 180);
  assert.equal(countEmojis(reply), 0);
  assert.doesNotMatch(reply, /4500 2290|dolor/i);
});

test("si el menú no está en la ficha, X pide un correo", () => {
  const { reply, revision } = pack("msg-lumen-x-dm");
  assert.equal(revision.ok, true, revision.issues.join(","));
  assert.match(reply, /no está en la ficha/i);
  assert.match(reply, /correo/i);
  assert.doesNotMatch(reply, /chilaquiles|croissant|huevos|tostada/i);
  assert.ok(reply.length <= 180);
});

test("el correo es formal y no inventa facturación", () => {
  const { reply, revision } = pack("msg-lumen-email");
  assert.equal(revision.ok, true, revision.issues.join(","));
  assert.ok(reply.startsWith("Estimado/a Roberto Salinas:"));
  assert.ok(reply.includes("Atentamente"));
  assert.ok(reply.includes("Le pedimos"));
  assert.ok(reply.includes("Lunes a viernes 7:30–19:00, sábados 8:00–14:00"));
  assert.ok(reply.includes("hola@cafelumen.mx"));
  assert.match(reply, /no incluye un correo de facturación/i);
  assert.match(reply, /teléfono o un correo/i);
  assert.equal(countEmojis(reply), 0);
  assert.doesNotMatch(reply, /correo de facturación es|facturación: hola@/i);
});

test("ninguna respuesta de ejemplo pide secretos ni falla la auditoría", () => {
  const seed = buildSeed();
  for (const message of seed.messages) {
    const { reply, revision } = pack(message.id, seed);
    assert.equal(revision.ok, true, `${message.id}: ${revision.issues.join(",")}\n${reply}`);
    assert.equal(
      /(env[ií]a|pasa|comparte|dime).{0,40}(contraseña|tarjeta|cvv|seguro social)/i.test(
        reply,
      ),
      false,
      message.id,
    );
  }
});
