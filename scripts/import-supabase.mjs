import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSupabaseAdmin } from "../src/supabase-admin.js";
import { applyPublicImportPlan, buildSupabaseImportPlan } from "../src/supabase-import.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataPath = process.env.PULSE_DATA || path.join(root, "data", "pulse.json");
const apply = process.argv.includes("--apply-public");
const state = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const plan = buildSupabaseImportPlan(state);

// Solo se imprime el resumen; el plan puede contener datos personales y nunca
// debe terminar en logs de CI o de producción.
if (!apply) {
  console.log(JSON.stringify({ mode: "dry-run", ...plan.summary }, null, 2));
  process.exit(0);
}

if (process.env.PULSE_IMPORT_CONFIRM !== "JOKMA_PULSE_PUBLIC_IMPORT") {
  throw new Error("Define PULSE_IMPORT_CONFIRM=JOKMA_PULSE_PUBLIC_IMPORT para aplicar el plan público.");
}

const client = createSupabaseAdmin();
const summary = await applyPublicImportPlan(client, plan);
console.log(JSON.stringify({ mode: "applied", ...summary }, null, 2));
