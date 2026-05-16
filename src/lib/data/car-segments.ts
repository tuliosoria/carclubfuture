import type { Era, Segment } from "@/lib/types/cars";

export interface SegmentDescriptor {
  id: Segment;
  name: string;
  shortName: string;
  description: string;
  /** Tailwind color token (used for chips/badges). */
  accentColor: string;
  eras: Era[];
}

export const SEGMENTS: readonly SegmentDescriptor[] = [
  {
    id: "blue-chip",
    name: "Blue Chip Classics",
    shortName: "Blue Chip",
    description: "Investment-grade icons with deep auction histories.",
    accentColor: "bg-papaya/20 text-papaya",
    eras: ["pre-war", "post-war-classic"],
  },
  {
    id: "american-muscle",
    name: "American Muscle",
    shortName: "Muscle",
    description: "Detroit V8 performance from the late 60s and early 70s.",
    accentColor: "bg-red-500/20 text-red-300",
    eras: ["muscle-era"],
  },
  {
    id: "affordable-classics",
    name: "Affordable Classics",
    shortName: "Affordable",
    description: "Entry-level collector cars under ~$30k.",
    accentColor: "bg-emerald-500/20 text-emerald-300",
    eras: ["malaise", "modern-classic"],
  },
  {
    id: "german-sport",
    name: "German Sport",
    shortName: "German",
    description: "Porsche, BMW M, Mercedes AMG performance heritage.",
    accentColor: "bg-slate-400/20 text-slate-200",
    eras: ["modern-classic", "modern-collectible"],
  },
  {
    id: "japanese-icons",
    name: "Japanese Icons",
    shortName: "JDM",
    description: "Skyline GT-R, Supra, NSX, RX-7 era performance.",
    accentColor: "bg-rose-500/20 text-rose-300",
    eras: ["modern-classic", "modern-collectible"],
  },
  {
    id: "british-classic",
    name: "British Classic",
    shortName: "British",
    description: "Jaguar, Aston, Triumph, MG craftsmanship.",
    accentColor: "bg-green-500/20 text-green-300",
    eras: ["post-war-classic", "modern-classic"],
  },
  {
    id: "modern-collectible",
    name: "Modern Collectible",
    shortName: "Modern",
    description: "Limited-run modern performance (2010+) showing collector demand.",
    accentColor: "bg-indigo-500/20 text-indigo-300",
    eras: ["modern-collectible"],
  },
  {
    id: "ferrari-italian",
    name: "Ferrari & Italian",
    shortName: "Italian",
    description: "Ferrari, Lamborghini, Maserati exotics.",
    accentColor: "bg-red-600/20 text-red-200",
    eras: ["post-war-classic", "modern-classic", "modern-collectible"],
  },
];

export const ERA_DESCRIPTORS: Record<Era, { label: string; range: string }> = {
  "pre-war": { label: "Pre-War", range: "before 1942" },
  "post-war-classic": { label: "Post-War Classic", range: "1946–1964" },
  "muscle-era": { label: "Muscle Era", range: "1964–1973" },
  malaise: { label: "Malaise Era", range: "1974–1989" },
  "modern-classic": { label: "Modern Classic", range: "1990–2010" },
  "modern-collectible": { label: "Modern Collectible", range: "2010+" },
};

export function getSegment(id: Segment): SegmentDescriptor {
  const found = SEGMENTS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown segment: ${id}`);
  return found;
}

export function eraForYear(year: number): Era {
  if (year < 1946) return "pre-war";
  if (year < 1965) return "post-war-classic";
  if (year < 1974) return "muscle-era";
  if (year < 1990) return "malaise";
  if (year < 2010) return "modern-classic";
  return "modern-collectible";
}
