// The part of the screen you can actually see, measured the way iOS behaves.
//
// iOS never shrinks the page for the keyboard. It keeps the page full height
// and moves a window over it — the visual viewport — which gets shorter when
// the keyboard comes up and slides down (offsetTop) when iOS scrolls a focused
// field into view. So the app frame takes its height and its top from that
// window, always.
//
// One correction on top. A Home Screen app on an iPhone draws under the status
// bar, yet reports the window's height as if it did not: it comes back short
// by exactly the status bar, and a frame that trusts it ends that far above
// the bottom of the screen — the empty band under the tab bar. The shortfall
// is the full screen's height less the tallest the window has been, and it is
// added back while the keyboard is down. With the keyboard up, the window
// above it is reported as it is; adding the status bar there as well put the
// bottom of the frame — the message box — that far under the keyboard.
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
  /** How much the window under-reports with the keyboard down. */
  deficit: number;
  appHeight: number;
  appTop: number;
  keyboardOpen: boolean;
  keyboardHeight: number;
};

/** Anything less than this is a toolbar collapsing, not a keyboard. */
export const KEYBOARD_THRESHOLD = 150;

/** Taller than any status bar. A gap larger than this is not the one being corrected. */
export const MAX_DEFICIT = 120;

export function measureViewport(reading: ViewportReading, previousBaseline: number): ViewportState {
  const height = Math.max(0, Math.round(reading.height));
  const baseline = Math.max(previousBaseline, height);
  const covered = baseline - height;
  const keyboardOpen = covered > KEYBOARD_THRESHOLD;

  // Measured against the tallest the window has been, not against its current
  // height, so a keyboard opening never looks like a bigger shortfall.
  const full = reading.fullHeight ? Math.round(reading.fullHeight) : 0;
  const deficit = full ? Math.min(MAX_DEFICIT, Math.max(0, full - baseline)) : 0;

  return {
    baseline,
    deficit,
    // The frame ends at the top of the keyboard when it is up, and at the
    // bottom of the screen when it is down.
    appHeight: keyboardOpen ? height : height + deficit,
    // Followed whether or not the keyboard is up: when iOS slides the window
    // and forgets to slide it back, following it keeps the frame's bottom — the
    // tab bar — at the bottom of the screen.
    appTop: Math.max(0, Math.round(reading.offsetTop)),
    keyboardOpen,
    keyboardHeight: keyboardOpen ? covered : 0,
  };
}
