// The part of the screen you can actually see, measured the way iOS behaves.
//
// iOS never shrinks the page for the keyboard. It keeps the page full height
// and moves a window over it — the visual viewport — which gets shorter when
// the keyboard comes up and slides down (offsetTop) when iOS scrolls a focused
// field into view. Anything positioned against the page is positioned against
// the wrong thing: the chat's text box went up and out of sight because the
// frame stayed where the page was while the window slid away beneath it.
//
// So the app frame takes its height *and* its top from that window, always.
// And the keyboard is judged against the tallest the window has been in this
// orientation — the screen with nothing covering it — rather than against
// window.innerHeight, which a Home Screen app on iOS reports inconsistently.
//
// Pure: the component that listens to the browser feeds it readings, the
// tests feed it numbers.

export type ViewportReading = {
  /** visualViewport.height — how much of the screen is visible. */
  height: number;
  /** visualViewport.offsetTop — how far iOS has slid the window down the page. */
  offsetTop: number;
};

export type ViewportState = {
  /** The tallest the visible area has been in this orientation. */
  baseline: number;
  appHeight: number;
  appTop: number;
  keyboardOpen: boolean;
  keyboardHeight: number;
};

/** Anything less than this is a toolbar collapsing, not a keyboard. */
export const KEYBOARD_THRESHOLD = 150;

export function measureViewport(reading: ViewportReading, previousBaseline: number): ViewportState {
  const height = Math.max(0, Math.round(reading.height));
  const baseline = Math.max(previousBaseline, height);
  const covered = baseline - height;
  const keyboardOpen = covered > KEYBOARD_THRESHOLD;

  return {
    baseline,
    appHeight: height,
    // Followed whether or not the keyboard is up. When iOS slides the window
    // and then forgets to slide it back, a frame pinned to the top of the page
    // is left with its bottom — the tab bar — floating up the screen by
    // exactly that much. Following the window keeps the bottom at the bottom.
    appTop: Math.max(0, Math.round(reading.offsetTop)),
    keyboardOpen,
    keyboardHeight: keyboardOpen ? covered : 0,
  };
}
