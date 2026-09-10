"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

// The screen's real measurements, written on the screen.
//
// Every phone reports its visible area, its keyboard and its safe areas a
// little differently, and a fix made from a screenshot is a guess about which
// number was wrong. This shows the numbers themselves. Hidden unless switched
// on for this device — five quick taps on a chat's picture — so nobody sees it
// by accident; the same taps switch it off.

const KEY = "neon:readout";
const CHANGED = "neon:readout-changed";
const TAPS = 5;
const TAP_WINDOW_MS = 2000;

function readoutOn() {
  try {
    return window.localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function toggleReadout() {
  try {
    if (readoutOn()) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, "on");
  } catch {
    // Private browsing: nothing to remember it in.
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  return () => window.removeEventListener(CHANGED, onChange);
}

// A box sized by a CSS length, so the browser's own idea of that length can be read back.
function measure(css: string, property: "height" | "paddingTop" | "paddingBottom") {
  const probe = document.createElement("div");
  probe.style.cssText = `position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;${css}`;
  document.body.appendChild(probe);
  const value =
    property === "height" ? probe.getBoundingClientRect().height : parseFloat(getComputedStyle(probe)[property]);
  probe.remove();
  return Math.round(value);
}

function rect(selector: string) {
  const element = document.querySelector(selector);
  if (!element) return "–";
  const box = element.getBoundingClientRect();
  return `${Math.round(box.top)}→${Math.round(box.bottom)}`;
}

function snapshot() {
  const viewport = window.visualViewport;
  const root = getComputedStyle(document.documentElement);
  const ios = navigator.userAgent.match(/OS (\d+)_(\d+)/);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  return [
    `iOS ${ios ? `${ios[1]}.${ios[2]}` : "?"} · ${standalone ? "home screen" : "browser"}`,
    `visual ${Math.round(viewport?.height ?? 0)} top ${Math.round(viewport?.offsetTop ?? 0)}`,
    `inner ${window.innerHeight} outer ${window.outerHeight} client ${document.documentElement.clientHeight} scrollY ${Math.round(window.scrollY)}`,
    `vh ${measure("height:100vh", "height")} svh ${measure("height:100svh", "height")} lvh ${measure("height:100lvh", "height")} dvh ${measure("height:100dvh", "height")}`,
    `screen ${screen.width}×${screen.height}`,
    `safe top ${measure("padding-top:env(safe-area-inset-top)", "paddingTop")} bottom ${measure("padding-bottom:env(safe-area-inset-bottom)", "paddingBottom")}`,
    `app h ${root.getPropertyValue("--app-height").trim()} top ${root.getPropertyValue("--app-top").trim()} kb ${document.body.dataset.keyboard ?? "–"}`,
    `frame ${rect(".employee-shell, .admin-shell")}`,
    `composer ${rect(".chat-composer")}`,
  ].join("\n");
}

export function ViewportReadout() {
  const on = useSyncExternalStore(subscribe, readoutOn, () => false);
  const [text, setText] = useState("");

  useEffect(() => {
    if (!on) return;
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setText(snapshot());
      });
    };

    update();
    const timer = window.setInterval(update, 500);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);

    return () => {
      window.clearInterval(timer);
      if (frame) cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, [on]);

  if (!on) return null;

  return (
    <pre
      aria-hidden
      className="pointer-events-none fixed left-1 z-[9999] whitespace-pre rounded bg-black/75 px-1.5 py-1 font-mono text-[10px] leading-tight text-white"
      style={{ top: "calc(env(safe-area-inset-top) + 64px)" }}
    >
      {text}
    </pre>
  );
}

/** Five quick taps on what this wraps switch the readout on or off, on this device only. */
export function ReadoutTaps({ children }: { children: ReactNode }) {
  const taps = useRef<number[]>([]);

  function tap() {
    const now = Date.now();
    taps.current = [...taps.current.filter((at) => now - at < TAP_WINDOW_MS), now];
    if (taps.current.length < TAPS) return;
    taps.current = [];
    toggleReadout();
  }

  return (
    <span className="contents" onClick={tap}>
      {children}
    </span>
  );
}
