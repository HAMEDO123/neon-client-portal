import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { mobileEmployee } from "@/lib/mobile-auth";
import { saveEmployeePhoto } from "@/lib/employee-photo";

// The person's own face, set from the phone.
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

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const employee = await mobileEmployee(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

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
    photoUrl = await saveEmployeePhoto(employee.id, formData.get("photo"));
  } catch (error) {
    // saveEmployeePhoto says what to do about a file it cannot read. That
    // sentence is the useful one, so it travels rather than being swallowed.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "That photo could not be saved." },
      { status: 400 }
    );
  }

  await prisma.employee.update({ where: { id: employee.id }, data: { photoUrl } });

  return NextResponse.json({ ok: true, photoUrl });
}
