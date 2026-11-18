// A private copy of the live platform on this PC, for LOOKING at a change
// before it ships — signed-in pages included.
//
//   node scripts/preview-instance.mjs setup   copy the live database into `neon_preview`
//   node scripts/preview-instance.mjs start   next dev on http://127.0.0.1:3077 against the copy
//   node scripts/preview-instance.mjs drop    delete the copy
//
// Why it exists: nobody but the manager knows the admin password, and an agent
// must never be given it — so for a long time every change to a signed-in
// screen shipped unseen, and the owner found the mistakes on his own phone.
// This gives a place to look that is not the live site:
//
//   - `setup` copies the live database into ANOTHER database on the same
//     Postgres (`neon_preview`). The live one is only read (pg_dump).
//   - In the copy, everything that could reach a real phone is deleted (push
//     subscriptions, device tokens), every sign-in is replaced by a throwaway
//     one written to `.preview/creds.json` (git-ignored), and real e-mail
//     addresses are taken off the accounts.
//   - `start` runs the app against the copy with its OWN random session secret
//     (a cookie from here means nothing to the live site) and with every
//     integration blanked: no push keys, no WhatsApp worker, no storage keys,
//     no AI key, no attendance device. It listens on this PC only.
//
// Screenshots of it are taken with scripts/preview-shot.mjs.

import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, ".preview");
const credsFile = path.join(dir, "creds.json");
const DATABASE = "neon_preview";
const PORT = 3077;

/** Every integration the preview must not have. Blank, so `.env.local` cannot fill them in. */
const BLANK = [
  "ADMIN_PASSWORD_HASH",
  "ANTHROPIC_API_KEY",
  "ATTENDANCE_DEVICE_IP",
  "ATTENDANCE_DEVICE_PORT",
  "R2_ACCESS_KEY_ID",
  "R2_ACCOUNT_ID",
  "R2_BUCKET_NAME",
  "R2_SECRET_ACCESS_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "VAPID_PRIVATE_KEY",
  "VAPID_PUBLIC_KEY",
  "VAPID_SUBJECT",
  "WHATSAPP_LINE_ID",
  "WHATSAPP_WORKER_KEY",
  "WHATSAPP_WORKER_URL",
  "CLOUDFLARE_TURN_KEY_ID",
  "CLOUDFLARE_TURN_KEY_API_TOKEN",
  "APNS_KEY_ID",
  "APNS_TEAM_ID",
  "APNS_PRIVATE_KEY",
];

function psql(database, sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", "neon-db", "psql", "-U", "neon", "-d", database, "-v", "ON_ERROR_STOP=1", "-q", "-tA"],
    { input: sql, encoding: "utf8" }
  );
}

function setup() {
  mkdirSync(dir, { recursive: true });

  psql("postgres", `DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE);\nCREATE DATABASE ${DATABASE};\n`);
  // The live database is read, never written: its dump is piped into the copy.
  execFileSync(
    "docker",
    ["exec", "neon-db", "sh", "-c", `pg_dump -U neon neon | psql -U neon -q -v ON_ERROR_STOP=1 -d ${DATABASE} > /dev/null`],
    { stdio: ["ignore", "ignore", "inherit"] }
  );

  const password = `preview-${randomBytes(9).toString("hex")}`;
  const hash = bcrypt.hashSync(password, 10);
  // A throwaway hash is letters, digits, "$", "." and "/" — nothing to escape.
  psql(
    DATABASE,
    `
    DELETE FROM "PushSubscription";
    DELETE FROM "DeviceToken";
    UPDATE "Employee" SET email = NULL, "passwordHash" = NULL;
    UPDATE "Employee"
       SET email = lower(regexp_replace(name, '[^A-Za-z]', '', 'g')) || '@preview.local', "passwordHash" = '${hash}'
     WHERE "accessRole" = 'EMPLOYEE' AND active;
    INSERT INTO "AppSetting" (key, value, "updatedAt") VALUES ('admin_password_hash', '${hash}', now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now();
    `
  );

  const team = psql(
    DATABASE,
    `SELECT name || '|' || email FROM "Employee" WHERE "accessRole" = 'EMPLOYEE' AND active ORDER BY "order", name;`
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, email] = line.split("|");
      return { name, email };
    });

  const previous = existsSync(credsFile) ? JSON.parse(readFileSync(credsFile, "utf8")) : {};
  writeFileSync(
    credsFile,
    JSON.stringify(
      {
        url: `http://127.0.0.1:${PORT}`,
        password,
        team,
        // Kept across setups, so cookies saved by preview-shot.mjs keep working
        // until the next `setup` replaces the accounts under them.
        sessionSecret: previous.sessionSecret ?? randomBytes(32).toString("hex"),
      },
      null,
      2
    )
  );

  console.log(`preview database ready: ${team.length} team sign-ins, creds in .preview/creds.json`);
}

function start() {
  if (!existsSync(credsFile)) throw new Error("Run `node scripts/preview-instance.mjs setup` first.");
  const creds = JSON.parse(readFileSync(credsFile, "utf8"));

  // The live app's own address for the database, pointed at this PC and at the copy.
  const url = new URL(execFileSync("docker", ["exec", "neon-app", "printenv", "DATABASE_URL"], { encoding: "utf8" }).trim());
  url.hostname = "127.0.0.1";
  url.port = "55432";
  url.pathname = `/${DATABASE}`;

  const env = {
    ...process.env,
    DATABASE_URL: url.toString(),
    SESSION_SECRET: creds.sessionSecret,
    CRON_SECRET: randomBytes(24).toString("hex"),
    PUBLIC_APP_URL: `http://127.0.0.1:${PORT}`,
  };
  for (const key of BLANK) env[key] = "";

  const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [next, "dev", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

function drop() {
  psql("postgres", `DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE);\n`);
  console.log("preview database dropped");
}

const command = process.argv[2];
if (command === "setup") setup();
else if (command === "start") start();
else if (command === "drop") drop();
else {
  console.error("usage: node scripts/preview-instance.mjs setup | start | drop");
  process.exit(1);
}
