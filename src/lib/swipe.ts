// Reading a finger on a phone as a swipe, for the photo viewer (components/client/lightbox.tsx).

/**
 * A swipe, on a phone: far enough sideways, and more sideways than up or down,
 * so scrolling a caption or a slow tap is not taken for one (2026-11-25: "on the
 * phone let me scroll through the photos by swiping").
 */
export const SWIPE_PX = 50;

export function swipeOf(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  // The finger moving left brings the next picture in from the right.
  return dx < 0 ? 1 : -1;
}
