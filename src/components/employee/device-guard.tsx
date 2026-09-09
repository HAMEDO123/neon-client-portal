"use client";

import { useEffect } from "react";
import { claimDevice } from "@/lib/actions/device-actions";
import { currentSubscription } from "@/lib/push-client";

// Makes this device belong to whoever is signed in on it.
//
// Renders nothing. A push subscription lives in the browser and outlives the
// session, so without this a phone keeps delivering the previous person's
// notifications to the person now holding it. Running on every load of the
// portal means the row can never be more than one page-load out of date.
export function DeviceGuard() {
  useEffect(() => {
    async function claim() {
      const subscription = await currentSubscription();
      if (!subscription) return;
      await claimDevice(subscription.endpoint, navigator.userAgent);
    }

    claim().catch(() => {
      // A browser that cannot answer has no subscription to reassign.
    });
  }, []);

  return null;
}
