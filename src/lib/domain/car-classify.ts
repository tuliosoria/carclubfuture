/**
 * Deterministic backfill of segment + bodyStyle for catalog rows that came
 * from the NHTSA bulk ingest (where neither field is populated). Only fires
 * when the catalog row's field is null, so curated seed rows are untouched.
 *
 * Honest classification only — when we can't infer with high confidence,
 * we leave the field null so the UI can surface "unclassified" honestly.
 */
import type { BodyStyle, Segment } from "@/lib/types/cars";

const ITALIAN = new Set([
  "ferrari", "lamborghini", "maserati", "pagani", "bugatti", "de tomaso",
  "alfa romeo", "lancia", "fiat", "abarth", "iso",
]);
const GERMAN = new Set([
  "porsche", "bmw", "mercedes-benz", "mercedes", "audi", "volkswagen", "vw",
  "opel", "amg", "alpina",
]);
const JAPANESE = new Set([
  "honda", "acura", "toyota", "lexus", "nissan", "datsun", "infiniti",
  "mazda", "subaru", "mitsubishi", "suzuki", "isuzu",
]);
const BRITISH = new Set([
  "aston martin", "bentley", "rolls-royce", "jaguar", "lotus", "mclaren",
  "mg", "triumph", "morgan", "mini", "austin", "austin-healey", "daimler",
  "healey", "tvr", "rover", "land rover", "ac",
]);
const AMERICAN = new Set([
  "chevrolet", "chevy", "pontiac", "oldsmobile", "buick", "cadillac",
  "ford", "mercury", "lincoln", "dodge", "plymouth", "chrysler", "amc",
  "american motors", "shelby", "studebaker", "hudson", "packard", "nash",
]);

export function inferSegment(make: string, year: number): Segment | null {
  const m = make.trim().toLowerCase();
  if (ITALIAN.has(m)) return "ferrari-italian";
  if (GERMAN.has(m)) return "german-sport";
  if (JAPANESE.has(m)) return "japanese-icons";
  if (BRITISH.has(m)) return "british-classic";
  if (AMERICAN.has(m)) {
    if (year >= 1964 && year <= 1974) return "american-muscle";
    if (year >= 1990) return "modern-collectible";
    return "affordable-classics";
  }
  return null;
}

const BODY_PATTERNS: Array<{ re: RegExp; body: BodyStyle }> = [
  { re: /\b(convertible|cabriolet|cabrio|spider|spyder|roadster|targa)\b/i, body: "convertible" },
  { re: /\b(coupe|coup[eé]|fastback|hardtop)\b/i, body: "coupe" },
  { re: /\b(wagon|estate|avant|touring|shooting brake)\b/i, body: "wagon" },
  { re: /\b(pickup|f-?150|f-?250|f-?350|silverado|sierra|ram|tundra|titan|ranger|colorado|tacoma|frontier|ridgeline)\b/i, body: "truck" },
  { re: /\b(suv|tahoe|suburban|bronco|wrangler|cherokee|expedition|navigator|escalade|range rover|defender|land cruiser|4runner|pathfinder|explorer|blazer|trailblazer|durango|sequoia|armada|qx|gx|lx|x5|x7|q7|gle|gls|cayenne|macan|touareg)\b/i, body: "suv" },
  { re: /\b(sedan|saloon)\b/i, body: "sedan" },
];

export function inferBodyStyle(model: string): BodyStyle | null {
  if (!model) return null;
  for (const { re, body } of BODY_PATTERNS) {
    if (re.test(model)) return body;
  }
  return null;
}
