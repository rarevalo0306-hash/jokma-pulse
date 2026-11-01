const app = document.querySelector("#app");

const state = {
  view: "bandeja",
  companies: [],
  accounts: [],
  messages: [],
  canales: [],
  selectedCompanyId: null,
  selectedPerson: null,
  selectedMessageId: null,
  draft: null,
  filterCompany: "",
  filterChannel: "",
  settingsDraft: null,
  error: "",
  notice: "",
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
  const empresaId = state.companies[0]?.id;
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
  state.modelos = payload.modelos || [];
  state.parametros = payload.parametros || [];
  state.conexiones = payload.conexiones || [];
  if (state.selectedCompanyId && !companyById(state.selectedCompanyId)) {
    state.selectedCompanyId = null;
    state.view = "bandeja";
  }
  if (state.selectedMessageId && !state.messages.some((item) => item.id === state.selectedMessageId)) {
    state.selectedMessageId = null;
  }
  return noteArrivals(state.messages);
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
        : inboxView();
  app.innerHTML = `<div class="shell"><a class="skip" href="#contenido">Saltar al contenido</a><p class="sr-only" aria-live="polite" data-testid="arrival-note">${escapeHtml(arrivalNote)}</p>${appBar()}<main class="main" id="contenido" tabindex="-1">${body}</main></div>`;
}

function appBar() {
  return `<header class="app-bar">
    <div class="brand"><h1 class="lockup">${brandLockup()}</h1></div>
    <div class="nav-footer">
      <button type="button" class="nav-button" data-action="open-settings" data-testid="nav-settings" ${state.view === "ajustes" ? 'aria-current="page"' : ""}>Ajustes</button>
      ${themeButton()}
      <button type="button" class="nav-button" data-action="logout" data-testid="logout">Cerrar sesión</button>
    </div>
  </header>`;
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
  const company = state.companies[0];
  const list = people();
  const person = list.find((item) => item.key === state.selectedPerson) || null;
  const thread = person ? messagesForPerson(person.key) : [];
  const filterLabel = state.filterChannel ? networkById(state.filterChannel).label : "";
  const rows = list
    .map((item) => {
      const last = item.last;
      const network = last ? networkForChannel(last.canal) : null;
      const slug = item.key.replace(/\s+/g, "-");
      return `<li><button type="button" class="message-button" data-action="open-person" data-person="${escapeHtml(item.key)}" data-testid="person-${escapeHtml(slug)}" aria-current="${state.selectedPerson === item.key ? "true" : "false"}">
        <div class="message-top">
          <strong>${escapeHtml(item.name)}</strong>
          ${network ? `<span class="pill" data-network="${escapeHtml(network.id)}">${escapeHtml(network.label)}</span>` : ""}
        </div>
        <p class="message-preview">${escapeHtml(last ? last.texto : "Sin mensajes en esta red.")}</p>
      </button></li>`;
    })
    .join("");
  const chips = NETWORKS.map((item) => {
    const count = companyMessages().filter((message) => item.channels.includes(message.canal)).length;
    const pressed = state.filterChannel === item.id;
    return `<button type="button" class="channel-chip" data-action="select-network" data-network="${item.id}" aria-pressed="${pressed ? "true" : "false"}" aria-label="${item.label}, ${pressed ? "filtro activo" : "sin filtro"}, ${count} ${count === 1 ? "mensaje" : "mensajes"}">
      <span>${item.label}</span>
      <span class="channel-count">${count}</span>
    </button>`;
  }).join("");
  const threadItems = thread
    .map((message) => {
      const network = networkForChannel(message.canal);
      const selected = message.id === state.selectedMessageId;
      const savedReply =
        message.respuesta && !selected ? `<pre class="reply">${escapeHtml(message.respuesta)}</pre>` : "";
      return `<li class="thread-item" data-testid="message-${escapeHtml(message.id)}" data-network="${escapeHtml(network.id)}" aria-current="${selected ? "true" : "false"}">
        <button type="button" class="thread-select" data-action="open-message" data-id="${escapeHtml(message.id)}">
          <span class="thread-meta">
            <span class="pill">${escapeHtml(network.label)}</span>
            <span class="meta">${escapeHtml(channelLabel(message.canal))}</span>
            <time datetime="${escapeHtml(message.createdAt)}">${escapeHtml(formatWhen(message.createdAt))}</time>
          </span>
          ${message.calificacion ? `<span class="stars" aria-label="${message.calificacion} de 5 estrellas">${stars(message.calificacion)}</span>` : ""}
          <span class="original"${selected ? ` data-testid="message-text-view"` : ""}>${escapeHtml(message.texto)}</span>
        </button>
        ${savedReply}
        ${selected ? messageDetail() : ""}
      </li>`;
    })
    .join("");
  const conversation = person
    ? `<header class="topbar">
        <div>
          <p class="eyebrow">Conversación</p>
          <h2>${escapeHtml(person.name)}</h2>
          <p class="hint">${filterLabel ? `Solo ${escapeHtml(filterLabel)}.` : "Todas las redes, en orden."}</p>
        </div>
      </header>
      <ol class="thread" data-testid="conversation">
        ${threadItems || `<li class="empty-state" data-testid="empty-detail"><h3>Sin mensajes en esta red</h3><p>Quita el filtro de ${escapeHtml(filterLabel)} para ver todas las redes de esta persona.</p></li>`}
      </ol>`
    : `<section class="profile empty-state" data-testid="empty-detail"><h3>Elige una persona</h3><p>Su conversación reúne Google, Instagram, Facebook, X y Correo.</p></section>`;

  return `<section class="company-head">
      <div>
        <p class="eyebrow">Empresa</p>
        <h2 data-testid="session-company">${escapeHtml(company?.nombre || "Empresa")}</h2>
        <p class="hint">${escapeHtml(company?.industria || "")}</p>
        <p class="lede">Una persona reúne todas sus redes. La fila de arriba filtra esa conversación.</p>
      </div>
      <div class="actions">
        <button type="button" class="nav-button" data-action="nav-inbox" data-testid="nav-inbox" aria-current="page">Mensajes</button>
        <button type="button" class="ghost" data-action="open-settings">Ajustes</button>
        ${company ? `<button type="button" class="ghost company-button" data-action="open-company" data-id="${escapeHtml(company.id)}" data-testid="company-${escapeHtml(company.id)}">Ficha</button>` : ""}
      </div>
    </section>
    <nav class="channel-row" aria-label="Filtrar por red" data-testid="filter-channel">${chips}</nav>
    <p class="hint" data-testid="filter-status">${filterLabel ? `Filtro: ${escapeHtml(filterLabel)}.` : "Ninguna red seleccionada: se ven todas."}</p>
    ${banner()}
    <div class="inbox">
      <section class="inbox-column" aria-label="Personas">
        <header class="topbar">
          <div>
            <p class="eyebrow">Personas</p>
            <h2>Conversaciones</h2>
            <p class="hint">${list.length} ${list.length === 1 ? "persona" : "personas"}.</p>
          </div>
        </header>
        ${composer()}
        <ul class="message-list">
          ${rows || `<li class="empty-state" data-testid="empty-inbox"><h3>Sin personas</h3><p>No hay mensajes en esta red.</p></li>`}
        </ul>
      </section>
      <section class="inbox-detail" aria-label="Conversación de la persona">${conversation}</section>
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
    return `<section class="profile empty-state" data-testid="empty-detail"><h3>Nada seleccionado</h3><p>Elige un mensaje de este canal para escribir la respuesta.</p></section>`;
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

function settingValue(draft, key) {
  return draft?.[key] ?? "";
}

function settingControl(row, draft) {
  const value = settingValue(draft, row.api);
  const secret = row.secreto ? ` type="password" autocomplete="new-password" spellcheck="false"` : ` type="text" autocomplete="off"`;
  if (row.largo) {
    return `<textarea data-setting="${escapeHtml(row.api)}" data-testid="setting-${escapeHtml(row.api)}" rows="3">${escapeHtml(value)}</textarea>`;
  }
  return `<input data-setting="${escapeHtml(row.api)}" data-testid="setting-${escapeHtml(row.api)}" value="${escapeHtml(value)}"${secret} />`;
}

function settingRows(rows, draft) {
  return rows
    .map(
      (row) => `<tr>
        <th scope="row">${escapeHtml(row.nombre)}</th>
        <td><code>${escapeHtml(row.api)}</code></td>
        <td>${settingControl(row, draft)}</td>
      </tr>`,
    )
    .join("");
}

function settingsTable(rows, draft) {
  return `<div class="settings-scroll">
    <table class="settings-table">
      <thead><tr><th>Nombre</th><th>Nombre en la API</th><th>Valor</th></tr></thead>
      <tbody>${settingRows(rows, draft)}</tbody>
    </table>
  </div>`;
}

function settingsView() {
  const company = state.companies[0];
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
    .map(
      (group) => `<section class="settings-network" data-network="${escapeHtml(group.red)}">
        <h3>${escapeHtml(group.red)}</h3>
        ${settingsTable(group.filas || [], draft)}
      </section>`,
    )
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
        ${settingsTable(state.parametros || [], draft)}
      </section>
      <section class="panel" data-testid="settings-connections">
        <h3>Conexiones</h3>
        <p class="hint">Gmail usa n8n: cada correo nuevo se envía a la URL del webhook y la respuesta vuelve a Pulse. Instagram, Facebook y X no tienen OAuth.</p>
        ${connections}
      </section>
      <div class="actions">
        <button class="primary" type="submit" data-testid="save-settings">Guardar ajustes</button>
        <span class="ok-note" data-testid="save-status">${escapeHtml(state.notice)}</span>
      </div>
    </form>`;
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
  const busy = {
    login: ["[data-testid='login-submit']", "Entrando"],
    "save-company": ["[data-testid='save-company']", "Guardando"],
    "save-account-new": ["[data-testid='save-account']", "Agregando"],
    "save-message": ["[data-testid='save-message']", "Agregando"],
    "save-settings": ["[data-testid='save-settings']", "Guardando"],
  }[form.dataset.action];
  if (busy) setControlBusy(busy[0], true, busy[1]);
  try {
    state.error = "";
    if (form.dataset.action === "login") await submitLogin();
    if (form.dataset.action === "save-company") await saveCompany();
    if (form.dataset.action === "save-account-new") await createAccount();
    if (form.dataset.action === "save-message") await createMessage();
    if (form.dataset.action === "save-settings") await saveSettings();
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
  unlockAudio();
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
      stopPolling();
      knownMessageIds = null;
      arrivalNote = "";
      await api("/api/sesion", { method: "DELETE" });
      state.companies = [];
      state.accounts = [];
      state.messages = [];
      state.selectedCompanyId = null;
      state.selectedPerson = null;
      state.selectedMessageId = null;
      state.filterChannel = "";
      state.settingsDraft = null;
      state.error = "";
      state.notice = "";
      renderLogin();
    } else if (action === "open-settings") {
      state.view = "ajustes";
      state.notice = "";
      state.error = "";
      state.settingsDraft = structuredClone(state.companies[0]?.ajustes || {});
      render();
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
      ensureSelection();
      render();
      fillAccountSelect();
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

async function saveSettings() {
  const company = state.companies[0];
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
  state.settingsDraft = structuredClone(state.companies[0]?.ajustes || {});
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
  app.innerHTML = `<main class="gate" id="contenido">
    <a class="skip" href="#login-user">Saltar al acceso</a>
    <div class="gate-frame">
      <header class="gate-story">
        <h1 class="lockup">${brandLockup()}</h1>
        <p class="lema">Un espacio para tus objetivos.</p>
        <p class="lede">Pulse reúne la ficha, los agentes y la bandeja de cada empresa. Cada respuesta usa solo la ficha de esa cuenta.</p>
        ${themeButton()}
      </header>
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
  state.view = "bandeja";
  renderInboxSkeleton();
  await load();
  state.selectedCompanyId = state.companies[0]?.id || null;
  state.selectedPerson = null;
  state.filterChannel = "";
  ensureSelection();
  render();
  fillAccountSelect();
  startPolling();
}

async function boot() {
  const slow = setTimeout(() => renderInboxSkeleton(), 180);
  try {
    await load();
    clearTimeout(slow);
    state.selectedCompanyId = state.companies[0]?.id || null;
    state.view = "bandeja";
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
