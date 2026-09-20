import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { mobileStaff } from "@/lib/mobile-auth";
import { managerEmployeeId } from "@/lib/manager-account";

// Where the staff app registers the device token APNs gave it.
//
// A device token is not a credential and not a secret — it is an address. It
// changes when the app is reinstalled, when a phone is restored from a backup,
// and sometimes for no reason Apple explains, so the app re-registers on every
// launch rather than only the first, and this route is written to be called
// repeatedly with the same values.

/**
 * Whose device this is.
 *
 * An employee is themselves. The manager is the `Employee` row carrying
 * `accessRole: "MANAGER"` — the one created so the attendance device had
 * something to pair to, and the same row `dispatchNotification` already
 * addresses when the web admin registers a browser for push. A studio that
 * never paired it has nobody to hang the token on, which is an ordinary answer
 * and not a fault: `managerEmployeeId()` returns null and the app is told
 * plainly rather than failing on the tap.
 */
async function ownerOf(staff: NonNullable<Awaited<ReturnType<typeof mobileStaff>>>) {
  return staff.type === "ADMIN" ? managerEmployeeId() : staff.id;
}

export async function POST(request: Request) {
  const staff = await mobileStaff(request);
  if (!staff) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const employeeId = await ownerOf(staff);
  if (!employeeId) {
    return NextResponse.json(
      { error: "This account has no employee record to register a device against." },
      { status: 409 }
    );
  }

  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const bundleId = typeof body?.bundleId === "string" ? body.bundleId.trim() : "";
  const sandbox = body?.sandbox === true;
  const deviceName = typeof body?.deviceName === "string" ? body.deviceName.trim() : null;
  const appVersion = typeof body?.appVersion === "string" ? body.appVersion.trim() : null;

  if (!token || !bundleId) {
    return NextResponse.json({ error: "A token and a bundle id are required." }, { status: 400 });
  }

  // Keyed on the token rather than on the employee: Apple hands the same token
  // to whoever is holding the phone, so the same token arriving for a different
  // person means the device changed hands and the row must MOVE rather than be
  // duplicated. Two rows would mean the person who gave the phone away keeps
  // receiving on it.
  //
  // Re-registering also clears `failureCount` and re-activates: a token Apple
  // once disowned can be issued again, and a device that came back must not
  // stay retired because of failures it has already recovered from.
  const device = await prisma.deviceToken.upsert({
    where: { token },
    create: { employeeId, token, bundleId, sandbox, deviceName, appVersion },
    update: {
      employeeId,
      bundleId,
      sandbox,
      deviceName,
      appVersion,
      active: true,
      failureCount: 0,
    },
    select: { id: true },
  });

  return NextResponse.json({ id: device.id, registered: true });
}

/**
 * Signing out, or turning notifications off.
 *
 * The row is deactivated rather than deleted, for the same reason a dead
 * `PushSubscription` is: `NotificationDelivery` points at it, and a delivery
 * log that says "sent to a device we can no longer name" is a log that cannot
 * answer the question it exists for.
 */
export async function DELETE(request: Request) {
  const staff = await mobileStaff(request);
  if (!staff) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const employeeId = await ownerOf(staff);
  if (!employeeId) return NextResponse.json({ released: 0 });

  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) return NextResponse.json({ error: "A token is required." }, { status: 400 });

  // Scoped to the caller's own id in the `where`, never trusting the token
  // alone — otherwise anybody signed in could silence anybody else's phone by
  // sending their token.
  const { count } = await prisma.deviceToken.updateMany({
    where: { token, employeeId },
    data: { active: false },
  });

  return NextResponse.json({ released: count });
}
