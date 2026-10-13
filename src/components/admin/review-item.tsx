"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

// One piece of work in the review queue, which leaves the screen the moment it
// is answered.
//
// Approving used to hold its card, spinner turning, until the server had
// written the answer, told the person's phone and redrawn the page — and a
// page runs its server actions one at a time, so five approvals pressed in a
// row were five waits end to end. The answer is the manager's the moment they
// give it: the card goes at once, and comes back saying why only if the server
// refused it.

const ReviewItemContext = createContext<{ leave: () => void; comeBack: () => void } | null>(null);

export function ReviewItem({ className, children }: { className?: string; children: React.ReactNode }) {
  const [gone, setGone] = useState(false);
  const value = useMemo(() => ({ leave: () => setGone(true), comeBack: () => setGone(false) }), []);

  return (
    <ReviewItemContext.Provider value={value}>
      <li className={cn(className, gone && "hidden")}>{children}</li>
    </ReviewItemContext.Provider>
  );
}

/** Null outside a queue item, where there is no card to take away. */
export function useReviewItem() {
  return useContext(ReviewItemContext);
}
