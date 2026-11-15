import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const status = spawnSync("supabase", ["status", "-o", "env"], {
  cwd: root,
  encoding: "utf8",
});

if (status.status !== 0) {
  console.error("Supabase local no está activo. Inícialo antes de ejecutar Pulse.");
  process.exit(status.status || 1);
}

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

if (!local.API_URL || !local.DB_URL || !local.JWT_SECRET || !local.SERVICE_ROLE_KEY || !local.PUBLISHABLE_KEY) {
  console.error("Supabase local no devolvió la URL o las llaves necesarias.");
  process.exit(1);
}

const child = spawn(process.execPath, ["server.js"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    PULSE_STORE: "supabase",
    PULSE_ALLOW_SIGNUP: "true",
    SUPABASE_URL: local.API_URL,
    SUPABASE_SECRET_KEY: local.SERVICE_ROLE_KEY,
    SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
    SUPABASE_DATABASE_URL: local.DB_URL,
    PULSE_CREDENTIALS_KEY: createHash("sha256")
      .update(`${local.JWT_SECRET}|jokma-pulse-credentials-v1`)
      .digest("base64url"),
    NO_PROXY: [process.env.NO_PROXY, "127.0.0.1", "localhost"].filter(Boolean).join(","),
  },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
