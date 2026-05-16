/**
 * CarAPI enrichment helpers (task A6).
 *
 * - `getCarApiToken` — exchanges a JWT for a short-lived bearer token.
 * - `enrichWithCarApi` — fills missing fields on rows from CarAPI trims endpoint.
 */

import { jsonLog } from "./http.mjs";

/**
 * POST the JWT to CarAPI's login endpoint and return the bearer token string.
 *
 * @param {{ fetch: Function, jwt: string }} opts
 * @returns {Promise<string>}
 */
export async function getCarApiToken({ fetch: fetchFn, jwt }) {
  const resp = await fetchFn("https://carapi.app/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jwt }),
  });
  // CarAPI returns the bearer token as a plain text string in the body.
  const text = await resp.text();
  return text.trim();
}

/**
 * For each row, call the CarAPI trims endpoint and fill in any missing fields.
 * Sets `row.carapiId` on a successful match. Throttles via injected rateLimiter.
 *
 * Missing fields filled (if CarAPI has them): engineHp, engineTorque,
 * mpgCity, mpgHwy, bodySubStyle.
 *
 * @param {object[]} rows
 * @param {{ fetch: Function, rateLimiter: object, token: string }} opts
 * @returns {Promise<object[]>}
 */
export async function enrichWithCarApi(rows, { fetch: fetchFn, rateLimiter: rl, token }) {
  for (const row of rows) {
    await rl.take();
    try {
      const params = new URLSearchParams({
        year: String(row.year),
        make: row.make,
        model: row.model,
      });
      if (row.trim) params.set("trim", row.trim);

      const url = `https://carapi.app/api/trims?${params}`;
      const resp = await fetchFn(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await resp.json();

      // CarAPI paginates under `data`; also accept a direct array.
      const trims = Array.isArray(data) ? data : (data.data ?? []);
      if (!trims.length) continue;

      const match = trims[0];
      row.carapiId = match.id ?? null;

      // Fill in missing numeric / string fields from CarAPI.
      if (match.engine_hp != null && row.engineHp == null) row.engineHp = match.engine_hp;
      if (match.engine_torque != null && row.engineTorque == null) row.engineTorque = match.engine_torque;
      if (match.city_mileage != null && row.mpgCity == null) row.mpgCity = match.city_mileage;
      if (match.highway_mileage != null && row.mpgHwy == null) row.mpgHwy = match.highway_mileage;
      if (match.body != null && row.bodySubStyle == null) row.bodySubStyle = match.body;
    } catch (err) {
      jsonLog({
        operation: "carapi.enrich",
        make: row.make,
        year: row.year,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return rows;
}
