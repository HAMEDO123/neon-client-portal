import { mobileViewer } from "@/lib/mobile-auth";
import { answerError, json } from "@/lib/mobile/rpc";
import { ACTIONS } from "@/lib/mobile/registry";
import { noteAppBuild, withLatestBuild } from "@/lib/ios-build";

// Every change the phone app makes beyond the original handful of routes:
// POST /api/mobile/do/<area>/<name> — see lib/mobile/rpc.ts.
//
// Two shapes, one meaning:
//   application/json     { "args": [...], "form": { field: value | [values] } }
//   multipart/form-data  `__args` (a JSON array) plus the form's own fields and files
//
// The action the entry calls carries the website's own guard, so this route
// only refuses a request with no valid session at all.
//
// Every answer, refusals included, says which build of the iPhone app is the
// newest one installed (X-Neon-Latest-Build, lib/ios-build.ts), so an older
// app can ask to be updated.

export const dynamic = "force-dynamic";

async function readInput(request: Request): Promise<{ args: unknown[]; form: FormData }> {
  const form = new FormData();
  const type = request.headers.get("content-type") ?? "";

  if (type.includes("multipart/form-data")) {
    const posted = await request.formData();
    const raw = posted.get("__args");
    const args = typeof raw === "string" && raw ? (JSON.parse(raw) as unknown) : [];
    for (const [key, value] of posted.entries()) {
      if (key !== "__args") form.append(key, value);
    }
    return { args: Array.isArray(args) ? args : [], form };
  }

  const body = (await request.json().catch(() => ({}))) as { args?: unknown; form?: unknown };
  if (body.form && typeof body.form === "object") {
    for (const [key, value] of Object.entries(body.form as Record<string, unknown>)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item === null || item === undefined) continue;
        form.append(key, typeof item === "string" ? item : String(item));
      }
    }
  }
  return { args: Array.isArray(body.args) ? body.args : [], form };
}

export async function POST(request: Request, context: { params: Promise<{ name: string[] }> }) {
  return withLatestBuild(await act(request, context));
}

async function act(request: Request, context: { params: Promise<{ name: string[] }> }) {
  if (!(await mobileViewer(request))) return json({ error: "Unauthorized." }, 401);
  noteAppBuild(request.headers);

  const { name } = await context.params;
  const entry = ACTIONS[name.join("/")];
  if (!entry) return json({ error: "There is no such action." }, 404);

  let input: { args: unknown[]; form: FormData };
  try {
    input = await readInput(request);
  } catch {
    return json({ error: "That request could not be read." }, 400);
  }

  try {
    const result = await entry(input);
    return json({ ok: true, result: result === undefined ? null : result, redirect: null });
  } catch (error) {
    return answerError(error, true);
  }
}
