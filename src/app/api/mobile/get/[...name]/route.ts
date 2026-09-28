import { mobileViewer } from "@/lib/mobile-auth";
import { answerError, json } from "@/lib/mobile/rpc";
import { READS } from "@/lib/mobile/registry";

// Every read the phone app makes beyond the original handful of routes:
// GET /api/mobile/get/<area>/<name>?…  — see lib/mobile/rpc.ts.
//
// A request with no valid session is refused here. Which session may read
// what is the entry's to decide — it calls the same guard as the website's
// page before reading anything.

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ name: string[] }> }) {
  if (!(await mobileViewer(request))) return json({ error: "Unauthorized." }, 401);

  const { name } = await context.params;
  const entry = READS[name.join("/")];
  if (!entry) return json({ error: "There is no such read." }, 404);

  try {
    return json(await entry(new URL(request.url).searchParams));
  } catch (error) {
    return answerError(error, true);
  }
}
