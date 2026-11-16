import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseStore } from "./supabase-store.js";

function clientWithEmptyState() {
  const rows = {
    profiles: [{ id: "usr-1", username: "ricardo", display_name: "Ricardo Arevalo" }],
    organizations: [],
    companies: [],
    channel_accounts: [],
    contacts: [],
    conversations: [],
    messages: [],
    conversation_notes: [],
  };
  return {
    from(table) {
      return {
        select() {
          return Promise.resolve({ data: rows[table] || [], error: null });
        },
      };
    },
  };
}

test("Supabase no relee el archivo JSON legado durante cada carga", async () => {
  const authStore = {
    getState() {
      throw new Error("el archivo legado no debe leerse en modo Supabase Auth");
    },
  };
  const store = createSupabaseStore(clientWithEmptyState(), authStore, {
    createAuthClient: () => ({}),
  });

  const state = await store.getState();

  assert.deepEqual(state.users, [
    { id: "usr-1", nombre: "Ricardo Arevalo", usuario: "ricardo" },
  ]);
});
