"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// On a desk the chat is three panels — the list, a conversation and its tiles
// (design 2, 2026-11-19) — and a bare list filling the screen was read as
// "the chat did not change". So the chat page opens the newest conversation
// there, in place of itself; a phone keeps the list, WhatsApp-style.
//
// Decided in the browser because only the browser knows how wide it is. The
// page hides its list from lg up meanwhile, so the desk never flashes it.

export function OpenOnDesk({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) router.replace(href);
  }, [href, router]);
  return null;
}
