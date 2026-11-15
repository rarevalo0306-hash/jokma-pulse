import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import postgres from "postgres";

export const SECRET_SETTING_KEYS = new Set([
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

const PROVIDER_KEYS = {
  meta: ["instagram_access_token", "meta_app_secret", "facebook_page_token"],
  google: ["google_client_secret", "google_refresh_token"],
  x: ["x_api_key", "x_api_secret", "x_access_token", "x_access_token_secret"],
  email: ["smtp_password"],
};

function required(env, key) {
  const value = String(env[key] || "").trim();
  if (!value) throw new Error(`${key} es obligatorio para proteger credenciales.`);
  return value;
}

export function parseCredentialsKey(value) {
  const raw = String(value || "").trim();
  let key;
  if (/^[a-f0-9]{64}$/i.test(raw)) key = Buffer.from(raw, "hex");
  else {
    try {
      key = Buffer.from(raw, "base64url");
    } catch {
      key = Buffer.alloc(0);
    }
  }
  if (key.length !== 32) throw new Error("PULSE_CREDENTIALS_KEY debe representar exactamente 32 bytes.");
  return key;
}

export function encryptCredentials(payload, keyValue) {
  const key = Buffer.isBuffer(keyValue) ? keyValue : parseCredentialsKey(keyValue);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(body), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptCredentials(value, keyValue) {
  const key = Buffer.isBuffer(keyValue) ? keyValue : parseCredentialsKey(keyValue);
  const packed = Buffer.from(value || []);
  if (packed.length < 30 || packed[0] !== 1) throw new Error("Formato de credencial cifrada no reconocido.");
  const iv = packed.subarray(1, 13);
  const tag = packed.subarray(13, 29);
  const ciphertext = packed.subarray(29);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const parsed = JSON.parse(plaintext.toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("La credencial cifrada no contiene un objeto válido.");
  }
  return parsed;
}

export function splitSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const publicSettings = {};
  const secrets = {};
  for (const [key, value] of Object.entries(source)) {
    if (SECRET_SETTING_KEYS.has(key)) {
      const normalized = String(value ?? "").trim();
      if (normalized) secrets[key] = normalized;
    } else {
      publicSettings[key] = value;
    }
  }
  return { publicSettings, secrets };
}

function providerPayloads(secrets) {
  const payloads = new Map();
  for (const [provider, keys] of Object.entries(PROVIDER_KEYS)) {
    const payload = {};
    for (const key of keys) {
      if (secrets[key]) payload[key] = secrets[key];
    }
    if (Object.keys(payload).length) payloads.set(provider, payload);
  }
  return payloads;
}

export function createCredentialStore(env = process.env) {
  const databaseUrl = required(env, "SUPABASE_DATABASE_URL");
  const key = parseCredentialsKey(required(env, "PULSE_CREDENTIALS_KEY"));
  const sql = postgres(databaseUrl, { max: 2, prepare: false });

  async function providerRows(companyId) {
    return sql`
      select provider, ciphertext
      from private.integration_credentials
      where company_id = ${companyId} and channel_account_id is null
    `;
  }

  async function load(companyId) {
    const combined = {};
    for (const row of await providerRows(companyId)) {
      Object.assign(combined, decryptCredentials(row.ciphertext, key));
    }
    return combined;
  }

  async function save(companyId, input) {
    const payloads = providerPayloads(input || {});
    if (!payloads.size) return;
    const current = new Map();
    for (const row of await providerRows(companyId)) {
      current.set(row.provider, decryptCredentials(row.ciphertext, key));
    }
    await sql.begin(async (transaction) => {
      for (const [provider, patch] of payloads) {
        const ciphertext = encryptCredentials({ ...(current.get(provider) || {}), ...patch }, key);
        await transaction`
          insert into private.integration_credentials
            (company_id, provider, channel_account_id, ciphertext, key_version)
          values (${companyId}, ${provider}, null, ${ciphertext}, 1)
          on conflict (company_id, provider) where channel_account_id is null
          do update set
            ciphertext = excluded.ciphertext,
            key_version = excluded.key_version,
            updated_at = now()
        `;
      }
    });
  }

  async function close() {
    await sql.end({ timeout: 2 });
  }

  return { load, save, close };
}
