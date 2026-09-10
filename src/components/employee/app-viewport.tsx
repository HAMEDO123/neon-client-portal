"use client";

import { useEffect } from "react";
import { measureViewport } from "@/lib/viewport";
import { ViewportReadout } from "@/components/viewport-readout";

// Keeps the portal's frame exactly over the part of the screen you can see.
//
// iOS does not shrink the page for the keyboard: it slides a window over a
// full-height page. The frame takes that window's height and top, so its
// bottom is always the top of the keyboard or the bottom of what can be seen.
//
// In a Home Screen app that window can stop short of the bottom of the screen,
// and nothing fixed is drawn below it — so the frame stops there too. The full
// screen is measured as well, with CSS, only to know how far short: the
// frame's last row then keeps no room for a home indicator it does not reach
// (--screen-shortfall). Only in a Home Screen app: in a browser tab the
// toolbars cover the bottom, and the window's end is the end.
//
// The arithmetic lives in lib/viewport.ts, where it is tested; this only
// listens to the browser and writes the answer down.

function standalone() {
  const displayMode = window.matchMedia?.("(display-mode: standalone)").matches === true;
  const legacy = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return displayMode || legacy;
}

export function AppViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;

    // A box exactly the height of the whole screen, as CSS sees it.
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:100vh;visibility:hidden;pointer-events:none;";
    document.body.appendChild(probe);

    // The tallest the visible area has been in this orientation: what the
    // screen looks like with no keyboard.
    let baseline = 0;
    let frame = 0;

    function apply() {
      frame = 0;
      const state = measureViewport(
        {
          height: viewport?.height ?? window.innerHeight,
          offsetTop: viewport?.offsetTop ?? 0,
          fullHeight: standalone() ? probe.getBoundingClientRect().height : undefined,
        },
        baseline
      );
      baseline = state.baseline;

      root.style.setProperty("--app-height", `${state.appHeight}px`);
      root.style.setProperty("--app-top", `${state.appTop}px`);
      root.style.setProperty("--keyboard-inset", `${state.keyboardHeight}px`);
      root.style.setProperty("--screen-shortfall", `${state.shortfall}px`);
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
      probe.remove();
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--app-top");
      root.style.removeProperty("--keyboard-inset");
      root.style.removeProperty("--screen-shortfall");
      delete document.body.dataset.keyboard;
    };
  }, []);

  // The numbers this works from, on screen, when switched on for this device.
  return <ViewportReadout />;
}
