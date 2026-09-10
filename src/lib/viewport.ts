// The part of the screen you can actually see, measured the way iOS behaves.
//
// iOS never shrinks the page for the keyboard. It keeps the page full height
// and moves a window over it — the visual viewport — which gets shorter when
// the keyboard comes up and slides down (offsetTop) when iOS scrolls a focused
// field into view. So the app frame takes its height and its top from that
// window, always, and never runs past it.
//
// Never past it, even where the window stops short of the bottom of the
// screen. A Home Screen app on iOS 26 does that: the window comes back a
// status bar's height short, and nothing fixed to it is drawn below that line.
// A frame stretched to the full screen had its bottom row — the message box —
// cut off by a blank band there. The gap is still measured, for one thing: the
// frame's last row then stops that far above the home indicator, and needs no
// room kept for it.
//
// Pure: the component that listens to the browser feeds it readings, the
// tests feed it numbers.

export type ViewportReading = {
  /** visualViewport.height — how much of the screen is visible. */
  height: number;
  /** visualViewport.offsetTop — how far iOS has slid the window down the page. */
  offsetTop: number;
  /**
   * The whole screen's height, measured with CSS, in a Home Screen app only.
   * Omitted in a browser tab, whose toolbars really do cover part of it.
   */
  fullHeight?: number;
};

export type ViewportState = {
  /** The tallest the visible area has been in this orientation. */
  baseline: number;
  /** How far above the bottom of the screen the window stops with the keyboard down. */
  shortfall: number;
  appHeight: number;
  appTop: number;
  keyboardOpen: boolean;
  keyboardHeight: number;
};

/** Anything less than this is a toolbar collapsing, not a keyboard. */
export const KEYBOARD_THRESHOLD = 150;

/** Taller than any status bar. A gap larger than this is not the one being measured. */
export const MAX_SHORTFALL = 120;

export function measureViewport(reading: ViewportReading, previousBaseline: number): ViewportState {
  const height = Math.max(0, Math.round(reading.height));
  const baseline = Math.max(previousBaseline, height);
  const covered = baseline - height;
  const keyboardOpen = covered > KEYBOARD_THRESHOLD;

  // Measured against the tallest the window has been, not against its current
  // height, so a keyboard opening never looks like a bigger gap.
  const full = reading.fullHeight ? Math.round(reading.fullHeight) : 0;
  const shortfall = full ? Math.min(MAX_SHORTFALL, Math.max(0, full - baseline)) : 0;

  return {
    baseline,
    shortfall,
    // The frame ends where the window does: at the top of the keyboard when it
    // is up, at the bottom of what can be seen when it is down.
    appHeight: height,
    // Followed whether or not the keyboard is up: when iOS slides the window
    // and forgets to slide it back, following it keeps the frame's bottom — the
    // tab bar — at the bottom of what can be seen.
    appTop: Math.max(0, Math.round(reading.offsetTop)),
    keyboardOpen,
    keyboardHeight: keyboardOpen ? covered : 0,
  };
}
