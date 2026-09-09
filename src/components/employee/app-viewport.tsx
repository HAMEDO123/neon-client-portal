"use client";

import { useEffect } from "react";

// Makes the portal exactly as tall as the part of the screen you can actually
// see, and says whether the keyboard is up.
//
// This is the whole fix for the tab bar riding up with the keyboard. iOS does
// not shrink the page when the keyboard opens: the page stays full height and
// the document is scrolled up underneath, so a bar pinned to the bottom of the
// page is pinned to a bottom that is now behind the keyboard — and `position:
// fixed` follows the layout viewport, not the visible one, so it travels with
// it. Hiding the bar was treating the symptom.
//
// The visual viewport is the only thing that reports the visible area
// honestly. Writing its height into a variable, and sizing the shell against
// that, means the portal is never taller than what the eye can see: nothing
// can scroll under the keyboard, because there is nothing under it.

export function AppViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;

    function update() {
      const visible = viewport?.height ?? window.innerHeight;
      // Anything smaller than this is the address bar collapsing, not a
      // keyboard.
      const covered = Math.max(0, window.innerHeight - visible);
      const keyboardOpen = covered > 120;

      root.style.setProperty("--app-height", `${Math.round(visible)}px`);
      root.style.setProperty("--keyboard-inset", `${keyboardOpen ? Math.round(covered) : 0}px`);
      document.body.dataset.keyboard = keyboardOpen ? "open" : "closed";

      // iOS may have scrolled the document to make room. With the shell
      // sized to the visible area there is nothing to scroll to, so put it
      // back rather than leaving the header off the top of the screen.
      if (keyboardOpen && window.scrollY !== 0) window.scrollTo(0, 0);
    }

    update();

    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("orientationchange", update);

    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("orientationchange", update);
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--keyboard-inset");
      delete document.body.dataset.keyboard;
    };
  }, []);

  return null;
}
