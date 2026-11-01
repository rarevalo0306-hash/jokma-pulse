const LONG = new Set(["description", "products", "reply_guide", "person_profile"]);

export const MODELS = [{ id: "jokma-ficha", etiqueta: "Jokma Ficha" }];

export const PARAMETERS = [
  { nombre: "Modelo", api: "model" },
  { nombre: "Temperatura", api: "temperature" },
  { nombre: "Tope de tokens", api: "max_tokens" },
  { nombre: "Top p", api: "top_p" },
  { nombre: "Perfil de la persona", api: "person_profile", largo: true },
  { nombre: "Organización", api: "organization" },
  { nombre: "Descripción de la empresa", api: "description", largo: true },
  { nombre: "Productos", api: "products", largo: true },
  { nombre: "Guía de la IA", api: "reply_guide", largo: true },
];

export const CONNECTIONS = [
  {
    red: "Gmail",
    filas: [{ nombre: "URL del webhook de n8n", api: "n8n_webhook_url" }],
  },
  {
    red: "Google",
    filas: [
      { nombre: "Identificador de cliente", api: "google_client_id" },
      { nombre: "Secreto de cliente", api: "google_client_secret", secreto: true },
      { nombre: "Token de actualización", api: "google_refresh_token", secreto: true },
    ],
  },
  {
    red: "Instagram",
    filas: [
      { nombre: "Identificador de cuenta", api: "instagram_user_id" },
      { nombre: "Token de acceso", api: "instagram_access_token", secreto: true },
    ],
  },
  {
    red: "Facebook",
    filas: [
      { nombre: "Identificador de página", api: "facebook_page_id" },
      { nombre: "Token de página", api: "facebook_page_token", secreto: true },
    ],
  },
  {
    red: "X",
    filas: [
      { nombre: "Clave de API", api: "x_api_key", secreto: true },
      { nombre: "Secreto de API", api: "x_api_secret", secreto: true },
      { nombre: "Token de acceso", api: "x_access_token", secreto: true },
      { nombre: "Secreto del token", api: "x_access_token_secret", secreto: true },
    ],
  },
  {
    red: "Correo",
    filas: [
      { nombre: "Servidor", api: "smtp_host" },
      { nombre: "Usuario", api: "smtp_user" },
      { nombre: "Contraseña", api: "smtp_password", secreto: true },
    ],
  },
];

function clip(value, max, multiline) {
  let text = String(value ?? "");
  text = multiline ? text.replace(/\r\n/g, "\n").trim() : text.replace(/\s+/g, " ").trim();
  return text.slice(0, max);
}

export function settingKeys() {
  return [
    ...PARAMETERS.map((item) => item.api),
    ...CONNECTIONS.flatMap((group) => group.filas.map((item) => item.api)),
  ];
}

export function defaultSettings(company = {}) {
  const settings = {
    model: "jokma-ficha",
    temperature: "0.2",
    max_tokens: "800",
    top_p: "1",
    person_profile: "",
    organization: String(company.nombre || "").trim(),
    description: "",
    products: String(company.servicios || "").trim(),
    reply_guide: "",
  };
  for (const key of settingKeys()) {
    if (settings[key] === undefined) settings[key] = "";
  }
  return settings;
}

export function normalizeSettings(raw, company = {}) {
  const defaults = defaultSettings(company);
  const source = raw && typeof raw === "object" ? raw : {};
  const settings = {};
  for (const key of settingKeys()) {
    const multiline = LONG.has(key);
    const max = key === "n8n_webhook_url" ? 1000 : multiline ? 2000 : 500;
    settings[key] = Object.prototype.hasOwnProperty.call(source, key)
      ? clip(source[key], max, multiline)
      : defaults[key];
  }
  if (!settings.model) settings.model = "jokma-ficha";
  return settings;
}
