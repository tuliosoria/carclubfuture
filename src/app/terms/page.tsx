import { legalConfig } from "@/lib/legal-config";

export const metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 prose prose-invert">
      <h1>Terms of Service</h1>
      <p>
        CarClubFuture provides statistical estimates of collector car values for
        informational purposes only. Forecasts are not financial advice and may be wrong.
      </p>
      <h2>Use at your own risk</h2>
      <p>
        Decisions to buy, hold, or sell a vehicle are yours alone. {legalConfig.operatorName}
        disclaims liability for any losses arising from use of the site.
      </p>
      <h2>Contact</h2>
      <p>
        Questions:{" "}
        <a href={`mailto:${legalConfig.contactEmail}`}>{legalConfig.contactEmail}</a>.
      </p>
    </div>
  );
}
