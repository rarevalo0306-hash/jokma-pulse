import fs from "node:fs";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";
import { countEmojis } from "../src/replies.js";

const base = process.env.BASE_URL || "http://127.0.0.1:4317";
const shots = "/tmp/jokma-pulse-shots";
fs.mkdirSync(shots, { recursive: true });

const checks = [
  {
    id: "msg-lumen-review-pos",
    agent: "Lumen Reseñas",
    industry: "Alimentos y bebidas",
    includes: ["El latte de vainilla estaba delicioso", "5 estrellas", "Cafetería Lumen"],
    excludes: ["dentalarce", "4421", "+52 33 4500 2290"],
    maxEmojis: 1,
  },
  {
    id: "msg-arce-review-neg",
    agent: "Arce Reseñas",
    industry: "Salud",
    includes: ["lamentamos", "privado", "+52 33 4500 2290"],
    excludes: ["cafelumen", "salí a las 12", "pero"],
    maxEmojis: 0,
  },
  {
    id: "msg-lumen-ig-dm",
    agent: "Lumen Directo",
    industry: "Alimentos y bebidas",
    includes: ["Lunes a viernes 7:30–19:00, sábados 8:00–14:00", "hola@cafelumen.mx"],
    excludes: ["dentalarce", "Limpieza dental"],
    minEmojis: 1,
    maxEmojis: 2,
  },
  {
    id: "msg-arce-fb-dm",
    agent: "Arce Messenger",
    industry: "Salud",
    includes: [
      "Limpieza dental, ortodoncia y urgencias",
      "Lunes a viernes 9:00–19:00, sábados 9:00–14:00",
      "+52 33 4500 2288",
    ],
    excludes: ["limpieza los sábados", "cafelumen"],
    minEmojis: 1,
    maxEmojis: 2,
  },
  {
    id: "msg-lumen-ig-comment",
    agent: "Lumen Comentarios",
    industry: "Alimentos y bebidas",
    includes: ["mensaje privado"],
    excludes: ["4421", "contraseña"],
    maxLines: 2,
  },
  {
    id: "msg-arce-fb-comment",
    agent: "Arce Comentarios",
    industry: "Salud",
    includes: ["Lunes a viernes 9:00–19:00, sábados 9:00–14:00", "urgencias"],
    excludes: ["abiertos los domingos", "sí, los domingos"],
    maxLines: 2,
  },
  {
    id: "msg-arce-x-post",
    agent: "Arce X",
    industry: "Salud",
    includes: ["lo sentimos", "DM"],
    excludes: ["4500 2290", "dolor"],
    maxLength: 180,
    maxEmojis: 0,
  },
  {
    id: "msg-lumen-x-dm",
    agent: "Lumen X",
    industry: "Alimentos y bebidas",
    includes: ["no está en la ficha", "correo"],
    excludes: ["chilaquiles", "croissant", "huevos"],
    maxLength: 180,
    maxEmojis: 0,
  },
  {
    id: "msg-lumen-email",
    agent: "Lumen Correo",
    industry: "Alimentos y bebidas",
    includes: [
      "Estimado/a Roberto Salinas:",
      "Atentamente",
      "Le pedimos",
      "Lunes a viernes 7:30–19:00, sábados 8:00–14:00",
      "hola@cafelumen.mx",
      "no incluye un correo de facturación",
      "teléfono o un correo",
    ],
    excludes: ["correo de facturación es"],
    maxEmojis: 0,
  },
];

function assertReply(spec, reply) {
  for (const part of spec.includes) {
    assert.ok(reply.toLowerCase().includes(part.toLowerCase()), `${spec.id} missing ${part}\n${reply}`);
  }
  for (const part of spec.excludes || []) {
    assert.equal(reply.toLowerCase().includes(part.toLowerCase()), false, `${spec.id} has ${part}\n${reply}`);
  }
  const emojis = countEmojis(reply);
  if (spec.maxEmojis !== undefined) assert.ok(emojis <= spec.maxEmojis, `${spec.id} emojis ${emojis}`);
  if (spec.minEmojis !== undefined) assert.ok(emojis >= spec.minEmojis, `${spec.id} emojis ${emojis}`);
  if (spec.maxLines !== undefined) {
    const lines = reply.split("\n").filter((line) => line.trim());
    assert.ok(lines.length <= spec.maxLines && lines.length >= 1, `${spec.id} lines ${lines.length}`);
  }
  if (spec.maxLength !== undefined) assert.ok(reply.length <= spec.maxLength, `${spec.id} length`);
}

async function shot(page, name) {
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || "/usr/local/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

const page = await browser.newPage();
page.setDefaultTimeout(20000);
await page.setViewport({ width: 1280, height: 860 });
const context = browser.defaultBrowserContext();
await context.overridePermissions(base, ["clipboard-read", "clipboard-write"]);
page.on("dialog", (dialog) => dialog.accept());

const verified = [];
let soporteTouched = false;

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="app-ready"]');
  await page.waitForSelector('[data-testid="company-co-lumen"]');
  await page.waitForSelector('[data-testid="company-co-arce"]');
  await shot(page, "01-bandeja");

  await page.click('[data-testid="company-co-lumen"]');
  await page.waitForSelector('[data-testid="model-note"]');
  const lumenIndustry = await page.$eval('[data-testid="ficha-industria"]', (el) => el.value);
  assert.equal(lumenIndustry, "Alimentos y bebidas");
  const lumenAccounts = await page.$$('[data-testid^="account-ac-lumen"]');
  assert.ok(lumenAccounts.length > 1);
  const lumenHandles = await page.$$eval('[data-testid^="account-ac-lumen"]', (nodes) =>
    nodes.map((node) => node.innerText),
  );
  const instagramAgents = lumenHandles.filter((text) => text.includes("@cafelumen"));
  assert.ok(instagramAgents.length >= 2);
  assert.ok(lumenHandles.some((text) => text.includes("Lumen Directo")));
  assert.ok(lumenHandles.some((text) => text.includes("Lumen Comentarios")));
  assert.notEqual(
    lumenHandles.find((text) => text.includes("Lumen Directo")),
    lumenHandles.find((text) => text.includes("Lumen Comentarios")),
  );
  await shot(page, "02-lumen");

  await page.click('[data-testid="company-co-arce"]');
  await page.waitForSelector('[data-testid="account-ac-arce-reviews"]');
  const arceIndustry = await page.$eval('[data-testid="ficha-industria"]', (el) => el.value);
  assert.equal(arceIndustry, "Salud");
  assert.notEqual(arceIndustry, lumenIndustry);
  const arceAccounts = await page.$$('[data-testid^="account-ac-arce"]');
  assert.ok(arceAccounts.length > 1);
  const arceText = await page.$$eval('[data-testid^="account-ac-arce"]', (nodes) =>
    nodes.map((node) => node.innerText).join("\n"),
  );
  assert.ok(arceText.includes("Arce Messenger"));
  assert.ok(arceText.includes("Arce Comentarios"));
  assert.ok(arceText.includes("Dental Arce"));
  await shot(page, "03-arce");

  await page.click('[data-testid="nav-inbox"]');
  await page.waitForSelector('[data-testid="message-msg-lumen-email"]');

  for (const spec of checks) {
    await page.click(`[data-testid="message-${spec.id}"]`);
    await page.waitForSelector('[data-testid="agent-name"]');
    const agent = await page.$eval('[data-testid="agent-name"]', (el) => el.textContent.trim());
    const industry = await page.$eval('[data-testid="agent-industry"]', (el) => el.textContent);
    const ficha = await page.$eval('[data-testid="agent-ficha"]', (el) => el.textContent);
    assert.equal(agent, spec.agent, spec.id);
    assert.ok(industry.includes(spec.industry), spec.id);
    if (spec.industry === "Salud") assert.equal(ficha.includes("cafelumen"), false);
    if (spec.industry === "Alimentos y bebidas") assert.equal(ficha.includes("dentalarce"), false);
    const reply = await generate(page);
    assertReply(spec, reply);
    const ok = await page.$eval('[data-testid="revision"]', (el) => el.dataset.ok);
    assert.equal(ok, "true", spec.id);
    verified.push({ id: spec.id, agent, reply });
    if (spec.id === "msg-lumen-review-pos") await shot(page, "04-resena-positiva");
    if (spec.id === "msg-lumen-email") await shot(page, "05-correo");
    if (spec.id === "msg-arce-x-post") await shot(page, "06-reclamo-x");
  }

  await page.click('[data-testid="copy-reply"]');
  const copyState = await page.evaluate(async () => {
    let clipboard = "";
    try {
      clipboard = await navigator.clipboard.readText();
    } catch (error) {
      clipboard = `read-failed:${error}`;
    }
    return {
      clipboard,
      selected: window.getSelection()?.toString() || "",
      note: document.querySelector('[data-testid="revision"]')?.textContent || "",
      copied: document.querySelector('[data-testid="revision"]')?.dataset.copied || "",
      error: window.__copyError || "",
    };
  });
  const expectedReply = verified.at(-1).reply;
  assert.ok(
    copyState.clipboard === expectedReply || copyState.selected === expectedReply,
    JSON.stringify(copyState),
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="message-msg-lumen-review-pos"]');
  await page.click('[data-testid="message-msg-lumen-review-pos"]');
  const persisted = await page.$eval('[data-testid="reply-text"]', (el) => el.textContent);
  assert.ok(persisted.includes("El latte de vainilla estaba delicioso"));

  await page.click('[data-testid="company-co-arce"]');
  await page.waitForSelector('[data-testid="ficha-soporte"]');
  await page.$eval('[data-testid="ficha-soporte"]', (el) => {
    el.value = "+52 33 4500 2200";
  });
  soporteTouched = true;
  await page.click('[data-testid="save-company"]');
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="save-status"]')?.textContent.includes("Ficha guardada"),
  );
  await page.click('[data-testid="nav-inbox"]');
  await page.click('[data-testid="message-msg-arce-review-neg"]');
  const updatedReply = await generate(page);
  assert.ok(updatedReply.includes("+52 33 4500 2200"));
  assert.equal(updatedReply.includes("+52 33 4500 2290"), false);

  await page.click('[data-testid="company-co-arce"]');
  await page.$eval('[data-testid="ficha-soporte"]', (el) => {
    el.value = "+52 33 4500 2290";
  });
  await page.click('[data-testid="save-company"]');
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="save-status"]')?.textContent.includes("Ficha guardada"),
  );
  soporteTouched = false;
  await page.click('[data-testid="nav-inbox"]');
  await page.click('[data-testid="message-msg-arce-review-neg"]');
  const restoredReply = await generate(page);
  assert.ok(restoredReply.includes("+52 33 4500 2290"));

  await page.click('[data-testid="new-company"]');
  await page.click('[data-testid="save-company"]');
  await page.waitForSelector('[data-testid="form-error"]');
  const validation = await page.$eval('[data-testid="form-error"]', (el) => el.textContent);
  assert.match(validation, /nombre/i);

  const fields = {
    nombre: "Florería Nube",
    industria: "Comercio",
    servicios: "Ramos de temporada",
    horarios: "Lunes a viernes 10:00–18:00",
    telefono: "+52 81 1000 2000",
    correoOficial: "hola@florerianube.mx",
    sitioWeb: "https://florerianube.mx",
    soporte: "ayuda@florerianube.mx",
  };
  for (const [field, value] of Object.entries(fields)) {
    await page.$eval(
      `[data-testid="ficha-${field}"]`,
      (el, next) => {
        el.value = next;
      },
      value,
    );
  }
  await page.click('[data-testid="save-company"]');
  await page.waitForSelector('[data-testid="account-form"]');
  await page.select('[data-testid="account-canal"]', "email");
  await page.$eval('[data-testid="account-handle"]', (el) => {
    el.value = "hola@florerianube.mx";
  });
  await page.$eval('[data-testid="account-agent-name"]', (el) => {
    el.value = "Nube Correo";
  });
  await page.click('[data-testid="save-account"]');
  await page.waitForFunction(() => document.body.textContent.includes("Nube Correo"));

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.textContent.includes("Florería Nube"));
  const nubeId = await page.evaluate(() => {
    const button = [...document.querySelectorAll("[data-testid^='company-']")].find((el) =>
      el.textContent.includes("Florería Nube"),
    );
    return button?.dataset.id || "";
  });
  await page.click(`[data-testid="company-${nubeId}"]`);
  const nubePhone = await page.$eval('[data-testid="ficha-telefono"]', (el) => el.value);
  assert.equal(nubePhone, "+52 81 1000 2000");
  await page.click('[data-testid="delete-company"]');
  await page.waitForFunction(() => !document.body.textContent.includes("Florería Nube"));

  await page.click('[data-testid="nav-inbox"]');
  await page.click('[data-testid="message-form-wrap"] summary');
  await page.select('[data-testid="message-company"]', "co-lumen");
  await page.waitForFunction(() =>
    [...document.querySelectorAll("#message-account option")].some((option) =>
      option.textContent.includes("Lumen Directo"),
    ),
  );
  const directo = await page.$$eval("#message-account option", (options) => {
    return options.find((option) => option.textContent.includes("Lumen Directo"))?.value || "";
  });
  await page.select("#message-account", directo);
  await page.$eval("#message-name", (el) => {
    el.value = "Ana Prueba";
  });
  await page.$eval("#message-text", (el) => {
    el.value = "¿Cuánto cuesta el latte?";
  });
  await page.click('[data-testid="save-message"]');
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="message-text-view"]')?.textContent.includes("latte"),
  );
  const priceReply = await generate(page);
  assert.match(priceReply, /no está en la ficha/i);
  assert.match(priceReply, /teléfono o un correo/i);
  assert.equal(countEmojis(priceReply), 1);
  assert.doesNotMatch(priceReply, /\$|pesos|mxn|85/i);
  await page.click('[data-testid="delete-message"]');
  await page.waitForFunction(() => !document.body.textContent.includes("Ana Prueba"));

  await page.setViewport({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="company-co-lumen"]');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  assert.equal(overflow, false);
  await page.click('[data-testid="company-co-lumen"]');
  await page.waitForSelector('[data-testid="ficha-nombre"]');
  await shot(page, "07-movil");

  const finalState = await page.evaluate(async () => {
    const response = await fetch("/api/estado");
    return response.json();
  });
  assert.equal(finalState.companies.length, 2);
  assert.equal(finalState.messages.length, 9);
  assert.ok(finalState.messages.every((message) => message.respuesta));
  assert.equal(
    finalState.companies.find((company) => company.id === "co-arce").soporte,
    "+52 33 4500 2290",
  );

  fs.writeFileSync(`${shots}/replies.json`, JSON.stringify(verified, null, 2));
  console.log(JSON.stringify({ ok: true, verified: verified.length, shots }, null, 2));
} catch (error) {
  await shot(page, "error").catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  if (soporteTouched) {
    await page.evaluate(async () => {
      const state = await fetch("/api/estado").then((response) => response.json());
      const company = state.companies.find((item) => item.id === "co-arce");
      company.soporte = "+52 33 4500 2290";
      await fetch("/api/empresas/co-arce", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(company),
      });
    }).catch(() => {});
  }
  await browser.close();
}

async function generate(page) {
  const before = await page.$eval('[data-testid="reply-text"]', (el) => el.dataset.replyAt || "");
  await page.click('[data-testid="generate-reply"]');
  await page.waitForFunction((previous) => {
    const reply = document.querySelector('[data-testid="reply-text"]');
    const revision = document.querySelector('[data-testid="revision"]');
    return (
      reply &&
      reply.dataset.replyAt &&
      reply.dataset.replyAt !== previous &&
      revision &&
      revision.dataset.ok !== "pending"
    );
  }, {}, before);
  const ok = await page.$eval('[data-testid="revision"]', (el) => el.dataset.ok);
  const reply = await page.$eval('[data-testid="reply-text"]', (el) => el.textContent);
  assert.equal(ok, "true", reply);
  return reply;
}
