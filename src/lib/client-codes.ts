import crypto from "crypto";

// The code a client is given instead of a link.
//
// The studio has always sent `/p/<token>` and the link is the credential. A
// client app cannot be opened by a link the same way: somebody has to be able
// to read a code down the phone, or off a WhatsApp message, and type it into a
// box. So a project carries a second credential of the same standing — shorter,
// and built to survive being spoken aloud and typed by hand.
//
// Pure, and tested, because it is the whole of the access check: a mistake here
// either locks a client out of their own project or lets a guess in.

/**
 * Crockford's base-32 alphabet: the digits and the letters, without `I`, `L`,
 * `O` or `U`.
 *
 * `I`/`1`, `L`/`1` and `O`/`0` are the pairs people mishear and mistype, so
 * they are not both in the set — and `normaliseCode` folds each onto the one
 * that is. `U` is left out as Crockford leaves it out, so no code can spell
 * something the studio would rather not read out to a client.
 */
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Eight characters: 32^8, a little over a million million. */
export const CODE_LENGTH = 8;

/** Where the dash goes when a code is shown. Never stored with it. */
const GROUP = 4;

/**
 * A new code.
 *
 * `% 32` is unbiased here because 32 divides 256 exactly — with an alphabet of
 * any other size this would quietly favour its first few letters.
 */
export function generateAccessCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

/**
 * What somebody typed, turned into what is stored — or null if it cannot be a
 * code at all.
 *
 * Lower case, spaces, the dash this is displayed with, and the three
 * confusable letters are all expected and all fine. Anything else means the
 * person has typed something that is not this code, and a null here is what
 * makes "that code is not right" honest rather than a guess.
 */
export function normaliseCode(input: string): string | null {
  const folded = input
    .toUpperCase()
    // The separators a code is read and written with.
    .replace(/[\s\-._]/g, "")
    // The pairs people mishear. Folded towards the character the alphabet has.
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");

  if (folded.length !== CODE_LENGTH) return null;
  for (const character of folded) {
    if (!CODE_ALPHABET.includes(character)) return null;
  }
  return folded;
}

/** How a code is shown and read out: `4F7K-2QX9`. */
export function formatCode(code: string): string {
  const groups: string[] = [];
  for (let at = 0; at < code.length; at += GROUP) groups.push(code.slice(at, at + GROUP));
  return groups.join("-");
}
