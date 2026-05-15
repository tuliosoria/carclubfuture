import { legalConfig } from "@/lib/legal-config";

export const metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 prose prose-invert">
      <h1>Privacy Policy</h1>
      <p>
        {legalConfig.operatorName} (&quot;we&quot;) operates CarClubFuture. This page summarizes how we
        collect and use information.
      </p>
      <h2>Information we collect</h2>
      <p>
        We collect minimal analytics about page views and search queries. We do not sell or
        share personal data with third parties.
      </p>
      <h2>Cookies</h2>
      <p>
        We use a single first-party cookie / localStorage entry to remember that you have
        dismissed the disclaimer banner.
      </p>
      <h2>Contact</h2>
      <p>
        Privacy questions:{" "}
        <a href={`mailto:${legalConfig.privacyEmail}`}>{legalConfig.privacyEmail}</a>.
      </p>
    </div>
  );
}
