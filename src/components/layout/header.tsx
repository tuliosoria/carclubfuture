import Link from "next/link";

const navItems = [
  { href: "/car-forecast", label: "Catalog" },
  { href: "/market-index", label: "Market Index" },
  { href: "/calculator", label: "Calculator" },
  { href: "/car-forecast/methodology", label: "Methodology" },
];

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background">
      <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between px-4 sm:px-8">
        <Link
          href="/"
          className="font-display text-xl sm:text-2xl font-bold uppercase tracking-tight text-foreground"
        >
          CARCLUB<span className="text-papaya">FUTURE</span>
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-meta uppercase tracking-[0.04em] text-foreground transition-colors duration-150 ease-out hover:text-papaya"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <Link
          href="/car-forecast"
          className="rounded-sm bg-papaya px-4 py-2 text-meta font-semibold uppercase tracking-[0.04em] text-papaya-foreground transition-colors duration-150 ease-out hover:bg-papaya-hover active:bg-papaya-press"
        >
          Browse
        </Link>
      </div>
    </header>
  );
}
