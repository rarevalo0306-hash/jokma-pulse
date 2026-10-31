const CTA_VERBS = /\b(Escríbenos|Escribenos|Déjanos|Dejanos|Llámanos|Llamanos|Visítanos|Visitanos|Responde)\b/g;

export function countEmojis(text) {
  const matches = String(text || "").match(/\p{Extended_Pictographic}/gu);
  return matches ? matches.length : 0;
}

export function norm(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

export function extractDetail(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const parts = cleaned.split(/(?<=[.!?])\s+/);
  let sentence =
    parts.find((part) => part.replace(/[.!?¿¡]/g, "").trim().length >= 12) ||
    cleaned;
  sentence = sentence.trim();
  if (sentence.length > 110) {
    const cut = sentence.slice(0, 110);
    const lastSpace = cut.lastIndexOf(" ");
    sentence = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim();
  }
  sentence = sentence.replace(/[.!?]+$/g, "").trim();
  if (!cleaned.includes(sentence)) {
    const cut = cleaned.slice(0, 80);
    const lastSpace = cut.lastIndexOf(" ");
    sentence = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut)
      .replace(/[.!?]+$/g, "")
      .trim();
  }
  return sentence;
}

export function isComplaint(text) {
  const n = norm(text);
  return /queja|pesim|terrible|incomplet|reclamo|decepcion|horrible|nadie contesta|nadie me|mala atencion|pesima|estafa|nunca mas|no me atend/.test(
    n,
  );
}

export function needsPrivate(text) {
  const raw = String(text || "");
  const n = norm(raw);
  return (
    /pedido|repon|reembolso|devoluci|tarjeta|cvv|contrasen|seguro social|mi cuenta|incomplet|queja|reclamo|pesim|nadie/.test(
      n,
    ) || /\d{4,}/.test(raw)
  );
}

export function requestsSecrets(text) {
  const n = norm(text);
  return /(envi|envia|pasa|comparte|dime|indica|escribe|manda|deja|dame|proporciona).{0,48}(contrasena|tarjeta|cvv|nip|seguro social|nss)/.test(
    n,
  );
}

function asksForSensitive(text) {
  const n = norm(text);
  return /contrasena|password|tarjeta|cvv|\bnip\b|seguro social|\bnss\b|numero de cuenta|clave bancaria/.test(
    n,
  );
}

function cleanName(name) {
  const trimmed = String(name || "").replace(/\s+/g, " ").trim();
  return trimmed || "cliente";
}

export function collectFacts(ficha, text) {
  const n = norm(text);
  const facts = [];
  const missing = [];
  const serviceWords = norm(ficha.servicios || "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 4);

  const wantHours = /horario|a que hora|abren|cierran|sabado|domingo|abierto|atienden/.test(
    n,
  );
  const wantMenu = /\bmenu\b/.test(n);
  const wantInvoice = /factur/.test(n);
  const wantPrice = /precio|costo|cuanto cuesta|tarifa/.test(n);
  const wantPhone = /telefono|whatsapp/.test(n) || /\bllamar\b/.test(n);
  const wantEmail = /correo|email|e-mail/.test(n);
  const wantWeb = /\bweb\b|\bsitio\b|\bpagina\b/.test(n);
  const wantServices =
    !wantMenu &&
    (/servicio|producto|ofrecen|\bhacen\b/.test(n) ||
      serviceWords.some((word) => n.includes(word)));

  if (wantHours) {
    if (ficha.horarios) facts.push(`Horario: ${ficha.horarios}.`);
    else missing.push("el horario");
  }
  if (wantServices) {
    if (ficha.servicios) facts.push(`Ofrecemos ${ficha.servicios}.`);
    else missing.push("los servicios");
  }
  if (wantMenu) missing.push("el menú");
  if (wantPrice) missing.push("el precio");
  if (wantInvoice) missing.push("un correo de facturación");
  if (wantPhone) {
    if (ficha.telefono) facts.push(`Teléfono: ${ficha.telefono}.`);
    else missing.push("el teléfono");
  }
  if (wantEmail && !wantInvoice) {
    if (ficha.correoOficial) facts.push(`Correo oficial: ${ficha.correoOficial}.`);
    else missing.push("el correo");
  }
  if (wantInvoice && ficha.correoOficial) {
    facts.push(`Correo oficial: ${ficha.correoOficial}.`);
  }
  if (wantWeb) {
    if (ficha.sitioWeb) facts.push(`Sitio web: ${ficha.sitioWeb}.`);
    else missing.push("el sitio web");
  }

  return {
    facts: [...new Set(facts)],
    missing: [...new Set(missing)],
  };
}

function contactLine(ficha) {
  return ficha.correoOficial || ficha.telefono || ficha.soporte || "";
}

function followUpCta() {
  return "Déjanos un teléfono o un correo y un representante te contacta.";
}

function dmCta(ficha) {
  if (ficha.correoOficial) {
    return `Escríbenos a ${ficha.correoOficial} si quieres visitarnos.`;
  }
  if (ficha.telefono) return `Llámanos al ${ficha.telefono} si quieres visitarnos.`;
  if (ficha.sitioWeb) return `Visítanos en ${ficha.sitioWeb}.`;
  return followUpCta();
}

function confirmCta(ficha) {
  if (ficha.telefono) {
    return `Llámanos al ${ficha.telefono} para confirmar disponibilidad.`;
  }
  if (ficha.correoOficial) {
    return `Escríbenos a ${ficha.correoOficial} para confirmar disponibilidad.`;
  }
  return "Déjanos un teléfono o un correo y un representante te confirma.";
}

function chooseCta(ficha, facts, missing) {
  if (missing.length && facts.length === 0) return followUpCta();
  if (missing.length) {
    return "Déjanos un teléfono o un correo y un representante te confirma lo que falta.";
  }
  const hasServices = facts.some((fact) => fact.startsWith("Ofrecemos"));
  const hasHours = facts.some((fact) => fact.startsWith("Horario"));
  if (hasServices && hasHours) return confirmCta(ficha);
  return dmCta(ficha);
}

function replyReview(ficha, name, text, rating) {
  const stars = Number(rating);
  if (!(stars >= 1 && stars <= 5)) {
    return `Hola ${name}, gracias por escribir.\n\nPara responder con un dato de la ficha, déjanos un teléfono o un correo y un representante de ${ficha.nombre} te contacta.`;
  }
  if (stars <= 3) {
    if (ficha.soporte) {
      return `Hola ${name}, lamentamos que tu experiencia no haya sido la que esperabas.\n\nNo vamos a discutir lo ocurrido. Para atenderte en privado, contacta a ${ficha.soporte} y un representante de ${ficha.nombre} dará seguimiento.`;
    }
    return `Hola ${name}, lamentamos que tu experiencia no haya sido la que esperabas.\n\nPara atenderte en privado, déjanos un teléfono o un correo y un representante de ${ficha.nombre} te contacta.`;
  }
  const detail = extractDetail(text);
  if (!detail || !String(text).includes(detail)) {
    return `Hola ${name}, gracias por tus ${stars} estrellas.\n\nNo vamos a inventar un detalle. Déjanos un teléfono o un correo y un representante de ${ficha.nombre} te escribe.`;
  }
  return `Hola ${name}, gracias por tus ${stars} estrellas.\n\nNos alegra leer esto: «${detail}».\n\nGracias por contarlo. Te esperamos de nuevo en ${ficha.nombre}.`;
}

function replyDm(ficha, name, text) {
  if (asksForSensitive(text)) {
    const contact = contactLine(ficha);
    const cta = contact
      ? `Escríbenos a ${contact} por el canal oficial.`
      : followUpCta();
    return `Hola ${name} 👋 No podemos resolver ese trámite por este medio. ${cta}`;
  }
  const { facts, missing } = collectFacts(ficha, text);
  if (isComplaint(text) && facts.length === 0) {
    const dest = ficha.soporte || ficha.correoOficial || ficha.telefono;
    const cta = dest
      ? `Escríbenos a ${dest} y lo vemos en privado.`
      : followUpCta();
    return `Hola ${name} 🙏 Sentimos lo que pasó. ${cta}`;
  }
  const cta = chooseCta(ficha, facts, missing);
  if (!facts.length) {
    return `Hola ${name} 👋 Ese dato no está en la ficha de ${ficha.nombre}. ${cta}`;
  }
  const extra = missing.length
    ? ` Lo demás no está en la ficha de ${ficha.nombre}.`
    : "";
  return `Hola ${name} 👋 ${facts.join(" ")}${extra} ${cta}`.replace(/\s+/g, " ").trim();
}

function replyComment(ficha, name, text) {
  if (asksForSensitive(text) || needsPrivate(text)) {
    return [
      `Hola ${name}, gracias por escribir.`,
      "Te enviamos un mensaje privado para resolverlo; no compartas datos de pago aquí.",
    ].join("\n");
  }
  const { facts, missing } = collectFacts(ficha, text);
  if (!facts.length || missing.length) {
    return `Hola ${name}, te escribimos por mensaje privado para confirmarlo.`;
  }
  return facts
    .slice(0, 2)
    .map((fact, index) => (index === 0 ? `Hola ${name}, ${fact}` : fact))
    .join("\n");
}

function fitX(reply) {
  const clean = reply.replace(/\s+/g, " ").trim();
  if (clean.length <= 180) return clean;
  return clean.slice(0, 177).replace(/\s+\S*$/, "").trim();
}

function replyX(canal, ficha, name, text) {
  if (canal === "x_post" && (isComplaint(text) || needsPrivate(text))) {
    return fitX(`${name}, lo sentimos. Te escribimos por DM ahora para darle seguimiento.`);
  }
  const { facts, missing } = collectFacts(ficha, text);
  if (!facts.length || missing.length) {
    return fitX(
      `Hola ${name}. Ese dato no está en la ficha. Déjanos tu correo y te escribimos.`,
    );
  }
  const bit = facts[0].replace(/\.$/, "");
  const cta = ficha.correoOficial ? ` Escríbenos a ${ficha.correoOficial}.` : "";
  return fitX(`Hola ${name}. ${bit}.${cta}`);
}

function replyEmail(ficha, name, text) {
  const { facts, missing } = collectFacts(ficha, text);
  const lines = [`Estimado/a ${name}:`, "", `Gracias por escribir a ${ficha.nombre}.`, ""];

  if (asksForSensitive(text)) {
    lines.push(
      "No solicitamos contraseñas, tarjetas ni números de seguro social por correo.",
      "",
    );
  }

  if (facts.length) {
    lines.push("Esto es lo que figura en la ficha:", "");
    for (const fact of facts) lines.push(`- ${fact.replace(/\.$/, "")}`);
    lines.push("");
  }

  if (missing.length) {
    lines.push(`La ficha no incluye ${missing.join(", ")}.`, "");
    lines.push(
      `Le pedimos responder con un teléfono o un correo de contacto para que un representante de ${ficha.nombre} confirme ese punto.`,
    );
  } else if (facts.length) {
    const contact = contactLine(ficha);
    lines.push(
      contact
        ? `Le pedimos responder a este correo si desea que un representante de ${ficha.nombre} amplíe la información. Puede escribir a ${contact}.`
        : `Le pedimos responder a este correo con un teléfono o un correo de contacto para que un representante de ${ficha.nombre} amplíe la información.`,
    );
  } else if (isComplaint(text)) {
    const dest = ficha.soporte || ficha.correoOficial || ficha.telefono;
    lines.push("Lamentamos lo ocurrido y no vamos a discutir su experiencia.", "");
    lines.push(
      dest
        ? `Le pedimos escribir a ${dest} para continuar la atención en privado.`
        : `Le pedimos responder con un teléfono o un correo de contacto para que un representante de ${ficha.nombre} le atienda en privado.`,
    );
  } else {
    lines.push("La ficha no incluye un dato que responda a su mensaje.", "");
    lines.push(
      `Le pedimos responder con un teléfono o un correo de contacto para que un representante de ${ficha.nombre} le contacte.`,
    );
  }

  lines.push("", "Atentamente,", ficha.nombre);
  const sign = ficha.correoOficial || ficha.telefono || "";
  if (sign) lines.push(sign);
  return lines.join("\n");
}

export function generateReply(account, message) {
  const ficha = account?.agente?.ficha;
  if (!ficha || !ficha.nombre) {
    throw Object.assign(new Error("Esta cuenta no tiene ficha."), { status: 400 });
  }
  const canal = account.canal;
  const name = cleanName(message?.nombreCliente);
  const text = String(message?.texto || "");

  switch (canal) {
    case "google_reviews":
      return replyReview(ficha, name, text, message?.calificacion);
    case "instagram_dm":
    case "facebook_messenger":
      return replyDm(ficha, name, text);
    case "instagram_comment":
    case "facebook_comment":
      return replyComment(ficha, name, text);
    case "x_post":
    case "x_dm":
      return replyX(canal, ficha, name, text);
    case "email":
      return replyEmail(ficha, name, text);
    default:
      throw Object.assign(new Error("Canal no reconocido."), { status: 400 });
  }
}

function listedContacts(text) {
  const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const phones = text.match(/\+\d{1,3}(?:[\s-]\d{2,})+/g) || [];
  const urls = text.match(/https?:\/\/[^\s)]+/gi) || [];
  return [...emails, ...phones, ...urls];
}

function inventsContact(reply, ficha) {
  const blob = Object.values(ficha).join("\n");
  return listedContacts(reply).some((item) => {
    const clean = item.replace(/[.,;:]+$/g, "");
    return !blob.includes(clean);
  });
}

function countCta(reply) {
  const matches = String(reply).match(CTA_VERBS);
  return matches ? matches.length : 0;
}

export function auditReply(account, message, reply) {
  const issues = [];
  const canal = account.canal;
  const ficha = account.agente.ficha;
  const text = String(reply || "");
  const lines = text.split("\n").filter((line) => line.trim());

  if (!text.trim()) issues.push("vacia");
  if (requestsSecrets(text)) issues.push("pide_datos_sensibles");
  if (inventsContact(text, ficha)) issues.push("dato_ajeno");

  if (canal === "google_reviews") {
    const stars = Number(message.calificacion);
    if (countEmojis(text) > 1) issues.push("emojis_de_mas");
    if (stars >= 4) {
      const detail = extractDetail(message.texto);
      if (!detail || !String(message.texto).includes(detail) || !text.includes(detail)) {
        issues.push("no_cita_detalle");
      }
    } else if (stars <= 3) {
      if (!/lament/i.test(text)) issues.push("sin_disculpa");
      if (!/privado/i.test(text)) issues.push("sin_privado");
      if (/\bpero\b|sin embargo|no es cierto|te equivocas/i.test(text)) issues.push("discute");
      if (ficha.soporte && !text.includes(ficha.soporte)) issues.push("sin_soporte");
      if (!ficha.soporte && !/teléfono o un correo|telefono o un correo/i.test(text)) {
        issues.push("sin_pedido_de_contacto");
      }
    }
  }

  if (canal === "instagram_dm" || canal === "facebook_messenger") {
    const emojis = countEmojis(text);
    if (emojis < 1 || emojis > 2) issues.push("emojis");
    if (countCta(text) !== 1) issues.push("cta");
  }

  if (canal === "instagram_comment" || canal === "facebook_comment") {
    if (lines.length < 1 || lines.length > 2) issues.push("lineas");
    const digits = String(message.texto).match(/\d{4,}/g) || [];
    if (digits.some((digit) => text.includes(digit))) issues.push("repite_dato_personal");
    if (
      (needsPrivate(message.texto) || asksForSensitive(message.texto)) &&
      !/mensaje privado/i.test(text)
    ) {
      issues.push("sin_privado");
    }
  }

  if (canal === "x_post" || canal === "x_dm") {
    if (text.length > 180) issues.push("largo");
    if (countEmojis(text) > 0) issues.push("emoji");
    if (canal === "x_post" && isComplaint(message.texto) && !/\bDM\b/.test(text)) {
      issues.push("sin_dm");
    }
  }

  if (canal === "email") {
    if (countEmojis(text) > 0) issues.push("emoji");
    if (!text.startsWith("Estimado/a ")) issues.push("saludo");
    if (!text.includes("Atentamente")) issues.push("despedida");
    if (!text.includes("Le pedimos")) issues.push("cta");
    if (!text.includes(ficha.nombre)) issues.push("sin_empresa");
  }

  return { ok: issues.length === 0, issues };
}
