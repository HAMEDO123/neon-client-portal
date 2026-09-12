/**
 * Where a floating panel goes, given the button that opened it.
 *
 * Pure on purpose. The board's scheduling editor is far taller than the cell
 * that opens it, the board sits low on the page, and getting this wrong has
 * already meant a Save button hanging off the bottom of the window. Deciding
 * it here means it can be checked without a browser.
 *
 * Two promises the caller relies on: the panel stays inside the window, and
 * its height is always capped — so when the form is taller than the room it
 * has, it scrolls inside itself instead of running off the screen.
 */

/** How clear of the window's own edges a panel stays. */
export const MARGIN = 8;
/** Between the trigger and the panel. */
export const GAP = 4;
/** However cramped the window, a panel never shrinks below this — it scrolls. */
export const MIN_PANEL_HEIGHT = 200;

export type PanelPlacement = { left: number; top: number; maxHeight: number };

export type PlacementInput = {
  /** The trigger's box, in window coordinates. */
  trigger: { top: number; bottom: number; left: number; width: number };
  /** The panel's width, and the height it wants with nothing capping it. */
  panel: { width: number; height: number };
  viewport: { width: number; height: number };
  /** Which edge of the panel lines up with the trigger. */
  align: "start" | "center" | "end";
};

export function placePanel({ trigger, panel, viewport, align }: PlacementInput): PanelPlacement {
  const offset =
    align === "end" ? trigger.width - panel.width : align === "center" ? (trigger.width - panel.width) / 2 : 0;

  // Lined up with the trigger, then pushed back inside the window.
  const left = Math.max(MARGIN, Math.min(trigger.left + offset, viewport.width - panel.width - MARGIN));

  // The room each way, counting the gap and the window's margin.
  const below = viewport.height - MARGIN - (trigger.bottom + GAP);
  const above = trigger.top - GAP - MARGIN;

  // Hangs below by preference: that is where the eye already is.
  if (panel.height <= below) {
    return { left, top: trigger.bottom + GAP, maxHeight: below };
  }

  // Above, it is hung by its own height rather than given the whole room —
  // the room is measured upwards from the trigger, and handing that to a panel
  // that starts higher up would let it run off the bottom of the window.
  if (panel.height <= above) {
    return { left, top: trigger.top - GAP - panel.height, maxHeight: panel.height };
  }

  // Neither side fits it whole, so it takes the roomier one and scrolls —
  // as long as that side is worth using at all.
  const roomier = Math.max(below, above);
  if (roomier >= MIN_PANEL_HEIGHT) {
    return below >= above
      ? { left, top: trigger.bottom + GAP, maxHeight: below }
      : { left, top: MARGIN, maxHeight: above };
  }

  // A trigger in the middle of a short window has room nowhere. Cover the
  // window rather than squeeze into a strip: the panel is the task now.
  return { left, top: MARGIN, maxHeight: Math.max(0, viewport.height - MARGIN * 2) };
}
