import { normalizeSettings } from "./settings.js";

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function configuration(company) {
  const settings = normalizeSettings(company?.ajustes, company);
  const required = ["google_client_id", "google_client_secret", "google_refresh_token", "google_account_id", "google_location_id"];
  if (required.some((key) => !String(settings[key] || "").trim())) {
    throw fail(409, "Completa la conexión de Google Business Profile.");
  }
  return settings;
}

async function readJson(response, message) {
  let payload;
  try { payload = await response.json(); } catch { throw fail(502, message); }
  if (!response.ok) throw fail(502, message);
  return payload;
}

export async function googleAccessToken(company, fetchImpl = fetch) {
  const settings = configuration(company);
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: settings.google_client_id,
      client_secret: settings.google_client_secret,
      refresh_token: settings.google_refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });
  const payload = await readJson(response, "Google no pudo renovar la conexión.");
  if (!payload.access_token) throw fail(502, "Google no devolvió un token de acceso.");
  return { token: String(payload.access_token), settings };
}

function starNumber(value) {
  const map = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return map[String(value || "").toUpperCase()] || 0;
}

export async function listGoogleReviews(company, fetchImpl = fetch) {
  const { token, settings } = await googleAccessToken(company, fetchImpl);
  const account = encodeURIComponent(settings.google_account_id.replace(/^accounts\//, ""));
  const location = encodeURIComponent(settings.google_location_id.replace(/^locations\//, ""));
  const url = `https://mybusiness.googleapis.com/v4/accounts/${account}/locations/${location}/reviews?orderBy=updateTime%20desc&pageSize=50`;
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${token}` },
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  const payload = await readJson(response, "Google no pudo leer las reseñas.");
  return (Array.isArray(payload.reviews) ? payload.reviews : [])
    .filter((review) => review?.reviewId && review?.comment)
    .map((review) => ({
      externalId: String(review.reviewId),
      displayName: String(review.reviewer?.displayName || "Cliente de Google").slice(0, 160),
      text: String(review.comment).slice(0, 4000),
      rating: starNumber(review.starRating),
    }))
    .filter((review) => review.rating > 0);
}

export async function replyGoogleReview(company, message, fetchImpl = fetch) {
  const reviewId = String(message?.externalId || "").trim();
  const comment = String(message?.borrador || message?.respuesta || "").trim();
  if (!reviewId || !comment) throw fail(409, "La reseña no conserva el identificador o la respuesta aprobada.");
  const { token, settings } = await googleAccessToken(company, fetchImpl);
  const account = encodeURIComponent(settings.google_account_id.replace(/^accounts\//, ""));
  const location = encodeURIComponent(settings.google_location_id.replace(/^locations\//, ""));
  const url = `https://mybusiness.googleapis.com/v4/accounts/${account}/locations/${location}/reviews/${encodeURIComponent(reviewId)}/reply`;
  const response = await fetchImpl(url, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ comment }),
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  await readJson(response, "Google no pudo publicar la respuesta.");
  return { providerMessageId: reviewId };
}
