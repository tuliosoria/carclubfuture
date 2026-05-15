/**
 * Google Trends wrapper — thin adapter around google-trends-api.
 *
 * Returns a 0–100 score and linear-regression momentum over 90 days.
 * All errors are caught and returned as a null-score object (never throws).
 */
import googleTrends from "google-trends-api";
import { jsonLog } from "./http.mjs";

/**
 * Fetch trend interest score for a query term.
 *
 * @param {string} query              Search term
 * @param {object} [opts]
 * @param {object} [opts.trendsClient] Injected trends client (default: google-trends-api)
 * @param {function} [opts.now]        () => Date — injectable for tests
 * @returns {Promise<{
 *   score30d: number|null,
 *   momentum90d: number|null,
 *   raw: Array,
 *   error?: string
 * }>}
 */
export async function fetchTrendScore(
  query,
  { trendsClient = googleTrends, now = () => new Date() } = {},
) {
  try {
    const endTime = now();
    const startTime = new Date(endTime.getTime() - 90 * 24 * 60 * 60 * 1000);

    const raw = await trendsClient.interestOverTime({
      keyword: query,
      startTime,
      endTime,
    });

    // google-trends-api returns a JSON string
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const timelineData = parsed?.default?.timelineData ?? [];

    if (timelineData.length === 0) {
      return { score30d: null, momentum90d: null, raw: [], error: "no data returned" };
    }

    // Extract numeric values (each entry has `value: [number]`)
    const values = timelineData.map((d) =>
      Array.isArray(d.value) ? d.value[0] : Number(d.value),
    );

    // score30d: average of the last 30 data points
    const last30 = values.slice(-30);
    const score30d = last30.reduce((a, b) => a + b, 0) / last30.length;

    // momentum90d: ordinary least-squares slope across all 90d points
    const n = values.length;
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((a, b) => a + b, 0) / n;
    const numerator = values.reduce((sum, y, i) => sum + (i - xMean) * (y - yMean), 0);
    const denominator = values.reduce((sum, _, i) => sum + (i - xMean) ** 2, 0);
    const momentum90d = denominator === 0 ? 0 : numerator / denominator;

    return { score30d, momentum90d, raw: timelineData };
  } catch (err) {
    jsonLog({ operation: "trends", query, warning: "fetch error", error: String(err) });
    return { score30d: null, momentum90d: null, raw: [], error: String(err) };
  }
}
