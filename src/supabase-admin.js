import { createClient } from "@supabase/supabase-js";

function required(env, key) {
  const value = String(env[key] || "").trim();
  if (!value) throw new Error(`${key} es obligatorio para usar Supabase.`);
  return value;
}

export function supabaseAdminConfiguration(env = process.env) {
  const url = required(env, "SUPABASE_URL");
  const secretKey = required(env, "SUPABASE_SECRET_KEY");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("SUPABASE_URL no es una URL válida.");
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error("SUPABASE_URL debe usar HTTPS fuera del entorno local.");
  }
  if (secretKey.startsWith("sb_publishable_") || secretKey === String(env.SUPABASE_PUBLISHABLE_KEY || "")) {
    throw new Error("SUPABASE_SECRET_KEY no puede contener una llave publicable.");
  }
  return { url: parsed.toString().replace(/\/$/, ""), secretKey };
}

export function createSupabaseAdmin(env = process.env) {
  const { url, secretKey } = supabaseAdminConfiguration(env);
  return createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

export function createSupabaseAuthClient(env = process.env) {
  const url = required(env, "SUPABASE_URL");
  const publishableKey = required(env, "SUPABASE_PUBLISHABLE_KEY");
  if (!publishableKey.startsWith("sb_publishable_") && !publishableKey.startsWith("eyJ")) {
    throw new Error("SUPABASE_PUBLISHABLE_KEY no tiene un formato reconocido.");
  }
  return createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

export function supabaseStoreEnabled(env = process.env) {
  return String(env.PULSE_STORE || "json").trim().toLowerCase() === "supabase";
}
