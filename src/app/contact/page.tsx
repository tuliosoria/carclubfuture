import { legalConfig } from "@/lib/legal-config";

export const metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold text-foreground">Contact</h1>
      <p className="mt-4 text-muted-foreground">
        Reach the CarClubFuture team at{" "}
        <a href={`mailto:${legalConfig.contactEmail}`} className="text-accent hover:underline">
          {legalConfig.contactEmail}
        </a>
        .
      </p>
      {legalConfig.contactUrl ? (
        <p className="mt-3 text-muted-foreground">
          Or use our{" "}
          <a href={legalConfig.contactUrl} className="text-accent hover:underline">
            contact form
          </a>
          .
        </p>
      ) : null}
      {legalConfig.businessAddress ? (
        <address className="mt-6 not-italic text-sm text-muted-foreground">
          {legalConfig.businessAddress}
        </address>
      ) : null}
    </div>
  );
}
