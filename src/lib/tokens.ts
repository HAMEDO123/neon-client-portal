import crypto from "crypto";

// Produces links like /p/villa-al-fulan-2026-x7k92 — readable, but not guessable
// (the random suffix carries all the entropy; the slug is cosmetic only).
export function generateProjectToken(name: string) {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const year = new Date().getFullYear();
  const random = crypto.randomBytes(5).toString("hex");
  return [slug || "project", year, random].join("-");
}
