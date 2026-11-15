import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertSessionConfiguration, createSession, verifyPassword, verifySession } from "./auth.js";
import { buildSeed } from "./seed.js";
import { createStore } from "./store.js";

test("la semilla separa acceso y empresa sin persistir claves en texto plano", () => {
  const seed = buildSeed();
  assert.ok(seed.companies.every((company) => company.usuario === undefined && company.clave === undefined));
  assert.ok(seed.users.every((user) => user.clave === undefined));
  assert.ok(seed.users.every((user) => user.passwordHash.startsWith("scrypt$")));
  assert.equal(verifyPassword("lumen123", seed.users.find((user) => user.usuario === "lumen").passwordHash), true);
  assert.equal(JSON.stringify(seed).includes('"clave"'), false);
  for (const account of seed.accounts) {
    assert.equal(account.agente.ficha.clave, undefined);
    assert.equal(account.agente.ficha.usuario, undefined);
  }
});

test("cada usuario ve solo sus empresas autorizadas y una clave incorrecta no entra", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jokma-auth-"));
  const file = path.join(dir, "pulse.json");
  const bare = buildSeed();
  fs.writeFileSync(file, JSON.stringify(bare));
  const store = createStore(file);
  const lumen = store.authenticate("lumen", "lumen123");
  const arce = store.authenticate("arce", "arce123");
  assert.equal(lumen.user.id, "usr-lumen");
  assert.equal(lumen.companyId, "co-lumen");
  assert.deepEqual(lumen.companies.map((item) => item.id), ["co-lumen", "co-arce"]);
  assert.equal(lumen.user.clave, undefined);
  assert.equal(arce.user.id, "usr-arce");
  assert.deepEqual(arce.companies.map((item) => item.id), ["co-arce"]);
  assert.equal(store.authenticate("lumen", "mal"), null);
  assert.equal(store.authenticate("arce", "lumen123"), null);
  const scoped = store.scopedState("usr-lumen", "co-lumen");
  assert.deepEqual(scoped.companies.map((item) => item.id), ["co-lumen", "co-arce"]);
  assert.ok(scoped.accounts.every((item) => item.empresaId === "co-lumen"));
  assert.ok(scoped.messages.every((item) => item.empresaId === "co-lumen"));
  assert.equal(JSON.stringify(scoped).includes("arce123"), false);
  const switched = store.scopedState("usr-lumen", "co-arce");
  assert.ok(switched.accounts.every((item) => item.empresaId === "co-arce"));
  assert.throws(() => store.scopedState("usr-arce", "co-lumen"), /no está disponible/);
  const token = createSession("usr-lumen", "co-arce");
  assert.deepEqual(verifySession(token), { userId: "usr-lumen", companyId: "co-arce" });
  assert.equal(verifySession(`${token}x`), null);
});

test("las claves antiguas migran a scrypt al cargar el archivo", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jokma-legacy-auth-"));
  const file = path.join(dir, "pulse.json");
  const legacy = buildSeed();
  legacy.companies[0].usuario = "lumen";
  legacy.companies[0].clave = "lumen123";
  delete legacy.users[0].passwordHash;
  legacy.users[0].clave = "lumen123";
  fs.writeFileSync(file, JSON.stringify(legacy));
  const store = createStore(file);
  assert.equal(store.authenticate("lumen", "lumen123").user.id, "usr-lumen");
  const migrated = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(migrated.companies[0].clave, undefined);
  assert.equal(migrated.companies[0].usuario, undefined);
  assert.equal(migrated.users[0].clave, undefined);
  assert.ok(migrated.users[0].passwordHash.startsWith("scrypt$"));
});

test("producción exige un secreto de sesión fuerte", () => {
  assert.throws(() => assertSessionConfiguration({ NODE_ENV: "production" }), /obligatorio/);
  assert.throws(
    () => assertSessionConfiguration({ NODE_ENV: "production", PULSE_SESSION_SECRET: "corto" }),
    /32 caracteres/,
  );
  assert.equal(
    assertSessionConfiguration({ NODE_ENV: "production", PULSE_SESSION_SECRET: "a".repeat(32) }),
    true,
  );
});

test("el borrador se guarda y requiere aprobación explícita", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jokma-draft-"));
  const file = path.join(dir, "pulse.json");
  fs.writeFileSync(file, JSON.stringify(buildSeed()));
  const store = createStore(file);
  const id = "msg-lumen-ig-dm";
  const saved = store.saveDraft(id, "Abrimos los sábados a las ocho.");
  assert.equal(saved.estadoRespuesta, "borrador");
  assert.equal(saved.aprobadoEn, null);
  const approved = store.approveDraft(id);
  assert.equal(approved.estadoRespuesta, "aprobado");
  assert.ok(approved.aprobadoEn);
});
