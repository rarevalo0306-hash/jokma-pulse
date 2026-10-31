import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";
import { countEmojis } from "../src/replies.js";

const base = process.env.BASE_URL || "http://127.0.0.1:4317";
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || "/usr/local/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const page = await browser.newPage();
page.setDefaultTimeout(20000);
await page.setViewport({ width: 1280, height: 860 });

async function clickTestId(id) {
  await page.$eval(`[data-testid="${id}"]`, (el) => {
    el.scrollIntoView({ block: "center" });
    el.click();
  });
}

async function login(usuario, clave) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="login-form"]');
  await page.$eval("#login-user", (el, value) => { el.value = value; }, usuario);
  await page.$eval("#login-password", (el, value) => { el.value = value; }, clave);
  await clickTestId("login-submit");
}

async function openMessage(id) {
  await page.$eval(`[data-testid="message-${id}"]`, (el) => {
    el.scrollIntoView({ block: "center" });
    el.click();
  });
  await page.waitForFunction(
    (messageId) =>
      document.querySelector('[data-testid="generate-reply"]') &&
      document.querySelector(`[data-testid="message-${messageId}"]`)?.getAttribute("aria-current") === "true",
    {},
    id,
  );
}

async function generate() {
  const before = await page.$eval('[data-testid="reply-text"]', (el) => el.dataset.replyAt || "");
  await page.$eval('[data-testid="generate-reply"]', (el) => {
    el.scrollIntoView({ block: "center" });
    el.click();
  });
  try {
    await page.waitForFunction((previous) => {
      const reply = document.querySelector('[data-testid="reply-text"]');
      const revision = document.querySelector('[data-testid="revision"]');
      return reply && reply.dataset.replyAt && reply.dataset.replyAt !== previous && revision && (revision.dataset.ok === "true" || revision.dataset.ok === "false");
    }, { timeout: 15000 }, before);
  } catch (error) {
    const snapshot = await page.evaluate(() => ({
      error: document.querySelector('[data-testid="form-error"]')?.textContent || "",
      revision: document.querySelector('[data-testid="revision"]')?.textContent || "",
      ok: document.querySelector('[data-testid="revision"]')?.dataset.ok || "",
      replyAt: document.querySelector('[data-testid="reply-text"]')?.dataset.replyAt || "",
    }));
    throw new Error(`${error.message} ${JSON.stringify(snapshot)}`);
  }
  const ok = await page.$eval('[data-testid="revision"]', (el) => el.dataset.ok);
  const reply = await page.$eval('[data-testid="reply-text"]', (el) => el.textContent);
  assert.equal(ok, "true", reply);
  return reply;
}

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="demo-logins"]');
  const demo = await page.$eval('[data-testid="demo-logins"]', (el) => el.textContent);
  assert.match(demo, /lumen/);
  assert.match(demo, /lumen123/);
  assert.match(demo, /arce/);
  assert.match(demo, /arce123/);
  assert.equal(await page.$('[data-testid="session-company"]'), null);

  await page.$eval("#login-user", (el) => { el.value = "lumen"; });
  await page.$eval("#login-password", (el) => { el.value = "no-es-la-clave"; });
  await page.click('[data-testid="login-submit"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="login-error"]')?.textContent.includes("incorrectos"));
  assert.equal(await page.$('[data-testid="nav-inbox"]'), null);

  const blocked = await page.evaluate(async () => {
    const response = await fetch("/api/estado");
    return response.status;
  });
  assert.equal(blocked, 401);

  await login("lumen", "lumen123");
  await page.waitForSelector('[data-testid="session-company"]');
  const lumenName = await page.$eval('[data-testid="session-company"]', (el) => el.textContent);
  assert.equal(lumenName, "Cafetería Lumen");
  const lumenBody = await page.evaluate(() => document.body.innerText);
  assert.equal(lumenBody.includes("Clínica Dental Arce"), false);
  assert.equal(lumenBody.includes("dentalarce"), false);
  const lumenState = await page.evaluate(async () => fetch("/api/estado").then((response) => response.json()));
  assert.deepEqual(lumenState.companies.map((item) => item.nombre), ["Cafetería Lumen"]);
  assert.ok(lumenState.accounts.length > 1);
  assert.ok(lumenState.accounts.every((item) => item.empresaId === "co-lumen"));
  assert.ok(lumenState.messages.every((item) => item.empresaId === "co-lumen"));
  assert.equal(JSON.stringify(lumenState).includes("clave"), false);
  assert.equal(JSON.stringify(lumenState).includes("lumen123"), false);

  await page.click('[data-testid="company-co-lumen"]');
  await page.waitForSelector('[data-testid="ficha-nombre"]');
  const fichaName = await page.$eval('[data-testid="ficha-nombre"]', (el) => el.value);
  assert.equal(fichaName, "Cafetería Lumen");
  const accountCount = await page.$$eval('[data-testid^="account-"]', (nodes) => nodes.length);
  assert.ok(accountCount > 1);

  await page.click('[data-testid="nav-inbox"]');
  await openMessage("msg-lumen-review-pos");
  const positive = await generate();
  assert.ok(positive.includes("El latte de vainilla estaba delicioso"));
  assert.match(positive, /5 estrellas/);
  assert.equal(countEmojis(positive), 0);
  assert.doesNotMatch(positive, /dentalarce|lumen123/);

  await openMessage("msg-lumen-ig-comment");
  const comment = await generate();
  assert.match(comment, /mensaje privado/i);
  assert.equal(comment.includes("4421"), false);
  assert.ok(comment.split("\n").filter((line) => line.trim()).length <= 2);

  await clickTestId("logout");
  await page.waitForSelector('[data-testid="login-form"]');

  await login("arce", "arce123");
  await page.waitForSelector('[data-testid="session-company"]');
  const arceName = await page.$eval('[data-testid="session-company"]', (el) => el.textContent);
  assert.equal(arceName, "Clínica Dental Arce");
  const arceBody = await page.evaluate(() => document.body.innerText);
  assert.equal(arceBody.includes("Cafetería Lumen"), false);
  assert.equal(arceBody.includes("cafelumen"), false);
  const arceState = await page.evaluate(async () => fetch("/api/estado").then((response) => response.json()));
  assert.deepEqual(arceState.companies.map((item) => item.id), ["co-arce"]);
  assert.ok(arceState.accounts.every((item) => item.empresaId === "co-arce"));
  assert.ok(arceState.messages.every((item) => item.empresaId === "co-arce"));
  assert.equal(await page.$('[data-testid="message-msg-lumen-review-pos"]'), null);

  await openMessage("msg-arce-review-neg");
  const negative = await generate();
  assert.match(negative, /lamentamos/i);
  assert.match(negative, /privado/);
  assert.ok(negative.includes("+52 33 4500 2290"));
  assert.doesNotMatch(negative, /\bpero\b|cafelumen|arce123/i);
  assert.equal(countEmojis(negative), 0);

  await openMessage("msg-arce-x-post");
  const complaint = await generate();
  assert.match(complaint, /\bDM\b/);
  assert.ok(complaint.length <= 180);
  assert.equal(countEmojis(complaint), 0);

  const foreign = await page.evaluate(async () => {
    const response = await fetch("/api/empresas/co-lumen", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: "Otra" }),
    });
    return response.status;
  });
  assert.equal(foreign, 403);

  console.log(JSON.stringify({ ok: true, positive, negative, complaint }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
