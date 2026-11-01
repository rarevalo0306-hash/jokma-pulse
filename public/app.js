const app = document.querySelector("#app");

const state = {
  view: "bandeja",
  companies: [],
  accounts: [],
  messages: [],
  canales: [],
  selectedCompanyId: null,
  selectedMessageId: null,
  draft: null,
  filterCompany: "",
  filterChannel: "",
  error: "",
  notice: "",
};

const FICHA_FIELDS = [
  ["nombre", "Nombre"],
  ["industria", "Industria"],
  ["servicios", "Servicios o productos"],
  ["horarios", "Horarios de atención"],
  ["telefono", "Teléfono"],
  ["correoOficial", "Correo oficial"],
  ["sitioWeb", "Sitio web"],
  ["soporte", "Correo o teléfono de soporte"],
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function channelLabel(id) {
  return state.canales.find((item) => item.id === id)?.etiqueta || id;
}

function companyById(id) {
  return state.companies.find((item) => item.id === id);
}

function accountById(id) {
  return state.accounts.find((item) => item.id === id);
}

function stars(value) {
  if (!value) return "";
  return "★".repeat(value) + "☆".repeat(5 - value);
}

async function api(url, options) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "No se pudo completar la acción.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function load() {
  const payload = await api("/api/estado");
  state.companies = payload.companies;
  state.accounts = payload.accounts;
  state.messages = payload.messages;
  state.canales = payload.canales;
  if (state.selectedCompanyId && !companyById(state.selectedCompanyId)) {
    state.selectedCompanyId = null;
    state.view = "bandeja";
  }
  if (state.selectedMessageId && !state.messages.some((item) => item.id === state.selectedMessageId)) {
    state.selectedMessageId = null;
  }
}

function setDraftFromCompany(company) {
  state.draft = {};
  for (const [field] of FICHA_FIELDS) state.draft[field] = company?.[field] || "";
}

function isDarkTheme() {
  return document.documentElement.dataset.theme === "dark";
}

function themeButton() {
  const dark = isDarkTheme();
  return `<button type="button" class="ghost theme-toggle" data-action="toggle-theme" data-testid="theme-toggle" aria-pressed="${dark ? "true" : "false"}" aria-label="${dark ? "Usar tema claro" : "Usar tema oscuro"}">${dark ? "Tema claro" : "Tema oscuro"}</button>`;
}

function toggleTheme() {
  const next = isDarkTheme() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("pulse-tema", next);
  } catch {
    /* El tema sigue en esta visita si el almacenamiento está bloqueado. */
  }
  for (const button of document.querySelectorAll("[data-testid='theme-toggle']")) {
    const dark = next === "dark";
    button.setAttribute("aria-pressed", dark ? "true" : "false");
    button.setAttribute("aria-label", dark ? "Usar tema claro" : "Usar tema oscuro");
    button.textContent = dark ? "Tema claro" : "Tema oscuro";
  }
}

function setControlBusy(selector, busy, label) {
  const button = document.querySelector(selector);
  if (!button) return;
  if (busy) {
    if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent.trim();
    button.textContent = label;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    return;
  }
  if (button.dataset.idleLabel) button.textContent = button.dataset.idleLabel;
  button.disabled = false;
  button.removeAttribute("aria-busy");
}

function skeletonLines(count) {
  return Array.from({ length: count }, () => `<span class="skeleton"></span>`).join("");
}

function render() {
  app.dataset.ready = "true";
  app.dataset.testid = "app-ready";
  app.innerHTML = `<div class="shell"><a class="skip" href="#contenido">Saltar al contenido</a>${sidebar()}${main()}</div>`;
}

function sidebar() {
  const company = state.companies[0];
  return `<aside class="sidebar">
    <div class="brand">
      <div class="mark" aria-hidden="true">P</div>
      <div>
        <h1>Jokma Pulse</h1>
        <p>Por cuenta y canal</p>
      </div>
    </div>
    <nav class="nav-stack" aria-label="Secciones">
      <button type="button" class="nav-button" data-action="nav-inbox" data-testid="nav-inbox" aria-current="${state.view === "bandeja" ? "page" : "false"}">Bandeja</button>
      ${company ? `<button type="button" class="company-button" data-action="open-company" data-id="${escapeHtml(company.id)}" data-testid="company-${escapeHtml(company.id)}" aria-current="${state.view === "empresa" ? "true" : "false"}"><strong data-testid="session-company">${escapeHtml(company.nombre)}</strong><small>${escapeHtml(company.industria)} · ${state.accounts.length} agentes</small></button>` : ""}
    </nav>
    <div class="nav-footer">
      ${themeButton()}
      <button type="button" class="nav-button" data-action="logout" data-testid="logout">Cerrar sesión</button>
    </div>
  </aside>`;
}

function main() {
  const body =
    state.view === "empresa" || state.view === "nueva" ? companyView() : inboxView();
  return `<main class="main" id="contenido" tabindex="-1">${body}</main>`;
}

function companyView() {
  const creating = state.view === "nueva";
  const company = creating ? null : companyById(state.selectedCompanyId);
  const title = creating ? "Nueva empresa" : company?.nombre || "Empresa";
  const draft = state.draft || {};
  const fields = FICHA_FIELDS.map(([field, label]) => {
    const wide = field === "servicios" || field === "horarios";
    const control =
      field === "servicios" || field === "horarios"
        ? `<textarea id="ficha-${field}" data-field="${field}" data-testid="ficha-${field}" rows="3">${escapeHtml(draft[field] || "")}</textarea>`
        : `<input id="ficha-${field}" data-field="${field}" data-testid="ficha-${field}" value="${escapeHtml(draft[field] || "")}" />`;
    return `<label class="${wide ? "span-2" : ""}" for="ficha-${field}">${label}${control}</label>`;
  }).join("");

  return `<header class="topbar">
      <div>
        <p class="eyebrow">Ficha y agentes</p>
        <h2>${escapeHtml(title)}</h2>
      </div>
    </header>
    ${banner()}
    <section class="panel">
      <p class="model-note" data-testid="model-note">El tipo de agente es el mismo en todas las cuentas. Cada cuenta de red y cada canal tiene su propio perfil: nombre, industria, tono del canal y la ficha de esta empresa. La respuesta usa solo esa ficha.</p>
      <form class="grid" data-action="save-company" data-testid="company-form">
        ${fields}
        <div class="span-2 actions">
          <button class="primary" type="submit" data-testid="save-company">${creating ? "Crear empresa" : "Guardar ficha"}</button>
          <span class="ok-note" data-testid="save-status">${escapeHtml(state.notice)}</span>
        </div>
      </form>
    </section>
    ${creating ? "" : accountsSection(company)}`;
}

function accountsSection(company) {
  const accounts = state.accounts.filter((item) => item.empresaId === company.id);
  const options = state.canales
    .map((item) => `<option value="${item.id}">${escapeHtml(item.etiqueta)}</option>`)
    .join("");
  const cards = accounts
    .map((account) => {
      return `<article class="account-card" data-testid="account-${escapeHtml(account.id)}">
        <div class="account-head">
          <div>
            <span class="pill" data-channel="${escapeHtml(account.canal)}">${escapeHtml(channelLabel(account.canal))}</span>
            <h3 class="account-title">${escapeHtml(account.agente.nombre)}</h3>
            <small>${escapeHtml(account.cuenta)}</small>
          </div>
          <button type="button" class="tiny" data-action="delete-account" data-id="${escapeHtml(account.id)}" aria-label="Quitar ${escapeHtml(account.agente.nombre)}">Quitar</button>
        </div>
        <p class="meta" data-testid="agent-industry-${escapeHtml(account.id)}">Industria: ${escapeHtml(account.agente.industria)} · Tipo: atención</p>
        <p class="tone">${escapeHtml(account.agente.tono)}</p>
        <div class="grid">
          <label>Nombre del agente<input data-account-field="agenteNombre" data-account="${escapeHtml(account.id)}" value="${escapeHtml(account.agente.nombre)}" /></label>
          <label>Cuenta<input data-account-field="cuenta" data-account="${escapeHtml(account.id)}" value="${escapeHtml(account.cuenta)}" /></label>
        </div>
        <button type="button" class="ghost" data-action="save-account" data-id="${escapeHtml(account.id)}">Guardar perfil</button>
      </article>`;
    })
    .join("");

  return `<section>
    <div class="account-head">
      <h3 class="section-title" data-testid="account-count">${accounts.length} ${accounts.length === 1 ? "agente" : "agentes"}</h3>
    </div>
    <div class="account-list">${cards}</div>
    <form class="composer" data-action="save-account-new" data-testid="account-form">
      <h3>Nueva cuenta</h3>
      <div class="grid">
        <label for="account-canal">Canal<select id="account-canal" data-testid="account-canal">${options}</select></label>
        <label for="account-handle">Cuenta o usuario<input id="account-handle" data-testid="account-handle" placeholder="@cuenta, página o buzón" /></label>
        <label class="span-2" for="account-agent-name">Nombre del agente<input id="account-agent-name" data-testid="account-agent-name" placeholder="Nombre de este perfil" /></label>
      </div>
      <div class="actions">
        <button class="primary" type="submit" data-testid="save-account">Agregar agente</button>
      </div>
    </form>
  </section>`;
}

function inboxView() {
  const channelOptions = [`<option value="">Todos los canales</option>`]
    .concat(
      state.canales.map(
        (item) =>
          `<option value="${item.id}" ${state.filterChannel === item.id ? "selected" : ""}>${escapeHtml(item.etiqueta)}</option>`,
      ),
    )
    .join("");
  const messages = state.messages
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .filter((message) => !state.filterCompany || message.empresaId === state.filterCompany)
    .filter((message) => !state.filterChannel || message.canal === state.filterChannel);

  const rows = messages
    .map((message) => {
      const company = companyById(message.empresaId);
      const account = accountById(message.cuentaId);
      return `<li><button type="button" class="message-button" data-action="open-message" data-id="${escapeHtml(message.id)}" data-testid="message-${escapeHtml(message.id)}" aria-current="${state.selectedMessageId === message.id ? "true" : "false"}">
        <div class="message-top">
          <strong>${escapeHtml(message.nombreCliente)}</strong>
          <span class="pill" data-channel="${escapeHtml(message.canal)}">${escapeHtml(channelLabel(message.canal))}</span>
        </div>
        <span class="message-meta">${escapeHtml(company?.nombre || "Empresa")} · ${escapeHtml(account?.agente.nombre || "Agente")}${message.muestra ? ` · ${escapeHtml(message.muestra)}` : ""}</span>
        ${message.calificacion ? `<div class="stars" aria-label="${message.calificacion} de 5 estrellas">${stars(message.calificacion)}</div>` : ""}
        <p class="message-preview">${escapeHtml(message.texto)}</p>
      </button></li>`;
    })
    .join("");

  return `<header class="topbar">
      <div>
        <p class="eyebrow">Bandeja</p>
        <h2>Mensajes</h2>
        <p class="hint">Cada respuesta sale del agente de esa cuenta.</p>
      </div>
      <label class="filter-field" for="filter-channel">Canal
        <select id="filter-channel" data-testid="filter-channel" data-filter="channel">${channelOptions}</select>
      </label>
    </header>
    ${banner()}
    <div class="inbox">
      <section class="inbox-column" aria-label="Lista de mensajes">
        ${composer()}
        <ul class="message-list">
          ${rows || `<li class="empty-state" data-testid="empty-inbox"><h3>Sin mensajes</h3><p>No hay mensajes con ese filtro.</p></li>`}
        </ul>
      </section>
      <div class="inbox-detail">${messageDetail()}</div>
    </div>`;
}

function composer() {
  return `<details class="composer" data-testid="message-form-wrap">
    <summary>Nuevo mensaje</summary>
    <form data-action="save-message" data-testid="message-form">
    <div class="grid">
      <label class="span-2" for="message-account">Agente y canal<select id="message-account" data-testid="message-account"></select></label>
      <label for="message-name">Cliente<input id="message-name" data-testid="message-name" /></label>
      <label id="rating-wrap" for="message-rating">Estrellas<select id="message-rating" data-testid="message-rating">
        <option value="5">5</option><option value="4">4</option><option value="3">3</option><option value="2">2</option><option value="1">1</option>
      </select></label>
      <label class="span-2" for="message-text">Texto<textarea id="message-text" data-testid="message-text"></textarea></label>
    </div>
    <div class="actions">
      <button class="primary" type="submit" data-testid="save-message">Agregar mensaje</button>
    </div>
    </form>
  </details>`;
}

function messageDetail() {
  const message = state.messages.find((item) => item.id === state.selectedMessageId);
  if (!message) {
    return `<section class="profile empty-state" data-testid="empty-detail"><h3>Nada seleccionado</h3><p>Abre un mensaje para ver el agente que lo responde y generar el texto final.</p></section>`;
  }
  const account = accountById(message.cuentaId);
  const company = companyById(message.empresaId);
  const ficha = account?.agente.ficha || {};
  const fichaRows = [
    ["Nombre", ficha.nombre],
    ["Servicios", ficha.servicios],
    ["Horarios", ficha.horarios],
    ["Teléfono", ficha.telefono],
    ["Correo oficial", ficha.correoOficial],
    ["Sitio web", ficha.sitioWeb],
    ["Soporte", ficha.soporte],
  ]
    .map(
      ([label, value]) =>
        `<dt>${label}</dt><dd>${escapeHtml(value || "—")}</dd>`,
    )
    .join("");

  return `<article class="profile" data-testid="message-detail">
    <div class="profile-top">
      <div>
        <p class="eyebrow">${escapeHtml(message.muestra || "Mensaje")}</p>
        <h3>${escapeHtml(message.nombreCliente)}</h3>
        <p class="meta">${escapeHtml(company?.nombre || "")} · ${message.calificacion ? stars(message.calificacion) : channelLabel(message.canal)}</p>
      </div>
      <button type="button" class="tiny danger" data-action="delete-message" data-testid="delete-message">Eliminar</button>
    </div>
    <p class="original" data-testid="message-text-view">${escapeHtml(message.texto)}</p>
    <section class="profile-block">
      <h3>Perfil que responde</h3>
      <p data-testid="agent-name">${escapeHtml(account?.agente.nombre || "")}</p>
      <p class="meta" data-testid="agent-type">Tipo: atención · el mismo en todas las cuentas</p>
      <p class="meta" data-testid="agent-industry">Industria: ${escapeHtml(account?.agente.industria || "")}</p>
      <p class="meta" data-testid="agent-account">${escapeHtml(channelLabel(account?.canal || ""))} · ${escapeHtml(account?.cuenta || "")}</p>
      <p class="tone" data-testid="agent-tone">${escapeHtml(account?.agente.tono || "")}</p>
    </section>
    <section class="profile-block">
      <h3>Ficha de esta cuenta</h3>
      <dl class="ficha-used" data-testid="agent-ficha">${fichaRows}</dl>
    </section>
    <div class="actions">
      <button type="button" class="primary" data-action="generate-reply" data-testid="generate-reply">Generar respuesta</button>
      <button type="button" class="ghost" data-action="copy-reply" data-testid="copy-reply">Copiar respuesta</button>
    </div>
    <pre class="reply" data-testid="reply-text" data-reply-at="${escapeHtml(message.respondidoEn || "")}">${escapeHtml(message.respuesta || "")}</pre>
    <p class="revision" data-testid="revision" data-ok="${message.respuesta ? "pending" : "false"}" aria-live="polite">${message.respuesta ? "Respuesta guardada en este equipo." : "Aún no hay respuesta."}</p>
  </section>`;
}

function banner() {
  if (!state.error) return "";
  return `<p class="error" data-testid="form-error" role="alert">${escapeHtml(state.error)}</p>`;
}

function fillAccountSelect() {
  const accountSelect = document.querySelector("#message-account");
  const ratingWrap = document.querySelector("#rating-wrap");
  if (!accountSelect) return;
  const empresaId = state.companies[0]?.id;
  const accounts = state.accounts.filter((item) => item.empresaId === empresaId);
  accountSelect.innerHTML = accounts
    .map(
      (account) =>
        `<option value="${escapeHtml(account.id)}">${escapeHtml(account.agente.nombre)} · ${escapeHtml(channelLabel(account.canal))}</option>`,
    )
    .join("");
  const selected = accountById(accountSelect.value);
  if (ratingWrap) ratingWrap.hidden = selected?.canal !== "google_reviews";
}

app.addEventListener("input", (event) => {
  const field = event.target.dataset.field;
  if (!field || !state.draft) return;
  state.draft[field] = event.target.value;
});

app.addEventListener("change", async (event) => {
  if (event.target.dataset.filter) {
    if (event.target.dataset.filter === "channel") state.filterChannel = event.target.value;
    render();
    fillAccountSelect();
    return;
  }
  if (event.target.id === "message-account") {
    const selected = accountById(event.target.value);
    const ratingWrap = document.querySelector("#rating-wrap");
    if (ratingWrap) ratingWrap.hidden = selected?.canal !== "google_reviews";
  }
});

app.addEventListener("submit", async (event) => {
  const form = event.target.closest("form");
  if (!form) return;
  event.preventDefault();
  const busy = {
    login: ["[data-testid='login-submit']", "Entrando"],
    "save-company": ["[data-testid='save-company']", "Guardando"],
    "save-account-new": ["[data-testid='save-account']", "Agregando"],
    "save-message": ["[data-testid='save-message']", "Agregando"],
  }[form.dataset.action];
  if (busy) setControlBusy(busy[0], true, busy[1]);
  try {
    state.error = "";
    if (form.dataset.action === "login") await submitLogin();
    if (form.dataset.action === "save-company") await saveCompany();
    if (form.dataset.action === "save-account-new") await createAccount();
    if (form.dataset.action === "save-message") await createMessage();
  } catch (error) {
    if (form.dataset.action === "login") {
      setControlBusy("[data-testid='login-submit']", false);
      const node = document.querySelector('[data-testid="login-error"]');
      if (node) node.textContent = error.message;
      for (const id of ["login-user", "login-password"]) {
        document.getElementById(id)?.setAttribute("aria-invalid", "true");
      }
      return;
    }
    state.error = error.message;
    render();
    fillAccountSelect();
  }
});

app.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || button.closest("form")) return;
  try {
    state.error = "";
    const action = button.dataset.action;
    if (action === "toggle-theme") {
      toggleTheme();
    } else if (action === "retry-boot") {
      await boot();
    } else if (action === "nav-inbox") {
      state.view = "bandeja";
      state.notice = "";
      render();
      fillAccountSelect();
    } else if (action === "logout") {
      await api("/api/sesion", { method: "DELETE" });
      state.companies = [];
      state.accounts = [];
      state.messages = [];
      state.selectedCompanyId = null;
      state.selectedMessageId = null;
      state.error = "";
      state.notice = "";
      renderLogin();
    } else if (action === "open-company") {
      state.view = "empresa";
      state.selectedCompanyId = button.dataset.id;
      state.notice = "";
      setDraftFromCompany(companyById(button.dataset.id));
      render();
    } else if (action === "delete-account") {
      await api(`/api/cuentas/${button.dataset.id}`, { method: "DELETE" });
      await load();
      render();
    } else if (action === "save-account") {
      const id = button.dataset.id;
      setControlBusy(`[data-action="save-account"][data-id="${id}"]`, true, "Guardando");
      const nombre = app.querySelector(`[data-account-field="agenteNombre"][data-account="${id}"]`).value;
      const cuenta = app.querySelector(`[data-account-field="cuenta"][data-account="${id}"]`).value;
      await api(`/api/cuentas/${id}`, {
        method: "PUT",
        body: JSON.stringify({ agenteNombre: nombre, cuenta }),
      });
      state.notice = "Perfil guardado.";
      await load();
      render();
    } else if (action === "open-message") {
      state.selectedMessageId = button.dataset.id;
      state.view = "bandeja";
      render();
      fillAccountSelect();
    } else if (action === "generate-reply") {
      setControlBusy("[data-testid='generate-reply']", true, "Generando");
      const result = await api(`/api/mensajes/${state.selectedMessageId}/respuesta`, {
        method: "POST",
        body: "{}",
      });
      await load();
      state.notice = "";
      render();
      fillAccountSelect();
      const revision = document.querySelector('[data-testid="revision"]');
      if (revision) {
        revision.dataset.ok = result.revision.ok ? "true" : "false";
        revision.textContent = result.revision.ok
          ? "La respuesta cumple las reglas de este canal."
          : `Revisión: ${result.revision.issues.join(", ")}`;
      }
    } else if (action === "copy-reply") {
      const node = document.querySelector('[data-testid="reply-text"]');
      const text = node?.textContent || "";
      if (!text.trim()) throw new Error("Genera la respuesta antes de copiarla.");
      let copied = false;
      window.__copyError = "";
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch (error) {
        window.__copyError = String(error);
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
        try {
          copied = document.execCommand("copy");
        } catch (commandError) {
          window.__copyError = `${window.__copyError} | ${commandError}`;
        }
      }
      const note = document.querySelector('[data-testid="revision"]');
      if (note) {
        note.dataset.copied = copied ? "true" : "false";
        note.textContent = copied
          ? "Respuesta copiada."
          : "Respuesta seleccionada. Cópiala con el atajo del sistema.";
      }
    } else if (action === "delete-message") {
      await api(`/api/mensajes/${state.selectedMessageId}`, { method: "DELETE" });
      state.selectedMessageId = null;
      await load();
      render();
      fillAccountSelect();
    }
  } catch (error) {
    if (error.status === 401) {
      state.companies = [];
      state.accounts = [];
      state.messages = [];
      state.selectedCompanyId = null;
      state.selectedMessageId = null;
      state.error = "";
      renderLogin();
      return;
    }
    state.error = error.message;
    render();
    fillAccountSelect();
  }
});

async function saveCompany() {
  const payload = {};
  for (const [field] of FICHA_FIELDS) {
    const input = document.querySelector(`[data-testid="ficha-${field}"]`);
    payload[field] = input ? input.value : state.draft?.[field] || "";
  }
  state.draft = payload;
  const updated = await api(`/api/empresas/${state.selectedCompanyId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  await load();
  setDraftFromCompany(updated);
  state.notice = "Ficha guardada en los agentes de esta empresa.";
  render();
}

async function createAccount() {
  await api(`/api/empresas/${state.selectedCompanyId}/cuentas`, {
    method: "POST",
    body: JSON.stringify({
      canal: document.querySelector("#account-canal").value,
      cuenta: document.querySelector("#account-handle").value,
      agenteNombre: document.querySelector("#account-agent-name").value,
    }),
  });
  state.notice = "Agente creado.";
  await load();
  setDraftFromCompany(companyById(state.selectedCompanyId));
  render();
}

async function createMessage() {
  const cuentaId = document.querySelector("#message-account").value;
  const account = accountById(cuentaId);
  const created = await api("/api/mensajes", {
    method: "POST",
    body: JSON.stringify({
      cuentaId,
      nombreCliente: document.querySelector("#message-name").value,
      texto: document.querySelector("#message-text").value,
      calificacion:
        account?.canal === "google_reviews"
          ? Number(document.querySelector("#message-rating").value)
          : null,
    }),
  });
  await load();
  state.selectedMessageId = created.id;
  state.view = "bandeja";
  render();
  fillAccountSelect();
}

function renderInboxSkeleton() {
  app.dataset.ready = "true";
  app.dataset.testid = "app-ready";
  app.innerHTML = `<div class="shell" data-testid="inbox-skeleton" aria-busy="true">
    <aside class="sidebar">
      <div class="brand"><div class="mark" aria-hidden="true">P</div><div><h1>Jokma Pulse</h1><p>Por cuenta y canal</p></div></div>
    </aside>
    <main class="main" id="contenido">
      <p class="sr-only">Cargando la bandeja.</p>
      <div class="skeleton-stack" aria-hidden="true"><span class="skeleton short"></span><span class="skeleton title"></span></div>
      <div class="inbox">
        <div class="skeleton-card">${skeletonLines(4)}</div>
        <div class="skeleton-card"><span class="skeleton title"></span>${skeletonLines(2)}<span class="skeleton tall"></span></div>
      </div>
    </main>
  </div>`;
}

function renderFailure(message) {
  app.dataset.ready = "true";
  app.dataset.testid = "app-ready";
  app.innerHTML = `<main class="state-screen" id="contenido">
    <section class="state-card" role="alert" data-testid="boot-error">
      <p class="eyebrow">Bandeja</p>
      <h1>No se pudo abrir Jokma Pulse</h1>
      <p>${escapeHtml(message)}</p>
      <button type="button" class="primary" data-action="retry-boot" data-testid="retry-boot">Reintentar</button>
    </section>
  </main>`;
}

function renderLogin(message = "") {
  app.dataset.ready = "true";
  app.dataset.testid = "app-ready";
  const invalid = message ? ` aria-invalid="true"` : "";
  app.innerHTML = `<main class="gate" id="contenido">
    <a class="skip" href="#login-user">Saltar al acceso</a>
    <section class="gate-story">
      <p class="kicker">Atención por canal</p>
      <h1>Jokma<br>Pulse</h1>
      <p class="lede">Cada empresa entra a su ficha, sus agentes y su bandeja. La respuesta de cada cuenta usa solo esa ficha.</p>
      ${themeButton()}
    </section>
    <section class="gate-panel">
        <form class="login-card" data-action="login" data-testid="login-form" aria-describedby="login-error">
          <h2 id="login-title">Entra con tu empresa</h2>
          <label for="login-user">Usuario<input id="login-user" data-testid="login-user" autocomplete="username" aria-describedby="login-error"${invalid} /></label>
          <label for="login-password">Clave<input id="login-password" data-testid="login-password" type="password" autocomplete="current-password" aria-describedby="login-error"${invalid} /></label>
          <button class="primary" type="submit" data-testid="login-submit">Entrar</button>
          <p class="error" id="login-error" data-testid="login-error" role="alert">${escapeHtml(message)}</p>
        </form>
        <aside class="demo-logins" data-testid="demo-logins">
          <h2>Accesos de demostración</h2>
          <div class="demo-row">
            <strong>Cafetería Lumen</strong>
            <p>usuario <code>lumen</code> · clave <code>lumen123</code></p>
          </div>
          <div class="demo-row">
            <strong>Clínica Dental Arce</strong>
            <p>usuario <code>arce</code> · clave <code>arce123</code></p>
          </div>
        </aside>
    </section>
  </main>`;
}

async function submitLogin() {
  await api("/api/sesion", {
    method: "POST",
    body: JSON.stringify({
      usuario: document.querySelector("#login-user").value,
      clave: document.querySelector("#login-password").value,
    }),
  });
  state.error = "";
  state.view = "bandeja";
  renderInboxSkeleton();
  await load();
  state.selectedCompanyId = state.companies[0]?.id || null;
  render();
  fillAccountSelect();
}

async function boot() {
  const slow = setTimeout(() => renderInboxSkeleton(), 180);
  try {
    await load();
    clearTimeout(slow);
    state.selectedCompanyId = state.companies[0]?.id || null;
    state.view = "bandeja";
    render();
    fillAccountSelect();
  } catch (error) {
    clearTimeout(slow);
    if (error.status === 401) {
      renderLogin();
      return;
    }
    renderFailure(error.message);
  }
}

boot();
