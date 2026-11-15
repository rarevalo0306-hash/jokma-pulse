import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const backupDirectory = path.join(root, "backups");
fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = path.join(backupDirectory, `jokma-pulse-${stamp}.sql`);

const dump = spawnSync(
  "supabase",
  ["db", "dump", "--local", "--data-only", "--use-copy", "--schema", "public,private,auth", "--file", destination],
  { cwd: root, encoding: "utf8" },
);

if (dump.status !== 0) {
  fs.rmSync(destination, { force: true });
  console.error("No se pudo crear la copia local de Pulse.");
  process.exit(dump.status || 1);
}

const stats = fs.statSync(destination);
if (stats.size < 100 || !fs.readFileSync(destination, "utf8").includes("companies")) {
  fs.rmSync(destination, { force: true });
  console.error("La copia local quedó incompleta y fue descartada.");
  process.exit(1);
}
fs.chmodSync(destination, 0o600);
console.log(JSON.stringify({ ok: true, file: path.relative(root, destination), bytes: stats.size }));
