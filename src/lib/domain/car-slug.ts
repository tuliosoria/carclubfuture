import { slugify } from "@/lib/utils/string";

export function carSlug(year: number, make: string, model: string, trim?: string | null): string {
  const parts = [year, make, model];
  if (trim) parts.push(trim);
  return slugify(parts.join(" "));
}
