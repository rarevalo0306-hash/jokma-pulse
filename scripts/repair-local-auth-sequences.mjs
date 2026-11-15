import { spawnSync } from "node:child_process";
import postgres from "postgres";

const status = spawnSync("supabase", ["status", "-o", "env"], { encoding: "utf8" });
if (status.status !== 0) throw new Error("Supabase local no está activo.");
const line = status.stdout.split(/\r?\n/).find((item) => item.startsWith("DB_URL="));
const databaseUrl = JSON.parse(line.slice("DB_URL=".length));
const sql = postgres(databaseUrl, { max: 1, prepare: false });

try {
  const [row] = await sql`select max(id)::bigint as max_id from auth.refresh_tokens`;
  const maxId = Number(row.max_id || 0);
  if (maxId > 0) {
    await sql`select setval('auth.refresh_tokens_id_seq', ${maxId}, true)`;
  } else {
    await sql`select setval('auth.refresh_tokens_id_seq', 1, false)`;
  }
  console.log("Secuencia local de sesiones reparada.");
} finally {
  await sql.end({ timeout: 2 });
}
