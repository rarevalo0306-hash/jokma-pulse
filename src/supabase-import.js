import { createHash } from "node:crypto";

const SECRET_SETTING_KEYS = new Set([
  "n8n_webhook_url",
  "google_client_secret",
  "google_refresh_token",
  "instagram_access_token",
  "meta_app_secret",
  "facebook_page_token",
  "x_api_key",
  "x_api_secret",
  "x_access_token",
  "x_access_token_secret",
  "smtp_password",
]);

const DELIVERY_STATES = new Map([
  ["sin_borrador", "pending"],
  ["borrador", "draft"],
  // La aprobación heredada no identifica quién aprobó. Se conserva como borrador
  // hasta asociar un usuario de Auth, respetando la restricción de la base.
  ["aprobado", "draft"],
]);

function text(value, max = 8000) {
  return String(value ?? "").trim().slice(0, max);
}

function slug(value) {
  return text(value, 160)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "empresa";
}

function normalizedIdentity(value) {
  return text(value, 160).normalize("NFKC").toLocaleLowerCase("es");
}

export function stableUuid(kind, legacyId) {
  const bytes = createHash("sha256").update(`jokma-pulse:${kind}:${legacyId}`).digest().subarray(0, 16);
  // UUID v8: identificador determinista específico de la aplicación.
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function splitSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const publicSettings = {};
  const pendingSecretKeys = [];
  for (const [key, value] of Object.entries(source)) {
    if (SECRET_SETTING_KEYS.has(key)) {
      if (text(value)) pendingSecretKeys.push(key);
      continue;
    }
    publicSettings[key] = value;
  }
  return { publicSettings, pendingSecretKeys: pendingSecretKeys.sort() };
}

function maxDate(current, candidate) {
  if (!candidate) return current;
  if (!current) return candidate;
  return Date.parse(candidate) > Date.parse(current) ? candidate : current;
}

export function buildSupabaseImportPlan(state) {
  const companies = [];
  const channelAccounts = [];
  const contactsByKey = new Map();
  const identitiesByKey = new Map();
  const conversationsByKey = new Map();
  const messages = [];
  const companyIds = new Map();
  const accountIds = new Map();
  const pendingCredentialKeys = new Set();

  for (const company of state.companies || []) {
    const legacyId = text(company.id, 240);
    if (!legacyId) throw new Error("Cada empresa necesita un id heredado.");
    const id = stableUuid("company", legacyId);
    companyIds.set(legacyId, id);
    const { publicSettings, pendingSecretKeys } = splitSettings(company.ajustes);
    for (const key of pendingSecretKeys) pendingCredentialKeys.add(key);
    companies.push({
      id,
      slug: `${slug(company.nombre)}-${id.slice(0, 8)}`,
      name: text(company.nombre, 160),
      industry: text(company.industria, 240),
      services: text(company.servicios, 600),
      business_hours: text(company.horarios, 600),
      phone: text(company.telefono, 240),
      official_email: text(company.correoOficial, 240),
      website: text(company.sitioWeb, 240),
      support_contact: text(company.soporte, 240),
      settings: publicSettings,
    });
  }

  for (const account of state.accounts || []) {
    const legacyId = text(account.id, 240);
    const companyId = companyIds.get(text(account.empresaId, 240));
    if (!legacyId || !companyId) throw new Error("Cada cuenta necesita ids válidos de cuenta y empresa.");
    const id = stableUuid("channel-account", legacyId);
    accountIds.set(legacyId, id);
    channelAccounts.push({
      id,
      company_id: companyId,
      channel: text(account.canal, 80),
      external_account_id: text(account.cuenta, 500),
      label: text(account.cuenta, 500),
      agent_name: text(account.agente?.nombre, 120) || "Agente Pulse",
      tone: text(account.agente?.tono, 500),
      active: true,
    });
  }

  for (const message of state.messages || []) {
    const legacyId = text(message.id, 240);
    const legacyCompanyId = text(message.empresaId, 240);
    const legacyAccountId = text(message.cuentaId, 240);
    const companyId = companyIds.get(legacyCompanyId);
    const channelAccountId = accountIds.get(legacyAccountId);
    if (!legacyId || !companyId || !channelAccountId) {
      throw new Error("Cada mensaje necesita ids válidos de mensaje, empresa y cuenta.");
    }
    const displayName = text(message.nombreCliente, 160) || "Contacto sin nombre";
    const identity = normalizedIdentity(displayName);
    const contactKey = `${legacyCompanyId}:${identity}`;
    let contact = contactsByKey.get(contactKey);
    if (!contact) {
      contact = {
        id: stableUuid("contact", contactKey),
        company_id: companyId,
        display_name: displayName,
      };
      contactsByKey.set(contactKey, contact);
    }
    const identityKey = `${legacyAccountId}:${identity}`;
    if (!identitiesByKey.has(identityKey)) {
      identitiesByKey.set(identityKey, {
        id: stableUuid("contact-identity", identityKey),
        company_id: companyId,
        contact_id: contact.id,
        channel_account_id: channelAccountId,
        external_user_id: identity,
      });
    }
    let conversation = conversationsByKey.get(contactKey);
    if (!conversation) {
      conversation = {
        id: stableUuid("conversation", contactKey),
        company_id: companyId,
        contact_id: contact.id,
        status: "open",
        last_message_at: null,
      };
      conversationsByKey.set(contactKey, conversation);
    }
    const createdAt = message.createdAt || new Date(0).toISOString();
    conversation.last_message_at = maxDate(conversation.last_message_at, createdAt);
    const legacyState = text(message.estadoRespuesta, 40) || "sin_borrador";
    messages.push({
      id: stableUuid("message", legacyId),
      company_id: companyId,
      conversation_id: conversation.id,
      channel_account_id: channelAccountId,
      external_message_id: legacyId,
      direction: "inbound",
      body: text(message.texto),
      rating: message.calificacion == null ? null : Number(message.calificacion),
      reply_draft: text(message.borrador || message.respuesta) || null,
      delivery_state: DELIVERY_STATES.get(legacyState) || "pending",
      approved_at: null,
      metadata: {
        legacy_id: legacyId,
        legacy_sample: text(message.muestra, 500) || null,
        legacy_reply_state: legacyState,
        legacy_approved_at: message.aprobadoEn || null,
      },
      created_at: createdAt,
      updated_at: message.respondidoEn || createdAt,
    });
  }

  return {
    companies,
    channelAccounts,
    contacts: [...contactsByKey.values()],
    contactIdentities: [...identitiesByKey.values()],
    conversations: [...conversationsByKey.values()],
    messages,
    summary: {
      companies: companies.length,
      channelAccounts: channelAccounts.length,
      contacts: contactsByKey.size,
      contactIdentities: identitiesByKey.size,
      conversations: conversationsByKey.size,
      messages: messages.length,
      usersPending: (state.users || []).length,
      pendingCredentialKeys: [...pendingCredentialKeys].sort(),
    },
  };
}

async function upsert(client, table, rows, onConflict = "id") {
  if (!rows.length) return;
  const { error } = await client.from(table).upsert(rows, { onConflict });
  if (error) throw new Error(`No se pudo importar ${table}: ${error.message}`);
}

export async function applyPublicImportPlan(client, plan) {
  if (plan.summary.pendingCredentialKeys.length) {
    throw new Error("Hay credenciales pendientes. Deben cifrarse y migrarse antes de activar Supabase.");
  }
  await upsert(client, "companies", plan.companies);
  await upsert(client, "channel_accounts", plan.channelAccounts);
  await upsert(client, "contacts", plan.contacts);
  await upsert(client, "contact_identities", plan.contactIdentities);
  await upsert(client, "conversations", plan.conversations);
  await upsert(client, "messages", plan.messages);
  return plan.summary;
}
