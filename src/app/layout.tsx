import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { FirstVisitDisclaimer } from "@/components/layout/first-visit-disclaimer";

export const metadata: Metadata = {
  title: {
    default: "CarClubFuture — Collector Car Forecasting",
    template: "%s · CarClubFuture",
  },
  description:
    "Buy / Hold / Sell signals, 5-year value forecasts, and ROI calculators for collectible and classic cars.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <FirstVisitDisclaimer />
        <Header />
        <main className="min-h-[calc(100vh-8rem)]">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
