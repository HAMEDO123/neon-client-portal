import crypto from "crypto";

// Keeping a secret the platform has to be able to read back.
//
// A password is normally hashed, and the point of a hash is that nobody —
// including us — can recover it. That is wrong here: the office's shop account
// has to be handed to a phone so it can fill in the shop's own sign-in form,
// so it must be reversible. What this gets us is narrower and worth being
// exact about:
//
//   It protects a copy of the database. The daily dumps in local-backup, a
//   file copied to a laptop, a disk that leaves the office — none of those
//   carry the password any more.
//
//   It protects nothing against somebody signed in. The server decrypts it to
//   answer the app, so anybody the app answers to can read it. That was said
//   plainly before this was built and is the studio's decision; the mitigation
//   is the record of who fetched it, not this.
//
// The key is derived from SESSION_SECRET, which already exists and is already
// the thing that must never leak. **Changing SESSION_SECRET makes anything
// stored here unreadable** — it already signs out every employee and the iOS
// app, so it is not a thing done lightly, but this is one more reason.

const SCHEME = "v1";
const KEY_INFO = "neon-secret-box-v1";

function keyFor(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set, so nothing can be stored securely.");
  // scrypt rather than the raw secret: it is already used as an HMAC key
  // elsewhere, and one secret should not be the key for two different things.
  return crypto.scryptSync(secret, KEY_INFO, 32);
}

/** Locked, as a single string safe to put in a settings row. */
export function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFor(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [SCHEME, iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".");
}

/**
 * Back again, or null.
 *
 * Null for anything that is not ours, has been tampered with, or was written
 * under a different `SESSION_SECRET` — a caller then behaves as though nothing
 * is stored, which is the honest reading of a value we cannot open.
 */
export function open(sealed: string | null | undefined): string | null {
  if (!sealed) return null;

  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== SCHEME) return null;

  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      keyFor(),
      Buffer.from(parts[1], "base64url")
    );
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(parts[3], "base64url")),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch {
    // GCM's tag check failing is what a changed byte looks like, and it is not
    // something to throw into a settings page over.
    return null;
  }
}

/** Whether a stored value is one of ours at all, without opening it. */
export function isSealed(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${SCHEME}.`);
}
