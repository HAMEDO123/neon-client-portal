import { NextResponse } from "next/server";
import { mobileStaff } from "@/lib/mobile-auth";

// Who the app is signed in as.
//
// The app keeps its token in the Keychain across launches, and a stored token
// proves nothing on its own: the account behind it may have been disabled, the
// studio's shared password may have changed, `SESSION_SECRET` may have been
// rotated — and every one of those looks identical from inside the app until it
// asks. So it asks at launch rather than drawing a signed-in screen it is about
// to be thrown out of.
//
// It needs the answer regardless: the manager and somebody on the team do not
// get the same screens, and the app cannot tell which it is holding by looking
// at the token.

// A database that cannot be reached must NOT answer 401 here. `mobileStaff`
// reads the employee row on every call, so an outage makes that read throw and
// this route 500s — which is the right answer, and deliberately left to
// propagate. The app clears its stored token on a 401 (`APIClient`), so turning
// a transient outage into "unauthorized" would sign the whole team out and make
// every one of them type their password again to recover from a blip that fixed
// itself. Unreachable is not unauthorized.

export async function GET(request: Request) {
  const staff = await mobileStaff(request);
  if (!staff) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json({ actor: staff });
}
