import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptCredentials,
  encryptCredentials,
  parseCredentialsKey,
  splitSettings,
} from "./credentials.js";

const KEY = Buffer.alloc(32, 7).toString("base64url");

test("las credenciales cifradas se recuperan sin guardar texto plano", () => {
  const encrypted = encryptCredentials({ meta_app_secret: "secreto-de-prueba" }, KEY);
  assert.equal(encrypted.includes(Buffer.from("secreto-de-prueba")), false);
  assert.deepEqual(decryptCredentials(encrypted, KEY), { meta_app_secret: "secreto-de-prueba" });
});

test("el cifrado autenticado rechaza alteraciones y llaves incorrectas", () => {
  const encrypted = encryptCredentials({ smtp_password: "prueba" }, KEY);
  const tampered = Buffer.from(encrypted);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptCredentials(tampered, KEY));
  assert.throws(() => decryptCredentials(encrypted, Buffer.alloc(32, 9)));
});

test("solo los campos no sensibles quedan en ajustes públicos", () => {
  const split = splitSettings({
    organization: "Lumen",
    meta_app_id: "1036513856135777",
    meta_app_secret: "no-publicar",
    smtp_password: "no-publicar",
  });
  assert.deepEqual(split.publicSettings, {
    organization: "Lumen",
    meta_app_id: "1036513856135777",
  });
  assert.deepEqual(split.secrets, {
    meta_app_secret: "no-publicar",
    smtp_password: "no-publicar",
  });
});

test("la llave de credenciales exige 32 bytes", () => {
  assert.equal(parseCredentialsKey(KEY).length, 32);
  assert.throws(() => parseCredentialsKey("corta"));
});
