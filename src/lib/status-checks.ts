import os from "node:os";
import { existsSync } from "node:fs";
import { open, readdir, readFile, stat, statfs } from "node:fs/promises";
import { lookup as dnsLookup, Resolver } from "node:dns/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { appVersion } from "@/lib/app-version";
import { TIMEZONE_SETTING_KEY } from "@/lib/settings";
import { resolveTimezone } from "@/lib/time";
import { isApnsConfigured } from "@/lib/notifications/apns";
import { isPushConfigured } from "@/lib/notifications/push";
import { getVapidKeys } from "@/lib/notifications/vapid";
import { activeTransport, checkWhatsAppConnection } from "@/lib/whatsapp";
import { getWhatsAppConfig, lineStatus, whatsAppHealth } from "@/lib/whatsapp/worker";
import {
  apnsRow,
  backupsRow,
  camerasRow,
  codeInWords,
  databaseRow,
  describeError,
  diskRow,
  dnsRow,
  formatMs,
  internetRow,
  lastBackupLogLine,
  loadRow,
  memoryRow,
  migrationFacts,
  parseCronStamp,
  parseStreams,
  parseTrace,
  publicRow,
  SCHEDULES,
  scheduleRow,
  siteRow,
  STATUS_TITLES,
  webPushRow,
  whatsappRow,
  type BackupFacts,
  type BackupFile,
  type CamerasFacts,
  type DatabaseFacts,
  type DeliveryTally,
  type DiskFacts,
  type DnsLookup,
  type InternetFacts,
  type MachineWhere,
  type MigrationRecord,
  type PublicFacts,
  type StatusReport,
  type StatusRow,
  type WhatsAppFacts,
} from "@/lib/status";

// The probes behind the manager's status screen (`ops/status` in the phone
// API). Each one goes and looks — at the database, the disk, the network, the
// services beside the site — and hands what it saw to the pure judgements in
// status.ts.
//
// Three rules hold for all of them:
//
// - **Every probe has a timeout of a few seconds, and they run side by side**,
//   so the whole read answers in about four seconds however much is broken.
//   The database's are the exception to "side by side": they run one after
//   another on purpose, because firing them together is what kills the local
//   development database (README, "Gotchas"), and together they take a few
//   milliseconds anyway.
// - **One failing probe never fails the read.** Each is settled on its own; a
//   probe that throws or overruns becomes an "unknown" row saying so.
// - **Nothing secret leaves.** Rows carry facts — times, sizes, counts, host
//   names — never a key, a token, a password or a connection string. Every
//   error message goes through `scrub` before it reaches a row, and the
//   things that hold secrets (the WhatsApp line's QR, a camera's RTSP URL, the
//   database URL) are never read into a row in the first place.
//
// Nothing here talks to Docker. The site's container is not given the Docker
// socket — that would be root on the PC — so each neighbour's health is read
// off what it does: the schedulers stamp the cron endpoint when they call it,
// the backup task writes files and a log line, the tunnel carries a request.

const TIMEOUT = {
  database: 3000,
  internet: 3500,
  publicAddress: 4000,
  dns: 2500,
  worker: 3000,
  cameras: 3000,
  files: 2500,
} as const;

/** The last resort around every probe: past this, the row says the check itself overran. */
const PROBE_BUDGET_MS = 4500;

/** The public address, as clients use it. Fetched from here, it goes out and comes back in through the tunnel. */
const PUBLIC_URL = "https://clients.neonjo.com/employee/login";

/** A name that resolves on any working resolver, to tell "DNS is broken" from "our record is". */
const REFERENCE_HOST = "cloudflare.com";

/** Cloudflare's trace, by address first (no DNS involved), then by name. */
const TRACE_URLS = ["https://1.1.1.1/cdn-cgi/trace", "https://cloudflare.com/cdn-cgi/trace"] as const;

/** go2rtc's own default port, on the service name docker-compose.yml gives it. */
const CAMERAS_DEFAULT_URL = "http://neon-cameras:1984";

/**
 * Where the daily backups are visible from this process: the read-only mount
 * docker-compose.yml gives neon-app, or — running outside Docker on the PC —
 * the folder itself.
 */
function backupFolders(): string[] {
  return [process.env.BACKUPS_DIR?.trim(), "/backups", path.join(process.cwd(), "local-backup", "docker")].filter(
    (folder): folder is string => Boolean(folder)
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

// --- Plumbing -----------------------------------------------------------------

function timeoutError(ms: number) {
  return Object.assign(new Error(`no answer within ${formatMs(ms)}`), { name: "TimeoutError" });
}

/** Rejects once `ms` has passed. The work itself carries on unobserved, and its outcome is dropped. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeoutError(ms)), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

/** A probe's row, or — if it threw or overran — an honest "unknown" in its place. */
async function settle(id: string, title: string, probe: () => Promise<StatusRow>): Promise<StatusRow> {
  try {
    return await withTimeout(probe(), PROBE_BUDGET_MS);
  } catch (error) {
    return { id, title, state: "unknown", detail: `The check itself did not finish: ${describeError(error, PROBE_BUDGET_MS).message}` };
  }
}

/** host:port of a URL — never its user, password, path or query. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "an address that is not a URL";
  }
}

function machineWhere(): MachineWhere {
  if (process.platform === "linux") return existsSync("/.dockerenv") ? "docker" : "linux";
  if (process.platform === "darwin" || process.platform === "win32") return process.platform;
  return "other";
}

// --- The database, and everything kept in it ----------------------------------

type DatabaseChain = {
  database: DatabaseFacts;
  /** The timezone and the cron stamps, or null when the database did not answer. */
  settings: Map<string, string> | null;
  push: {
    configured: boolean;
    source: "environment" | "database" | null;
    subscriptions: number;
    iphones: number;
    apns: DeliveryTally;
    web: DeliveryTally;
  } | null;
};

/** This build's migrations, by folder name — what `prisma migrate deploy` would apply. */
async function buildMigrations(): Promise<string[] | null> {
  try {
    const entries = await withTimeout(readdir(path.join(process.cwd(), "prisma", "migrations"), { withFileTypes: true }), TIMEOUT.files);
    return entries.filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name)).map((entry) => entry.name);
  } catch {
    return null;
  }
}

function tally(
  grouped: { channel: string; status: string; _count: { _all: number } }[],
  channel: "APNS" | "WEB_PUSH",
  last: { createdAt: Date; status: string; detail: string | null } | null
): DeliveryTally {
  const count = (status: string) =>
    grouped.filter((group) => group.channel === channel && group.status === status).reduce((sum, group) => sum + group._count._all, 0);
  return {
    sent: count("SENT"),
    failed: count("FAILED"),
    last: last ? { at: last.createdAt.getTime(), status: last.status, detail: last.detail } : null,
  };
}

/**
 * The database first — does it answer, how fast, how big, which migrations —
 * then the facts that live in it: the timezone, the cron stamps, push. One
 * query at a time, inside one shared deadline.
 */
async function databaseChain(): Promise<DatabaseChain> {
  // One deadline for the whole chain: past it, the remaining steps are not
  // started at all, so a slow database cannot push the read past its budget.
  const deadline = Date.now() + TIMEOUT.database;
  const step = <T>(work: () => Promise<T>): Promise<T> => {
    const left = deadline - Date.now();
    return left > 0 ? withTimeout(work(), left) : Promise.reject(timeoutError(TIMEOUT.database));
  };

  const started = performance.now();
  try {
    await step(() => prisma.$queryRaw`SELECT 1`);
  } catch (error) {
    return { database: { ok: false, error: describeError(error, TIMEOUT.database).message }, settings: null, push: null };
  }
  const ms = performance.now() - started;

  // Each of the rest is a detail: a database that answers `SELECT 1` and then
  // cannot say its own size is still up, so these fail quietly into "not
  // shown" rather than into "down".
  type Stats = { size: bigint | number | null; connections: number | null; max_connections: number | null; version: string | null };
  const stats = await step(
    () => prisma.$queryRaw<Stats[]>`
      SELECT pg_database_size(current_database())::bigint AS size,
             (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::int AS connections,
             current_setting('max_connections')::int AS max_connections,
             current_setting('server_version') AS version`
  )
    .then((rows) => rows[0] ?? null)
    .catch(() => null);

  type Migration = { migration_name: string; finished: boolean; rolled_back: boolean };
  const migrations = await step(
    () => prisma.$queryRaw<Migration[]>`
      SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back
      FROM "_prisma_migrations"`
  ).catch(() => null);
  const records: MigrationRecord[] | null =
    migrations?.map((record) => ({ name: record.migration_name, finished: record.finished, rolledBack: record.rolled_back })) ?? null;
  const folders = records ? await step(() => buildMigrations()).catch(() => null) : null;
  const migrated = records ? migrationFacts(records, folders) : null;

  const database: DatabaseFacts = {
    ok: true,
    ms,
    sizeBytes: stats?.size != null ? Number(stats.size) : null,
    connections: stats?.connections ?? null,
    maxConnections: stats?.max_connections ?? null,
    version: stats?.version ?? null,
    newestMigration: migrated?.newestMigration ?? null,
    applied: migrated?.applied ?? null,
    unfinished: migrated?.unfinished ?? null,
    pending: migrated?.pending ?? null,
  };

  const settings = await step(() =>
    prisma.appSetting.findMany({
      where: { key: { in: [TIMEZONE_SETTING_KEY, SCHEDULES.jobs.key, SCHEDULES.meetings.key] } },
      select: { key: true, value: true },
    })
  )
    .then((rows) => new Map(rows.map((row) => [row.key, row.value])))
    .catch(() => null);

  const push = await (async () => {
    const configured = await step(() => isPushConfigured());
    const keys = await step(() => getVapidKeys());
    const subscriptions = await step(() => prisma.pushSubscription.count({ where: { active: true } }));
    const iphones = await step(() => prisma.deviceToken.count({ where: { active: true, kind: "ALERT" } }));
    const grouped = await step(() =>
      prisma.notificationDelivery.groupBy({
        by: ["channel", "status"],
        where: { channel: { in: ["APNS", "WEB_PUSH"] }, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
        _count: { _all: true },
      })
    );
    const lastOf = (channel: "APNS" | "WEB_PUSH") =>
      step(() =>
        prisma.notificationDelivery.findFirst({
          where: { channel },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true, status: true, detail: true },
        })
      );
    const lastApns = await lastOf("APNS");
    const lastWeb = await lastOf("WEB_PUSH");
    return {
      configured,
      source: keys?.source ?? null,
      subscriptions,
      iphones,
      apns: tally(grouped, "APNS", lastApns),
      web: tally(grouped, "WEB_PUSH", lastWeb),
    };
  })().catch(() => null);

  return { database, settings, push };
}

// --- The machine --------------------------------------------------------------

/** The container's memory limit, when Docker was given one. "max" (or a huge number) means none. */
async function containerMemoryLimit(): Promise<number | null> {
  if (process.platform !== "linux") return null;
  for (const file of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try {
      const text = (await withTimeout(readFile(file, "utf8"), TIMEOUT.files)).trim();
      if (text === "max") return null;
      const value = Number(text);
      return Number.isFinite(value) && value > 0 && value < 2 ** 60 ? value : null;
    } catch {
      // Not this cgroup version; try the other.
    }
  }
  return null;
}

async function diskFacts(folder: string): Promise<DiskFacts> {
  try {
    const stats = await withTimeout(statfs(folder), TIMEOUT.files);
    return { ok: true, total: stats.blocks * stats.bsize, free: stats.bavail * stats.bsize };
  } catch (error) {
    return { ok: false, error: describeError(error, TIMEOUT.files).message };
  }
}

/** Which disk "/" is, in words — the figure is meaningless without it. */
function rootDiskLabel(where: MachineWhere) {
  switch (where) {
    case "docker":
      return "on Docker's virtual disk, which holds its containers and volumes";
    case "darwin":
      return "on this Mac's disk";
    case "win32":
      return "on this PC's disk";
    default:
      return "on this machine's main disk";
  }
}

// --- Backups ------------------------------------------------------------------

async function firstVisibleFolder(): Promise<string | null> {
  for (const folder of backupFolders()) {
    try {
      if ((await withTimeout(stat(folder), TIMEOUT.files)).isDirectory()) return folder;
    } catch {
      // Not mounted here; try the next place.
    }
  }
  return null;
}

/**
 * The end of backup.log. Read from the tail, since it grows a line a day for
 * ever; decoded as UTF-16 when Windows wrote it that way (a BOM, or every
 * other byte zero), as UTF-8 otherwise.
 */
async function readLogTail(file: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(file, "r");
    const { size } = await handle.stat();
    // An even offset, so UTF-16 text is read on a character boundary.
    let start = Math.max(0, size - 4096);
    if (start % 2) start -= 1;
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const head = start === 0 ? buffer : null;
    const utf16 =
      (head && head[0] === 0xff && head[1] === 0xfe) ||
      buffer.subarray(0, 64).filter((byte, index) => index % 2 === 1 && byte === 0).length > 16;
    return utf16 ? buffer.toString("utf16le").replace(/^﻿/, "") : buffer.toString("utf8");
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function backupFacts(folder: string | null): Promise<BackupFacts> {
  if (!folder) return { visible: false, reason: "the backups folder is not mounted into the site's container" };
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    const dumps = entries.filter((entry) => entry.isFile() && /\.dump$/i.test(entry.name));
    const files: BackupFile[] = [];
    for (const entry of dumps) {
      const info = await stat(path.join(folder, entry.name));
      files.push({ name: entry.name, size: info.size, modifiedAt: info.mtimeMs });
    }
    const log = await readLogTail(path.join(folder, "backup.log"));
    return { visible: true, files, log: log ? lastBackupLogLine(log) : null };
  } catch (error) {
    return { visible: false, reason: `the backups folder could not be read (${describeError(error).message})` };
  }
}

// --- WhatsApp -----------------------------------------------------------------

/**
 * The checks the settings page makes — `/health` for "is it running", the
 * line's status for "is a number linked" — with this screen's timeout. Only
 * the line's state and number are kept; its QR and pairing code never are.
 */
async function whatsappFacts(): Promise<WhatsAppFacts> {
  const transport = activeTransport();
  if (transport === "none") return { transport: "none" };

  if (transport === "cloud") {
    try {
      const connection = await withTimeout(checkWhatsAppConnection(), TIMEOUT.worker);
      return { transport: "cloud", ok: connection.ok, detail: connection.detail, number: connection.number ?? null };
    } catch (error) {
      return { transport: "cloud", ok: false, detail: describeError(error, TIMEOUT.worker).message };
    }
  }

  const config = getWhatsAppConfig();
  const at = config ? hostOf(config.baseUrl) : "the worker";
  const failed = (error: unknown) => ({ ok: false as const, error: describeError(error, TIMEOUT.worker).message });
  const [health, line] = await Promise.all([
    withTimeout(whatsAppHealth(), TIMEOUT.worker).catch(failed),
    withTimeout(lineStatus(), TIMEOUT.worker).catch(failed),
  ]);

  // The helper words its own failures ("Could not reach the WhatsApp worker:
  // fetch failed"); the row already says which worker, so only the reason is kept.
  const reason = (text: string) => text.replace(/^Could not reach the WhatsApp worker:?\s*/i, "").replace(/^fetch failed$/, "the connection failed");
  if (!health.ok) return { transport: "worker", at, reachable: false, error: reason(health.error) };
  if (!line.ok) return { transport: "worker", at, reachable: true, line: null, lineError: line.error };
  return {
    transport: "worker",
    at,
    reachable: true,
    line: { status: String(line.data.status), phone: line.data.phoneNumber ?? null, error: line.data.error ?? null },
  };
}

// --- The network --------------------------------------------------------------

async function timedFetch(url: string, init: RequestInit, timeoutMs: number) {
  const started = performance.now();
  const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.arrayBuffer();
  return { response, body, ms: performance.now() - started };
}

async function internetFacts(): Promise<InternetFacts> {
  // Both at once: waiting for 1.1.1.1 to time out before trying the name
  // would double the wait on a network that blocks the address.
  const attempts = await Promise.all(
    TRACE_URLS.map(async (url) => {
      try {
        const { response, body, ms } = await timedFetch(url, {}, TIMEOUT.internet);
        if (!response.ok) return { url, ok: false as const, error: `answered ${response.status}` };
        return { url, ok: true as const, ms, trace: parseTrace(Buffer.from(body).toString("utf8")) };
      } catch (error) {
        return { url, ok: false as const, error: describeError(error, TIMEOUT.internet).message };
      }
    })
  );
  const [byAddress, byName] = attempts;
  if (byAddress.ok) return { ok: true, ms: byAddress.ms, trace: byAddress.trace, via: hostOf(byAddress.url), fellBack: false };
  if (byName.ok) return { ok: true, ms: byName.ms, trace: byName.trace, via: hostOf(byName.url), fellBack: true };
  return { ok: false, error: byAddress.error === byName.error ? byAddress.error : `${byAddress.error}; by name: ${byName.error}` };
}

async function resolve(host: string): Promise<DnsLookup> {
  // The resolver the server is configured with (Docker's own, inside a
  // container), with a timeout of its own rather than the system's.
  const resolver = new Resolver({ timeout: TIMEOUT.dns, tries: 1 });
  const started = performance.now();
  try {
    const addresses = await withTimeout(resolver.resolve4(host), TIMEOUT.dns + 250);
    return { host, ok: true, ms: performance.now() - started, addresses };
  } catch (error) {
    resolver.cancel();
    const { code, message } = describeError(error, TIMEOUT.dns);
    return { host, ok: false, ms: performance.now() - started, error: code && code !== "TIMEOUT" ? codeInWords(code) : message };
  }
}

async function publicFacts(): Promise<PublicFacts> {
  try {
    // `manual`: what the address itself answers, not wherever it points.
    const { response, ms } = await timedFetch(PUBLIC_URL, { redirect: "manual" }, TIMEOUT.publicAddress);
    return { url: PUBLIC_URL, ok: true, status: response.status, ms, ray: response.headers.get("cf-ray") };
  } catch (error) {
    return { url: PUBLIC_URL, ok: false, error: describeError(error, TIMEOUT.publicAddress).message };
  }
}

/**
 * go2rtc's stream list. With CAMERAS_RELAY_URL unset, the relay is the default
 * service name; if that name does not resolve, there is no relay here at all,
 * which is "not set up" — not "down". Credentials in the URL are sent as
 * Basic auth and never echoed.
 */
async function camerasFacts(): Promise<CamerasFacts> {
  const configured = process.env.CAMERAS_RELAY_URL?.trim();
  let base: URL;
  try {
    base = new URL(configured || CAMERAS_DEFAULT_URL);
  } catch {
    return { configured: true, at: "CAMERAS_RELAY_URL", ok: false, error: "CAMERAS_RELAY_URL is not a URL" };
  }

  if (!configured) {
    try {
      await withTimeout(dnsLookup(base.hostname), TIMEOUT.dns);
    } catch {
      return { configured: false };
    }
  }

  const headers: Record<string, string> = {};
  if (base.username || base.password) {
    const pair = `${decodeURIComponent(base.username)}:${decodeURIComponent(base.password)}`;
    headers.authorization = `Basic ${Buffer.from(pair).toString("base64")}`;
    base.username = "";
    base.password = "";
  }
  const at = base.host;
  const streams = new URL("api/streams", base.href.endsWith("/") ? base.href : `${base.href}/`);

  try {
    const { response, body } = await timedFetch(streams.href, { headers }, TIMEOUT.cameras);
    if (!response.ok) return { configured: true, at, ok: false, error: `answered ${response.status}`, status: response.status };
    let json: unknown = null;
    try {
      json = JSON.parse(Buffer.from(body).toString("utf8"));
    } catch {
      return { configured: true, at, ok: false, error: "answered with something that is not go2rtc's stream list" };
    }
    return { configured: true, at, ok: true, streams: parseStreams(json) };
  } catch (error) {
    return { configured: true, at, ok: false, error: describeError(error, TIMEOUT.cameras).message };
  }
}

// --- The read -----------------------------------------------------------------

/** Every check, side by side; the answer `ops/status` returns. */
export async function gatherStatus(): Promise<StatusReport> {
  const checkedAt = new Date();
  const where = machineWhere();
  const uptimeMs = process.uptime() * 1000;

  const chain = databaseChain().catch(
    (error): DatabaseChain => ({ database: { ok: false, error: describeError(error).message }, settings: null, push: null })
  );
  const backupsFolder = firstVisibleFolder().catch(() => null);

  // The rows that need the database wait for its chain; everything else
  // starts at once. The chain stops itself at its own deadline, so waiting on
  // it never costs more than that.
  const fromChain = async <T>(read: (facts: DatabaseChain) => T) => read(await chain);
  const timezoneOf = (facts: DatabaseChain) => resolveTimezone(facts.settings?.get(TIMEZONE_SETTING_KEY) ?? null);
  const scheduled = (kind: "jobs" | "meetings") =>
    fromChain((facts) => {
      const schedule = SCHEDULES[kind];
      if (!facts.settings) {
        return {
          id: schedule.id,
          title: schedule.title,
          state: "unknown" as const,
          detail: "Can't tell: the stamp is kept in the database, which did not answer",
        };
      }
      return scheduleRow(kind, parseCronStamp(facts.settings.get(schedule.key)), Date.now(), uptimeMs, timezoneOf(facts));
    });

  const server = Promise.all([
    // The site answers whatever the database does; only the timezone its
    // start time is written in comes from there, and has a default.
    settle("site", STATUS_TITLES.site, () =>
      fromChain((facts) =>
        siteRow({ uptimeMs, build: appVersion(), node: process.version, timezone: timezoneOf(facts), now: Date.now() })
      )
    ),
    settle("database", STATUS_TITLES.database, () => fromChain((facts) => databaseRow(facts.database))),
    settle(SCHEDULES.jobs.id, SCHEDULES.jobs.title, () => scheduled("jobs")),
    settle(SCHEDULES.meetings.id, SCHEDULES.meetings.title, () => scheduled("meetings")),
    settle("backups", STATUS_TITLES.backups, async () => backupsRow(await backupFacts(await backupsFolder), Date.now())),
    settle("whatsapp", STATUS_TITLES.whatsapp, async () => whatsappRow(await whatsappFacts())),
    settle("apns", STATUS_TITLES.apns, () =>
      fromChain((facts) =>
        apnsRow({ configured: isApnsConfigured(), devices: facts.push?.iphones ?? null, tally: facts.push?.apns ?? null }, Date.now())
      )
    ),
    settle("web-push", STATUS_TITLES.webPush, () =>
      fromChain((facts) =>
        webPushRow(
          facts.push
            ? {
                readable: true,
                configured: facts.push.configured,
                source: facts.push.source,
                subscriptions: facts.push.subscriptions,
                tally: facts.push.web,
              }
            : { readable: false },
          Date.now()
        )
      )
    ),
    settle("load", STATUS_TITLES.load, async () =>
      loadRow({ where, loadavg: os.loadavg(), cores: os.availableParallelism?.() ?? os.cpus().length })
    ),
    settle("memory", STATUS_TITLES.memory, async () =>
      memoryRow({
        where,
        total: os.totalmem(),
        free: os.freemem(),
        rss: process.memoryUsage().rss,
        limit: await containerMemoryLimit(),
      })
    ),
    settle("disk", STATUS_TITLES.disk, async () =>
      diskRow("disk", STATUS_TITLES.disk, await diskFacts(path.parse(process.cwd()).root), rootDiskLabel(where))
    ),
    settle("host-disk", STATUS_TITLES.hostDisk, async () => {
      const folder = await backupsFolder;
      if (!folder) {
        return {
          id: "host-disk",
          title: STATUS_TITLES.hostDisk,
          state: "unknown" as const,
          detail: "Not visible from the server: it is measured through the backups folder, which is not mounted",
        };
      }
      return diskRow("host-disk", STATUS_TITLES.hostDisk, await diskFacts(folder), "on the drive that holds the backups folder");
    }),
  ]);

  const network = Promise.all([
    settle("internet", STATUS_TITLES.internet, async () => internetRow(await internetFacts())),
    settle("dns", STATUS_TITLES.dns, async () => {
      const [own, reference] = await Promise.all([resolve(hostOf(PUBLIC_URL)), resolve(REFERENCE_HOST)]);
      return dnsRow(own, reference);
    }),
    settle("public", STATUS_TITLES.publicAddress, async () => publicRow(await publicFacts())),
    settle("cameras", STATUS_TITLES.cameras, async () => camerasRow(await camerasFacts())),
  ]);

  return { checkedAt: checkedAt.toISOString(), server: await server, network: await network };
}
