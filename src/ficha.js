const FIELDS = [
  "nombre",
  "servicios",
  "horarios",
  "telefono",
  "correoOficial",
  "sitioWeb",
  "soporte",
];

export function snapshotFicha(company) {
  const ficha = {};
  for (const field of FIELDS) {
    ficha[field] = String(company?.[field] ?? "").trim();
  }
  return ficha;
}
