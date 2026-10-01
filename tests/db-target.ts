// Which database a test is allowed to write to.
//
// `*.db.test.ts` files create people, projects, chats and calls and delete them
// again. They are written for the development database — `prisma dev`, ports
// 51213-51216 — and the README says plainly why: "`npm run dev` and the tests
// must never touch the database clients use."
//
// Nothing enforced that. `DATABASE_URL` is read from `.env.local`, and on
// 2026-10-01 it was found pointing at the studio's own database on port 55432:
// the one behind clients.neonjo.com. Every `npm test` since had been creating
// and deleting rows in it, and it had left 55 ENDED calls on pair chats between
// employees who never existed. Nothing was damaged and nobody could see them —
// but nothing about the arrangement made that true on purpose, and the next
// test to be written might not clean up after itself at all.
//
// So the check is here rather than in a comment. Pure, so it can be tested
// without a database of any kind.

/** The ports `prisma dev --name neon-client-portal` serves on. */
const DEV_PORTS = [51213, 51214, 51215, 51216];

export type Target =
  | { safe: true; why: string }
  | { safe: false; why: string };

/**
 * Whether this is a database tests may write to.
 *
 * An allow-list, not a block-list: a new database somebody points this at is
 * refused until they say it is a development one, which is the right way round
 * for a check whose failure mode is writing into client data.
 */
export function databaseTarget(url: string | undefined): Target {
  if (!url || url.trim().length === 0) {
    // No database at all is the documented outcome when the dev one is down,
    // and the tests skip themselves. Not this check's business.
    return { safe: true, why: "no DATABASE_URL — the tests will skip themselves" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, why: "DATABASE_URL could not be read as an address" };
  }

  const port = Number(parsed.port);
  const host = parsed.hostname;
  const local = host === "127.0.0.1" || host === "localhost" || host === "::1";

  if (local && DEV_PORTS.includes(port)) {
    return { safe: true, why: `the development database on ${host}:${port}` };
  }

  if (local && port === 55432) {
    return {
      safe: false,
      why:
        `DATABASE_URL points at ${host}:${port} — the studio's live database, the one behind ` +
        `clients.neonjo.com. The tests write and delete rows. Point .env.local back at the ` +
        `development database (npm run db:dev prints its postgres:// address).`,
    };
  }

  return {
    safe: false,
    why:
      `DATABASE_URL points at ${host}:${port || "(no port)"}, which is not the development ` +
      `database. The tests write and delete rows, so they refuse anything they have not been ` +
      `told is safe. The development database is ${DEV_PORTS.join("/")} on this machine.`,
  };
}
