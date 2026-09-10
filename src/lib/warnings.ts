// Formal warnings from the manager: the rules, with no database.
//
// Three is the limit. The first two are warnings; the third closes the
// account, the way a final written warning ends in dismissal. The employee is
// told on their phone the moment one is given, and sees every warning at the
// top of their home screen until the manager removes it.

export const WARNING_LIMIT = 3;

/** A reason longer than this is refused: a lock screen shows a line or two. */
export const MAX_REASON_LENGTH = 500;

export type WarningStanding = {
  /** Warnings on record. */
  count: number;
  /** How many more can be given before the account closes. */
  left: number;
  /** The next warning is the one that closes the account. */
  nextIsFinal: boolean;
  /** The limit is reached. */
  reached: boolean;
};

export function warningStanding(count: number): WarningStanding {
  const safe = Math.max(0, Math.floor(count));
  return {
    count: safe,
    left: Math.max(0, WARNING_LIMIT - safe),
    nextIsFinal: safe === WARNING_LIMIT - 1,
    reached: safe >= WARNING_LIMIT,
  };
}

/** What the employee's phone says when warning number `number` is given. */
export function warningCopy(number: number, reason: string) {
  const text = reason.trim();

  if (number >= WARNING_LIMIT) {
    return {
      title: `Warning ${number} of ${WARNING_LIMIT}: your account is closed`,
      message: text,
    };
  }

  const tail = number === WARNING_LIMIT - 1 ? " One more warning closes your account." : "";
  return {
    title: `You got a warning (${number} of ${WARNING_LIMIT})`,
    message: `${text}${tail}`,
  };
}

/** One notification per warning, however many times the send is retried. */
export function warningKey(warningId: string) {
  return `WARNING:${warningId}`;
}
