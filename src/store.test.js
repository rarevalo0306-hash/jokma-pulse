import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStore } from "./store.js";

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jokma-"));
  return createStore(path.join(dir, "pulse.json"));
}

test("guardar la ficha actualiza solo los agentes de esa empresa", () => {
  const store = tempStore();
  const updated = store.updateCompany("co-lumen", {
    nombre: "Cafetería Lumen",
    industria: "Alimentos y bebidas",
    servicios: "Café de especialidad, pastelería artesanal y desayunos",
    horarios: "Lunes a viernes 7:30–19:00, sábados 8:00–14:00",
    telefono: "+52 55 1200 9999",
    correoOficial: "hola@cafelumen.mx",
    sitioWeb: "https://cafelumen.mx",
    soporte: "soporte@cafelumen.mx",
  });
  assert.equal(updated.telefono, "+52 55 1200 9999");
  const state = store.getState();
  const lumen = state.accounts.filter((item) => item.empresaId === "co-lumen");
  const arce = state.accounts.filter((item) => item.empresaId === "co-arce");
  assert.ok(lumen.every((item) => item.agente.ficha.telefono === "+52 55 1200 9999"));
  assert.ok(arce.every((item) => item.agente.ficha.telefono === "+52 33 4500 2288"));
  assert.ok(lumen.every((item) => item.agente.tipo === "atencion"));
});

test("los ajustes de una empresa no cambian a la otra ni guardan la clave", () => {
  const store = tempStore();
  const saved = store.updateSettings("co-lumen", {
    model: "jokma-ficha",
    organization: "Cafetería Lumen Norte",
    description: "Café de barrio y pastelería",
    products: "Café de especialidad y pasteles",
    person_profile: "Atiende Ana",
    reply_guide: "No prometas descuentos.",
    google_client_secret: "valor-de-prueba",
  });
  assert.equal(saved.clave, undefined);
  assert.equal(saved.nombre, "Cafetería Lumen Norte");
  assert.equal(saved.ajustes.organization, "Cafetería Lumen Norte");
  assert.equal(saved.ajustes.products, "Café de especialidad y pasteles");
  assert.equal(saved.ajustes.reply_guide, "No prometas descuentos.");
  assert.equal(saved.ajustes.google_client_secret, "valor-de-prueba");
  assert.equal(saved.ajustes.instagram_access_token, "");
  const state = store.getState();
  const arce = state.companies.find((item) => item.id === "co-arce");
  assert.equal(arce.nombre, "Clínica Dental Arce");
  assert.equal(arce.ajustes, undefined);
  assert.equal(store.scopedState("co-arce").companies[0].ajustes.organization, "Clínica Dental Arce");
  assert.equal(store.scopedState("co-arce").companies[0].ajustes.google_client_secret, "");
  assert.equal(store.authenticate("lumen", "lumen123").id, "co-lumen");
});

test("una empresa nueva conserva su ficha al recargar el archivo", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jokma-"));
  const file = path.join(dir, "pulse.json");
  const store = createStore(file);
  const company = store.createCompany({
    nombre: "Florería Nube",
    industria: "Comercio",
    servicios: "Ramos de temporada",
    horarios: "Lunes a viernes 10:00–18:00",
    telefono: "+52 81 1000 2000",
    correoOficial: "hola@florerianube.mx",
    sitioWeb: "https://florerianube.mx",
    soporte: "ayuda@florerianube.mx",
  });
  const account = store.createAccount(company.id, {
    canal: "email",
    cuenta: "hola@florerianube.mx",
    agenteNombre: "Nube Correo",
  });
  assert.equal(account.agente.ficha.telefono, "+52 81 1000 2000");
  assert.equal(account.agente.industria, "Comercio");
  const reloaded = createStore(file).getState();
  assert.ok(reloaded.companies.some((item) => item.nombre === "Florería Nube"));
  assert.ok(reloaded.accounts.some((item) => item.agente.nombre === "Nube Correo"));
});
