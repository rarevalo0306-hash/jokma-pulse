import fs from "node:fs";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const base = process.env.BASE_URL || "http://127.0.0.1:4317";
const chrome = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const shots = decodeURIComponent(new URL("../.impeccable/review/", import.meta.url).pathname);
fs.mkdirSync(shots, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

const page = await browser.newPage();
page.setDefaultTimeout(20000);
page.on("dialog", (dialog) => dialog.accept());

async function login() {
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.type("#login-user", "lumen");
  await page.type("#login-password", "lumen123");
  await page.click('[data-testid="login-submit"]');
  await page.waitForSelector('[data-testid="company-switcher"]');
}

try {
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await login();
  const organizationIds = await page.$eval('[data-testid="organization-switcher"]', (node) =>
    Object.fromEntries([...node.options].map((option) => [option.textContent.trim(), option.value])),
  );
  const lumenOrganizationId = Object.entries(organizationIds).find(([label]) => label.includes("Cafetería Lumen"))?.[1];
  const arceOrganizationId = Object.entries(organizationIds).find(([label]) => label.includes("Clínica Dental Arce"))?.[1];
  assert.ok(lumenOrganizationId);
  assert.ok(arceOrganizationId);
  assert.equal(await page.$eval('[data-testid="organization-switcher"]', (node) => node.value), lumenOrganizationId);
  assert.equal(await page.$eval('[data-testid="company-switcher"]', (node) => node.options.length), 1);
  assert.ok(await page.$('[data-testid="person-mariana-lópez"]'));
  assert.equal(await page.$('[data-testid="person-jorge-ramírez"]'), null);
  await page.screenshot({ path: `${shots}desktop.png`, fullPage: true });

  await page.select('[data-testid="organization-switcher"]', arceOrganizationId);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="company-switcher"]')?.selectedOptions[0]?.textContent.includes("Clínica Dental Arce"),
  );
  await page.waitForSelector('[data-testid="person-jorge-ramírez"]');
  assert.equal(await page.$('[data-testid="person-mariana-lópez"]'), null);

  const verificationMessageId = await page.evaluate(async () => {
    const stateResponse = await fetch("/api/estado");
    const state = await stateResponse.json();
    const account = state.accounts[0];
    const response = await fetch("/api/mensajes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cuentaId: account.id,
        nombreCliente: "Verificación Pulse",
        texto: "Mensaje sintético para verificar el flujo de aprobación.",
        calificacion: account.canal === "google_reviews" ? 5 : null,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "No se creó el mensaje de verificación");
    return body.id;
  });
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="person-verificación-pulse"]');
  await page.$eval('[data-testid="person-verificación-pulse"]', (node) => node.click());
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-testid^="message-"] button')].some((node) => node.offsetParent !== null),
  );
  await page.evaluate((id) => document.querySelector(`[data-action="open-message"][data-id="${CSS.escape(id)}"]`)?.click(), verificationMessageId);
  const [draftResponse, refreshedStateResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/respuesta")),
    page.waitForResponse((response) => response.url().endsWith("/api/estado")),
    page.$eval('[data-testid="generate-reply"]', (node) => node.click()),
  ]);
  assert.equal(draftResponse.status(), 200, await draftResponse.text());
  assert.equal(refreshedStateResponse.status(), 200, await refreshedStateResponse.text());
  await page.waitForFunction(
    () => {
      const reply = document.querySelector('[data-testid="reply-text"]');
      const approve = document.querySelector('[data-testid="approve-draft"]');
      return reply?.value.length > 10 && approve && !approve.disabled;
    },
  );
  const [approvalResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/aprobar")),
    page.$eval('[data-testid="approve-draft"]', (node) => node.click()),
  ]);
  assert.equal(approvalResponse.status(), 200);
  await page.waitForFunction(() => document.querySelector('[data-testid="approve-draft"]')?.textContent.includes("Aprobado"));

  await page.evaluate(async (id) => {
    const response = await fetch(`/api/mensajes/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) throw new Error("No se eliminó el mensaje de verificación");
  }, verificationMessageId);

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="company-switcher"]');
  assert.equal(await page.$eval(".inbox", (node) => node.dataset.mobilePane), "list");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: `${shots}mobile-list.png` });
  await page.$eval('[data-testid="person-jorge-ramírez"]', (node) => node.click());
  await page.waitForFunction(() => document.querySelector(".inbox")?.dataset.mobilePane === "conversation");
  await page.screenshot({ path: `${shots}mobile-conversation.png` });
  await page.$eval('[data-action="back-to-list"]', (node) => node.click());
  await page.waitForFunction(() => document.querySelector(".inbox")?.dataset.mobilePane === "list");
  await page.$eval('[data-testid="nav-spaces"]', (node) => node.click());
  await page.waitForSelector('[data-testid="change-password-form"]');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: `${shots}mobile-spaces.png`, fullPage: true });

  console.log(JSON.stringify({ ok: true, organizationSwitch: true, approval: true, mobileListDetail: true, mobileSpaces: true }));
} finally {
  await browser.close();
}
