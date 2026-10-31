import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSession, verifySession } from "./auth.js";
import { buildSeed } from "./seed.js";
import { createStore } from "./store.js";

test("la semilla tiene un acceso distinto por empresa y la ficha no lleva la clave", () => {
  const seed = buildSeed();
  const lumen = seed.companies.find((item) => item.id === "co-lumen");
  const arce = seed.companies.find((item) => item.id === "co-arce");
  assert.equal(lumen.usuario, "lumen");
  assert.equal(lumen.clave, "lumen123");
  assert.equal(arce.usuario, "arce");
  assert.equal(arce.clave, "arce123");
  assert.notEqual(lumen.clave, arce.clave);
  for (const account of seed.accounts) {
    assert.equal(account.agente.ficha.clave, undefined);
    assert.equal(account.agente.ficha.usuario, undefined);
  }
});

test("cada sesión solo ve su empresa y una clave incorrecta no entra", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jokma-auth-"));
  const file = path.join(dir, "pulse.json");
  const bare = buildSeed();
  delete bare.companies[0].usuario;
  delete bare.companies[0].clave;
  delete bare.companies[1].usuario;
  delete bare.companies[1].clave;
  fs.writeFileSync(file, JSON.stringify(bare));
  const store = createStore(file);
  const lumen = store.authenticate("lumen", "lumen123");
  const arce = store.authenticate("arce", "arce123");
  assert.equal(lumen.id, "co-lumen");
  assert.equal(lumen.clave, undefined);
  assert.equal(arce.nombre, "Clínica Dental Arce");
  assert.equal(store.authenticate("lumen", "mal"), null);
  assert.equal(store.authenticate("arce", "lumen123"), null);
  const scoped = store.scopedState("co-lumen");
  assert.deepEqual(scoped.companies.map((item) => item.id), ["co-lumen"]);
  assert.ok(scoped.accounts.every((item) => item.empresaId === "co-lumen"));
  assert.ok(scoped.messages.every((item) => item.empresaId === "co-lumen"));
  assert.equal(JSON.stringify(scoped).includes("arce123"), false);
  assert.equal(JSON.stringify(scoped).includes("dentalarce"), false);
  const token = createSession("co-lumen");
  assert.equal(verifySession(token), "co-lumen");
  assert.equal(verifySession(`${token}x`), null);
});
