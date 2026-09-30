import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { mobileViewer } from "@/lib/mobile-auth";
import { managerEmployeeId } from "@/lib/manager-account";
import { saveEmployeePhoto } from "@/lib/employee-photo";

// The signed-in person's own face, set from the phone — somebody on the team,
// or the manager.
//
// The web has this on `/employee/profile`; the app's own profile screen drew
// initials and offered nothing, so "each employee adds their own photo" was
// true on the website and false in the app — which is indistinguishable, from
// the outside, from the feature not working.
//
// Multipart, with the same field name the web form posts:
//   photo — an image. Absent or empty means "take mine off", which is the same
//           thing the web's Remove button does and the state everybody starts
//           in, so DELETE is not a second way to say it.
//
// Their own and nobody else's: the id comes from the token, never from the
// body, exactly as the employee's server action takes it from the session.
// The manager's token writes to the manager's own `Employee` row — the
// `accessRole: "MANAGER"` one `lib/faces.ts` already reads their face from,
// so the photo set here is the one every chat row, call tile and story shows
// for "admin". Setting somebody *else's* face is the manager's alone and goes
// through `team/employees/photo`, behind `requireAdmin`.

export const dynamic = "force-dynamic";

/**
 * Whose face this token may write: an employee is themselves; the manager is
 * their own row, or nobody when this studio never paired one (see
 * `managerEmployeeId`) — an ordinary answer the phone is told in a sentence,
 * as `/api/mobile/devices` does.
 */
async function ownRow(viewer: NonNullable<Awaited<ReturnType<typeof mobileViewer>>>) {
  return viewer.type === "ADMIN" ? managerEmployeeId() : viewer.id;
}

export async function POST(request: Request) {
  const viewer = await mobileViewer(request);
  if (!viewer) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const employeeId = await ownRow(viewer);
  if (!employeeId) {
    return NextResponse.json(
      { error: "This account has no employee record to put a photo on." },
      { status: 409 }
    );
  }

  if (!(request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Send this as multipart/form-data with a `photo` field." },
      { status: 415 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "That upload could not be read." }, { status: 400 });
  }

  let photoUrl: string | null;
  try {
    photoUrl = await saveEmployeePhoto(employeeId, formData.get("photo"));
  } catch (error) {
    // saveEmployeePhoto says what to do about a file it cannot read. That
    // sentence is the useful one, so it travels rather than being swallowed.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "That photo could not be saved." },
      { status: 400 }
    );
  }

  await prisma.employee.update({ where: { id: employeeId }, data: { photoUrl } });

  return NextResponse.json({ ok: true, photoUrl });
}
