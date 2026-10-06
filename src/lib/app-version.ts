import { readFileSync } from "node:fs";
import path from "node:path";

// Which build of the platform this server is running.
//
// This is what tells everybody with the site open to reload after a deploy:
// the heartbeat's first word carries it, and a page drawn by a different build
// blocks itself (components/update-required.tsx). So it has to change exactly
// when new code is deployed, and not when a container merely restarts after a
// crash or a reboot.
//
// **It is the deploy id, not `.next/BUILD_ID`.** It used to be the build id,
// which Next made new on every build — until a `deploymentId` was configured,
// from which point Next keeps the build id **constant** on purpose (its docs:
// "the build ID is constant when deploymentId is set", v16.2.0). The prompt
// then compared one constant with itself for ever and never appeared again,
// with nothing to show it had stopped. The deploy id is the thing that changes
// per deploy now: Render's commit, or the stamp the Dockerfile writes to
// `.deploy-id` — the same file next.config.ts reads, so the page's idea of
// its build and this one cannot drift apart.
//
// The build id stays as the fallback for a build with no deploy id at all,
// where it is still unique per build.

let cached: string | null = null;

function fileAt(...parts: string[]): string | null {
  try {
    return readFileSync(path.join(process.cwd(), ...parts), "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function appVersion() {
  if (cached) return cached;

  // In development the id would change with every restart of `next dev`, which
  // would nag whoever is working on the platform rather than the people using it.
  if (process.env.NODE_ENV !== "production") {
    cached = "development";
    return cached;
  }

  cached =
    process.env.RENDER_GIT_COMMIT?.trim() ||
    process.env.NEON_DEPLOY_ID?.trim() ||
    fileAt(".deploy-id") ||
    fileAt(".next", "BUILD_ID") ||
    `start-${Date.now()}`;
  return cached;
}
