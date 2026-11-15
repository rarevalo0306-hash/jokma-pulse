const app = document.querySelector("#app");

const state = {
  view: "bandeja",
  user: null,
  organizations: [],
  companies: [],
  accounts: [],
  messages: [],
  canales: [],
  selectedCompanyId: null,
  selectedOrganizationId: null,
  selectedPerson: null,
  selectedMessageId: null,
  draft: null,
  filterCompany: "",
  filterChannel: "",
  searchQuery: "",
  mobilePane: "list",
  settingsDraft: null,
  error: "",
  notice: "",
  authMode: "login",
  registrationEnabled: false,
  inviteRequired: false,
  recoveryEmailEnabled: false,
  loginNotice: "",
};

let knownMessageIds = null;
let pollTimer = null;
let refreshing = false;
let audioCtx = null;
let arrivalNote = "";

const NETWORKS = [
  { id: "google", label: "Google", channels: ["google_reviews"] },
  { id: "instagram", label: "Instagram", channels: ["instagram_dm", "instagram_comment"] },
  { id: "facebook", label: "Facebook", channels: ["facebook_messenger", "facebook_comment"] },
  { id: "x", label: "X", channels: ["x_post", "x_dm"] },
  { id: "email", label: "Correo", channels: ["email"] },
];

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

function networkById(id) {
  return NETWORKS.find((item) => item.id === id) || NETWORKS[0];
}

function networkForChannel(canal) {
  return NETWORKS.find((item) => item.channels.includes(canal)) || NETWORKS[0];
}

function personKey(name) {
  return String(name || "").trim().toLocaleLowerCase("es");
}

function companyMessages() {
  const empresaId = state.selectedCompanyId;
  return state.messages.filter((message) => !empresaId || message.empresaId === empresaId);
}

function matchesFilter(message) {
  if (!state.filterChannel) return true;
  return networkForChannel(message.canal).id === state.filterChannel;
}

function messagesForPerson(key) {
  return companyMessages()
    .filter((message) => personKey(message.nombreCliente) === key && matchesFilter(message))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

function people() {
  const map = new Map();
  for (const message of companyMessages()) {
    const key = personKey(message.nombreCliente);
    const entry = map.get(key) || { key, name: message.nombreCliente, last: null, lastAny: message };
    if (String(message.createdAt) >= String(entry.lastAny.createdAt)) {
      entry.lastAny = message;
      entry.name = message.nombreCliente;
    }
    if (matchesFilter(message) && (!entry.last || String(message.createdAt) >= String(entry.last.createdAt))) {
      entry.last = message;
    }
    map.set(key, entry);
  }
  let list = [...map.values()];
  if (state.filterChannel) list = list.filter((person) => person.last || person.key === state.selectedPerson);
  if (state.searchQuery) {
    const query = personKey(state.searchQuery);
    list = list.filter((person) => personKey(person.name).includes(query) || personKey(person.last?.texto || person.lastAny?.texto).includes(query));
  }
  return list.sort((a, b) =>
    String((b.last || b.lastAny).createdAt).localeCompare(String((a.last || a.lastAny).createdAt)),
  );
}

function ensureSelection() {
  const known = companyMessages().some((message) => personKey(message.nombreCliente) === state.selectedPerson);
  if (!known) state.selectedPerson = people()[0]?.key || null;
  const visible = state.selectedPerson ? messagesForPerson(state.selectedPerson) : [];
  if (!visible.some((message) => message.id === state.selectedMessageId)) {
    state.selectedMessageId = visible.at(-1)?.id || null;
  }
}

function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function unlockAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playDoublePing() {
  try {
    const ctx = unlockAudio();
    if (!ctx) return;
    const start = ctx.currentTime + 0.02;
    for (const offset of [0, 0.17]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, start + offset);
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.06, start + offset + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.09);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start + offset);
      osc.stop(start + offset + 0.1);
    }
  } catch {
    /* El navegador puede bloquear el audio hasta el siguiente gesto. */
  }
}

function noteArrivals(messages) {
  const ids = new Set(messages.map((message) => message.id));
  let arrived = false;
  if (knownMessageIds) {
    for (const id of ids) {
      if (!knownMessageIds.has(id)) {
        arrived = true;
        break;
      }
    }
  }
  knownMessageIds = ids;
  return arrived;
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    refreshMessages().catch(() => {});
  }, 4000);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

async function refreshMessages() {
  if (refreshing || !document.querySelector("[data-testid='logout']")) return;
  refreshing = true;
  try {
    const arrived = await load();
    if (!arrived) return;
    arrivalNote = "Nuevo mensaje.";
    playDoublePing();
    const active = document.activeElement;
    const typing = active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
    if (!typing && state.view !== "login") {
      ensureSelection();
      render();
      fillAccountSelect();
    }
  } catch (error) {
    if (error.status === 401) {
      stopPolling();
      knownMessageIds = null;
      renderLogin();
    }
  } finally {
    refreshing = false;
  }
}

function companyById(id) {
  return state.companies.find((item) => item.id === id);
}

function organizationById(id) {
  return state.organizations.find((item) => item.id === id);
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
  state.user = payload.user || null;
  state.organizations = payload.organizations || [];
  state.companies = payload.companies;
  state.accounts = payload.accounts;
  state.messages = payload.messages;
  state.canales = payload.canales;
  state.modelos = payload.modelos || [];
  state.parametros = payload.parametros || [];
  state.conexiones = payload.conexiones || [];
  state.selectedCompanyId = payload.activeCompanyId || state.companies[0]?.id || null;
  state.selectedOrganizationId = payload.activeOrganizationId || companyById(state.selectedCompanyId)?.organizacionId || state.organizations[0]?.id || null;
  if (state.selectedCompanyId && !companyById(state.selectedCompanyId)) {
    state.selectedCompanyId = null;
    state.view = "bandeja";
  }
  if (state.selectedMessageId && !state.messages.some((item) => item.id === state.selectedMessageId)) {
    state.selectedMessageId = null;
  }
  return noteArrivals(state.messages);
}

async function loadPublicConfig() {
  try {
    const payload = await api("/api/configuracion-publica");
    state.registrationEnabled = payload.registroHabilitado === true;
    state.inviteRequired = payload.codigoInvitacionRequerido === true;
    state.recoveryEmailEnabled = payload.recuperacionCorreoHabilitada === true;
  } catch {
    state.registrationEnabled = false;
    state.inviteRequired = false;
    state.recoveryEmailEnabled = false;
  }
}

function setDraftFromCompany(company) {
  state.draft = {};
  for (const [field] of FICHA_FIELDS) state.draft[field] = company?.[field] || "";
}

function isDarkTheme() {
  return document.documentElement.dataset.theme === "dark";
}

function pulseMark() {
  const pen = `fill="none" stroke="#23D8BD" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" pathLength="1"`;
  return `<svg class="pulse-mark" viewBox="0 0 120 36" aria-hidden="true" focusable="false"><path class="beat beat-lub" ${pen} d="M2 20 H24 L30 24 L38 6 L46 30 L52 20"/><path class="beat beat-dub" ${pen} d="M52 20 H60 C68 20 72 13 80 13 C88 13 92 20 98 20"/><path class="beat beat-rest" ${pen} d="M98 20 H118"/></svg>`;
}

function brandLockup() {
  return `<span class="logo-lockup"><img class="logo logo-on-light" src="/jokma-logo.svg?v=20261101-gap" alt="" /><img class="logo logo-on-dark" src="/jokma-logo-on-dark.svg?v=20261101-gap" alt="" /></span><span class="pulse-name"><span class="sr-only">Jokma </span><span class="pulse-word">Pulse</span>${pulseMark()}</span>`;
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
  const body =
    state.view === "empresa" || state.view === "nueva"
      ? companyView()
      : state.view === "ajustes"
        ? settingsView()
        : state.view === "espacios"
          ? spacesView()
        : inboxView();
  app.innerHTML = `<div class="shell"><a class="skip" href="#contenido">Saltar al contenido</a><p class="sr-only" aria-live="polite" data-testid="arrival-note">${escapeHtml(arrivalNote)}</p>${appBar()}<main class="main" id="contenido" tabindex="-1">${workspaceBar()}${body}</main></div>`;
}

function appBar() {
  return `<aside class="app-bar" aria-label="Navegación principal">
    <div class="brand"><img class="brand-symbol" src="/jokma-pulse-icon.svg" alt="Jokma Pulse" /></div>
    <nav class="nav-stack">
      <button type="button" class="nav-button" data-action="nav-inbox" data-testid="nav-inbox" ${state.view === "bandeja" ? 'aria-current="page"' : ""}>Mensajes</button>
      <button type="button" class="nav-button" data-action="open-company" data-id="${escapeHtml(state.selectedCompanyId || "")}" data-testid="nav-company" ${state.view === "empresa" ? 'aria-current="page"' : ""}>Empresa</button>
      <button type="button" class="nav-button" data-action="open-spaces" data-testid="nav-spaces" ${state.view === "espacios" ? 'aria-current="page"' : ""}>Espacios</button>
      <button type="button" class="nav-button" data-action="open-settings" data-testid="nav-settings" ${state.view === "ajustes" ? 'aria-current="page"' : ""}>Ajustes</button>
    </nav>
    <div class="nav-footer">${themeButton()}<button type="button" class="nav-button" data-action="logout" data-testid="logout">Salir</button></div>
  </aside>`;
}

function workspaceBar() {
  const organizationOptions = state.organizations
    .map((organization) => `<option value="${escapeHtml(organization.id)}"${organization.id === state.selectedOrganizationId ? " selected" : ""}>${escapeHtml(organization.nombre)}</option>`)
    .join("");
  const options = state.companies
    .filter((company) => !state.selectedOrganizationId || company.organizacionId === state.selectedOrganizationId)
    .map((company) => `<option value="${escapeHtml(company.id)}"${company.id === state.selectedCompanyId ? " selected" : ""}>${escapeHtml(company.nombre)}</option>`)
    .join("");
  return `<header class="workspace-bar">
    <div class="workspace-brand"><span class="pulse-dot" aria-hidden="true"></span><strong>Pulse</strong></div>
    <div class="workspace-switchers">
      <label class="company-switcher" for="organization-switcher"><span>Organización</span><select id="organization-switcher" data-testid="organization-switcher">${organizationOptions}</select></label>
      <label class="company-switcher" for="company-switcher"><span>Empresa</span><select id="company-switcher" data-testid="company-switcher">${options}</select></label>
    </div>
    <div class="workspace-user"><span>${escapeHtml(state.user?.nombre || "Usuario")}</span><span class="user-avatar" aria-hidden="true">${escapeHtml((state.user?.nombre || "U").slice(0, 1))}</span></div>
  </header>`;
}

function spacesView() {
  const organization = organizationById(state.selectedOrganizationId);
  const organizationRole = state.user?.rolesOrganizacion?.[organization?.id] || "agent";
  const canManage = ["owner", "admin"].includes(organizationRole);
  const companyItems = state.companies
    .filter((company) => company.organizacionId === organization?.id)
    .map((company) => `<li><div><strong>${escapeHtml(company.nombre)}</strong><span>${escapeHtml(company.industria || "Sin industria")}</span></div>${company.id === state.selectedCompanyId ? '<span class="pill">Activa</span>' : `<button type="button" class="tiny" data-action="switch-company" data-id="${escapeHtml(company.id)}">Abrir</button>`}</li>`)
    .join("");
  return `<header class="topbar">
      <div><h2>Organizaciones y empresas</h2><p class="lede">Tu usuario puede pertenecer a varios espacios. La organización agrupa empresas; la bandeja siempre trabaja con una empresa activa.</p></div>
      <button type="button" class="ghost" data-action="nav-inbox">Volver a los mensajes</button>
    </header>
    ${banner()}
    <div class="spaces-layout">
      <section class="panel space-summary">
        <div class="space-heading"><div><h3>${escapeHtml(organization?.nombre || "Organización")}</h3><p>${escapeHtml(organizationRole === "owner" ? "Propietario" : organizationRole === "admin" ? "Administrador" : "Miembro")}</p></div><span class="pill">${state.organizations.length} ${state.organizations.length === 1 ? "organización" : "organizaciones"}</span></div>
        <ul class="space-company-list">${companyItems || "<li>No hay empresas disponibles.</li>"}</ul>
      </section>
      <section class="panel">
        <h3>Agregar empresa</h3>
        <p class="hint">La empresa nueva queda dentro de <strong>${escapeHtml(organization?.nombre || "la organización activa")}</strong> y mantiene sus propios canales, ficha y conversaciones.</p>
        ${canManage ? `<form class="grid" data-action="create-company" data-testid="create-company-form">
          <label>Nombre de la empresa<input id="space-company-name" maxlength="160" required /></label>
          <label>Industria o actividad<input id="space-company-industry" maxlength="240" required /></label>
          <button class="primary span-2" type="submit" data-testid="create-company-submit">Agregar y abrir empresa</button>
        </form>` : '<p class="hint">Pide a un propietario o administrador que agregue otra empresa.</p>'}
      </section>
      <section class="panel">
        <h3>Nueva organización</h3>
        <p class="hint">Crea otro espacio independiente con su primera empresa. Serás propietario de ambos.</p>
        <form class="grid" data-action="create-organization" data-testid="create-organization-form">
          <label class="span-2">Nombre de la organización<input id="new-organization-name" maxlength="160" required /></label>
          <label>Primera empresa<input id="new-organization-company" maxlength="160" required /></label>
          <label>Industria o actividad<input id="new-organization-industry" maxlength="240" required /></label>
          <button class="primary span-2" type="submit" data-testid="create-organization-submit">Crear organización</button>
        </form>
      </section>
      <section class="panel security-panel">
        <h3>Seguridad de la cuenta</h3>
        <p class="hint">Cambia la clave de tu usuario. Al terminar tendrás que entrar nuevamente en todos tus dispositivos.</p>
        <form class="grid" data-action="change-password" data-testid="change-password-form">
          <label class="span-2">Clave actual<input id="current-password" type="password" autocomplete="current-password" required /></label>
          <label>Clave nueva<input id="new-password" type="password" autocomplete="new-password" minlength="6" maxlength="128" pattern="(?=.*[A-Za-z])(?=.*[0-9]).{6,128}" required /></label>
          <label>Confirmar clave<input id="confirm-new-password" type="password" autocomplete="new-password" minlength="6" maxlength="128" required /></label>
          <button class="primary span-2" type="submit" data-testid="change-password-submit">Cambiar clave</button>
        </form>
        <p class="recovery-status">Recuperación por correo: <strong>pendiente de configurar SMTP</strong>. Hasta entonces, un administrador local puede restablecer el acceso sin ver tu clave anterior.</p>
      </section>
    </div>`;
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
      <button type="button" class="ghost" data-action="nav-inbox" data-testid="nav-inbox">Volver a los mensajes</button>
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
  ensureSelection();
  const company = companyById(state.selectedCompanyId);
  const list = people();
  const person = list.find((item) => item.key === state.selectedPerson) || null;
  const thread = person ? messagesForPerson(person.key) : [];
  const filterLabel = state.filterChannel ? networkById(state.filterChannel).label : "";
  const rows = list.map((item) => {
    const last = item.last || item.lastAny;
    const network = last ? networkForChannel(last.canal) : null;
    const slug = item.key.replace(/\s+/g, "-");
    return `<li><button type="button" class="message-button" data-action="open-person" data-person="${escapeHtml(item.key)}" data-testid="person-${escapeHtml(slug)}" aria-current="${state.selectedPerson === item.key ? "true" : "false"}">
      <span class="person-avatar" aria-hidden="true">${escapeHtml(item.name.slice(0, 1))}</span>
      <span class="message-copy"><span class="message-top"><strong>${escapeHtml(item.name)}</strong>${network ? `<span class="pill">${escapeHtml(network.label)}</span>` : ""}</span><span class="message-preview">${escapeHtml(last?.texto || "Sin mensajes")}</span><span class="queue-status" data-state="${escapeHtml(last?.estadoRespuesta || "sin_borrador")}">${escapeHtml(responseStatus(last))}</span></span>
    </button></li>`;
  }).join("");
  const chips = NETWORKS.map((item) => {
    const count = companyMessages().filter((message) => item.channels.includes(message.canal)).length;
    const pressed = state.filterChannel === item.id;
    return `<button type="button" class="channel-chip" data-action="select-network" data-network="${item.id}" aria-pressed="${pressed ? "true" : "false"}"><span>${item.label}</span><span class="channel-count">${count}</span></button>`;
  }).join("");
  const threadItems = thread.map((message) => {
    const network = networkForChannel(message.canal);
    const selected = message.id === state.selectedMessageId;
    return `<li class="thread-item" data-testid="message-${escapeHtml(message.id)}" aria-current="${selected ? "true" : "false"}"><button type="button" class="thread-select" data-action="open-message" data-id="${escapeHtml(message.id)}"><span class="thread-meta"><span class="pill">${escapeHtml(network.label)}</span><span>${escapeHtml(channelLabel(message.canal))}</span><time datetime="${escapeHtml(message.createdAt)}">${escapeHtml(formatWhen(message.createdAt))}</time></span>${message.calificacion ? `<span class="stars" aria-label="${message.calificacion} de 5 estrellas">${stars(message.calificacion)}</span>` : ""}<span class="original"${selected ? ` data-testid="message-text-view"` : ""}>${escapeHtml(message.texto)}</span></button></li>`;
  }).join("");
  const conversation = person
    ? `<header class="conversation-head"><button type="button" class="mobile-back" data-action="back-to-list">Volver</button><div><h2>${escapeHtml(person.name)}</h2><p>${filterLabel ? `Mostrando ${escapeHtml(filterLabel)}` : "Conversación omnicanal"}</p></div></header><ol class="thread" data-testid="conversation">${threadItems || `<li class="empty-state" data-testid="empty-detail"><h3>Sin mensajes en esta red</h3><p>Cambia el filtro para continuar.</p></li>`}</ol>${messageDetail()}`
    : `<section class="empty-state" data-testid="empty-detail"><h3>Elige una persona</h3><p>Su conversación reúne todos los canales.</p></section>`;

  return `<section class="inbox-titlebar"><div><h2 data-testid="session-company">Bandeja</h2><p>${escapeHtml(company?.nombre || "Empresa")} · ${list.length} conversaciones</p></div><button type="button" class="ghost test-message-button" data-action="toggle-test-message">Simular entrada</button></section>${banner()}<div class="inbox" data-mobile-pane="${escapeHtml(state.mobilePane)}"><section class="inbox-column" aria-label="Cola de conversaciones"><div class="queue-tools"><label class="search-field" for="conversation-search"><span class="sr-only">Buscar conversaciones</span><input id="conversation-search" type="search" data-search="conversation" value="${escapeHtml(state.searchQuery)}" placeholder="Buscar persona o mensaje" /></label><span class="queue-count">${list.length}</span></div><nav class="channel-row" aria-label="Filtrar por red" data-testid="filter-channel"><button type="button" class="channel-chip" data-action="select-network" data-network="" aria-pressed="${state.filterChannel ? "false" : "true"}"><span>Todos</span><span class="channel-count">${companyMessages().length}</span></button>${chips}</nav><div class="test-message-drawer" ${state.showTestMessage ? "" : "hidden"}>${composer()}</div><ul class="message-list">${rows || `<li class="empty-state" data-testid="empty-inbox"><h3>Sin conversaciones</h3><p>Cambia el filtro o la búsqueda.</p></li>`}</ul></section><section class="inbox-detail" aria-label="Conversación de la persona">${conversation}</section><aside class="context-panel" aria-label="Contexto de la conversación">${contextPanel()}</aside></div>`;
}

function responseStatus(message) {
  return ({ sin_borrador: "Pendiente", borrador: "Borrador", aprobado: "Aprobado", enviando: "Enviando", enviado: "Enviado", entregado: "Entregado", error: "Error de envío" })[message?.estadoRespuesta] || "Pendiente";
}

function contextPanel() {
  const message = state.messages.find((item) => item.id === state.selectedMessageId);
  if (!message) return `<div class="empty-state"><h3>Contexto</h3><p>Selecciona un mensaje para ver el perfil utilizado.</p></div>`;
  const account = accountById(message.cuentaId);
  const ficha = account?.agente?.ficha || {};
  const statuses = [["open", "Abierta"], ["pending", "En espera"], ["closed", "Cerrada"]]
    .map(([value, label]) => `<option value="${value}"${(message.estadoConversacion || "open") === value ? " selected" : ""}>${label}</option>`)
    .join("");
  const notes = (message.notas || []).map((note) => `<li><strong>${escapeHtml(note.autor || "Equipo")}</strong><p>${escapeHtml(note.texto)}</p><time datetime="${escapeHtml(note.createdAt || "")}">${escapeHtml(formatWhen(note.createdAt))}</time></li>`).join("");
  return `<div class="context-head"><h3>Contexto</h3><button type="button" class="tiny" data-action="delete-message" data-testid="delete-message">Eliminar</button></div><dl class="context-list" data-testid="agent-ficha"><dt>Agente</dt><dd data-testid="agent-name">${escapeHtml(account?.agente?.nombre || "")}</dd><dt>Canal</dt><dd data-testid="agent-account">${escapeHtml(channelLabel(account?.canal || ""))} · ${escapeHtml(account?.cuenta || "")}</dd><dt>Industria</dt><dd data-testid="agent-industry">${escapeHtml(account?.agente?.industria || "")}</dd><dt>Servicios</dt><dd>${escapeHtml(ficha.servicios || "Sin datos")}</dd><dt>Horario</dt><dd>${escapeHtml(ficha.horarios || "Sin datos")}</dd><dt>Soporte</dt><dd>${escapeHtml(ficha.soporte || "Sin datos")}</dd></dl><p class="tone" data-testid="agent-tone">${escapeHtml(account?.agente?.tono || "")}</p><section class="conversation-ops" aria-label="Operación de la conversación"><h4>Seguimiento</h4><label>Estado<select data-testid="conversation-status">${statuses}</select></label><label class="check-row"><input type="checkbox" data-testid="assign-to-me" ${message.asignadoA === state.user?.id ? "checked" : ""} /> Asignarme esta conversación</label><button type="button" class="ghost" data-action="save-conversation" data-testid="save-conversation">Guardar seguimiento</button><h4>Notas internas</h4><ul class="notes-list">${notes || "<li>Sin notas internas.</li>"}</ul><label>Nueva nota<textarea data-testid="conversation-note" rows="3" maxlength="2000"></textarea></label><button type="button" class="ghost" data-action="add-note" data-testid="add-note">Agregar nota</button></section><span class="sr-only" data-testid="agent-type">Tipo: atención</span>`;
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
    return `<section class="reply-composer empty-state" data-testid="empty-detail"><h3>Selecciona un mensaje</h3><p>El borrador aparecerá aquí.</p></section>`;
  }
  const draft = message.borrador || message.respuesta || "";
  const approved = message.estadoRespuesta === "aprobado";
  const locked = ["aprobado", "enviando", "enviado", "entregado"].includes(message.estadoRespuesta);
  const account = state.accounts.find((item) => item.id === message.cuentaId);
  const directChannels = new Set(["email", "google_reviews", "x", "facebook_messenger", "instagram_dm"]);
  const canSend = directChannels.has(account?.canal) && ["aprobado", "error"].includes(message.estadoRespuesta);
  const sendLabel = account?.canal === "google_reviews"
    ? "Publicar respuesta"
    : account?.canal === "x"
      ? "Enviar en X"
      : account?.canal === "facebook_messenger"
        ? "Enviar en Messenger"
        : account?.canal === "instagram_dm"
          ? "Enviar en Instagram"
          : "Enviar correo";
  const deliveryNote = message.estadoRespuesta === "enviado" || message.estadoRespuesta === "entregado"
    ? "Respuesta enviada directamente por correo."
    : message.estadoRespuesta === "error"
      ? "El envío falló. Revisa la conexión y vuelve a intentarlo."
      : approved
        ? directChannels.has(account?.canal) ? "Borrador aprobado. Ya puedes enviarlo directamente." : "Borrador aprobado. Este canal aún requiere copiar la respuesta."
        : draft ? "Borrador guardado. Revisa y aprueba antes de usarlo." : "Genera un borrador para comenzar.";
  return `<article class="reply-composer" data-testid="message-detail"><div class="composer-head"><div><h3>Borrador de respuesta</h3><p>Edita el texto antes de aprobarlo.</p></div><span class="reply-state" data-state="${escapeHtml(message.estadoRespuesta || "sin_borrador")}">${escapeHtml(responseStatus(message))}</span></div><label for="reply-draft" class="sr-only">Borrador de respuesta</label><textarea id="reply-draft" class="reply" data-testid="reply-text" data-reply-at="${escapeHtml(message.respondidoEn || "")}" ${locked ? "readonly" : ""}>${escapeHtml(draft)}</textarea><div class="composer-actions"><button type="button" class="ghost" data-action="generate-reply" data-testid="generate-reply" ${locked ? "disabled" : ""}>${draft ? "Regenerar" : "Generar borrador"}</button><button type="button" class="ghost" data-action="save-draft" data-testid="save-draft" ${locked ? "disabled" : ""}>Guardar borrador</button><button type="button" class="primary" data-action="approve-draft" data-testid="approve-draft" ${draft && !locked ? "" : "disabled"}>${approved ? "Aprobado" : "Aprobar"}</button>${directChannels.has(account?.canal) ? `<button type="button" class="primary" data-action="send-message" data-testid="send-message" ${canSend ? "" : "disabled"}>${message.estadoRespuesta === "error" ? "Reintentar envío" : escapeHtml(sendLabel)}</button>` : ""}<button type="button" class="ghost" data-action="copy-reply" data-testid="copy-reply" ${draft ? "" : "disabled"}>Copiar</button></div><p class="revision" data-testid="revision" data-ok="${draft ? "pending" : "false"}" aria-live="polite">${escapeHtml(deliveryNote)}</p></article>`;
}

function settingValue(draft, key) {
  return draft?.[key] ?? "";
}

function settingControl(row, draft, company) {
  const value = settingValue(draft, row.api);
  const id = `setting-${String(row.api).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const stored = row.secreto && company?.credenciales?.[row.api];
  const secret = row.secreto ? ` type="password" autocomplete="new-password" spellcheck="false" placeholder="${stored ? "Guardado; escribe solo para reemplazar" : ""}"` : ` type="text" autocomplete="off"`;
  if (row.largo) {
    return `<textarea id="${escapeHtml(id)}" aria-label="${escapeHtml(row.nombre)}" data-setting="${escapeHtml(row.api)}" data-testid="setting-${escapeHtml(row.api)}" rows="3">${escapeHtml(value)}</textarea>`;
  }
  return `<input id="${escapeHtml(id)}" aria-label="${escapeHtml(row.nombre)}" data-setting="${escapeHtml(row.api)}" data-testid="setting-${escapeHtml(row.api)}" value="${escapeHtml(value)}"${secret} />`;
}

function settingRows(rows, draft, company) {
  return rows
    .map(
      (row) => `<tr>
        <th scope="row">${escapeHtml(row.nombre)}</th>
        <td><code>${escapeHtml(row.api)}</code></td>
        <td>${settingControl(row, draft, company)}</td>
      </tr>`,
    )
    .join("");
}

function settingsTable(rows, draft, company) {
  return `<div class="settings-scroll">
    <table class="settings-table">
      <thead><tr><th>Nombre</th><th>Nombre en la API</th><th>Valor</th></tr></thead>
      <tbody>${settingRows(rows, draft, company)}</tbody>
    </table>
  </div>`;
}

function settingsView() {
  const company = companyById(state.selectedCompanyId);
  const draft = state.settingsDraft || company?.ajustes || {};
  const currentModel = settingValue(draft, "model") || "jokma-ficha";
  const models = state.modelos?.length ? [...state.modelos] : [{ id: "jokma-ficha", etiqueta: "Jokma Ficha" }];
  if (!models.some((item) => item.id === currentModel)) {
    models.unshift({ id: currentModel, etiqueta: currentModel });
  }
  const options = models
    .map(
      (item) =>
        `<option value="${escapeHtml(item.id)}"${item.id === currentModel ? " selected" : ""}>${escapeHtml(item.etiqueta)}</option>`,
    )
    .join("");
  const connections = (state.conexiones || [])
    .filter((group) => !group.oculto)
    .map((group) => {
      const facebook =
        group.red === "Facebook"
          ? `<div class="settings-connect">
              <p class="hint">Crea una app de Meta solo para Pulse. Pega aquí su identificador y su secreto, guarda, y pulsa Conectar Facebook. El botón abre el inicio de sesión y guarda la página de esta empresa. En la app, las URI de redirección válidas son <code data-testid="facebook-redirect">https://jokma-pulse.vercel.app/api/facebook/callback</code> y <code data-testid="facebook-redirect-pulse">https://pulse.jokma.app/api/facebook/callback</code>.</p>
              <p class="hint">Webhook de Messenger: <code>https://pulse.jokma.app/api/facebook/webhook</code>. Token de verificación: <code>jokma-pulse-facebook</code>.</p>
              <button type="button" class="primary" data-action="facebook-login" data-testid="facebook-login">Conectar Facebook</button>
            </div>`
          : "";
      const instagram =
        group.red === "Instagram"
          ? `<div class="settings-connect">
              <p class="hint">Usa la misma app de Meta que Facebook, identificador <code data-testid="instagram-app">1036513856135777</code>. El botón guarda la cuenta de Instagram de esta empresa. En la app, las URI de redirección válidas son <code data-testid="instagram-redirect">https://jokma-pulse.vercel.app/api/instagram/callback</code> y <code data-testid="instagram-redirect-pulse">https://pulse.jokma.app/api/instagram/callback</code>. En Instagram, Webhooks, la URL de devolución es <code data-testid="instagram-webhook">https://pulse.jokma.app/api/instagram/webhook</code> y el token de verificación es <code data-testid="instagram-verify">jokma-pulse-instagram</code>.</p>
              <button type="button" class="primary" data-action="instagram-login" data-testid="instagram-login">Conectar Instagram</button>
            </div>`
          : "";
      const email =
        group.red === "Correo"
          ? `<div class="settings-connect">
              <p class="hint">La recepción usa IMAP y el envío usa SMTP directamente. Guarda la configuración antes de sincronizar.</p>
              <button type="button" class="primary" data-action="sync-email" data-testid="sync-email">Sincronizar correo</button>
            </div>`
          : "";
      const providerSync = group.red === "Google"
        ? `<div class="settings-connect"><p class="hint">La API oficial necesita acceso de Google Business Profile, cuenta y ubicación.</p><button type="button" class="primary" data-action="sync-google" data-testid="sync-google">Sincronizar reseñas</button></div>`
        : group.red === "X"
          ? `<div class="settings-connect"><p class="hint">Usa credenciales de usuario de la API de X para leer y responder mensajes directos.</p><button type="button" class="primary" data-action="sync-x" data-testid="sync-x">Sincronizar X</button></div>`
          : "";
      return `<section class="settings-network" data-network="${escapeHtml(group.red)}">
        <h3>${escapeHtml(group.red)}</h3>
        ${settingsTable(group.filas || [], draft, company)}
        ${facebook}
        ${instagram}
        ${email}
        ${providerSync}
      </section>`;
    })
    .join("");

  return `<header class="topbar">
      <div>
        <p class="eyebrow">Ajustes de la empresa</p>
        <h2 data-testid="settings-company">${escapeHtml(company?.nombre || "Empresa")}</h2>
        <p class="lede">Una sola pantalla para el modelo, los parámetros y las conexiones de esta empresa.</p>
      </div>
      <button type="button" class="ghost" data-action="nav-inbox" data-testid="nav-inbox">Volver a los mensajes</button>
    </header>
    ${banner()}
    <form class="settings-screen" data-action="save-settings" data-testid="settings-form">
      <section class="panel">
        <h3>Modelo</h3>
        <label for="model-select">Modelo de la respuesta automática
          <select id="model-select" data-testid="model-select">${options}</select>
        </label>
        <p class="hint">La respuesta sigue las reglas del canal y la ficha. El modelo elegido se guarda en esta empresa.</p>
      </section>
      <section class="panel" data-testid="settings-parameters">
        <h3>Parámetros</h3>
        <p class="hint">Nombre, nombre en la API y valor. Incluye el perfil, la organización, la descripción, los productos y la guía de la IA.</p>
        ${settingsTable(state.parametros || [], draft, company)}
      </section>
      <section class="panel" data-testid="settings-connections">
        <h3>Conexiones</h3>
        <p class="hint">Facebook e Instagram se conectan directamente con Meta. Correo usa IMAP y SMTP sin intermediarios. X y Google Reviews necesitan sus credenciales oficiales.</p>
        ${connections}
      </section>
      <div class="actions">
        <button class="primary" type="submit" data-testid="save-settings">Guardar ajustes</button>
        <span class="ok-note" data-testid="save-status">${escapeHtml(state.notice)}</span>
      </div>
    </form>`;
}

function banner() {
  if (state.error) return `<p class="error" data-testid="form-error" role="alert">${escapeHtml(state.error)}</p>`;
  if (state.notice) return `<p class="success" data-testid="form-notice" role="status">${escapeHtml(state.notice)}</p>`;
  return "";
}

function fillAccountSelect() {
  const accountSelect = document.querySelector("#message-account");
  const ratingWrap = document.querySelector("#rating-wrap");
  if (!accountSelect) return;
  const empresaId = state.selectedCompanyId;
  const channels = state.filterChannel ? new Set(networkById(state.filterChannel).channels) : null;
  const accounts = state.accounts.filter(
    (item) => item.empresaId === empresaId && (!channels || channels.has(item.canal)),
  );
  accountSelect.innerHTML = accounts
    .map(
      (account) =>
        `<option value="${escapeHtml(account.id)}">${escapeHtml(account.agente.nombre)} · ${escapeHtml(channelLabel(account.canal))}</option>`,
    )
    .join("");
  const selectedMessage = state.messages.find((item) => item.id === state.selectedMessageId);
  if (selectedMessage && accounts.some((item) => item.id === selectedMessage.cuentaId)) {
    accountSelect.value = selectedMessage.cuentaId;
  }
  const selected = accountById(accountSelect.value);
  if (ratingWrap) ratingWrap.hidden = selected?.canal !== "google_reviews";
  const nameInput = document.querySelector("#message-name");
  const person = people().find((item) => item.key === state.selectedPerson);
  if (nameInput && person && !nameInput.value) nameInput.value = person.name;
}

app.addEventListener("input", (event) => {
  if (event.target.matches("[data-search='conversation']")) {
    state.searchQuery = event.target.value;
    const caret = event.target.selectionStart;
    render();
    const search = document.querySelector("[data-search='conversation']");
    search?.focus();
    if (search && caret !== null) search.setSelectionRange(caret, caret);
    return;
  }
  const setting = event.target.dataset.setting;
  if (setting && state.settingsDraft) {
    state.settingsDraft[setting] = event.target.value;
    if (setting === "model") {
      const select = document.querySelector("#model-select");
      if (select && [...select.options].some((option) => option.value === event.target.value)) {
        select.value = event.target.value;
      }
    }
    return;
  }
  const field = event.target.dataset.field;
  if (!field || !state.draft) return;
  state.draft[field] = event.target.value;
});

app.addEventListener("change", async (event) => {
  if (event.target.id === "organization-switcher") {
    const company = state.companies.find((item) => item.organizacionId === event.target.value);
    if (!company) {
      state.error = "Esta organización todavía no tiene una empresa disponible.";
      render();
      return;
    }
    try {
      await switchCompany(company.id);
    } catch (error) {
      state.error = error.message;
      render();
    }
    return;
  }
  if (event.target.id === "company-switcher") {
    try {
      event.target.disabled = true;
      await switchCompany(event.target.value);
    } catch (error) {
      state.error = error.message;
      render();
    }
    return;
  }
  if (event.target.id === "model-select" && state.settingsDraft) {
    state.settingsDraft.model = event.target.value;
    const input = document.querySelector("[data-setting='model']");
    if (input) input.value = event.target.value;
    return;
  }
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
  unlockAudio();
  const form = event.target.closest("form");
  if (!form) return;
  event.preventDefault();
  const action = form.dataset.action;
  const busy = {
    login: ["[data-testid='login-submit']", "Entrando"],
    register: ["[data-testid='registration-submit']", "Creando cuenta"],
    "save-company": ["[data-testid='save-company']", "Guardando"],
    "save-account-new": ["[data-testid='save-account']", "Agregando"],
    "save-message": ["[data-testid='save-message']", "Agregando"],
    "save-settings": ["[data-testid='save-settings']", "Guardando"],
    "create-company": ["[data-testid='create-company-submit']", "Creando empresa"],
    "create-organization": ["[data-testid='create-organization-submit']", "Creando organización"],
    "change-password": ["[data-testid='change-password-submit']", "Cambiando clave"],
  }[action];
  if (busy) setControlBusy(busy[0], true, busy[1]);
  try {
    state.error = "";
    if (action === "login") await submitLogin();
    if (action === "registration-user") advanceRegistration();
    if (action === "register") await submitRegistration();
    if (action === "save-company") await saveCompany();
    if (action === "save-account-new") await createAccount();
    if (action === "save-message") await createMessage();
    if (action === "save-settings") await saveSettings();
    if (action === "create-company") await createSpaceCompany();
    if (action === "create-organization") await createOrganization();
    if (action === "change-password") await changePassword();
  } catch (error) {
    if (["login", "registration-user", "register"].includes(action)) {
      const registering = action !== "login";
      setControlBusy(registering ? "[data-testid='registration-submit']" : "[data-testid='login-submit']", false);
      const node = document.querySelector(registering ? '[data-testid="registration-error"]' : '[data-testid="login-error"]');
      if (node) node.textContent = error.message;
      const ids = registering
        ? ["registration-name", "registration-last-name", "registration-company", "registration-industry", "registration-user", "registration-email", "registration-password", "registration-confirm", "registration-invite"]
        : ["login-user", "login-password"];
      for (const id of ids) {
        document.getElementById(id)?.setAttribute("aria-invalid", "true");
      }
      return;
    }
    if (["create-company", "create-organization", "change-password"].includes(action)) {
      state.error = error.message;
      state.view = "espacios";
      render();
      return;
    }
    state.error = error.message;
    render();
    fillAccountSelect();
  }
});

app.addEventListener("click", async (event) => {
  unlockAudio();
  const button = event.target.closest("[data-action]");
  if (!button) return;
  if (button.dataset.action === "instagram-login") {
    event.preventDefault();
    try {
      state.error = "";
      setControlBusy("[data-testid='instagram-login']", true, "Abriendo Instagram");
      await saveSettings();
      window.location.assign("/api/instagram/iniciar");
    } catch (error) {
      state.error = error.message;
      state.view = "ajustes";
      render();
    }
    return;
  }
  if (button.dataset.action === "facebook-login") {
    event.preventDefault();
    try {
      state.error = "";
      setControlBusy("[data-testid='facebook-login']", true, "Abriendo Facebook");
      await saveSettings();
      window.location.assign("/api/facebook/iniciar");
    } catch (error) {
      state.error = error.message;
      state.view = "ajustes";
      render();
    }
    return;
  }
  if (button.dataset.action === "registration-back") {
    backToRegistrationUser();
    return;
  }
  if (button.closest("form")) return;
  try {
    state.error = "";
    const action = button.dataset.action;
    if (action === "toggle-theme") {
      toggleTheme();
    } else if (action === "show-login") {
      state.authMode = "login";
      renderLogin();
      document.querySelector("#login-user")?.focus();
    } else if (action === "show-registration") {
      state.authMode = "register";
      renderLogin();
      document.querySelector("#registration-name")?.focus();
    } else if (action === "show-recovery") {
      state.authMode = "recover";
      renderLogin();
    } else if (action === "retry-boot") {
      await boot();
    } else if (action === "nav-inbox") {
      state.view = "bandeja";
      state.notice = "";
      render();
      fillAccountSelect();
    } else if (action === "logout") {
      stopPolling();
      knownMessageIds = null;
      arrivalNote = "";
      await api("/api/sesion", { method: "DELETE" });
      state.companies = [];
      state.organizations = [];
      state.accounts = [];
      state.messages = [];
      state.selectedCompanyId = null;
      state.selectedOrganizationId = null;
      state.selectedPerson = null;
      state.selectedMessageId = null;
      state.filterChannel = "";
      state.searchQuery = "";
      state.mobilePane = "list";
      state.user = null;
      state.settingsDraft = null;
      state.error = "";
      state.notice = "";
      renderLogin();
    } else if (action === "open-settings") {
      state.view = "ajustes";
      state.notice = "";
      state.error = "";
      state.settingsDraft = structuredClone(companyById(state.selectedCompanyId)?.ajustes || {});
      render();
    } else if (action === "open-spaces") {
      state.view = "espacios";
      state.notice = "";
      state.error = "";
      render();
    } else if (action === "open-company") {
      state.view = "empresa";
      state.selectedCompanyId = button.dataset.id;
      state.notice = "";
      setDraftFromCompany(companyById(button.dataset.id));
      render();
    } else if (action === "switch-company") {
      await switchCompany(button.dataset.id);
    } else if (action === "delete-account") {
      if (!window.confirm("¿Quitar esta cuenta? Esta acción no se puede deshacer.")) return;
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
    } else if (action === "select-network") {
      const network = button.dataset.network;
      state.filterChannel = state.filterChannel === network ? "" : network;
      state.view = "bandeja";
      ensureSelection();
      render();
      fillAccountSelect();
    } else if (action === "open-person") {
      state.selectedPerson = button.dataset.person;
      state.selectedMessageId = null;
      state.view = "bandeja";
      state.mobilePane = "conversation";
      ensureSelection();
      render();
      fillAccountSelect();
    } else if (action === "open-message") {
      state.selectedMessageId = button.dataset.id;
      state.view = "bandeja";
      render();
      fillAccountSelect();
    } else if (action === "back-to-list") {
      state.mobilePane = "list";
      render();
      fillAccountSelect();
    } else if (action === "toggle-test-message") {
      state.showTestMessage = !state.showTestMessage;
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
    } else if (action === "save-draft") {
      const draft = document.querySelector("[data-testid='reply-text']")?.value || "";
      await api(`/api/mensajes/${state.selectedMessageId}/borrador`, {
        method: "PUT",
        body: JSON.stringify({ borrador: draft }),
      });
      await load();
      render();
      fillAccountSelect();
    } else if (action === "approve-draft") {
      const draft = document.querySelector("[data-testid='reply-text']")?.value || "";
      const current = state.messages.find((item) => item.id === state.selectedMessageId)?.borrador || "";
      if (draft.trim() !== current.trim()) {
        await api(`/api/mensajes/${state.selectedMessageId}/borrador`, {
          method: "PUT",
          body: JSON.stringify({ borrador: draft }),
        });
      }
      await api(`/api/mensajes/${state.selectedMessageId}/aprobar`, { method: "POST", body: "{}" });
      await load();
      render();
      fillAccountSelect();
    } else if (action === "send-message") {
      setControlBusy("[data-testid='send-message']", true, "Enviando");
      await api(`/api/mensajes/${state.selectedMessageId}/enviar`, { method: "POST", body: "{}" });
      await load();
      state.notice = "Respuesta enviada por correo.";
      render();
      fillAccountSelect();
    } else if (action === "sync-email") {
      setControlBusy("[data-testid='sync-email']", true, "Sincronizando");
      const result = await api("/api/email/sincronizar", { method: "POST", body: "{}" });
      await load();
      state.notice = `${result.importados} correo${result.importados === 1 ? "" : "s"} importado${result.importados === 1 ? "" : "s"}.`;
      render();
      fillAccountSelect();
    } else if (action === "sync-google" || action === "sync-x") {
      const provider = action === "sync-google" ? "google-reviews" : "x";
      const selector = action === "sync-google" ? "[data-testid='sync-google']" : "[data-testid='sync-x']";
      setControlBusy(selector, true, "Sincronizando");
      const result = await api(`/api/${provider}/sincronizar`, { method: "POST", body: "{}" });
      await load();
      state.notice = `${result.importados} elemento${result.importados === 1 ? "" : "s"} importado${result.importados === 1 ? "" : "s"}.`;
      render();
      fillAccountSelect();
    } else if (action === "save-conversation") {
      await api(`/api/mensajes/${state.selectedMessageId}/conversacion`, {
        method: "PUT",
        body: JSON.stringify({
          status: document.querySelector("[data-testid='conversation-status']")?.value || "open",
          assignedToMe: Boolean(document.querySelector("[data-testid='assign-to-me']")?.checked),
        }),
      });
      await load();
      state.notice = "Seguimiento actualizado.";
      render();
      fillAccountSelect();
    } else if (action === "add-note") {
      const texto = document.querySelector("[data-testid='conversation-note']")?.value || "";
      await api(`/api/mensajes/${state.selectedMessageId}/notas`, { method: "POST", body: JSON.stringify({ texto }) });
      await load();
      state.notice = "Nota interna agregada.";
      render();
      fillAccountSelect();
    } else if (action === "copy-reply") {
      const node = document.querySelector('[data-testid="reply-text"]');
      const text = node?.value || node?.textContent || "";
      if (!text.trim()) throw new Error("Genera la respuesta antes de copiarla.");
      let copied = false;
      window.__copyError = "";
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch (error) {
        window.__copyError = String(error);
        node.focus();
        node.select();
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
      if (!window.confirm("¿Eliminar este mensaje? Esta acción no se puede deshacer.")) return;
      await api(`/api/mensajes/${state.selectedMessageId}`, { method: "DELETE" });
      state.selectedMessageId = null;
      await load();
      render();
      fillAccountSelect();
    }
  } catch (error) {
    if (error.status === 401) {
      stopPolling();
      knownMessageIds = null;
      state.companies = [];
      state.accounts = [];
      state.messages = [];
      state.selectedCompanyId = null;
      state.selectedPerson = null;
      state.selectedMessageId = null;
      state.filterChannel = "";
      state.error = "";
      renderLogin();
      return;
    }
    state.error = error.message;
    render();
    fillAccountSelect();
  }
});

async function switchCompany(companyId) {
  await api("/api/sesion/empresa", {
    method: "POST",
    body: JSON.stringify({ empresaId: companyId }),
  });
  state.selectedPerson = null;
  state.selectedMessageId = null;
  state.filterChannel = "";
  state.searchQuery = "";
  state.mobilePane = "list";
  state.settingsDraft = null;
  await load();
  ensureSelection();
  render();
  fillAccountSelect();
}

async function createSpaceCompany() {
  await api(`/api/organizaciones/${state.selectedOrganizationId}/empresas`, {
    method: "POST",
    body: JSON.stringify({
      nombre: document.querySelector("#space-company-name").value,
      industria: document.querySelector("#space-company-industry").value,
    }),
  });
  await load();
  state.view = "espacios";
  state.notice = "Empresa creada y activada.";
  render();
}

async function createOrganization() {
  await api("/api/organizaciones", {
    method: "POST",
    body: JSON.stringify({
      nombre: document.querySelector("#new-organization-name").value,
      empresa: document.querySelector("#new-organization-company").value,
      industria: document.querySelector("#new-organization-industry").value,
    }),
  });
  await load();
  state.view = "espacios";
  state.notice = "Organización creada con su primera empresa.";
  render();
}

async function changePassword() {
  const nextPassword = document.querySelector("#new-password").value;
  const confirmation = document.querySelector("#confirm-new-password").value;
  if (nextPassword !== confirmation) throw new Error("Las claves nuevas no coinciden.");
  await api("/api/cuenta/cambiar-clave", {
    method: "POST",
    body: JSON.stringify({
      claveActual: document.querySelector("#current-password").value,
      claveNueva: nextPassword,
    }),
  });
  stopPolling();
  state.user = null;
  state.organizations = [];
  state.companies = [];
  state.accounts = [];
  state.messages = [];
  state.authMode = "login";
  state.loginNotice = "Clave cambiada. Entra nuevamente con tu clave nueva.";
  renderLogin();
}

async function saveSettings() {
  const company = companyById(state.selectedCompanyId);
  const payload = { ...(state.settingsDraft || {}) };
  for (const input of document.querySelectorAll("[data-setting]")) {
    payload[input.dataset.setting] = input.value;
  }
  state.settingsDraft = payload;
  await api(`/api/empresas/${company.id}/ajustes`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  await load();
  state.settingsDraft = structuredClone(companyById(state.selectedCompanyId)?.ajustes || {});
  state.notice = "Ajustes guardados.";
  state.view = "ajustes";
  render();
}

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
  const nombreCliente = document.querySelector("#message-name").value;
  const created = await api("/api/mensajes", {
    method: "POST",
    body: JSON.stringify({
      cuentaId,
      nombreCliente,
      texto: document.querySelector("#message-text").value,
      calificacion:
        account?.canal === "google_reviews"
          ? Number(document.querySelector("#message-rating").value)
          : null,
    }),
  });
  const arrived = await load();
  state.selectedPerson = personKey(created.nombreCliente || nombreCliente);
  state.selectedMessageId = created.id;
  state.view = "bandeja";
  ensureSelection();
  if (matchesFilter(created)) state.selectedMessageId = created.id;
  if (arrived) arrivalNote = "Nuevo mensaje.";
  render();
  fillAccountSelect();
  if (arrived) playDoublePing();
}

function renderInboxSkeleton() {
  app.dataset.ready = "true";
  app.dataset.testid = "app-ready";
  app.innerHTML = `<div class="shell" data-testid="inbox-skeleton" aria-busy="true">
    ${appBar()}
    <main class="main" id="contenido">
      <p class="sr-only">Cargando la bandeja.</p>
      <div class="skeleton-stack" aria-hidden="true"><span class="skeleton short"></span><span class="skeleton title"></span></div>
      <div class="channel-row">${skeletonLines(5)}</div>
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
  const registering = state.registrationEnabled && state.authMode === "register";
  const recovering = state.authMode === "recover";
  const accessForm = registering
    ? `<form class="login-card registration-card" data-action="registration-user" data-testid="registration-form" aria-describedby="registration-error">
          <div class="auth-heading">
            <p class="registration-progress" data-testid="registration-progress">Paso 1 de 2 · Usuario</p>
            <h2 id="registration-title">Crea tu cuenta</h2>
            <p>Primero registra tu acceso personal. Después crearás la organización y su primera empresa.</p>
          </div>
          <fieldset class="registration-step" data-registration-step="user">
            <legend class="sr-only">Datos del usuario</legend>
            <label for="registration-name">Nombre<input id="registration-name" data-testid="registration-name" autocomplete="given-name" maxlength="60" required${invalid} /></label>
            <label for="registration-last-name">Apellido<input id="registration-last-name" data-testid="registration-last-name" autocomplete="family-name" maxlength="60" required${invalid} /></label>
            <label for="registration-user">Usuario<input id="registration-user" data-testid="registration-user" autocomplete="username" minlength="3" maxlength="40" pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,39}" aria-describedby="registration-user-hint registration-error" required${invalid} /><small id="registration-user-hint">Letras, números, punto, guion o guion bajo.</small></label>
            <label for="registration-email">Correo<input id="registration-email" data-testid="registration-email" type="email" autocomplete="email" maxlength="254" required${invalid} /></label>
            <label for="registration-password">Clave<input id="registration-password" data-testid="registration-password" type="password" autocomplete="new-password" minlength="6" maxlength="128" pattern="(?=.*[A-Za-z])(?=.*[0-9]).{6,128}" aria-describedby="registration-password-hint registration-error" required${invalid} /><small id="registration-password-hint">Mínimo 6 caracteres, con letras y números.</small></label>
            <label for="registration-confirm">Confirma la clave<input id="registration-confirm" data-testid="registration-confirm" type="password" autocomplete="new-password" minlength="6" maxlength="128" required${invalid} /></label>
            <button class="primary" type="submit" data-testid="registration-next">Continuar a organización</button>
          </fieldset>
          <fieldset class="registration-step" data-registration-step="organization" hidden disabled>
            <legend class="sr-only">Organización y primera empresa</legend>
            <div class="auth-heading">
              <h3>Organización y primera empresa</h3>
              <p>La organización agrupa usuarios y empresas. Podrás agregar más empresas después.</p>
            </div>
            <label for="registration-organization">Organización<input id="registration-organization" data-testid="registration-organization" autocomplete="organization" maxlength="160" required${invalid} /></label>
            <label for="registration-company">Primera empresa<input id="registration-company" data-testid="registration-company" maxlength="160" required${invalid} /></label>
            <label for="registration-industry">Industria o actividad<input id="registration-industry" data-testid="registration-industry" maxlength="240" placeholder="Ej. seguros, restaurante, salud" required${invalid} /></label>
            ${state.inviteRequired ? `<label for="registration-invite">Código de invitación<input id="registration-invite" data-testid="registration-invite" type="password" autocomplete="one-time-code" maxlength="128" aria-describedby="registration-invite-hint registration-error" required${invalid} /><small id="registration-invite-hint">Solicítalo al administrador de Pulse.</small></label>` : ""}
            <div class="registration-actions">
              <button class="ghost" type="button" data-action="registration-back">Volver</button>
              <button class="primary" type="submit" data-testid="registration-submit">Crear cuenta y entrar</button>
            </div>
          </fieldset>
          <p class="error" id="registration-error" data-testid="registration-error" role="alert">${escapeHtml(message)}</p>
        </form>`
    : recovering
      ? `<section class="login-card recovery-card" aria-labelledby="recovery-title">
          <h2 id="recovery-title">Recupera tu acceso</h2>
          <p>El envío automático por correo todavía necesita un servidor SMTP. Mientras se configura, pide al administrador local que restablezca tu clave; no necesita conocer tu clave anterior.</p>
          <button class="ghost" type="button" data-action="show-login">Volver a entrar</button>
        </section>`
      : `<form class="login-card" data-action="login" data-testid="login-form" aria-describedby="login-error">
          <h2 id="login-title">Entra a Pulse</h2>
          ${state.loginNotice ? `<p class="success" role="status">${escapeHtml(state.loginNotice)}</p>` : ""}
          <label for="login-user">Usuario<input id="login-user" data-testid="login-user" autocomplete="username" aria-describedby="login-error" required${invalid} /></label>
          <label for="login-password">Clave<input id="login-password" data-testid="login-password" type="password" autocomplete="current-password" aria-describedby="login-error" required${invalid} /></label>
          <button class="primary" type="submit" data-testid="login-submit">Entrar</button>
          <p class="error" id="login-error" data-testid="login-error" role="alert">${escapeHtml(message)}</p>
        </form>`;
  const authSwitch = state.registrationEnabled && !recovering
    ? `<div class="auth-switch" aria-label="Acceso a Pulse">
        <button type="button" data-action="show-login" aria-pressed="${registering ? "false" : "true"}">Entrar</button>
        <button type="button" data-action="show-registration" aria-pressed="${registering ? "true" : "false"}">Crear cuenta</button>
      </div>`
    : "";
  app.innerHTML = `<main class="gate" id="contenido">
    <a class="skip" href="#${registering ? "registration-name" : recovering ? "recovery-title" : "login-user"}">Saltar al acceso</a>
    <div class="gate-frame">
      <header class="gate-story">
        <h1 class="lockup">${brandLockup()}</h1>
        <p class="lema">Un espacio para tus objetivos.</p>
        <p class="lede">Tu cuenta puede acceder a varias organizaciones y empresas. Cada respuesta usa solo la ficha de la empresa activa.</p>
        ${themeButton()}
      </header>
      <section class="gate-panel">
        ${authSwitch}
        ${accessForm}
        ${!registering && !recovering ? '<button type="button" class="auth-help" data-action="show-recovery">¿Olvidaste tu clave?</button>' : ""}
        <aside class="demo-logins" data-testid="demo-logins" ${registering || recovering ? "hidden" : ""}>
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
      <nav class="legal-links" data-testid="legal-links">
        <a href="/privacidad">Privacidad</a>
        <a href="/eliminar-datos">Eliminar datos</a>
        <a href="/terminos">Términos</a>
      </nav>
    </div>
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
  state.loginNotice = "";
  state.view = "bandeja";
  renderInboxSkeleton();
  await load();
  state.selectedPerson = null;
  state.filterChannel = "";
  ensureSelection();
  render();
  fillAccountSelect();
  startPolling();
}

async function submitRegistration() {
  const password = document.querySelector("#registration-password").value;
  const confirmation = document.querySelector("#registration-confirm").value;
  if (password !== confirmation) {
    throw new Error("Las claves no coinciden. Vuelve a escribirlas.");
  }
  await api("/api/registro", {
    method: "POST",
    body: JSON.stringify({
      nombre: document.querySelector("#registration-name").value,
      apellido: document.querySelector("#registration-last-name").value,
      organizacion: document.querySelector("#registration-organization").value,
      empresa: document.querySelector("#registration-company").value,
      industria: document.querySelector("#registration-industry").value,
      usuario: document.querySelector("#registration-user").value,
      correo: document.querySelector("#registration-email").value,
      clave: password,
      invitacion: document.querySelector("#registration-invite")?.value || "",
    }),
  });
  state.error = "";
  state.view = "bandeja";
  renderInboxSkeleton();
  await load();
  state.selectedPerson = null;
  state.filterChannel = "";
  ensureSelection();
  render();
  fillAccountSelect();
  startPolling();
}

function advanceRegistration() {
  const password = document.querySelector("#registration-password").value;
  const confirmation = document.querySelector("#registration-confirm").value;
  if (password !== confirmation) throw new Error("Las claves no coinciden. Vuelve a escribirlas.");
  const form = document.querySelector('[data-testid="registration-form"]');
  form.dataset.action = "register";
  const userStep = document.querySelector('[data-registration-step="user"]');
  const organizationStep = document.querySelector('[data-registration-step="organization"]');
  userStep.hidden = true;
  userStep.disabled = true;
  organizationStep.hidden = false;
  organizationStep.disabled = false;
  document.querySelector('[data-testid="registration-progress"]').textContent = "Paso 2 de 2 · Organización y empresa";
  document.querySelector("#registration-title").textContent = "Configura tu espacio";
  document.querySelector("#registration-organization").focus();
}

function backToRegistrationUser() {
  const form = document.querySelector('[data-testid="registration-form"]');
  form.dataset.action = "registration-user";
  const userStep = document.querySelector('[data-registration-step="user"]');
  const organizationStep = document.querySelector('[data-registration-step="organization"]');
  organizationStep.hidden = true;
  organizationStep.disabled = true;
  userStep.hidden = false;
  userStep.disabled = false;
  document.querySelector('[data-testid="registration-progress"]').textContent = "Paso 1 de 2 · Usuario";
  document.querySelector("#registration-title").textContent = "Crea tu cuenta";
  document.querySelector("#registration-name").focus();
}

function facebookReturn() {
  const params = new URLSearchParams(window.location.search);
  const facebook = params.get("facebook");
  if (!facebook) return;
  const notes = {
    ok: "Página de Facebook conectada.",
    sin_app: "Pega el identificador y el secreto de la app de Meta antes de conectar.",
    denegado: "Facebook no autorizó la conexión.",
    sin_pagina: "Esa cuenta no tiene una página de Facebook.",
    facebook: "Facebook no completó el inicio de sesión.",
  };
  if (facebook === "ok") {
    state.notice = notes.ok;
    state.error = "";
  } else {
    state.error = notes[params.get("motivo")] || notes.facebook;
    state.notice = "";
  }
  state.view = "ajustes";
  state.settingsDraft = structuredClone(companyById(state.selectedCompanyId)?.ajustes || {});
  window.history.replaceState({}, "", "/");
}

function instagramReturn() {
  const params = new URLSearchParams(window.location.search);
  const instagram = params.get("instagram");
  if (!instagram) return;
  const notes = {
    ok: "Cuenta de Instagram conectada.",
    sin_app: "Pega el secreto de la app de Meta, en Facebook, antes de conectar Instagram.",
    denegado: "Instagram no autorizó la conexión.",
    sin_instagram: "Esa cuenta no tiene una cuenta profesional de Instagram unida a una página.",
    instagram: "Instagram no completó el inicio de sesión.",
  };
  if (instagram === "ok") {
    state.notice = notes.ok;
    state.error = "";
  } else {
    state.error = notes[params.get("motivo")] || notes.instagram;
    state.notice = "";
  }
  state.view = "ajustes";
  state.settingsDraft = structuredClone(companyById(state.selectedCompanyId)?.ajustes || {});
  window.history.replaceState({}, "", "/");
}

async function boot() {
  const slow = setTimeout(() => renderInboxSkeleton(), 180);
  try {
    await loadPublicConfig();
    await load();
    clearTimeout(slow);
    state.view = "bandeja";
    facebookReturn();
    instagramReturn();
    ensureSelection();
    render();
    fillAccountSelect();
    startPolling();
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

if ("serviceWorker" in navigator && window.location.protocol === "https:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("/service-worker.js").catch(() => {}));
}
