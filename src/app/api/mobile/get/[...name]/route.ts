import { mobileViewer } from "@/lib/mobile-auth";
import { answerError, json } from "@/lib/mobile/rpc";
import { READS } from "@/lib/mobile/registry";
import { noteAppBuild, withLatestBuild } from "@/lib/ios-build";

// Every read the phone app makes beyond the original handful of routes:
// GET /api/mobile/get/<area>/<name>?…  — see lib/mobile/rpc.ts.
//
// A request with no valid session is refused here. Which session may read
// what is the entry's to decide — it calls the same guard as the website's
// page before reading anything.
//
// Every answer, refusals included, says which build of the iPhone app is the
// newest one installed (X-Neon-Latest-Build, lib/ios-build.ts), so an older
// app can ask to be updated.

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ name: string[] }> }) {
  return withLatestBuild(await read(request, context));
}

async function read(request: Request, context: { params: Promise<{ name: string[] }> }) {
  if (!(await mobileViewer(request))) return json({ error: "Unauthorized." }, 401);
  noteAppBuild(request.headers);

  const { name } = await context.params;
  const entry = READS[name.join("/")];
  if (!entry) return json({ error: "There is no such read." }, 404);

  try {
    return json(await entry(new URL(request.url).searchParams));
  } catch (error) {
    return answerError(error, true);
  }
}
