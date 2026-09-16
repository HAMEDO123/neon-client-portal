import { readFileSync } from "node:fs";
import path from "node:path";

// Which build of the platform this server is running.
//
// Next writes a fresh id into .next/BUILD_ID on every build, so it changes
// exactly when new code is deployed and not when a container merely restarts
// after a crash or a reboot — which is the distinction that matters, because
// this is what tells everybody with the site open to reload.
//
// Nothing here needs a habit at deploy time: no build argument to remember, no
// commit to pass in. A build that happened is a build the id already knows
// about. RENDER_GIT_COMMIT is still honoured where it is set, so Render keeps
// naming its own deploys.

let cached: string | null = null;

export function appVersion() {
  if (cached) return cached;

  // In development the id would change with every restart of `next dev`, which
  // would nag whoever is working on the platform rather than the people using it.
  if (process.env.NODE_ENV !== "production") {
    cached = "development";
    return cached;
  }

  try {
    const id = readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
    if (id) {
      cached = id;
      return cached;
    }
  } catch {
    // An unusual output layout; the fallbacks below still give a stable answer.
  }

  cached = process.env.RENDER_GIT_COMMIT?.trim() || `start-${Date.now()}`;
  return cached;
}
