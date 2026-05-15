import Link from "next/link";
import { legalConfig } from "@/lib/legal-config";

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {year} {legalConfig.operatorName}. Forecasts are estimates, not financial advice.
        </p>
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/car-forecast/methodology" className="hover:text-foreground">Methodology</Link>
          <Link href="/contact" className="hover:text-foreground">Contact</Link>
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link href="/privacy-rights" className="hover:text-foreground">Privacy Rights</Link>
          <Link href="/terms" className="hover:text-foreground">Terms</Link>
        </nav>
      </div>
    </footer>
  );
}
