import { legalConfig } from "@/lib/legal-config";

export const metadata = { title: "Privacy Rights" };

export default function PrivacyRightsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 prose prose-invert">
      <h1>Your Privacy Rights</h1>
      <p>
        Depending on your jurisdiction (e.g. California / CCPA, EU / GDPR), you may have
        the right to access, correct, or delete personal data we hold about you, and to
        opt out of certain processing.
      </p>
      <p>
        To exercise these rights, email{" "}
        <a href={`mailto:${legalConfig.privacyEmail}`}>{legalConfig.privacyEmail}</a>. We
        respond within 30 days.
      </p>
    </div>
  );
}
