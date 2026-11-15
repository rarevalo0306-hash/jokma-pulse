import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSupabaseAdmin } from "../src/supabase-admin.js";
import { stableUuid } from "../src/supabase-import.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const status = spawnSync("supabase", ["status", "-o", "env"], {
  cwd: root,
  encoding: "utf8",
});
if (status.status !== 0) throw new Error("Supabase local no está activo.");

const local = {};
for (const line of status.stdout.split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (!match) continue;
  let value = match[2].trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      value = JSON.parse(value);
    } catch {
      value = value.slice(1, -1);
    }
  }
  local[match[1]] = value;
}

const admin = createSupabaseAdmin({
  SUPABASE_URL: local.API_URL,
  SUPABASE_SECRET_KEY: local.SERVICE_ROLE_KEY,
});

// Cuentas exclusivamente de demostración local. No reutilizar en producción.
const demos = [
  {
    username: "lumen",
    password: "lumen123",
    displayName: "Equipo Lumen",
    firstName: "Equipo",
    lastName: "Lumen",
    defaultCompany: "co-lumen",
    memberships: [
      ["co-lumen", "owner"],
      ["co-arce", "admin"],
    ],
  },
  {
    username: "arce",
    password: "arce123",
    displayName: "Equipo Arce",
    firstName: "Equipo",
    lastName: "Arce",
    defaultCompany: "co-arce",
    memberships: [["co-arce", "owner"]],
  },
];

const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listed.error) throw listed.error;
const existingByEmail = new Map((listed.data?.users || []).map((user) => [user.email, user]));

for (const demo of demos) {
  const email = `${demo.username}@pulse.local.invalid`;
  let user = existingByEmail.get(email);
  if (user) {
    const updated = await admin.auth.admin.updateUserById(user.id, {
      password: demo.password,
      app_metadata: { ...user.app_metadata, username: demo.username, local_demo: true },
      user_metadata: { ...user.user_metadata, display_name: demo.displayName },
    });
    if (updated.error) throw updated.error;
    user = updated.data.user;
  } else {
    const created = await admin.auth.admin.createUser({
      email,
      password: demo.password,
      email_confirm: true,
      app_metadata: { username: demo.username, local_demo: true },
      user_metadata: { display_name: demo.displayName },
    });
    if (created.error) throw created.error;
    user = created.data.user;
  }

  const defaultCompanyId = stableUuid("company", demo.defaultCompany);
  const profile = await admin.from("profiles").upsert({
    id: user.id,
    username: demo.username,
    display_name: demo.displayName,
    first_name: demo.firstName,
    last_name: demo.lastName,
    default_company_id: defaultCompanyId,
    updated_at: new Date().toISOString(),
  });
  if (profile.error) throw profile.error;

  const memberships = demo.memberships.map(([company, role]) => ({
    company_id: stableUuid("company", company),
    user_id: user.id,
    role,
    active: true,
  }));
  const membershipResult = await admin
    .from("company_memberships")
    .upsert(memberships, { onConflict: "company_id,user_id" });
  if (membershipResult.error) throw membershipResult.error;
}

console.log(JSON.stringify({
  ok: true,
  users: demos.map((item) => item.username),
  memberships: demos.reduce((total, item) => total + item.memberships.length, 0),
}));
