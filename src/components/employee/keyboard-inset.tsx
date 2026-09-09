"use client";

import { useEffect } from "react";

// Tells the layout how much of the screen the on-screen keyboard is covering.
//
// On iOS the page does not shrink when the keyboard opens — it stays full
// height and the whole document is scrolled up instead, which is why a fixed
// bottom bar ends up floating above the keyboard with the page pushed out from
// under it. The visual viewport API is the one thing that reports the real
// visible area, so the keyboard's height is written to a CSS variable and the
// chat screen sizes itself against that.
//
// It also marks the body while the keyboard is open, which is what hides the
// tab bar: five destinations are not worth the room when someone is mid-word.

export function KeyboardInset() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const root = document.documentElement;

    function update() {
      if (!viewport) return;
      // What the keyboard covers: the window height minus what is still
      // visible, allowing for the page being scrolled up underneath.
      const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      // Small values are the address bar collapsing, not a keyboard.
      const keyboard = covered > 120 ? covered : 0;

      root.style.setProperty("--keyboard-inset", `${Math.round(keyboard)}px`);
      document.body.dataset.keyboard = keyboard > 0 ? "open" : "closed";
    }

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);

    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      root.style.removeProperty("--keyboard-inset");
      delete document.body.dataset.keyboard;
    };
  }, []);

  return null;
}
