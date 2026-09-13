import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";

// One definition of "is this the manager".
//
// A server action is a public POST endpoint. The dashboard layout's redirect
// keeps a browser out of the pages, but it is not a security boundary: anybody
// who knows an action's id can call it directly, with no page involved. So the
// check belongs inside the action, and it belongs in one place — a security
// primitive copied into twenty files is a security primitive that drifts in
// nineteen of them.
//
// This file is deliberately NOT a "use server" module. Every export of one of
// those becomes callable over the network, and a guard that can itself be
// called is not a guard.

export async function requireAdmin(): Promise<void> {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) {
    throw new Error("Unauthorized");
  }
}
