import { formatDayIn, formatTimeIn } from "@/lib/time";

// The manager's "is everything running" screen, as facts.
//
// Every row is one thing the studio depends on — the site, its database, the
// PC it runs on, the jobs that run by themselves, the backups, the WhatsApp
// worker, push, and the way in and out of the office — with a state and the
// fact the state was read from. Nothing here guesses: a check that could not
// see what it was looking for says "unknown" and why, which is a different
// answer from "down", in the same way the day board never reads silence as a
// verdict. "The backups folder is not visible from here" must never come out
// as "there are no backups".
//
// This file is pure: thresholds, the judgement from facts to a row, the
// formatting, and the parsing of what the probes bring back (Cloudflare's
// trace, the backup log, go2rtc's stream list, the cron stamp). The probes
// themselves — the network, the disk, the database — are in status-checks.ts,
// and tests/status.test.ts holds this half to its word.

export type StatusState = "up" | "degraded" | "down" | "unknown";

/** One line of the screen. `value` is the short figure on the trailing side. */
export type StatusRow = {
  id: string;
  title: string;
  state: StatusState;
  detail: string;
  value?: string;
};

/** What `ops/status` answers. */
export type StatusReport = {
  checkedAt: string;
  server: StatusRow[];
  network: StatusRow[];
};

/**
 * The titles, fixed. The app translates them (ios/Resources/ar.lproj/
 * Status.strings), so a title is a key: changing one here means changing it
 * there too, or the Arabic screen shows the English.
 */
export const STATUS_TITLES = {
  site: "The site",
  database: "Database",
  load: "Processor load",
  memory: "Memory",
  disk: "Disk",
  hostDisk: "The PC's disk",
  jobs: "Scheduled jobs",
  meetings: "Meeting reminders",
  backups: "Database backups",
  whatsapp: "WhatsApp worker",
  apns: "iPhone push",
  webPush: "Web push",
  internet: "Internet",
  dns: "DNS",
  publicAddress: "Public address",
  cameras: "Office cameras",
} as const;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const GB = 1024 ** 3;

/**
 * Where each verdict turns. Written down in one place so the README and the
 * tests can name them, and so "amber" means the same thing on every row.
 */
export const LIMITS = {
  /** A database that takes this long to answer `SELECT 1` is struggling. */
  databaseSlowMs: 500,
  /** Share of `max_connections` in use before it is worth a word. */
  databaseConnectionsShare: 0.9,
  /** Free space, in bytes, on any disk. */
  diskDegradedBelow: 10 * GB,
  diskDownBelow: 2 * GB,
  /** Share of memory in use. */
  memoryDegradedAt: 0.9,
  memoryDownAt: 0.97,
  /** One-minute load per core. Load is never "down": the server answering is the proof it is not. */
  loadDegradedPerCore: 1.5,
  /** Backups are daily: a day and a bit is fine, a missed day is amber, two is red. */
  backupDegradedAfterMs: 26 * HOUR,
  backupDownAfterMs: 50 * HOUR,
  internetSlowMs: 1000,
  dnsSlowMs: 1000,
  publicSlowMs: 2500,
} as const;

// --- Formatting ---------------------------------------------------------------

/** "184 MB", "9.8 GB", "1007 GB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const text = unit === 0 ? String(Math.round(value)) : value < 10 ? value.toFixed(1) : String(Math.round(value));
  return `${text} ${units[unit]}`;
}

/** "38 ms", "2.1 s". */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1000) return `${Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0))} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** A length of time: "38 s", "4 min", "2 h 5 min", "3 d 4 h". */
export function formatSpan(ms: number): string {
  const seconds = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / SECOND));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}

/**
 * "4 min ago". A moment a few seconds old, or one slightly in the future
 * because two clocks disagree, is "just now" — never "-3 s ago".
 */
export function formatAgo(ms: number): string {
  return ms < 10 * SECOND ? "just now" : `${formatSpan(ms)} ago`;
}

/** "Thu, Oct 1 3:02 PM" in the studio's timezone — the platform's own wording. */
export function formatMoment(instant: Date, timezone: string): string {
  return `${formatDayIn(timezone, instant)} ${formatTimeIn(timezone, instant)}`;
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

// --- Keeping secrets out ------------------------------------------------------

/**
 * An error's message, safe to hand to a phone.
 *
 * Errors carry whatever they were given: a URL with a password in it, a token
 * in a query string, a key in a header. None of that may leave the server, so
 * every message a probe reports passes through here — credentials in URLs are
 * dropped, secret-looking query values and bearer values are blanked, long
 * opaque strings (keys, tokens) are cut out, and the whole is capped.
 */
export function scrub(message: unknown, max = 160): string {
  const raw =
    message instanceof Error ? message.message : typeof message === "string" ? message : message == null ? "" : String(message);
  let text = raw.replace(/\s+/g, " ").trim();
  // scheme://user:password@host → scheme://host
  text = text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1");
  // ?key=…, &token=…, password=…
  text = text.replace(
    /\b(key|token|secret|password|passwd|pass|auth|sig|signature|access_token|api_key|apikey)=([^&\s]+)/gi,
    "$1=…"
  );
  // Authorization values.
  text = text.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, "$1 …");
  // Anything long and opaque: a key, a token, a signature.
  text = text.replace(/[A-Za-z0-9+_-]{32,}={0,2}/g, "…");
  if (text.length > max) text = `${text.slice(0, max - 1)}…`;
  return text || "unknown error";
}

const NETWORK_CODES: Record<string, string> = {
  ECONNREFUSED: "connection refused",
  ECONNRESET: "connection reset",
  ETIMEDOUT: "timed out",
  ETIMEOUT: "timed out",
  EHOSTUNREACH: "host unreachable",
  ENETUNREACH: "network unreachable",
  ENOTFOUND: "name not found",
  ENODATA: "no address on record",
  ESERVFAIL: "the DNS server failed",
  EREFUSED: "the DNS server refused",
  EAI_AGAIN: "name lookup failed",
};

/** "connection refused (ECONNREFUSED)": the code, said in words where there are some. */
export function codeInWords(code: string): string {
  return NETWORK_CODES[code] ? `${NETWORK_CODES[code]} (${code})` : code;
}

/**
 * What went wrong with a request, in a sentence. `fetch` reports every
 * network failure as "fetch failed" and keeps the reason in `cause`, so the
 * useful part — ECONNREFUSED, ENOTFOUND, a certificate — is one level down.
 * Prisma's message is often nothing but "Invalid `prisma.$queryRaw()`
 * invocation:", with the reason only in `code`; that wrapper is dropped and
 * the code said in words instead.
 */
export function describeError(error: unknown, timeoutMs?: number): { code: string | null; message: string } {
  const outer = error as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown } | null;
  const cause = (outer?.cause ?? null) as { code?: unknown; message?: unknown } | null;
  const name = typeof outer?.name === "string" ? outer.name : "";

  if (name === "TimeoutError" || name === "AbortError") {
    return {
      code: "TIMEOUT",
      message: timeoutMs ? `no answer within ${formatMs(timeoutMs)}` : "no answer in time",
    };
  }

  const code =
    typeof cause?.code === "string" ? cause.code : typeof outer?.code === "string" ? outer.code : null;
  const raw =
    typeof cause?.message === "string" && cause.message
      ? cause.message
      : typeof outer?.message === "string"
        ? outer.message
        : error == null
          ? ""
          : String(error);
  const detail = raw.replace(/Invalid `[^`]*` invocation:?/g, "").trim();
  // Connecting to "localhost" tries ::1 and 127.0.0.1 at once, and both
  // refusing arrives as an AggregateError with no message of its own — so
  // "fetch failed" is all that is left unless the code is said instead.
  if ((!detail || detail === "fetch failed") && code) return { code, message: codeInWords(code) };
  return { code, message: scrub(detail) };
}

// --- Shared judgements --------------------------------------------------------

/** How old something may get: fine, then amber, then red. */
export function stateByAge(ageMs: number, degradedAfterMs: number, downAfterMs: number): StatusState {
  if (ageMs > downAfterMs) return "down";
  if (ageMs > degradedAfterMs) return "degraded";
  return "up";
}

/** The worse of two states. "unknown" sits between fine and amber: not a fault, but not a reassurance. */
export function worse(a: StatusState, b: StatusState): StatusState {
  const rank: Record<StatusState, number> = { up: 0, unknown: 1, degraded: 2, down: 3 };
  return rank[a] >= rank[b] ? a : b;
}

function row(id: string, title: string, state: StatusState, detail: string, value?: string): StatusRow {
  return value === undefined ? { id, title, state, detail } : { id, title, state, detail, value };
}

// --- The site -----------------------------------------------------------------

export type SiteFacts = {
  uptimeMs: number;
  build: string;
  node: string;
  timezone: string;
  now: number;
};

/** The process answering this read. It is up by definition — that it answered is the fact. */
export function siteRow(facts: SiteFacts): StatusRow {
  const since = new Date(facts.now - facts.uptimeMs);
  const build = facts.build === "development" ? "a development server" : `build ${facts.build.slice(0, 12)}`;
  return row(
    "site",
    STATUS_TITLES.site,
    "up",
    `Serving for ${formatSpan(facts.uptimeMs)}, since ${formatMoment(since, facts.timezone)} · ${build} · Node ${facts.node}`,
    formatSpan(facts.uptimeMs)
  );
}

// --- The database -------------------------------------------------------------

export type DatabaseFacts =
  | { ok: false; error: string }
  | {
      ok: true;
      ms: number;
      sizeBytes?: number | null;
      connections?: number | null;
      maxConnections?: number | null;
      version?: string | null;
      newestMigration?: string | null;
      applied?: number | null;
      /** Started and never finished: a migration that failed part-way. */
      unfinished?: number | null;
      /** In this build's prisma/migrations but not applied. */
      pending?: number | null;
    };

export type MigrationRecord = { name: string; finished: boolean; rolledBack: boolean };

/**
 * What `_prisma_migrations` says, set against the migrations this build
 * carries. A row that started and never finished is a migration that failed
 * part-way; a folder with no finished row is one that never ran — either way
 * the site may be running code against tables it expects and does not have.
 * `buildMigrations` is null when the folder could not be read, and then
 * nothing is claimed about pending ones.
 */
export function migrationFacts(
  records: MigrationRecord[],
  buildMigrations: string[] | null
): { newestMigration: string | null; applied: number; unfinished: number; pending: number | null } {
  const applied = new Set(records.filter((record) => record.finished && !record.rolledBack).map((record) => record.name));
  const unfinished = new Set(
    records.filter((record) => !record.finished && !record.rolledBack && !applied.has(record.name)).map((record) => record.name)
  );
  const newestMigration = [...applied].sort().pop() ?? null;
  const pending = buildMigrations ? buildMigrations.filter((name) => !applied.has(name) && !unfinished.has(name)).length : null;
  return { newestMigration, applied: applied.size, unfinished: unfinished.size, pending };
}

export function databaseRow(facts: DatabaseFacts): StatusRow {
  if (!facts.ok) {
    return row("database", STATUS_TITLES.database, "down", `Did not answer: ${scrub(facts.error)}`);
  }

  let state: StatusState = "up";
  const problems: string[] = [];
  const details: string[] = [`Answered in ${formatMs(facts.ms)}`];

  if (facts.ms >= LIMITS.databaseSlowMs) {
    state = "degraded";
    problems.push(`Slow: ${formatMs(facts.ms)} for the simplest query`);
    details.shift();
  }
  if (facts.unfinished) {
    state = "degraded";
    problems.push(`${plural(facts.unfinished, "migration")} started and did not finish`);
  }
  if (facts.pending) {
    state = "degraded";
    problems.push(`${plural(facts.pending, "migration")} in this build not applied`);
  }

  if (facts.sizeBytes != null) details.push(formatBytes(facts.sizeBytes));
  if (facts.connections != null) {
    if (facts.maxConnections) {
      details.push(`${facts.connections} of ${facts.maxConnections} connections`);
      if (facts.connections >= facts.maxConnections * LIMITS.databaseConnectionsShare) {
        state = "degraded";
        problems.push(`Nearly out of connections: ${facts.connections} of ${facts.maxConnections}`);
      }
    } else {
      details.push(plural(facts.connections, "connection"));
    }
  }
  const version = facts.version?.trim().split(/\s+/)[0];
  if (version) details.push(`PostgreSQL ${version}`);
  if (facts.newestMigration) {
    details.push(
      `newest migration ${facts.newestMigration}${facts.applied ? ` (${facts.applied} applied)` : ""}`
    );
  }

  return row("database", STATUS_TITLES.database, state, [...problems, ...details].join(" · "), formatMs(facts.ms));
}

// --- The machine --------------------------------------------------------------

/** Where the numbers come from: inside Docker they describe Docker's Linux VM, not Windows. */
export type MachineWhere = "docker" | "darwin" | "linux" | "win32" | "other";

export function machineLabel(where: MachineWhere): string {
  switch (where) {
    case "docker":
      return "Docker's Linux VM";
    case "darwin":
      return "this Mac";
    case "win32":
      return "this Windows PC";
    case "linux":
      return "this Linux machine";
    default:
      return "this machine";
  }
}

export type LoadFacts = { where: MachineWhere; loadavg: number[]; cores: number };

export function loadRow(facts: LoadFacts): StatusRow {
  // Node reports [0, 0, 0] on Windows, always: that is "not measured", not "idle".
  if (facts.where === "win32") {
    return row("load", STATUS_TITLES.load, "unknown", "Windows does not report a load average");
  }
  const [one = 0, five = 0, fifteen = 0] = facts.loadavg;
  const cores = Math.max(1, facts.cores);
  const busy = one / cores >= LIMITS.loadDegradedPerCore;
  const figures = [one, five, fifteen].map((value) => value.toFixed(2)).join(" · ");
  return row(
    "load",
    STATUS_TITLES.load,
    busy ? "degraded" : "up",
    `${busy ? "Busy: " : ""}1, 5 and 15 min load ${figures} on ${plural(cores, "core")} of ${machineLabel(facts.where)}`,
    one.toFixed(2)
  );
}

export type MemoryFacts = {
  where: MachineWhere;
  total: number;
  free: number;
  /** This site's own Node process. */
  rss: number;
  /** The container's memory limit, when one is set. */
  limit?: number | null;
};

export function memoryRow(facts: MemoryFacts): StatusRow {
  const used = Math.max(0, facts.total - facts.free);
  const share = facts.total > 0 ? used / facts.total : 0;
  let state: StatusState = share >= LIMITS.memoryDownAt ? "down" : share >= LIMITS.memoryDegradedAt ? "degraded" : "up";

  let own = `this site's process ${formatBytes(facts.rss)}`;
  if (facts.limit) {
    own += ` of its ${formatBytes(facts.limit)} limit`;
    if (facts.rss >= facts.limit * LIMITS.memoryDegradedAt) state = worse(state, "degraded");
  }
  // On Linux — the container — "free" is what the kernel calls available,
  // cache included. macOS reports only pages nobody has touched, so a healthy
  // Mac reads as full: the figure is shown, and not judged.
  const caveat = facts.where === "darwin" ? " (macOS counts its cache as in use, so this is not judged)" : "";
  if (facts.where === "darwin") state = "unknown";

  return row(
    "memory",
    STATUS_TITLES.memory,
    state,
    `${formatBytes(used)} of ${formatBytes(facts.total)} in use on ${machineLabel(facts.where)}${caveat} · ${own}`,
    `${Math.round(share * 100)}%`
  );
}

export type DiskFacts = { ok: true; total: number; free: number } | { ok: false; error: string };

/** Free space on one disk. `where` says which disk, in words: the numbers mean nothing without it. */
export function diskRow(id: string, title: string, facts: DiskFacts, where: string): StatusRow {
  if (!facts.ok) return row(id, title, "unknown", `Could not be measured: ${scrub(facts.error)}`);
  const state: StatusState =
    facts.free < LIMITS.diskDownBelow ? "down" : facts.free < LIMITS.diskDegradedBelow ? "degraded" : "up";
  return row(
    id,
    title,
    state,
    `${state === "up" ? "" : "Running out: "}${formatBytes(facts.free)} free of ${formatBytes(facts.total)} ${where}`,
    `${formatBytes(facts.free)} free`
  );
}

// --- Scheduled jobs -----------------------------------------------------------
//
// The cron endpoint stamps an AppSetting every time it runs (the route writes
// it; these are the names and the shape). Two schedulers call it: the full
// pass every ten minutes and the meetings pass every minute. They are judged
// separately, because the minute one would otherwise keep a single stamp
// fresh while the ten-minute one — the deadlines, the follow-ups, the rules —
// had been dead for a day.

export const CRON_STAMP_KEY = "cron_last_run";

/** Every job the endpoint can be told to run on its own (`?job=`). */
export const CRON_JOBS = ["tomorrow", "today", "deadlines", "followups", "rules", "meetings", "attendance", "stages", "clock", "location", "visits", "whatsapp"] as const;

/** The setting a run is stamped under: the full pass, or one forced job. Unknown jobs are not stamped. */
export function cronStampKey(job: string | null): string | null {
  if (!job) return CRON_STAMP_KEY;
  return (CRON_JOBS as readonly string[]).includes(job) ? `${CRON_STAMP_KEY}_${job}` : null;
}

export type CronStamp = { at: string; ok: boolean; ms: number };

export function cronStampValue(startedAt: Date, ok: boolean, finishedAt: Date = new Date()): string {
  const stamp: CronStamp = { at: startedAt.toISOString(), ok, ms: Math.max(0, finishedAt.getTime() - startedAt.getTime()) };
  return JSON.stringify(stamp);
}

/** Reads a stamp back. Anything unreadable is no stamp at all, never a run at the epoch. */
export function parseCronStamp(raw: string | null | undefined): CronStamp | null {
  if (!raw) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A bare timestamp, written by hand, still counts.
    parsed = { at: raw, ok: true, ms: 0 };
  }
  const candidate = parsed as Partial<CronStamp> | null;
  if (!candidate || typeof candidate.at !== "string" || Number.isNaN(Date.parse(candidate.at))) return null;
  return {
    at: new Date(candidate.at).toISOString(),
    ok: candidate.ok !== false,
    ms: typeof candidate.ms === "number" && Number.isFinite(candidate.ms) ? candidate.ms : 0,
  };
}

export const SCHEDULES = {
  jobs: {
    id: "jobs",
    title: STATUS_TITLES.jobs,
    key: CRON_STAMP_KEY,
    every: "every 10 minutes",
    container: "neon-scheduler",
    degradedAfterMs: 20 * MINUTE,
    downAfterMs: 60 * MINUTE,
  },
  meetings: {
    id: "meetings",
    title: STATUS_TITLES.meetings,
    key: `${CRON_STAMP_KEY}_meetings`,
    every: "every minute",
    container: "neon-meeting-scheduler",
    degradedAfterMs: 5 * MINUTE,
    downAfterMs: 20 * MINUTE,
  },
} as const;

export type ScheduleKind = keyof typeof SCHEDULES;

/**
 * When a scheduler last called the endpoint. No stamp at all is "unknown"
 * while the server is younger than the amber line — the first run may simply
 * not have come yet — and "down" after it.
 */
export function scheduleRow(
  kind: ScheduleKind,
  stamp: CronStamp | null,
  now: number,
  uptimeMs: number,
  timezone: string
): StatusRow {
  const schedule = SCHEDULES[kind];
  if (!stamp) {
    if (uptimeMs < schedule.degradedAfterMs) {
      return row(schedule.id, schedule.title, "unknown", `No run recorded yet · ${schedule.container} calls it ${schedule.every}`);
    }
    return row(
      schedule.id,
      schedule.title,
      "down",
      `No run has ever been recorded · ${schedule.container} (docker compose --profile live) calls it ${schedule.every}`
    );
  }

  const at = new Date(stamp.at);
  const age = now - at.getTime();
  let state = stateByAge(age, schedule.degradedAfterMs, schedule.downAfterMs);
  if (!stamp.ok) state = worse(state, "degraded");

  const when = `${formatAgo(age)} (${formatMoment(at, timezone)})`;
  const detail = stamp.ok
    ? `Last run ${when}, took ${formatMs(stamp.ms)} · expected ${schedule.every}`
    : `The last run, ${when}, failed part-way · see docker logs ${schedule.container}`;
  return row(schedule.id, schedule.title, state, detail, formatAgo(age));
}

// --- Backups ------------------------------------------------------------------
//
// scripts/backup-docker-db.ps1 runs daily on the PC and writes
// local-backup\docker\neon-yyyy-MM-dd-HHmm.dump, then a line to backup.log:
// "2026-09-30T03:00:01  ok      neon-….dump (12345 KB)" or "…  FAILED  <why>".
// docker-compose.yml mounts that folder into neon-app read-only at /backups.

export type BackupFile = { name: string; size: number; modifiedAt: number };
export type BackupLogLine = { text: string; ok: boolean | null };

export const BACKUP_FILE_PATTERN = /^neon-.*\.dump$/i;

/** The newest daily dump. Hand-made copies (before-fixture-cleanup.dump) are not the schedule's. */
export function newestBackup(files: BackupFile[]): BackupFile | null {
  let newest: BackupFile | null = null;
  for (const file of files) {
    if (!BACKUP_FILE_PATTERN.test(file.name)) continue;
    if (!newest || file.modifiedAt > newest.modifiedAt) newest = file;
  }
  return newest;
}

/** The log's last line, and whether it reports success. */
export function lastBackupLogLine(log: string): BackupLogLine | null {
  const lines = log
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) return null;
  const ok = /\bFAILED\b/.test(last) ? false : /\bok\b/.test(last) ? true : null;
  return { text: last.replace(/\s{2,}/g, " "), ok };
}

export type BackupFacts =
  | { visible: false; reason: string }
  | { visible: true; files: BackupFile[]; log: BackupLogLine | null };

export function backupsRow(facts: BackupFacts, now: number): StatusRow {
  const id = "backups";
  const title = STATUS_TITLES.backups;
  if (!facts.visible) return row(id, title, "unknown", `Not visible from the server: ${facts.reason}`);

  const daily = facts.files.filter((file) => BACKUP_FILE_PATTERN.test(file.name));
  const newest = newestBackup(daily);
  const failed = facts.log?.ok === false ? ` · the last run failed: ${scrub(facts.log.text)}` : "";

  if (!newest) {
    return row(id, title, "down", `The folder is visible but holds no backups${failed}`);
  }

  const age = now - newest.modifiedAt;
  let state = stateByAge(age, LIMITS.backupDegradedAfterMs, LIMITS.backupDownAfterMs);
  if (facts.log?.ok === false) state = worse(state, "degraded");

  return row(
    id,
    title,
    state,
    `Newest ${newest.name}, ${formatAgo(age)}, ${formatBytes(newest.size)} · ${daily.length} kept${failed}`,
    formatAgo(age)
  );
}

// --- WhatsApp -----------------------------------------------------------------

export type WhatsAppFacts =
  | { transport: "none" }
  | { transport: "cloud"; ok: boolean; detail: string; number?: string | null }
  | {
      transport: "worker";
      /** host:port, never the key. */
      at: string;
      reachable: boolean;
      error?: string | null;
      line?: { status: string; phone?: string | null; error?: string | null } | null;
      lineError?: string | null;
    };

function phoneLabel(phone: string | null | undefined) {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  return digits ? ` as +${digits}` : "";
}

export function whatsappRow(facts: WhatsAppFacts): StatusRow {
  const id = "whatsapp";
  const title = STATUS_TITLES.whatsapp;
  if (facts.transport === "none") return row(id, title, "unknown", "Not set up on this server");

  if (facts.transport === "cloud") {
    return facts.ok
      ? row(id, title, "up", `Meta's Cloud API: ${scrub(facts.detail)}${phoneLabel(facts.number)}`)
      : row(id, title, "down", `Meta's Cloud API refused: ${scrub(facts.detail)}`);
  }

  if (!facts.reachable) {
    return row(id, title, "down", `The worker at ${facts.at} did not answer: ${scrub(facts.error ?? "no answer")}`);
  }
  if (!facts.line) {
    return row(id, title, "degraded", `The worker answers at ${facts.at}, but its line could not be read: ${scrub(facts.lineError ?? "no answer")}`);
  }

  switch (facts.line.status) {
    case "connected":
      return row(id, title, "up", `Connected${phoneLabel(facts.line.phone)} · worker at ${facts.at}`, "Connected");
    case "pending":
      return row(id, title, "degraded", "Waiting for the QR code to be scanned · link the number in Settings");
    case "disconnected":
      return row(id, title, "degraded", "The worker is running, but no number is linked · link it in Settings");
    case "error":
      return row(id, title, "down", `The session reports an error: ${scrub(facts.line.error ?? "no detail")}`);
    default:
      return row(id, title, "degraded", `The line reads "${scrub(facts.line.status, 40)}"`);
  }
}

// --- Push ---------------------------------------------------------------------

export type DeliveryTally = {
  /** Last 24 hours. */
  sent: number;
  failed: number;
  last: { at: number; status: string; detail: string | null } | null;
};

function deliveryLine(tally: DeliveryTally, now: number): string {
  const parts = [`last 24 h: ${tally.sent} delivered, ${tally.failed} failed`];
  if (tally.last) {
    const outcome = tally.last.status === "SENT" ? "went through" : `${tally.last.status.toLowerCase()}${tally.last.detail ? ` (${scrub(tally.last.detail, 80)})` : ""}`;
    parts.push(`the last one ${formatAgo(now - tally.last.at)} ${outcome}`);
  }
  return parts.join(" · ");
}

/** More failures than deliveries, over enough of them to mean something. */
function mostlyFailing(tally: DeliveryTally) {
  return tally.failed >= 3 && tally.failed > tally.sent;
}

export type ApnsFacts = { configured: boolean; devices: number | null; tally: DeliveryTally | null };

export function apnsRow(facts: ApnsFacts, now: number): StatusRow {
  const id = "apns";
  const title = STATUS_TITLES.apns;
  const devices = facts.devices == null ? null : plural(facts.devices, "iPhone");
  if (!facts.configured) {
    return row(
      id,
      title,
      "degraded",
      `Not configured: the iPhone app gets no notifications${devices && facts.devices ? ` · ${devices} registered and waiting` : ""}`
    );
  }
  if (!facts.tally) {
    return row(id, title, "up", "Configured · delivery figures need the database, which did not answer", devices ?? undefined);
  }
  const state: StatusState = mostlyFailing(facts.tally) ? "degraded" : "up";
  return row(
    id,
    title,
    state,
    `${state === "degraded" ? "Mostly failing" : "Configured"}${devices ? ` · ${devices} registered` : ""} · ${deliveryLine(facts.tally, now)}`,
    devices ?? undefined
  );
}

export type WebPushFacts =
  | { readable: false }
  | { readable: true; configured: boolean; source: "environment" | "database" | null; subscriptions: number; tally: DeliveryTally };

export function webPushRow(facts: WebPushFacts, now: number): StatusRow {
  const id = "web-push";
  const title = STATUS_TITLES.webPush;
  if (!facts.readable) return row(id, title, "unknown", "Can't tell: the keys and the figures are in the database, which did not answer");
  if (!facts.configured) return row(id, title, "down", "No signing keys could be read, so nothing can be pushed to a browser");

  const keys = facts.source === "environment" ? "Keys set in the environment" : "Keys generated by the platform";
  const state: StatusState = mostlyFailing(facts.tally) ? "degraded" : "up";
  const devices = plural(facts.subscriptions, "browser");
  return row(
    id,
    title,
    state,
    `${state === "degraded" ? "Mostly failing · " : ""}${keys} · ${devices} subscribed · ${deliveryLine(facts.tally, now)}`,
    devices
  );
}

// --- The network --------------------------------------------------------------

/** Cloudflare's /cdn-cgi/trace: "key=value" lines — ip, colo, loc, and the rest. */
export function parseTrace(text: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at > 0) found[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return found;
}

export type InternetFacts =
  | { ok: true; ms: number; trace: Record<string, string>; via: string; fellBack: boolean }
  | { ok: false; error: string };

export function internetRow(facts: InternetFacts): StatusRow {
  const id = "internet";
  const title = STATUS_TITLES.internet;
  if (!facts.ok) return row(id, title, "down", `Cloudflare could not be reached from the server: ${scrub(facts.error)}`);

  const slow = facts.ms >= LIMITS.internetSlowMs;
  const parts = [`${slow ? "Slow: " : ""}Cloudflare answered in ${formatMs(facts.ms)}`];
  if (facts.trace.ip) parts.push(`public IP ${facts.trace.ip}`);
  if (facts.trace.colo) parts.push(`through Cloudflare ${facts.trace.colo}${facts.trace.loc ? `, ${facts.trace.loc}` : ""}`);
  if (facts.fellBack) parts.push(`1.1.1.1 did not answer, ${facts.via} did`);
  return row(id, title, slow ? "degraded" : "up", parts.join(" · "), formatMs(facts.ms));
}

export type DnsLookup =
  | { host: string; ok: true; ms: number; addresses: string[] }
  | { host: string; ok: false; ms: number; error: string };

/**
 * The studio's own name, and a reference name, both resolved from the
 * server. Our name failing while the reference resolves is a broken record,
 * not a broken resolver — the two need different people to fix them.
 */
export function dnsRow(own: DnsLookup, reference: DnsLookup): StatusRow {
  const id = "dns";
  const title = STATUS_TITLES.dns;
  if (!own.ok && !reference.ok) {
    return row(id, title, "down", `Nothing resolves from the server: ${own.host} and ${reference.host} both failed (${scrub(own.error, 60)})`);
  }
  if (!own.ok) {
    return row(id, title, "degraded", `The resolver works (${reference.host}), but ${own.host} did not resolve: ${scrub(own.error, 60)}`, formatMs(reference.ms));
  }
  if (!reference.ok) {
    return row(id, title, "degraded", `${own.host} resolved, but ${reference.host} did not: ${scrub(reference.error, 60)}`, formatMs(own.ms));
  }
  const slow = own.ms >= LIMITS.dnsSlowMs;
  const shown = own.addresses.slice(0, 2).join(", ") + (own.addresses.length > 2 ? ", …" : "");
  return row(
    id,
    title,
    slow ? "degraded" : "up",
    `${slow ? "Slow: " : ""}${own.host} → ${shown} in ${formatMs(own.ms)}`,
    formatMs(own.ms)
  );
}

/** "8c9f1e2d3b4a5c6d-AMM" → "AMM": the Cloudflare data centre that carried the request. */
export function rayColo(ray: string | null | undefined): string | null {
  if (!ray) return null;
  const at = ray.lastIndexOf("-");
  const colo = at >= 0 ? ray.slice(at + 1).trim() : "";
  return /^[A-Z]{3}$/.test(colo) ? colo : null;
}

export type PublicFacts =
  | { url: string; ok: true; status: number; ms: number; ray: string | null }
  | { url: string; ok: false; error: string };

/**
 * The public address fetched from the server itself: out to the internet,
 * into Cloudflare, back down the tunnel to this site. An answer proves DNS,
 * the office's internet, Cloudflare and the tunnel at once; a 530 is
 * Cloudflare saying the tunnel is not connected.
 */
export function publicRow(facts: PublicFacts): StatusRow {
  const id = "public";
  const title = STATUS_TITLES.publicAddress;
  const host = (() => {
    try {
      return new URL(facts.url).host;
    } catch {
      return facts.url;
    }
  })();

  if (!facts.ok) return row(id, title, "down", `No answer from ${host}: ${scrub(facts.error)}`);

  const { status, ms } = facts;
  if (status === 530) {
    return row(id, title, "down", `Cloudflare answered 530: the tunnel (neon-tunnel) is not connected`, String(status));
  }
  if (status === 502 || status === 503 || status === 504) {
    return row(id, title, "down", `Answered ${status}: the request reached Cloudflare but got no answer from the site behind the tunnel`, String(status));
  }
  if (status >= 500) return row(id, title, "down", `Answered ${status}`, String(status));
  if (status >= 400) return row(id, title, "degraded", `Answered ${status}: something refused the request on its way`, String(status));

  const colo = rayColo(facts.ray);
  if (!facts.ray) {
    return row(id, title, "degraded", `${host} answered ${status}, but not through Cloudflare (no cf-ray header)`, formatMs(ms));
  }
  const slow = ms >= LIMITS.publicSlowMs;
  return row(
    id,
    title,
    slow ? "degraded" : "up",
    `${slow ? "Slow: " : ""}${host} answered ${status} in ${formatMs(ms)}, out through Cloudflare${colo ? ` ${colo}` : ""} and back in through the tunnel`,
    formatMs(ms)
  );
}

// --- The office cameras' relay (go2rtc) ---------------------------------------

export type CameraStream = { name: string; producers: number; online: number };

/**
 * go2rtc's /api/streams: `{ "<name>": { producers: [...], consumers: [...] } }`.
 *
 * A producer is drawn as `{ "url": … }` until go2rtc connects to it, and as the
 * whole connection (remote address, media, bytes) while it is connected — and
 * go2rtc connects to a camera only while somebody is watching it. So "online"
 * is what go2rtc reports, and a camera with nobody watching is idle, not
 * offline. Only names and counts are kept: a producer's URL is the camera's
 * RTSP address, password and all.
 */
export function parseStreams(json: unknown): CameraStream[] {
  if (!json || typeof json !== "object" || Array.isArray(json)) return [];
  const streams: CameraStream[] = [];
  for (const [name, value] of Object.entries(json as Record<string, unknown>)) {
    const producers = Array.isArray((value as { producers?: unknown } | null)?.producers)
      ? ((value as { producers: unknown[] }).producers)
      : [];
    const online = producers.filter((producer) => {
      if (!producer || typeof producer !== "object") return false;
      return Object.entries(producer as Record<string, unknown>).some(
        ([key, field]) => key !== "url" && field !== null && field !== undefined && field !== ""
      );
    }).length;
    streams.push({ name, producers: producers.length, online });
  }
  return streams.sort((a, b) => a.name.localeCompare(b.name));
}

export type CamerasFacts =
  | { configured: false }
  | { configured: true; at: string; ok: false; error: string; status?: number | null }
  | { configured: true; at: string; ok: true; streams: CameraStream[] };

export function camerasRow(facts: CamerasFacts): StatusRow {
  const id = "cameras";
  const title = STATUS_TITLES.cameras;
  if (!facts.configured) return row(id, title, "unknown", "Not set up: there is no cameras relay (neon-cameras) on this server");

  if (!facts.ok) {
    if (facts.status === 401 || facts.status === 403) {
      return row(id, title, "degraded", `The relay at ${facts.at} refused the request (${facts.status})`);
    }
    return row(id, title, "down", `The relay at ${facts.at} did not answer: ${scrub(facts.error)}`);
  }

  const count = facts.streams.length;
  if (count === 0) return row(id, title, "degraded", `The relay at ${facts.at} answers, but lists no cameras`, "0 cameras");

  const streaming = facts.streams.filter((stream) => stream.online > 0);
  const names = streaming.slice(0, 4).map((stream) => stream.name).join(", ") + (streaming.length > 4 ? ", …" : "");
  const live = streaming.length
    ? `${streaming.length} streaming now: ${names}`
    : "none streaming now — the relay connects to a camera only while someone watches";
  return row(id, title, "up", `${plural(count, "camera")} listed · ${live}`, plural(count, "camera"));
}
