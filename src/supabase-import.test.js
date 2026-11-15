import assert from "node:assert/strict";
import test from "node:test";
import { buildSeed } from "./seed.js";
import { applyPublicImportPlan, buildSupabaseImportPlan, stableUuid } from "./supabase-import.js";

test("el plan de importación usa UUID estables y no mezcla empresas", () => {
  const first = buildSupabaseImportPlan(buildSeed());
  const second = buildSupabaseImportPlan(buildSeed());
  assert.deepEqual(first, second);
  assert.match(stableUuid("company", "co-lumen"), /^[0-9a-f-]{36}$/);
  assert.equal(first.summary.companies, 2);
  assert.equal(first.summary.channelAccounts, 9);
  assert.equal(first.summary.messages, 11);
  assert.equal(first.summary.usersPending, 2);
  const companyIds = new Set(first.companies.map((item) => item.id));
  assert.ok(first.channelAccounts.every((item) => companyIds.has(item.company_id)));
  assert.ok(first.messages.every((item) => companyIds.has(item.company_id)));
});

test("las credenciales nunca entran en companies.settings", () => {
  const seed = buildSeed();
  seed.companies[0].ajustes = {
    organization: "Lumen",
    meta_app_id: "public-id",
    meta_app_secret: "no-imprimir",
    instagram_access_token: "no-imprimir",
  };
  const plan = buildSupabaseImportPlan(seed);
  assert.equal(plan.companies[0].settings.meta_app_id, "public-id");
  assert.equal(plan.companies[0].settings.meta_app_secret, undefined);
  assert.equal(JSON.stringify(plan.companies).includes("no-imprimir"), false);
  assert.deepEqual(plan.summary.pendingCredentialKeys, ["instagram_access_token", "meta_app_secret"]);
});

test("la importación pública se bloquea si quedan credenciales pendientes", async () => {
  const plan = buildSupabaseImportPlan(buildSeed());
  plan.summary.pendingCredentialKeys = ["meta_app_secret"];
  await assert.rejects(() => applyPublicImportPlan({}, plan), /credenciales pendientes/);
});

test("la importación aplica las tablas en orden referencial y puede repetirse", async () => {
  const calls = [];
  const client = {
    from(table) {
      return {
        async upsert(rows, options) {
          calls.push({ table, count: rows.length, options });
          return { error: null };
        },
      };
    },
  };
  const plan = buildSupabaseImportPlan(buildSeed());
  const summary = await applyPublicImportPlan(client, plan);
  assert.equal(summary.messages, 11);
  assert.deepEqual(
    calls.map((item) => item.table),
    ["companies", "channel_accounts", "contacts", "contact_identities", "conversations", "messages"],
  );
  assert.ok(calls.every((item) => item.options.onConflict === "id"));
});
