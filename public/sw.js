/* NEON Tasks service worker — push delivery for the employee portal.
 *
 * Deliberately minimal: it does not cache or intercept fetches, so it cannot
 * serve a stale build or interfere with the admin and client portals. Its only
 * jobs are receiving a push, showing it, and opening the right page on a tap.
 */

self.addEventListener("install", () => {
  // Take over immediately so enabling push works on the first visit rather
  // than the next one.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "NEON Tasks";
  const options = {
    body: payload.body || "",
    // Same tag replaces an earlier notification of the same kind instead of
    // stacking duplicates on the lock screen.
    tag: payload.tag || "neon-task",
    renotify: true,
    icon: "/admin-icon-192.png",
    badge: "/admin-icon-192.png",
    data: {
      url: payload.url || "/employee",
      notificationId: payload.notificationId || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = (event.notification.data && event.notification.data.url) || "/employee";

  event.waitUntil(
    (async () => {
      const url = new URL(target, self.location.origin);
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      // Reuse a window that already has the portal open — an employee tapping
      // a notification should not end up with a stack of duplicate tabs.
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            await client.navigate(url.href).catch(() => {});
          }
          return;
        }
      }

      await self.clients.openWindow(url.href);
    })()
  );
});
