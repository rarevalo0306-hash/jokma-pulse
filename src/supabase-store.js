import { randomUUID } from "node:crypto";
import { snapshotFicha } from "./ficha.js";
import { splitSettings } from "./credentials.js";
import { normalizeSettings } from "./settings.js";
import { stableUuid } from "./supabase-import.js";
import { AGENT_TYPE, CHANNELS, isChannel, TONE_BY_CHANNEL } from "./tones.js";

const COMPANY_FIELDS = [
  "nombre",
  "industria",
  "servicios",
  "horarios",
  "telefono",
  "correoOficial",
  "sitioWeb",
  "soporte",
];

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function clean(value, max = 400) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function readCompanyInput(input, { partial = false } = {}) {
  const company = {};
  for (const field of COMPANY_FIELDS) {
    if (partial && input[field] === undefined) continue;
    const max = field === "servicios" || field === "horarios" ? 600 : 240;
    company[field] = clean(input[field], max);
  }
  if ((!partial || input.nombre !== undefined) && !company.nombre) {
    throw fail(400, "La empresa necesita un nombre.");
  }
  if ((!partial || input.industria !== undefined) && !company.industria) {
    throw fail(400, "La empresa necesita una industria.");
  }
  return company;
}

function check(result, context) {
  if (result.error) throw fail(500, `${context}: ${result.error.message}`);
  return result.data || [];
}

function companyFromRow(row) {
  const company = {
    id: row.id,
    organizacionId: row.organization_id,
    nombre: row.name,
    industria: row.industry,
    servicios: row.services,
    horarios: row.business_hours,
    telefono: row.phone,
    correoOficial: row.official_email,
    sitioWeb: row.website,
    soporte: row.support_contact,
  };
  company.ajustes = normalizeSettings(row.settings, company);
  company.credenciales = row.settings?._credential_status && typeof row.settings._credential_status === "object"
    ? row.settings._credential_status
    : {};
  return company;
}

function organizationFromRow(row) {
  return {
    id: row.id,
    nombre: row.name,
    slug: row.slug,
  };
}

function companyPatch(company) {
  return {
    name: company.nombre,
    industry: company.industria,
    services: company.servicios,
    business_hours: company.horarios,
    phone: company.telefono,
    official_email: company.correoOficial,
    website: company.sitioWeb,
    support_contact: company.soporte,
    updated_at: new Date().toISOString(),
  };
}

function accountFromRow(row, company) {
  return {
    id: row.id,
    empresaId: row.company_id,
    canal: row.channel,
    cuenta: row.label,
    agente: {
      tipo: AGENT_TYPE,
      nombre: row.agent_name,
      industria: company?.industria || "",
      tono: row.tone || TONE_BY_CHANNEL[row.channel] || "",
      ficha: snapshotFicha(company || {}),
    },
  };
}

function legacyReplyState(row) {
  const states = {
    approved: "aprobado",
    sending: "enviando",
    sent: "enviado",
    delivered: "entregado",
    error: "error",
  };
  if (states[row.delivery_state]) return states[row.delivery_state];
  if (row.metadata?.local_approved_at) return "aprobado";
  return row.reply_draft || row.delivery_state === "draft" ? "borrador" : "sin_borrador";
}

function messageFromRow(row, account, contact, conversation, notes = []) {
  const localApprovedAt = row.metadata?.local_approved_at || null;
  return {
    id: row.id,
    cuentaId: row.channel_account_id,
    empresaId: row.company_id,
    canal: account?.canal || "email",
    nombreCliente: contact?.display_name || "Contacto",
    texto: row.body,
    direccionCliente: row.metadata?.sender_address || null,
    asunto: row.metadata?.subject || null,
    externalId: row.external_message_id || null,
    conversationId: row.conversation_id,
    estadoConversacion: conversation?.status || "open",
    asignadoA: conversation?.assigned_user_id || null,
    notas: notes,
    calificacion: row.rating,
    muestra: row.metadata?.legacy_sample || null,
    respuesta: row.reply_draft || null,
    borrador: row.reply_draft || null,
    estadoRespuesta: legacyReplyState(row),
    respondidoEn: row.reply_draft ? row.updated_at : null,
    aprobadoEn: row.approved_at || localApprovedAt,
    createdAt: row.created_at,
  };
}

function normalizedIdentity(value) {
  return clean(value, 160).normalize("NFKC").toLocaleLowerCase("es");
}

function allowedCompanyIds(user) {
  return (user?.empresaIds || []).map((id) =>
    /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(id)) ? String(id) : stableUuid("company", id),
  );
}

export function createSupabaseStore(client, authStore, { createAuthClient, credentialStore } = {}) {
  async function load() {
    const [organizationRows, companyRows, accountRows, contactRows, conversationRows, messageRows, noteRows] = await Promise.all([
      client.from("organizations").select("id, slug, name"),
      client.from("companies").select("*"),
      client.from("channel_accounts").select("*"),
      client.from("contacts").select("*"),
      client.from("conversations").select("*"),
      client.from("messages").select("*"),
      client.from("conversation_notes").select("*"),
    ]);
    const organizations = check(organizationRows, "No se pudieron leer las organizaciones").map(organizationFromRow);
    const companies = check(companyRows, "No se pudieron leer las empresas").map(companyFromRow);
    const companyById = new Map(companies.map((item) => [item.id, item]));
    const accounts = check(accountRows, "No se pudieron leer las cuentas").map((row) =>
      accountFromRow(row, companyById.get(row.company_id)),
    );
    const accountById = new Map(accounts.map((item) => [item.id, item]));
    const contacts = check(contactRows, "No se pudieron leer los contactos");
    const contactById = new Map(contacts.map((item) => [item.id, item]));
    const conversations = check(conversationRows, "No se pudieron leer las conversaciones");
    const conversationById = new Map(conversations.map((item) => [item.id, item]));
    const contactByConversation = new Map(
      conversations.map((item) => [item.id, contactById.get(item.contact_id)]),
    );
    const notesByConversation = new Map();
    const userNames = new Map(authStore.getState().users.map((user) => [user.id, user.nombre]));
    for (const note of check(noteRows, "No se pudieron leer las notas")) {
      const notes = notesByConversation.get(note.conversation_id) || [];
      notes.push({ id: note.id, texto: note.body, autor: userNames.get(note.author_user_id) || "Equipo", createdAt: note.created_at });
      notesByConversation.set(note.conversation_id, notes);
    }
    const messages = check(messageRows, "No se pudieron leer los mensajes").map((row) =>
      messageFromRow(
        row,
        accountById.get(row.channel_account_id),
        contactByConversation.get(row.conversation_id),
        conversationById.get(row.conversation_id),
        notesByConversation.get(row.conversation_id) || [],
      ),
    );
    return {
      users: authStore.getState().users,
      organizations,
      companies,
      accounts,
      messages,
    };
  }

  async function getState() {
    return load();
  }

  async function getCompanyWithSecrets(id) {
    const state = await load();
    const company = state.companies.find((item) => item.id === id);
    if (!company) return null;
    const secrets = credentialStore ? await credentialStore.load(id) : {};
    return {
      ...company,
      ajustes: normalizeSettings({ ...company.ajustes, ...secrets }, company),
    };
  }

  async function getCompaniesWithSecrets() {
    const state = await load();
    return Promise.all(state.companies.map((company) => getCompanyWithSecrets(company.id)));
  }

  function userById(userId) {
    return authStore.getState().users.find((item) => item.id === userId) || null;
  }

  async function supabaseUserById(userId) {
    const profileResult = await client
      .from("profiles")
      .select("id, username, display_name, default_company_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileResult.error || !profileResult.data) return null;
    const [membershipsResult, organizationMembershipsResult] = await Promise.all([
      client.from("company_memberships").select("company_id, role").eq("user_id", userId).eq("active", true),
      client.from("organization_memberships").select("organization_id, role").eq("user_id", userId).eq("active", true),
    ]);
    if (membershipsResult.error || organizationMembershipsResult.error) return null;
    const companyIds = (membershipsResult.data || []).map((item) => item.company_id);
    return {
      id: profileResult.data.id,
      nombre: profileResult.data.display_name,
      usuario: profileResult.data.username,
      empresaIds: companyIds,
      rolesEmpresa: Object.fromEntries((membershipsResult.data || []).map((item) => [item.company_id, item.role])),
      organizacionIds: (organizationMembershipsResult.data || []).map((item) => item.organization_id),
      rolesOrganizacion: Object.fromEntries((organizationMembershipsResult.data || []).map((item) => [item.organization_id, item.role])),
      empresaPredeterminadaId: profileResult.data.default_company_id || companyIds[0] || null,
    };
  }

  async function authenticate(usuario, clave) {
    if (createAuthClient) {
      const username = clean(usuario, 80).toLowerCase();
      const password = String(clave ?? "").trim();
      if (!username || !password) return null;
      const profileResult = await client
        .from("profiles")
        .select("id")
        .eq("username", username)
        .maybeSingle();
      if (profileResult.error || !profileResult.data) return null;
      const authUserResult = await client.auth.admin.getUserById(profileResult.data.id);
      const email = authUserResult.data?.user?.email;
      if (authUserResult.error || !email) return null;
      const authClient = createAuthClient();
      const signedIn = await authClient.auth.signInWithPassword({ email, password });
      if (signedIn.error || signedIn.data?.user?.id !== profileResult.data.id) return null;
      const user = await supabaseUserById(profileResult.data.id);
      if (!user) return null;
      const state = await load();
      const allowed = allowedCompanyIds(user);
      const companies = state.companies.filter((item) => allowed.includes(item.id));
      const companyId = user.empresaPredeterminadaId || allowed[0];
      if (!companyId || !companies.some((item) => item.id === companyId)) return null;
      return {
        user: { id: user.id, nombre: user.nombre, usuario: user.usuario },
        companyId,
        companies,
      };
    }
    const legacy = authStore.authenticate(usuario, clave);
    if (!legacy) return null;
    const state = await load();
    const user = userById(legacy.user.id);
    const allowed = allowedCompanyIds(user);
    const companies = state.companies.filter((item) => allowed.includes(item.id));
    const defaultLegacy = user.empresaPredeterminadaId || user.empresaIds[0];
    const companyId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(defaultLegacy))
      ? String(defaultLegacy)
      : stableUuid("company", defaultLegacy);
    if (!companies.some((item) => item.id === companyId)) return null;
    return { user: legacy.user, companyId, companies };
  }

  async function sessionAccess(userId, companyId) {
    const user = createAuthClient ? await supabaseUserById(userId) : userById(userId);
    if (!user || !allowedCompanyIds(user).includes(companyId)) return null;
    const state = await load();
    const company = state.companies.find((item) => item.id === companyId);
    if (!company) return null;
    return { user, company };
  }

  async function scopedState(userId, companyId) {
    const access = await sessionAccess(userId, companyId);
    if (!access) throw fail(403, "Esa empresa no está disponible para este usuario.");
    const state = await load();
    const allowed = allowedCompanyIds(access.user);
    return {
      user: {
        id: access.user.id,
        nombre: access.user.nombre,
        usuario: access.user.usuario,
        rolesEmpresa: access.user.rolesEmpresa || {},
        rolesOrganizacion: access.user.rolesOrganizacion || {},
      },
      activeCompanyId: companyId,
      activeOrganizationId: access.company.organizacionId,
      organizations: state.organizations.filter((item) => (access.user.organizacionIds || []).includes(item.id)),
      companies: state.companies.filter((item) => allowed.includes(item.id)),
      accounts: state.accounts.filter((item) => item.empresaId === companyId),
      messages: state.messages.filter((item) => item.empresaId === companyId),
    };
  }

  async function createCompany(input) {
    const organizationId = clean(input.organizacionId, 80);
    const userId = clean(input.usuarioId, 80);
    if (!organizationId || !userId) throw fail(400, "Elige la organización de la empresa.");
    const membership = await client
      .from("organization_memberships")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("active", true)
      .maybeSingle();
    if (membership.error || !["owner", "admin"].includes(membership.data?.role)) {
      throw fail(403, "Solo un propietario o administrador puede agregar empresas.");
    }
    const company = { id: randomUUID(), organizacionId: organizationId, ...readCompanyInput(input) };
    for (const field of COMPANY_FIELDS) company[field] ||= "";
    const result = await client.from("companies").insert({
      id: company.id,
      organization_id: organizationId,
      slug: `empresa-${company.id.slice(0, 8)}`,
      ...companyPatch(company),
      settings: {},
    });
    check(result, "No se pudo crear la empresa");
    const role = membership.data.role === "owner" ? "owner" : "admin";
    const companyMembership = await client.from("company_memberships").insert({
      company_id: company.id,
      user_id: userId,
      role,
      active: true,
    });
    if (companyMembership.error) {
      await client.from("companies").delete().eq("id", company.id);
      check(companyMembership, "No se pudo dar acceso a la empresa");
    }
    return company;
  }

  async function createOrganization(userId, input) {
    const organizationName = clean(input.nombre, 160);
    if (!organizationName) throw fail(400, "La organización necesita un nombre.");
    const companyInput = readCompanyInput({ nombre: input.empresa, industria: input.industria });
    const organizationId = randomUUID();
    const companyId = randomUUID();
    const organization = { id: organizationId, nombre: organizationName, slug: `organizacion-${organizationId.slice(0, 8)}` };
    const company = { id: companyId, organizacionId: organizationId, ...companyInput };
    for (const field of COMPANY_FIELDS) company[field] ||= "";
    const createdOrganization = await client.from("organizations").insert({
      id: organizationId,
      slug: organization.slug,
      name: organizationName,
      created_by: userId,
    });
    check(createdOrganization, "No se pudo crear la organización");
    try {
      check(await client.from("organization_memberships").insert({ organization_id: organizationId, user_id: userId, role: "owner", active: true }), "No se pudo dar acceso a la organización");
      check(await client.from("companies").insert({ id: companyId, organization_id: organizationId, slug: `empresa-${companyId.slice(0, 8)}`, ...companyPatch(company), settings: {} }), "No se pudo crear la primera empresa");
      check(await client.from("company_memberships").insert({ company_id: companyId, user_id: userId, role: "owner", active: true }), "No se pudo dar acceso a la primera empresa");
    } catch (error) {
      await client.from("organizations").delete().eq("id", organizationId);
      throw error;
    }
    return { organization, company };
  }

  async function updateCompany(id, input) {
    const state = await load();
    const company = state.companies.find((item) => item.id === id);
    if (!company) throw fail(404, "No encontramos esa empresa.");
    Object.assign(company, readCompanyInput(input));
    if (company.ajustes) {
      company.ajustes.organization = company.nombre;
      company.ajustes.products = company.servicios;
    }
    const { publicSettings } = splitSettings(company.ajustes);
    company.ajustes = normalizeSettings(publicSettings, company);
    const result = await client
      .from("companies")
      .update({ ...companyPatch(company), settings: { ...publicSettings, _credential_status: company.credenciales || {} } })
      .eq("id", id);
    check(result, "No se pudo actualizar la empresa");
    return company;
  }

  async function updateSettings(id, input) {
    const state = await load();
    const company = state.companies.find((item) => item.id === id);
    if (!company) throw fail(404, "No encontramos esa empresa.");
    const ajustes = normalizeSettings(input, company);
    if (!ajustes.organization) throw fail(400, "La organización necesita un nombre.");
    const { publicSettings, secrets } = splitSettings(ajustes);
    if (Object.keys(secrets).length && !credentialStore) {
      throw fail(500, "El almacén privado de credenciales no está configurado.");
    }
    if (credentialStore) await credentialStore.save(id, secrets);
    company.credenciales = { ...(company.credenciales || {}) };
    for (const key of Object.keys(secrets)) company.credenciales[key] = true;
    company.ajustes = normalizeSettings(publicSettings, company);
    company.nombre = ajustes.organization;
    company.servicios = ajustes.products;
    const result = await client
      .from("companies")
      .update({ ...companyPatch(company), settings: { ...publicSettings, _credential_status: company.credenciales } })
      .eq("id", id);
    check(result, "No se pudieron guardar los ajustes");
    return company;
  }

  async function deleteCompany(id) {
    const result = await client.from("companies").delete().eq("id", id);
    check(result, "No se pudo borrar la empresa");
    return { ok: true };
  }

  async function createAccount(companyId, input) {
    const state = await load();
    const company = state.companies.find((item) => item.id === companyId);
    if (!company) throw fail(404, "No encontramos esa empresa.");
    if (!isChannel(input.canal)) throw fail(400, "El canal no es válido.");
    const cuenta = clean(input.cuenta, 160);
    const agenteNombre = clean(input.agenteNombre, 120);
    if (!cuenta) throw fail(400, "La cuenta necesita un identificador.");
    if (!agenteNombre) throw fail(400, "El agente necesita un nombre.");
    const row = {
      id: randomUUID(),
      company_id: companyId,
      channel: input.canal,
      external_account_id: cuenta,
      label: cuenta,
      agent_name: agenteNombre,
      tone: TONE_BY_CHANNEL[input.canal],
      active: true,
    };
    const result = await client.from("channel_accounts").insert(row);
    if (result.error?.code === "23505") throw fail(409, "Esa empresa ya tiene un agente para esa cuenta y ese canal.");
    check(result, "No se pudo crear la cuenta");
    return accountFromRow(row, company);
  }

  async function updateAccount(id, input) {
    const state = await load();
    const account = state.accounts.find((item) => item.id === id);
    if (!account) throw fail(404, "No encontramos esa cuenta.");
    const patch = { updated_at: new Date().toISOString() };
    if (input.cuenta !== undefined) {
      const cuenta = clean(input.cuenta, 160);
      if (!cuenta) throw fail(400, "La cuenta necesita un identificador.");
      patch.label = cuenta;
      patch.external_account_id = cuenta;
    }
    if (input.agenteNombre !== undefined) {
      const name = clean(input.agenteNombre, 120);
      if (!name) throw fail(400, "El agente necesita un nombre.");
      patch.agent_name = name;
    }
    const result = await client.from("channel_accounts").update(patch).eq("id", id);
    if (result.error?.code === "23505") throw fail(409, "Esa empresa ya tiene un agente para esa cuenta y ese canal.");
    check(result, "No se pudo actualizar la cuenta");
    const refreshed = await load();
    return refreshed.accounts.find((item) => item.id === id);
  }

  async function deleteAccount(id) {
    const usage = await client.from("messages").select("id", { count: "exact", head: true }).eq("channel_account_id", id);
    if (usage.error) check(usage, "No se pudo revisar la cuenta");
    if (usage.count) throw fail(409, "Esta cuenta tiene mensajes. No se puede borrar todavía.");
    check(await client.from("channel_accounts").delete().eq("id", id), "No se pudo borrar la cuenta");
    return { ok: true };
  }

  async function ensureConversation(companyId, accountId, displayName) {
    const identity = normalizedIdentity(displayName);
    const contactId = stableUuid("runtime-contact", `${companyId}:${identity}`);
    const conversationId = stableUuid("runtime-conversation", `${companyId}:${identity}`);
    const identityId = stableUuid("runtime-identity", `${accountId}:${identity}`);
    check(
      await client.from("contacts").upsert({ id: contactId, company_id: companyId, display_name: displayName }),
      "No se pudo guardar el contacto",
    );
    check(
      await client.from("conversations").upsert({
        id: conversationId,
        company_id: companyId,
        contact_id: contactId,
        status: "open",
        updated_at: new Date().toISOString(),
      }),
      "No se pudo guardar la conversación",
    );
    check(
      await client.from("contact_identities").upsert({
        id: identityId,
        company_id: companyId,
        contact_id: contactId,
        channel_account_id: accountId,
        external_user_id: identity,
      }),
      "No se pudo guardar la identidad",
    );
    return { conversationId };
  }

  async function insertMessage(account, input, { externalMessageId = null } = {}) {
    const displayName = clean(input.nombreCliente, 160);
    const body = String(input.texto ?? "").trim().slice(0, 4000);
    if (!displayName) throw fail(400, "El mensaje necesita el nombre del cliente.");
    if (!body) throw fail(400, "El mensaje necesita texto.");
    let rating = null;
    if (account.canal === "google_reviews") {
      rating = Number(input.calificacion);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw fail(400, "La reseña necesita una calificación de 1 a 5.");
      }
    }
    const { conversationId } = await ensureConversation(account.empresaId, account.id, displayName);
    const createdAt = new Date().toISOString();
    const id = externalMessageId ? stableUuid("message", externalMessageId) : randomUUID();
    const row = {
      id,
      company_id: account.empresaId,
      conversation_id: conversationId,
      channel_account_id: account.id,
      external_message_id: externalMessageId,
      direction: "inbound",
      body,
      rating,
      delivery_state: "pending",
      metadata: {
        ...(input.direccionCliente ? { sender_address: clean(input.direccionCliente, 320) } : {}),
        ...(input.asunto ? { subject: clean(input.asunto, 300) } : {}),
      },
      created_at: createdAt,
      updated_at: createdAt,
    };
    const result = externalMessageId
      ? await client.from("messages").upsert(row, { onConflict: "id" })
      : await client.from("messages").insert(row);
    check(result, "No se pudo guardar el mensaje");
    check(
      await client
        .from("conversations")
        .update({ last_message_at: createdAt, updated_at: createdAt })
        .eq("id", conversationId),
      "No se pudo actualizar la conversación",
    );
    const state = await load();
    return state.messages.find((item) => item.id === id);
  }

  async function createMessage(input) {
    const state = await load();
    const account = state.accounts.find((item) => item.id === input.cuentaId);
    if (!account) throw fail(404, "Elige una cuenta de canal.");
    return insertMessage(account, input);
  }

  async function recordInstagramMessage({ igUserId, igId, senderId, canal, nombreCliente, texto, externalId, cuenta }) {
    if (!isChannel(canal)) return null;
    const linked = String(igUserId || igId || "");
    if (!linked) return null;
    const state = await load();
    const company = state.companies.find(
      (item) => String(item.ajustes?.instagram_user_id || "") === linked,
    );
    if (!company) return null;
    let account = state.accounts.find(
      (item) => item.empresaId === company.id && item.canal === canal && item.cuenta === clean(cuenta, 160),
    );
    account ||= state.accounts.find((item) => item.empresaId === company.id && item.canal === canal);
    if (!account) {
      account = await createAccount(company.id, {
        canal,
        cuenta: clean(cuenta, 160) || canal,
        agenteNombre: canal === "instagram_comment" ? "Instagram Comentarios" : "Instagram Directo",
      });
    }
    return insertMessage(
      account,
      { nombreCliente, texto, calificacion: null, direccionCliente: canal === "instagram_dm" ? senderId : "" },
      { externalMessageId: clean(externalId, 240) || null },
    );
  }

  async function recordFacebookMessage({ pageId, senderId, displayName, text, externalId }) {
    const state = await load();
    const company = state.companies.find((item) => String(item.ajustes?.facebook_page_id || "") === String(pageId || ""));
    if (!company) return null;
    const account = state.accounts.find((item) => item.empresaId === company.id && item.canal === "facebook_messenger");
    if (!account) return null;
    return insertMessage(
      account,
      { nombreCliente: displayName, texto: text, direccionCliente: clean(senderId, 80) },
      { externalMessageId: clean(externalId, 240) || null },
    );
  }

  async function recordEmailMessage({ accountAddress, fromAddress, displayName, subject, text, externalId }) {
    const state = await load();
    const normalizedAccount = clean(accountAddress, 320).toLowerCase();
    const account = state.accounts.find(
      (item) => item.canal === "email" && String(item.cuenta || "").trim().toLowerCase() === normalizedAccount,
    );
    if (!account) return null;
    return insertMessage(
      account,
      {
        nombreCliente: clean(displayName, 160) || clean(fromAddress, 160),
        texto: text,
        direccionCliente: clean(fromAddress, 320).toLowerCase(),
        asunto: subject,
      },
      { externalMessageId: clean(externalId, 240) || null },
    );
  }

  async function recordGoogleReview(companyId, { externalId, displayName, text, rating }) {
    const state = await load();
    const account = state.accounts.find((item) => item.empresaId === companyId && item.canal === "google_reviews");
    if (!account) return null;
    return insertMessage(account, { nombreCliente: displayName, texto: text, calificacion: rating }, { externalMessageId: clean(externalId, 240) || null });
  }

  async function recordXMessage(companyId, { externalId, participantId, displayName, text }) {
    const state = await load();
    const account = state.accounts.find((item) => item.empresaId === companyId && item.canal === "x_dm");
    if (!account) return null;
    return insertMessage(
      account,
      { nombreCliente: displayName, texto: text, direccionCliente: clean(participantId, 40) },
      { externalMessageId: clean(externalId, 240) || null },
    );
  }

  async function deleteMessage(id) {
    check(await client.from("messages").delete().eq("id", id), "No se pudo borrar el mensaje");
    return { ok: true };
  }

  async function saveReply(id, respuesta) {
    const state = await load();
    const message = state.messages.find((item) => item.id === id);
    if (!message) throw fail(404, "No encontramos ese mensaje.");
    const account = state.accounts.find((item) => item.id === message.cuentaId);
    if (!account) throw fail(404, "La cuenta de este mensaje ya no existe.");
    const draft = String(respuesta ?? "").trim().slice(0, 4000);
    const now = new Date().toISOString();
    const current = check(
      await client.from("messages").select("metadata").eq("id", id).single(),
      "No se pudo leer la respuesta anterior",
    );
    const metadata = { ...(current.metadata || {}) };
    delete metadata.local_approved_at;
    check(
      await client
        .from("messages")
        .update({
          reply_draft: draft,
          delivery_state: "draft",
          approved_by: null,
          approved_at: null,
          metadata,
          updated_at: now,
        })
        .eq("id", id),
      "No se pudo guardar la respuesta",
    );
    const refreshed = await load();
    return { message: refreshed.messages.find((item) => item.id === id), account };
  }

  async function saveDraft(id, draft) {
    const value = String(draft ?? "").trim().slice(0, 4000);
    if (!value) throw fail(400, "El borrador necesita texto.");
    return (await saveReply(id, value)).message;
  }

  async function approveDraft(id, userId) {
    const state = await load();
    const message = state.messages.find((item) => item.id === id);
    if (!message) throw fail(404, "No encontramos ese mensaje.");
    if (!String(message.borrador || "").trim()) throw fail(409, "Guarda un borrador antes de aprobarlo.");
    const now = new Date().toISOString();
    const row = check(await client.from("messages").select("metadata").eq("id", id).single(), "No se pudo leer el mensaje");
    const validApprover = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(userId || ""));
    const metadata = { ...(row.metadata || {}) };
    delete metadata.local_approved_at;
    if (!validApprover) metadata.local_approved_at = now;
    check(
      await client
        .from("messages")
        .update(
          validApprover
            ? { metadata, delivery_state: "approved", approved_by: userId, approved_at: now, updated_at: now }
            : { metadata, updated_at: now },
        )
        .eq("id", id),
      "No se pudo aprobar el borrador",
    );
    const refreshed = await load();
    return refreshed.messages.find((item) => item.id === id);
  }

  async function markDelivery(id, state, { providerMessageId = "", error = "" } = {}) {
    const allowed = new Set(["sending", "sent", "delivered", "error"]);
    if (!allowed.has(state)) throw fail(400, "El estado de entrega no es válido.");
    const row = check(await client.from("messages").select("metadata").eq("id", id).single(), "No se pudo leer el mensaje");
    const metadata = { ...(row.metadata || {}) };
    if (providerMessageId) metadata.provider_message_id = clean(providerMessageId, 500);
    check(
      await client.from("messages").update({
        delivery_state: state,
        error_detail: error ? clean(error, 1000) : null,
        metadata,
        updated_at: new Date().toISOString(),
      }).eq("id", id),
      "No se pudo actualizar la entrega",
    );
    const refreshed = await load();
    return refreshed.messages.find((item) => item.id === id);
  }

  async function updateConversation(messageId, input, userId) {
    const messageResult = await client.from("messages").select("company_id, conversation_id").eq("id", messageId).single();
    const message = check(messageResult, "No se encontró la conversación");
    const status = String(input?.status || "");
    if (!new Set(["open", "pending", "closed"]).has(status)) throw fail(400, "El estado de conversación no es válido.");
    const patch = { status, updated_at: new Date().toISOString() };
    if (input?.assignedToMe !== undefined) patch.assigned_user_id = input.assignedToMe ? userId : null;
    check(await client.from("conversations").update(patch).eq("id", message.conversation_id), "No se pudo actualizar la conversación");
    check(await client.from("audit_events").insert({
      company_id: message.company_id,
      actor_user_id: userId,
      action: "conversation.status_changed",
      entity_type: "conversation",
      entity_id: message.conversation_id,
      metadata: { status, assigned_to_self: Boolean(input?.assignedToMe) },
    }), "No se pudo registrar la actividad");
    const refreshed = await load();
    return refreshed.messages.find((item) => item.id === messageId);
  }

  async function addConversationNote(messageId, body, userId) {
    const text = String(body || "").trim().slice(0, 2000);
    if (!text) throw fail(400, "La nota necesita texto.");
    const message = check(await client.from("messages").select("company_id, conversation_id").eq("id", messageId).single(), "No se encontró la conversación");
    check(await client.from("conversation_notes").insert({
      company_id: message.company_id,
      conversation_id: message.conversation_id,
      author_user_id: userId,
      body: text,
    }), "No se pudo guardar la nota");
    check(await client.from("audit_events").insert({
      company_id: message.company_id,
      actor_user_id: userId,
      action: "conversation.note_added",
      entity_type: "conversation",
      entity_id: message.conversation_id,
      metadata: {},
    }), "No se pudo registrar la actividad");
    const refreshed = await load();
    return refreshed.messages.find((item) => item.id === messageId);
  }

  return {
    backend: "supabase",
    getState,
    getCompanyWithSecrets,
    getCompaniesWithSecrets,
    createCompany,
    createOrganization,
    updateCompany,
    updateSettings,
    deleteCompany,
    createAccount,
    updateAccount,
    deleteAccount,
    createMessage,
    recordInstagramMessage,
    recordFacebookMessage,
    recordEmailMessage,
    recordGoogleReview,
    recordXMessage,
    deleteMessage,
    saveReply,
    saveDraft,
    approveDraft,
    markDelivery,
    updateConversation,
    addConversationNote,
    scopedState,
    authenticate,
    sessionAccess,
    channels: CHANNELS,
  };
}
