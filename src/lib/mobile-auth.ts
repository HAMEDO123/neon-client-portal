import { verifySessionToken } from "@/lib/auth";

// Same signed token as the web session cookie, just carried as a Bearer
// header instead — the native app has no cookie jar of its own.
export function requireMobileAuth(request: Request): boolean {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  return verifySessionToken(token);
}
