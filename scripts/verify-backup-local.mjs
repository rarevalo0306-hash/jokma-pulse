import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = path.join(root, "backups");
const requested = process.argv[2] ? path.resolve(root, process.argv[2]) : null;
const latest = fs.existsSync(directory)
  ? fs.readdirSync(directory).filter((name) => name.endsWith(".sql")).sort().at(-1)
  : null;
const backup = requested || (latest ? path.join(directory, latest) : null);
if (!backup || !fs.existsSync(backup)) {
  console.error("No hay una copia local para verificar.");
  process.exit(1);
}

const dump = fs.readFileSync(backup, "utf8");
const copiedTables = [...dump.matchAll(/^COPY "(auth|public|private)"\."([a-z0-9_]+)"/gm)]
  .map((match) => `"${match[1]}"."${match[2]}"`);
const truncate = `begin;\n${copiedTables.map((table) => `truncate table ${table} cascade;`).join("\n")}`;
const verify = `
select 'companies=' || count(*) from public.companies;
select 'messages=' || count(*) from public.messages;
select 'users=' || count(*) from auth.users;
rollback;
`;
const restored = spawnSync(
  "docker",
  ["exec", "-i", "supabase_db_Jokma_Pulse", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"],
  { cwd: root, input: `${truncate}\n${dump}\n${verify}`, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
);
if (restored.status !== 0) {
  console.error("La copia no superó el ensayo transaccional de restauración.");
  const diagnostic = String(restored.stderr || "")
    .split(/\r?\n/)
    .filter((line) => /ERROR|FATAL|psql:/.test(line))
    .slice(-3)
    .join(" | ")
    .replace(/(password|token|secret)=\S+/gi, "$1=[oculto]");
  if (diagnostic) console.error(diagnostic);
  process.exit(restored.status || 1);
}
const counts = Object.fromEntries(
  restored.stdout.split(/\r?\n/).filter((line) => /^(companies|messages|users)=\d+$/.test(line)).map((line) => line.split("=")),
);
if (Number(counts.companies) < 1 || Number(counts.users) < 1) {
  console.error("La copia no contiene las empresas o usuarios esperados.");
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, file: path.relative(root, backup), counts }));
