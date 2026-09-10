// Loads a copy of the local database's data (local-backup/local-data.sql) into
// the database DATABASE_URL points at — how a second computer gets the same
// employees, projects, tasks and chats to develop against.
//
// The copy is data only. The tables come from the migrations, so run
// `npx prisma migrate deploy` first. Needs nothing but Node and the `pg`
// package the app already depends on: no PostgreSQL tools on this computer.
//
//   node --env-file=.env.local scripts/restore-local-data.mjs            # into an empty database
//   node --env-file=.env.local scripts/restore-local-data.mjs --replace  # empty it first
//
// Making the copy (on a computer with PostgreSQL's tools) is in README.md.
// Refuses any database that is not on this computer: this must never be
// pointed at production.

import { readFile } from "node:fs/promises";
import pg from "pg";

const args = process.argv.slice(2);
const replace = args.includes("--replace");
const file = args.find((arg) => !arg.startsWith("--")) ?? "local-backup/local-data.sql";
const url = process.env.DATABASE_URL ?? "";

function stop(message) {
  console.error(message);
  process.exit(1);
}

if (!url) stop("DATABASE_URL is not set. Run with: node --env-file=.env.local scripts/restore-local-data.mjs");
if (url.startsWith("prisma+postgres:")) {
  stop("DATABASE_URL is the prisma+postgres:// address. Use the postgres:// (TCP) one that `npm run db:dev` prints.");
}

const host = new URL(url.replace(/^postgres(ql)?:/, "http:")).hostname;
if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)) {
  stop(`Refusing: DATABASE_URL points at ${host}, not this computer. This only ever loads a local database.`);
}

// psql's own commands (\restrict and the like) are not SQL, and a setting the
// server may be too old to know is not needed to load rows.
const sql = (await readFile(file, "utf8"))
  .split(/\r?\n/)
  .filter((line) => !line.startsWith("\\") && !/^SET transaction_timeout\b/.test(line))
  .join("\n");
const expected = sql.match(/^INSERT INTO /gm)?.length ?? 0;

const client = new pg.Client({ connectionString: url });
await client.connect();

async function tables() {
  const { rows } = await client.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> '_prisma_migrations'
      order by table_name`
  );
  return rows.map((row) => row.table_name);
}

async function countRows(names) {
  if (names.length === 0) return 0;
  const union = names.map((name) => `select count(*)::int as n from public."${name}"`).join(" union all ");
  const { rows } = await client.query(`select coalesce(sum(n), 0)::int as total from (${union}) counts`);
  return rows[0].total;
}

try {
  const names = await tables();
  if (names.length === 0) stop("No tables yet. Run `npx prisma migrate deploy` first, then this again.");

  const before = await countRows(names);
  if (before > 0 && !replace) {
    stop(`The database already holds ${before} rows. Run again with --replace to empty it and load the copy.`);
  }

  await client.query("begin");
  if (before > 0) {
    await client.query(`truncate table ${names.map((name) => `public."${name}"`).join(", ")} cascade`);
  }
  // The copy switches each table's triggers off while it loads, so rows can
  // arrive in any order without tripping a foreign key.
  await client.query(sql);
  await client.query("commit");

  const after = await countRows(names);
  console.log(`Loaded ${after} rows into ${names.length} tables (the copy holds ${expected}).`);
  if (after !== expected) process.exitCode = 1;
} catch (error) {
  await client.query("rollback").catch(() => {});
  console.error(`Nothing was loaded: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
