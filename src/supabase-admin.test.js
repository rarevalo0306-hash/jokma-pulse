import assert from "node:assert/strict";
import test from "node:test";
import {
  createSupabaseAdmin,
  createSupabaseAuthClient,
  supabaseAdminConfiguration,
  supabaseStoreEnabled,
} from "./supabase-admin.js";

test("Supabase permanece desactivado hasta escogerlo explícitamente", () => {
  assert.equal(supabaseStoreEnabled({}), false);
  assert.equal(supabaseStoreEnabled({ PULSE_STORE: "json" }), false);
  assert.equal(supabaseStoreEnabled({ PULSE_STORE: "supabase" }), true);
});

test("el cliente administrativo exige URL y llave exclusivamente del servidor", () => {
  assert.throws(() => supabaseAdminConfiguration({}), /SUPABASE_URL/);
  assert.throws(
    () => supabaseAdminConfiguration({ SUPABASE_URL: "https://demo.supabase.co" }),
    /SUPABASE_SECRET_KEY/,
  );
  assert.throws(
    () =>
      supabaseAdminConfiguration({
        SUPABASE_URL: "https://demo.supabase.co",
        SUPABASE_SECRET_KEY: "sb_publishable_demo",
      }),
    /publicable/,
  );
  const config = supabaseAdminConfiguration({
    SUPABASE_URL: "https://demo.supabase.co/",
    SUPABASE_SECRET_KEY: "server-only-test-key",
  });
  assert.equal(config.url, "https://demo.supabase.co");
  assert.equal(config.secretKey, "server-only-test-key");
  const client = createSupabaseAdmin({
    SUPABASE_URL: "http://127.0.0.1:55321",
    SUPABASE_SECRET_KEY: "server-only-test-key",
  });
  assert.ok(client.auth.admin);
});

test("el cliente de contraseña usa solo la llave publicable", () => {
  assert.throws(
    () => createSupabaseAuthClient({ SUPABASE_URL: "http://127.0.0.1:56321" }),
    /SUPABASE_PUBLISHABLE_KEY/,
  );
  const client = createSupabaseAuthClient({
    SUPABASE_URL: "http://127.0.0.1:56321",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_prueba",
  });
  assert.ok(client.auth);
});
