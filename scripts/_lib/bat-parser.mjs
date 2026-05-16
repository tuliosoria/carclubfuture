/**
 * Pure-function BaT (Bring a Trailer) helpers.
 *
 * - `batSearchUrl`      — builds the auction-results search URL for a vehicle
 * - `parseBatResultsHtml` — parses completed-auction HTML into records
 *
 * No network calls, no filesystem — fully testable in isolation.
 */
import * as cheerio from "cheerio";

/**
 * Build a BaT auction-results search URL.
 *
 * @param {{ year: number, make: string, model: string }} opts
 * @returns {string}
 */
export function batSearchUrl({ year, make, model }) {
  const base = "https://bringatrailer.com/auctions/results/";
  const params = new URLSearchParams({
    make: make.toLowerCase(),
    model: model.toLowerCase(),
    year_from: String(year),
    year_to: String(year),
  });
  return `${base}?${params.toString()}`;
}

/**
 * Parse a BaT completed-auctions results page into structured records.
 *
 * @param {string} html  — raw HTML of the results page
 * @returns {Array<{
 *   soldPriceUsd: number | null,
 *   soldDate: string | null,       // ISO date string (YYYY-MM-DD)
 *   mileage: string | null,        // as listed, e.g. "45,212 Miles"
 *   reserveMet: boolean | null,    // true = "Sold for", false = "Bid to", null = unknown
 *   listingUrl: string | null,
 *   title: string | null,
 * }>}
 */
export function parseBatResultsHtml(html) {
  const $ = cheerio.load(html);
  const results = [];

  $(".auction-card").each((_i, card) => {
    const $card = $(card);

    // Listing URL + title
    const $link = $card.find("a.content-link").first();
    const listingUrl = $link.attr("href") || null;
    const title = $link.attr("title") || $link.text().trim() || null;

    // Price text: "Sold for $72,500" or "Bid to $35,000"
    const priceText = $card.find(".auctions-completed-price").first().text().trim();
    let soldPriceUsd = null;
    let reserveMet = null;

    if (priceText) {
      const isSold = /^sold for/i.test(priceText);
      const isBid  = /^bid to/i.test(priceText);

      if (isSold || isBid) {
        reserveMet = isSold;
        const m = priceText.replace(/[^0-9]/g, "");
        soldPriceUsd = m ? parseInt(m, 10) : null;
      }
    }

    // Date: "May 10, 2024" → ISO date
    const dateText = $card.find(".auctions-completed-date").first().text().trim();
    let soldDate = null;
    if (dateText) {
      const d = new Date(dateText);
      if (!isNaN(d.getTime())) {
        soldDate = d.toISOString().slice(0, 10);
      }
    }

    // Mileage (optional)
    const mileage = $card.find(".auctions-completed-mileage").first().text().trim() || null;

    results.push({ soldPriceUsd, soldDate, mileage, reserveMet, listingUrl, title });
  });

  return results;
}
