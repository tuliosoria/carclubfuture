import Link from "next/link";
import { Gauge } from "lucide-react";

const navItems = [
  { href: "/car-forecast", label: "Catalog" },
  { href: "/market-index", label: "Market Index" },
  { href: "/calculator", label: "Calculator" },
  { href: "/car-forecast/methodology", label: "Methodology" },
];

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 text-foreground">
          <Gauge className="h-5 w-5 text-accent" />
          <span className="text-base font-semibold tracking-tight">CarClubFuture</span>
        </Link>
        <nav className="hidden items-center gap-6 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-muted-foreground transition hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <Link
          href="/car-forecast"
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          Browse
        </Link>
      </div>
    </header>
  );
}
