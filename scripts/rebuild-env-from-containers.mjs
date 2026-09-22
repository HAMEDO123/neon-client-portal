import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";

// Rebuilds .env.docker and .env.local from the running containers.
//
// These two files are git-ignored, which is right — they hold the database
// password, SESSION_SECRET, the bcrypt admin hash, the R2 keys and the rest.
// It also means they live in no commit, so when the working tree was emptied on
// 2026-09-21 they went with it and nothing in git could bring them back.
//
// The running containers still held every value in their environment, which is
// what this recovers from. **That only works while they are running.** After a
// reboot with no env file the app cannot start, and there is nothing to read.
// So this is a recovery tool, not a backup: keep a copy of .env.docker
// somewhere off this machine as well.
//
//   node scripts/rebuild-env-from-containers.mjs
//   node scripts/rebuild-env-from-containers.mjs --force   (overwrite existing)

const FORCE = process.argv.includes("--force");
const CONTAINER = "neon-app";

// Everything the app and compose need. DATABASE_URL is deliberately absent:
// compose builds it from POSTGRES_PASSWORD, and .env.local needs the local one.
const WANTED = [
  "ADMIN_PASSWORD_HASH",
  "ANTHROPIC_API_KEY",
  "APP_TIMEZONE",
  "ATTENDANCE_DEVICE_IP",
  "ATTENDANCE_DEVICE_PORT",
  "CRON_SECRET",
  "POSTGRES_PASSWORD",
  "PUBLIC_APP_URL",
  "R2_ACCESS_KEY_ID",
  "R2_ACCOUNT_ID",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_URL",
  "R2_SECRET_ACCESS_KEY",
  "SESSION_SECRET",
  "VAPID_PRIVATE_KEY",
  "VAPID_PUBLIC_KEY",
  "VAPID_SUBJECT",
  "WHATSAPP_LINE_ID",
  "WHATSAPP_WORKER_KEY",
  "WHATSAPP_WORKER_URL",
];

/** The local prisma dev database — never the one clients use. */
const DEV_DATABASE_URL =
  "postgres://postgres:postgres@127.0.0.1:51214/template1" +
  "?sslmode=disable&connection_limit=10&connect_timeout=0" +
  "&max_idle_connection_lifetime=0&pool_timeout=0&socket_timeout=0";

function readContainerEnv() {
  let raw;
  try {
    raw = execFileSync("docker", ["exec", CONTAINER, "printenv"], { encoding: "utf8" });
  } catch {
    console.error(`Could not read the environment from "${CONTAINER}".`);
    console.error("The container has to be running — that is the only place these values still exist.");
    process.exit(1);
  }

  const found = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at > 0) found.set(line.slice(0, at), line.slice(at + 1));
  }
  return found;
}

/**
 * One line of an env file.
 *
 * Single quotes are not decoration. Compose substitutes `$` inside double
 * quotes, which silently shortens the bcrypt admin hash — the admin login then
 * fails with nothing wrong in the code, which cost a day once already.
 */
function line(key, value) {
  return `${key}='${value.replace(/'/g, "'\\''")}'`;
}

function guard(path) {
  if (existsSync(path) && !FORCE) {
    console.error(`${path} already exists. Pass --force to overwrite it.`);
    process.exit(1);
  }
}

const env = readContainerEnv();
const missing = WANTED.filter((key) => !env.has(key));
if (missing.length) {
  console.error(`The container has no value for: ${missing.join(", ")}`);
  console.error("Writing a partial file would be worse than writing none, so nothing was written.");
  process.exit(1);
}

guard(".env.docker");
guard(".env.local");

const stamp = new Date().toISOString().slice(0, 10);

writeFileSync(
  ".env.docker",
  [
    `# Rebuilt ${stamp} by scripts/rebuild-env-from-containers.mjs.`,
    "# Values are single-quoted: Compose substitutes $ inside double quotes.",
    "",
    ...WANTED.map((key) => line(key, env.get(key))),
  ].join("\n") + "\n"
);

writeFileSync(
  ".env.local",
  [
    `# Rebuilt ${stamp} by scripts/rebuild-env-from-containers.mjs.`,
    "#",
    "# DATABASE_URL points at the local prisma dev database on purpose: npm run",
    "# dev and the tests must never touch the database clients use.",
    "",
    line("DATABASE_URL", DEV_DATABASE_URL),
    "",
    ...WANTED.filter((key) => key !== "POSTGRES_PASSWORD").map((key) => line(key, env.get(key))),
  ].join("\n") + "\n"
);

console.log(`Wrote .env.docker (${WANTED.length} variables) and .env.local (${WANTED.length} variables).`);
console.log("Lengths, so a truncated value shows up without printing any secret:");
for (const key of WANTED) console.log(`  ${key.padEnd(24)} ${env.get(key).length}`);
console.log("");
console.log("Check a container actually receives the admin hash intact — the rendered");
console.log("config prints a literal $ as $$ and will look wrong even when it is right:");
console.log(`  docker exec ${CONTAINER} sh -c 'printf "%s" "$ADMIN_PASSWORD_HASH" | sha256sum'`);
