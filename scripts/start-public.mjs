import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const account = os.userInfo().username;

function command(commandName, args, options = {}) {
  return spawnSync(commandName, args, {
    cwd: root,
    encoding: "utf8",
    timeout: options.timeout ?? 30_000,
    stdio: options.stdio ?? "pipe",
  });
}

function keychainSecret(service) {
  const result = command("/usr/bin/security", [
    "find-generic-password",
    "-a",
    account,
    "-s",
    service,
    "-w",
  ]);
  const value = String(result.stdout || "").trim();
  if (result.status !== 0 || value.length < 32) {
    throw new Error(`Falta el secreto privado ${service} en el llavero de macOS.`);
  }
  return value;
}

function ensureLocalServices() {
  if (command("/opt/homebrew/bin/colima", ["status"]).status !== 0) {
    const started = command("/opt/homebrew/bin/colima", ["start"], { timeout: 180_000 });
    if (started.status !== 0) throw new Error("No se pudo iniciar Colima.");
  }

  if (command("/opt/homebrew/bin/supabase", ["status"]).status !== 0) {
    const started = command("/opt/homebrew/bin/supabase", ["start"], { timeout: 300_000 });
    if (started.status !== 0) throw new Error("No se pudo iniciar Supabase local.");
  }
}

try {
  ensureLocalServices();
  const child = spawn(process.execPath, ["scripts/start-local.mjs"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      NODE_ENV: "production",
      PULSE_FACEBOOK_STATE_SECRET: keychainSecret("app.jokma.pulse.facebook-state"),
      PULSE_SESSION_SECRET: keychainSecret("app.jokma.pulse.session"),
      PULSE_SIGNUP_INVITE: keychainSecret("app.jokma.pulse.signup-invite"),
    },
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : "No se pudo iniciar Pulse.");
  process.exit(1);
}
