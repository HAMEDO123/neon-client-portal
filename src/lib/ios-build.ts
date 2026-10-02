import { prisma } from "@/lib/db";

// Which build of the iPhone app is the newest anybody has installed, so every
// older copy can ask its person to update. Not the website's version — that
// is lib/app-version.ts, the server's own build. This one is the phone's.
//
// The app sends two headers on every request: `X-Neon-Build`, its
// CFBundleVersion, which here is the moment it was archived (202610021122 is
// 2 October 2026 at 11:22), and `X-Neon-Channel`, where it was installed from
// — testflight, appstore or dev. The newest build a signed-in phone installed
// from TestFlight or the App Store is remembered (AppSetting
// `app_latest_build`), and every answer from the two registry routes carries
// it back as `X-Neon-Latest-Build`. An app older than that shows a "please
// update" screen.
//
// One phone having a build is enough to ask everybody for it because the
// whole team is one internal TestFlight group that receives every build: a
// build one phone installed is a build every phone can install.
//
// What keeps it from going wrong:
// - a build from Xcode ("dev") never counts — a developer's phone runs builds
//   nobody else can install;
// - a header is a claim, so a build dated before 2026 or more than a day and
//   a half ahead of the server's clock is not believed: one forged number must
//   not put everybody behind an update screen for a build that does not exist;
// - it only ever goes up, so an old phone checking in cannot lower it.
//
// It costs a request nothing: the stored value is kept in memory for a
// minute, and noting a build never holds up the answer it came with.
//
// Not "use server": every export of one of those is callable over the network.

export const LATEST_BUILD_KEY = "app_latest_build";
export const BUILD_HEADER = "X-Neon-Build";
export const CHANNEL_HEADER = "X-Neon-Channel";
export const LATEST_BUILD_HEADER = "X-Neon-Latest-Build";

/** Where a build has to come from to count: somewhere the rest of the team can install it from too. */
const COUNTED_CHANNELS: ReadonlySet<string> = new Set(["testflight", "appstore"]);

const EARLIEST_BUILD = Date.UTC(2026, 0, 1);
const MOST_AHEAD_MS = 36 * 60 * 60 * 1000;
const KEEP_MS = 60_000;

/**
 * The moment twelve digits name, or null when they do not name one. Read as
 * UTC: the Mac stamps its own clock, Amman's, and the three hours between
 * the two are well inside every margin this is used with.
 */
function buildMoment(digits: string): number | null {
  if (!/^\d{12}$/.test(digits)) return null;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const hour = Number(digits.slice(8, 10));
  const minute = Number(digits.slice(10, 12));
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return null;

  // setUTCFullYear rather than Date.UTC, which reads years below 100 as 19xx.
  const at = new Date(0);
  at.setUTCFullYear(year, month - 1, day);
  at.setUTCHours(hour, minute, 0, 0);
  // A day that does not exist (31 September) rolls over into the next month.
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null;
  return at.getTime();
}

/** A build number as the app sends it — exactly twelve digits that are a real date and time — or null. */
export function parseBuild(raw: string | null | undefined): number | null {
  if (typeof raw !== "string" || buildMoment(raw) === null) return null;
  return Number(raw);
}

/** Whether a build could be real: made in 2026 or later, and dated no more than 36 hours ahead of `now`. */
export function plausibleBuild(build: number, now: Date = new Date()): boolean {
  const at = buildMoment(String(build));
  return at !== null && at >= EARLIEST_BUILD && at <= now.getTime() + MOST_AHEAD_MS;
}

/**
 * The build one request gives reason to remember, or null: from TestFlight
 * or the App Store, believable, and newer than `known`.
 */
export function buildToNote(
  claim: { build: string | null; channel: string | null },
  known: number | null,
  now: Date = new Date()
): number | null {
  if (!COUNTED_CHANNELS.has((claim.channel ?? "").trim().toLowerCase())) return null;
  const build = parseBuild(claim.build);
  if (build === null || !plausibleBuild(build, now)) return null;
  return known !== null && build <= known ? null : build;
}

// --- Kept in memory ----------------------------------------------------------

let held: { at: number; build: number | null } | null = null;
let reading: Promise<number | null> | null = null;

/**
 * The newest build known, or null before any phone has reported one. Read from
 * the database at most once a minute; a database that cannot be read keeps
 * the last answer rather than taking the update screen away.
 */
export async function latestAppBuild(): Promise<number | null> {
  if (held && Date.now() - held.at < KEEP_MS) return held.build;
  if (!reading) {
    reading = prisma.appSetting
      .findUnique({ where: { key: LATEST_BUILD_KEY } })
      .then((row) => parseBuild(row?.value))
      .catch(() => held?.build ?? null)
      .then((build) => {
        held = { at: Date.now(), build };
        return build;
      })
      .finally(() => {
        reading = null;
      });
  }
  return reading;
}

/**
 * Remembers the build a request came from, when it is newer. In the
 * background: it never throws and never makes the request wait. Called by
 * the registry routes once the session has been accepted, so only a
 * signed-in phone is ever counted.
 */
export function noteAppBuild(headers: Headers, now: Date = new Date()): void {
  // Read now, while the request is certainly still in hand.
  const claim = { build: headers.get(BUILD_HEADER), channel: headers.get(CHANNEL_HEADER) };
  if (buildToNote(claim, null, now) === null) return; // a dev build, or no believable build at all

  void (async () => {
    const build = buildToNote(claim, await latestAppBuild(), now);
    if (build === null) return;
    await raiseStored(build);
    held = { at: Date.now(), build: Math.max(build, held?.build ?? 0) };
  })().catch((error) => {
    console.warn("[ios-build] could not note a build", error instanceof Error ? error.message : error);
  });
}

/**
 * Stores a build only if it is higher than the one stored. Every value written
 * here is twelve digits, so comparing them as text is comparing them as
 * numbers — and comparing inside the UPDATE means two phones checking in at
 * once cannot lower it between somebody's read and somebody's write.
 */
async function raiseStored(build: number) {
  const value = String(build);
  const raised = await prisma.appSetting.updateMany({
    where: { key: LATEST_BUILD_KEY, value: { lt: value } },
    data: { value },
  });
  if (raised.count === 0) {
    // No row yet — or a higher build already in it, which this leaves alone.
    await prisma.appSetting.createMany({ data: [{ key: LATEST_BUILD_KEY, value }], skipDuplicates: true });
  }
}

/** Puts the newest known build on an answer, when one is known. */
export async function withLatestBuild(response: Response): Promise<Response> {
  const latest = await latestAppBuild();
  if (latest === null) return response;
  try {
    response.headers.set(LATEST_BUILD_HEADER, String(latest));
  } catch {
    // A response whose headers are fixed (none of ours are): the answer
    // matters more than the header.
  }
  return response;
}
