/**
 * Reads LEGAL_* env vars at module load and exposes a typed config used by
 * the legal pages and footer. Defaults are safe placeholders so the site
 * boots locally with zero env wiring.
 */

export interface LegalConfig {
  operatorName: string;
  contactEmail: string;
  privacyEmail: string;
  businessAddress: string;
  contactUrl: string | null;
}

function read(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

export const legalConfig: LegalConfig = {
  operatorName: read("LEGAL_OPERATOR_NAME", "CarClubFuture"),
  contactEmail: read("LEGAL_CONTACT_EMAIL", "hello@carclubfuture.com"),
  privacyEmail: read("PRIVACY_REQUEST_EMAIL", "privacy@carclubfuture.com"),
  businessAddress: read("LEGAL_BUSINESS_ADDRESS"),
  contactUrl: read("LEGAL_CONTACT_URL") || null,
};
