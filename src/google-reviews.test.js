import assert from "node:assert/strict";
import test from "node:test";
import { listGoogleReviews, replyGoogleReview } from "./google-reviews.js";

const company = {
  nombre: "Lumen",
  ajustes: {
    google_client_id: "cliente-prueba",
    google_client_secret: "secreto-prueba",
    google_refresh_token: "refresh-prueba",
    google_account_id: "accounts/123",
    google_location_id: "locations/456",
  },
};

function response(payload, ok = true) {
  return { ok, async json() { return payload; } };
}

test("Google renueva el token y normaliza reseñas", async () => {
  const calls = [];
  const reviews = await listGoogleReviews(company, async (url, options) => {
    calls.push({ url, options });
    if (url === "https://oauth2.googleapis.com/token") return response({ access_token: "acceso-prueba" });
    return response({ reviews: [{ reviewId: "r-1", reviewer: { displayName: "Ada" }, starRating: "FIVE", comment: "Excelente" }] });
  });
  assert.deepEqual(reviews, [{ externalId: "r-1", displayName: "Ada", text: "Excelente", rating: 5 }]);
  assert.equal(calls[0].options.body.includes("secreto-prueba"), true);
  assert.equal(calls[1].options.headers.authorization, "Bearer acceso-prueba");
  assert.match(calls[1].url, /accounts\/123\/locations\/456\/reviews/);
});

test("Google publica únicamente la respuesta aprobada de la reseña identificada", async () => {
  const calls = [];
  const result = await replyGoogleReview(company, { externalId: "r-2", borrador: "Gracias", estadoRespuesta: "aprobado" }, async (url, options) => {
    calls.push({ url, options });
    return url === "https://oauth2.googleapis.com/token" ? response({ access_token: "acceso" }) : response({ updateTime: "ahora" });
  });
  assert.equal(calls[1].options.method, "PUT");
  assert.deepEqual(JSON.parse(calls[1].options.body), { comment: "Gracias" });
  assert.deepEqual(result, { providerMessageId: "r-2" });
});
