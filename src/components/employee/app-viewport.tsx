"use client";

import { useEffect } from "react";
import { measureViewport } from "@/lib/viewport";

// Keeps the portal's frame exactly over the part of the screen you can see.
//
// iOS does not shrink the page for the keyboard: it slides a window over a
// full-height page, and when a text field is tapped it slides that window down
// to show it. A frame positioned against the page therefore ends up somewhere
// the eye is not — the chat's text box went up and out of view, and the tab bar
// was left floating up the screen when iOS forgot to slide back. The window's
// height and its top both go into variables the frame is laid out against, so
// the bottom of the frame is always the top of the keyboard, or the bottom of
// the screen.
//
// The arithmetic lives in lib/viewport.ts, where it is tested; this only
// listens to the browser and writes the answer down.

export function AppViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;

    // The tallest the visible area has been in this orientation: what the
    // screen looks like with no keyboard. Learnt, rather than read from
    // window.innerHeight, which iOS reports inconsistently in Home Screen apps.
    let baseline = 0;
    let frame = 0;

    function apply() {
      frame = 0;
      const state = measureViewport(
        { height: viewport?.height ?? window.innerHeight, offsetTop: viewport?.offsetTop ?? 0 },
        baseline
      );
      baseline = state.baseline;

      root.style.setProperty("--app-height", `${state.appHeight}px`);
      root.style.setProperty("--app-top", `${state.appTop}px`);
      root.style.setProperty("--keyboard-inset", `${state.keyboardHeight}px`);
      document.body.dataset.keyboard = state.keyboardOpen ? "open" : "closed";
    }

    // iOS fires these continuously while the keyboard slides; once a frame is
    // all the layout can use anyway.
    function schedule() {
      if (!frame) frame = requestAnimationFrame(apply);
    }

    function typing() {
      const active = document.activeElement;
      return (
        active instanceof HTMLElement &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)
      );
    }

    // The keyboard going away is when iOS forgets to undo its scroll. Once it
    // has finished animating, put the page back and measure again — unless
    // focus simply moved to another field and the keyboard is staying.
    let settleTimer = 0;
    function settle() {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        if (!typing()) window.scrollTo(0, 0);
        schedule();
      }, 300);
    }

    // A new orientation is a new screen: forget the old full height.
    function reorient() {
      baseline = 0;
      schedule();
    }

    apply();

    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", reorient);
    document.addEventListener("focusout", settle);
    // Coming back to the app can bring sizes from before it went away.
    window.addEventListener("pageshow", schedule);
    document.addEventListener("visibilitychange", schedule);

    return () => {
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", reorient);
      document.removeEventListener("focusout", settle);
      window.removeEventListener("pageshow", schedule);
      document.removeEventListener("visibilitychange", schedule);
      window.clearTimeout(settleTimer);
      if (frame) cancelAnimationFrame(frame);
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--app-top");
      root.style.removeProperty("--keyboard-inset");
      delete document.body.dataset.keyboard;
    };
  }, []);

  return null;
}
