import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, parseISO } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Session dates are plain YYYY-MM-DD strings in club local time. */
export const toDate = (iso: string) => parseISO(iso);
export const isoDay = (date: Date) => format(date, "yyyy-MM-dd");
export const fmt = (iso: string, pattern: string) => format(parseISO(iso), pattern);

export function courtsLabel(courtNumbers: string | null | undefined) {
  if (!courtNumbers) return null;
  const parts = courtNumbers.split(/[,\s/]+/).filter(Boolean);
  return `${parts.length > 1 ? "Courts" : "Court"} ${parts.join(", ")}`;
}

export function maskCard(card: string | null | undefined) {
  if (!card) return "";
  const clean = card.replace(/\s+/g, "");
  return clean.length <= 4 ? clean : `•••• ${clean.slice(-4)}`;
}

export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}
