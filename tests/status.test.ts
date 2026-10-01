import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  apnsRow,
  backupsRow,
  camerasRow,
  cronStampKey,
  cronStampValue,
  databaseRow,
  describeError,
  diskRow,
  dnsRow,
  formatAgo,
  formatBytes,
  formatMs,
  formatSpan,
  internetRow,
  lastBackupLogLine,
  LIMITS,
  loadRow,
  memoryRow,
  migrationFacts,
  newestBackup,
  parseCronStamp,
  parseStreams,
  parseTrace,
  publicRow,
  rayColo,
  SCHEDULES,
  scheduleRow,
  scrub,
  siteRow,
  stateByAge,
  STATUS_TITLES,
  webPushRow,
  whatsappRow,
  worse,
  type BackupFile,
  type DeliveryTally,
} from "@/lib/status";

// The manager's status screen. Every row is a state and the fact behind it,
// so these hold the judgements to their thresholds, and hold the two
// refusals the screen is built on: "could not see" is never "down" or
// "none", and nothing secret ever reaches a row.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const GB = 1024 ** 3;
const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const TZ = "Asia/Amman";

describe("formatting", () => {
  it("writes sizes the way a person reads them", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(1536), "1.5 KB");
    assert.equal(formatBytes(184 * 1024 * 1024), "184 MB");
    assert.equal(formatBytes(9.84 * GB), "9.8 GB");
    assert.equal(formatBytes(1007 * GB), "1007 GB");
    assert.equal(formatBytes(-1), "?");
  });

  it("writes times short and spans in their largest two units", () => {
    assert.equal(formatMs(3.4), "3 ms");
    assert.equal(formatMs(2140), "2.1 s");
    assert.equal(formatSpan(38 * SECOND), "38 s");
    assert.equal(formatSpan(4 * MINUTE + 59 * SECOND), "4 min");
    assert.equal(formatSpan(2 * HOUR + 5 * MINUTE), "2 h 5 min");
    assert.equal(formatSpan(3 * 24 * HOUR + 4 * HOUR + 10 * MINUTE), "3 d 4 h");
    assert.equal(formatSpan(48 * HOUR), "2 d");
  });

  it("says just now for a moment a few seconds old, or one ahead of this clock", () => {
    assert.equal(formatAgo(3 * SECOND), "just now");
    assert.equal(formatAgo(-5 * SECOND), "just now");
    assert.equal(formatAgo(4 * MINUTE), "4 min ago");
  });
});

describe("keeping secrets out of every row", () => {
  it("drops credentials from URLs, secret query values and bearer values", () => {
    const text = scrub(
      "connect ECONNREFUSED postgresql://neon:hunter2@db:5432/neon?sslmode=disable&password=abc then GET https://x.test/a?key=s3cr3t with Bearer eyJhbGciOi.payload.sig"
    );
    assert.doesNotMatch(text, /hunter2/);
    assert.doesNotMatch(text, /s3cr3t/);
    assert.doesNotMatch(text, /password=abc/);
    assert.doesNotMatch(text, /eyJhbGciOi/);
    assert.match(text, /postgresql:\/\/db:5432/);
  });

  it("cuts out long opaque strings and caps the length", () => {
    const key = "A".repeat(20) + "b".repeat(20) + "0123456789";
    assert.doesNotMatch(scrub(`invalid key ${key}`), new RegExp(key));
    assert.ok(scrub("x ".repeat(400)).length <= 160);
    assert.equal(scrub(""), "unknown error");
  });

  it("reads the reason out of fetch's \"fetch failed\", and calls a timeout what it is", () => {
    const failed = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND neon-cameras"), { code: "ENOTFOUND" }),
    });
    assert.deepEqual(describeError(failed), { code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND neon-cameras" });

    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    assert.deepEqual(describeError(timeout, 3000), { code: "TIMEOUT", message: "no answer within 3.0 s" });

    // Both of localhost's addresses refusing: an AggregateError with no message, the code alone.
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new AggregateError([], ""), { code: "ECONNREFUSED" }),
    });
    assert.deepEqual(describeError(refused), { code: "ECONNREFUSED", message: "connection refused (ECONNREFUSED)" });
  });

  it("says what Prisma means when its message is only boilerplate", () => {
    // What `prisma.$queryRaw` throws with the database stopped: the reason is in `code` alone.
    const prisma = Object.assign(new Error("\nInvalid `prisma.$queryRaw()` invocation:\n\n\n"), { code: "ECONNREFUSED" });
    assert.deepEqual(describeError(prisma), { code: "ECONNREFUSED", message: "connection refused (ECONNREFUSED)" });
    const p1001 = Object.assign(new Error("Invalid `prisma.x()` invocation:\nCan't reach database server at `db:5432`"), { code: "P1001" });
    assert.equal(describeError(p1001).message, "Can't reach database server at `db:5432`");
  });

  it("never lets a camera's RTSP address, a WhatsApp QR or a key into a row", () => {
    const streams = parseStreams({
      entrance: { producers: [{ url: "rtsp://admin:CamPass1@192.168.1.10/stream1" }], consumers: null },
    });
    const cameras = camerasRow({ configured: true, at: "neon-cameras:1984", ok: true, streams });
    assert.doesNotMatch(JSON.stringify(cameras), /rtsp|CamPass1|192\.168/);

    const worker = whatsappRow({
      transport: "worker",
      at: "host.docker.internal:4100",
      reachable: false,
      error: "request to http://user:WorkerKey99@host.docker.internal:4100/health failed",
    });
    assert.doesNotMatch(JSON.stringify(worker), /WorkerKey99/);
  });
});

describe("the shared judgements", () => {
  it("turns amber, then red, past each line", () => {
    assert.equal(stateByAge(19 * MINUTE, 20 * MINUTE, 60 * MINUTE), "up");
    assert.equal(stateByAge(21 * MINUTE, 20 * MINUTE, 60 * MINUTE), "degraded");
    assert.equal(stateByAge(61 * MINUTE, 20 * MINUTE, 60 * MINUTE), "down");
  });

  it("ranks unknown between fine and amber: not a fault, not a reassurance", () => {
    assert.equal(worse("up", "unknown"), "unknown");
    assert.equal(worse("unknown", "degraded"), "degraded");
    assert.equal(worse("down", "degraded"), "down");
  });
});

describe("the site", () => {
  it("is up by definition, and says since when, which build and which Node", () => {
    const row = siteRow({ uptimeMs: 3 * 24 * HOUR + 4 * HOUR, build: "Xy12AbCdEfGhIjKlMnOp", node: "v22.20.0", timezone: TZ, now: NOW });
    assert.equal(row.state, "up");
    assert.equal(row.value, "3 d 4 h");
    assert.match(row.detail, /build Xy12AbCdEfGh · Node v22\.20\.0/);
    // 76 hours before noon UTC on Oct 1 is 08:00 UTC on Sep 28: 11:00 in Amman.
    assert.match(row.detail, /^Serving for 3 d 4 h, since Mon, Sep 28 11:00 AM · /);
  });
});

describe("the database", () => {
  it("is down when it does not answer, with the reason scrubbed", () => {
    const row = databaseRow({ ok: false, error: "connect ECONNREFUSED postgresql://neon:pw@db:5432/neon" });
    assert.equal(row.state, "down");
    assert.doesNotMatch(row.detail, /pw@/);
  });

  it("reports the round trip, size, connections, version and newest migration", () => {
    const row = databaseRow({
      ok: true,
      ms: 2.2,
      sizeBytes: 184 * 1024 * 1024,
      connections: 7,
      maxConnections: 100,
      version: "17.6 (Debian 17.6-1.pgdg120+1)",
      newestMigration: "20261001100000_project_access_code",
      applied: 47,
      unfinished: 0,
      pending: 0,
    });
    assert.equal(row.state, "up");
    assert.equal(row.value, "2 ms");
    assert.equal(
      row.detail,
      "Answered in 2 ms · 184 MB · 7 of 100 connections · PostgreSQL 17.6 · newest migration 20261001100000_project_access_code (47 applied)"
    );
  });

  it("turns amber when slow, nearly out of connections, or a migration did not land", () => {
    assert.equal(databaseRow({ ok: true, ms: LIMITS.databaseSlowMs }).state, "degraded");
    assert.equal(databaseRow({ ok: true, ms: 2, connections: 95, maxConnections: 100 }).state, "degraded");
    const failed = databaseRow({ ok: true, ms: 2, unfinished: 1 });
    assert.equal(failed.state, "degraded");
    assert.match(failed.detail, /^1 migration started and did not finish/);
    assert.match(databaseRow({ ok: true, ms: 2, pending: 2 }).detail, /^2 migrations in this build not applied/);
  });

  it("sets what _prisma_migrations says against the build's own folders", () => {
    const facts = migrationFacts(
      [
        { name: "20260901000000_a", finished: true, rolledBack: false },
        { name: "20260902000000_b", finished: false, rolledBack: true },
        { name: "20260902000000_b", finished: true, rolledBack: false },
        { name: "20260903000000_c", finished: false, rolledBack: false },
      ],
      ["20260901000000_a", "20260902000000_b", "20260903000000_c", "20260904000000_d"]
    );
    assert.deepEqual(facts, { newestMigration: "20260902000000_b", applied: 2, unfinished: 1, pending: 1 });
    // An unreadable folder claims nothing about pending ones.
    assert.equal(migrationFacts([], null).pending, null);
  });
});

describe("the machine", () => {
  it("does not read Windows' always-zero load as idle", () => {
    assert.equal(loadRow({ where: "win32", loadavg: [0, 0, 0], cores: 8 }).state, "unknown");
  });

  it("says whose load it is, and is never down for being busy", () => {
    const calm = loadRow({ where: "docker", loadavg: [0.42, 0.37, 0.3], cores: 8 });
    assert.equal(calm.state, "up");
    assert.match(calm.detail, /0\.42 · 0\.37 · 0\.30 on 8 cores of Docker's Linux VM/);
    assert.equal(loadRow({ where: "docker", loadavg: [40, 30, 20], cores: 8 }).state, "degraded");
  });

  it("turns amber at 90% of memory and red at 97%", () => {
    const at = (share: number) => memoryRow({ where: "docker", total: 100 * GB, free: (1 - share) * 100 * GB, rss: GB }).state;
    assert.equal(at(0.5), "up");
    assert.equal(at(0.92), "degraded");
    assert.equal(at(0.98), "down");
    // macOS's "free" leaves out its cache, so a healthy Mac reads as full: shown, not judged.
    const mac = memoryRow({ where: "darwin", total: 16 * GB, free: 0.1 * GB, rss: GB });
    assert.equal(mac.state, "unknown");
    assert.match(mac.detail, /macOS counts its cache as in use/);
  });

  it("turns amber under 10 GB free and red under 2 GB", () => {
    const at = (free: number) => diskRow("disk", STATUS_TITLES.disk, { ok: true, total: 500 * GB, free }, "on a disk").state;
    assert.equal(at(50 * GB), "up");
    assert.equal(at(9 * GB), "degraded");
    assert.equal(at(1.5 * GB), "down");
    assert.equal(diskRow("disk", STATUS_TITLES.disk, { ok: false, error: "EACCES" }, "on a disk").state, "unknown");
  });
});

describe("the cron stamp", () => {
  it("keeps the full pass and each forced job apart, and stamps no made-up job", () => {
    assert.equal(cronStampKey(null), "cron_last_run");
    assert.equal(cronStampKey("meetings"), "cron_last_run_meetings");
    assert.equal(cronStampKey("deadlines"), "cron_last_run_deadlines");
    assert.equal(cronStampKey("../../etc"), null);
    assert.equal(SCHEDULES.jobs.key, cronStampKey(null));
    assert.equal(SCHEDULES.meetings.key, cronStampKey("meetings"));
  });

  it("reads back what it wrote, and nothing it cannot read", () => {
    const started = new Date(NOW - 2100);
    assert.deepEqual(parseCronStamp(cronStampValue(started, true, new Date(NOW))), {
      at: started.toISOString(),
      ok: true,
      ms: 2100,
    });
    assert.equal(parseCronStamp(null), null);
    assert.equal(parseCronStamp("not a time"), null);
    assert.equal(parseCronStamp('{"ok":true}'), null);
    assert.equal(parseCronStamp("2026-10-01T11:58:00.000Z")?.ok, true);
  });
});

describe("scheduled jobs", () => {
  const stampAt = (ago: number, ok = true) => ({ at: new Date(NOW - ago).toISOString(), ok, ms: 1200 });

  it("judges the ten-minute pass: amber past 20 minutes, red past an hour", () => {
    assert.equal(scheduleRow("jobs", stampAt(4 * MINUTE), NOW, HOUR * 5, TZ).state, "up");
    assert.equal(scheduleRow("jobs", stampAt(25 * MINUTE), NOW, HOUR * 5, TZ).state, "degraded");
    assert.equal(scheduleRow("jobs", stampAt(61 * MINUTE), NOW, HOUR * 5, TZ).state, "down");
    assert.equal(scheduleRow("jobs", stampAt(4 * MINUTE), NOW, HOUR * 5, TZ).value, "4 min ago");
  });

  it("judges the minute pass on its own, tighter lines", () => {
    assert.equal(scheduleRow("meetings", stampAt(40 * SECOND), NOW, HOUR, TZ).state, "up");
    assert.equal(scheduleRow("meetings", stampAt(6 * MINUTE), NOW, HOUR, TZ).state, "degraded");
    assert.equal(scheduleRow("meetings", stampAt(21 * MINUTE), NOW, HOUR, TZ).state, "down");
  });

  it("is at least amber when the last run failed part-way", () => {
    const row = scheduleRow("jobs", stampAt(2 * MINUTE, false), NOW, HOUR, TZ);
    assert.equal(row.state, "degraded");
    assert.match(row.detail, /failed part-way · see docker logs neon-scheduler/);
  });

  it("waits for a first run on a young server, and is red once one is overdue", () => {
    assert.equal(scheduleRow("jobs", null, NOW, 5 * MINUTE, TZ).state, "unknown");
    const never = scheduleRow("jobs", null, NOW, 3 * HOUR, TZ);
    assert.equal(never.state, "down");
    assert.match(never.detail, /--profile live/);
  });
});

describe("backups", () => {
  const dump = (name: string, ago: number, size = 12 * 1024 * 1024): BackupFile => ({ name, size, modifiedAt: NOW - ago });

  it("says the folder is not visible — never that there are no backups", () => {
    const row = backupsRow({ visible: false, reason: "the backups folder is not mounted into the site's container" }, NOW);
    assert.equal(row.state, "unknown");
    assert.match(row.detail, /^Not visible from the server/);
    assert.doesNotMatch(row.detail, /no backups/i);
  });

  it("is red when the folder is there and empty", () => {
    assert.equal(backupsRow({ visible: true, files: [], log: null }, NOW).state, "down");
  });

  it("judges the newest daily dump: fine, a missed day, two", () => {
    const at = (ago: number) => backupsRow({ visible: true, files: [dump("neon-2026-10-01-0300.dump", ago)], log: null }, NOW);
    assert.equal(at(6 * HOUR).state, "up");
    assert.equal(at(6 * HOUR).value, "6 h ago");
    assert.equal(at(30 * HOUR).state, "degraded");
    assert.equal(at(60 * HOUR).state, "down");
  });

  it("ignores a hand-made copy, however new", () => {
    const files = [dump("neon-2026-09-28-0300.dump", 80 * HOUR), dump("before-fixture-cleanup.dump", HOUR)];
    assert.equal(newestBackup(files)?.name, "neon-2026-09-28-0300.dump");
    assert.equal(backupsRow({ visible: true, files, log: null }, NOW).state, "down");
  });

  it("reads the log's last line, and a failed run turns the row amber", () => {
    const log = "﻿2026-09-30T03:00:01  ok      neon-2026-09-30-0300.dump (12345 KB)\r\n2026-10-01T03:00:02  FAILED  pg_dump failed inside neon-db (exit 1)\r\n";
    const line = lastBackupLogLine(log);
    assert.deepEqual(line, { text: "2026-10-01T03:00:02 FAILED pg_dump failed inside neon-db (exit 1)", ok: false });
    assert.equal(lastBackupLogLine("2026-09-30T03:00:01  ok      neon-x.dump (1 KB)\n")?.ok, true);
    assert.equal(lastBackupLogLine("\n\n"), null);

    const row = backupsRow({ visible: true, files: [dump("neon-2026-09-30-0300.dump", 9 * HOUR)], log: line }, NOW);
    assert.equal(row.state, "degraded");
    assert.match(row.detail, /the last run failed: 2026-10-01T03:00:02 FAILED pg_dump failed/);
  });
});

describe("WhatsApp", () => {
  const worker = { transport: "worker" as const, at: "host.docker.internal:4100" };

  it("is not set up, rather than down, with no transport", () => {
    assert.equal(whatsappRow({ transport: "none" }).state, "unknown");
  });

  it("separates a worker that is not running from one with no number linked", () => {
    assert.equal(whatsappRow({ ...worker, reachable: false, error: "ECONNREFUSED" }).state, "down");
    assert.equal(whatsappRow({ ...worker, reachable: true, line: { status: "disconnected" } }).state, "degraded");
    assert.equal(whatsappRow({ ...worker, reachable: true, line: { status: "pending" } }).state, "degraded");
    assert.equal(whatsappRow({ ...worker, reachable: true, line: null, lineError: "The worker rejected the API key." }).state, "degraded");
    assert.equal(whatsappRow({ ...worker, reachable: true, line: { status: "error", error: "boom" } }).state, "down");
  });

  it("says which number is connected", () => {
    const row = whatsappRow({ ...worker, reachable: true, line: { status: "connected", phone: "962790000000" } });
    assert.equal(row.state, "up");
    assert.match(row.detail, /^Connected as \+962790000000 · worker at host\.docker\.internal:4100$/);
  });
});

describe("push", () => {
  const tally = (sent: number, failed: number): DeliveryTally => ({
    sent,
    failed,
    last: { at: NOW - 12 * MINUTE, status: failed > sent ? "FAILED" : "SENT", detail: failed > sent ? "403: InvalidProviderToken" : "HTTP 200" },
  });

  it("is amber when the iPhone app gets nothing because APNs is not configured", () => {
    const row = apnsRow({ configured: false, devices: 4, tally: null }, NOW);
    assert.equal(row.state, "degraded");
    assert.match(row.detail, /4 iPhones registered and waiting/);
  });

  it("is amber only when deliveries mostly fail, over enough of them", () => {
    assert.equal(apnsRow({ configured: true, devices: 4, tally: tally(30, 2) }, NOW).state, "up");
    assert.equal(apnsRow({ configured: true, devices: 4, tally: tally(0, 2) }, NOW).state, "up");
    const failing = apnsRow({ configured: true, devices: 4, tally: tally(1, 5) }, NOW);
    assert.equal(failing.state, "degraded");
    assert.match(failing.detail, /the last one 12 min ago failed \(403: InvalidProviderToken\)/);
  });

  it("cannot tell about web push without the database, and is red with no keys", () => {
    assert.equal(webPushRow({ readable: false }, NOW).state, "unknown");
    assert.equal(
      webPushRow({ readable: true, configured: false, source: null, subscriptions: 0, tally: tally(0, 0) }, NOW).state,
      "down"
    );
    const ok = webPushRow({ readable: true, configured: true, source: "database", subscriptions: 6, tally: tally(12, 0) }, NOW);
    assert.equal(ok.state, "up");
    assert.match(ok.detail, /^Keys generated by the platform · 6 browsers subscribed/);
  });
});

describe("the internet", () => {
  const trace = "fl=12f34\nh=1.1.1.1\nip=203.0.113.7\nts=1759320000.1\nvisit_scheme=https\nuag=node\ncolo=AMM\nloc=JO\ntls=TLSv1.3\nwarp=off\n";

  it("reads Cloudflare's trace", () => {
    assert.deepEqual(
      { ip: parseTrace(trace).ip, colo: parseTrace(trace).colo, loc: parseTrace(trace).loc },
      { ip: "203.0.113.7", colo: "AMM", loc: "JO" }
    );
  });

  it("gives the time, the public IP and the Cloudflare data centre", () => {
    const row = internetRow({ ok: true, ms: 38, trace: parseTrace(trace), via: "1.1.1.1", fellBack: false });
    assert.equal(row.state, "up");
    assert.equal(row.detail, "Cloudflare answered in 38 ms · public IP 203.0.113.7 · through Cloudflare AMM, JO");
    assert.equal(internetRow({ ok: true, ms: 1500, trace: {}, via: "1.1.1.1", fellBack: false }).state, "degraded");
    assert.match(internetRow({ ok: true, ms: 50, trace: {}, via: "cloudflare.com", fellBack: true }).detail, /1\.1\.1\.1 did not answer, cloudflare\.com did/);
    assert.equal(internetRow({ ok: false, error: "no answer within 3.5 s" }).state, "down");
  });
});

describe("DNS", () => {
  const ok = (host: string, ms = 12) => ({ host, ok: true as const, ms, addresses: ["104.21.32.1", "172.67.150.2", "104.21.32.2"] });
  const failed = (host: string) => ({ host, ok: false as const, ms: 20, error: "ENOTFOUND" });

  it("tells a broken record from a broken resolver", () => {
    assert.equal(dnsRow(ok("clients.neonjo.com"), ok("cloudflare.com")).state, "up");
    assert.equal(dnsRow(ok("clients.neonjo.com"), ok("cloudflare.com")).detail, "clients.neonjo.com → 104.21.32.1, 172.67.150.2, … in 12 ms");
    assert.match(dnsRow(failed("clients.neonjo.com"), ok("cloudflare.com")).detail, /^The resolver works \(cloudflare\.com\), but clients\.neonjo\.com did not resolve/);
    assert.equal(dnsRow(failed("clients.neonjo.com"), ok("cloudflare.com")).state, "degraded");
    assert.equal(dnsRow(failed("clients.neonjo.com"), failed("cloudflare.com")).state, "down");
    assert.equal(dnsRow(ok("clients.neonjo.com", 1500), ok("cloudflare.com")).state, "degraded");
  });
});

describe("the public address", () => {
  const url = "https://clients.neonjo.com/employee/login";

  it("proves the round trip through Cloudflare and the tunnel", () => {
    const row = publicRow({ url, ok: true, status: 200, ms: 320, ray: "8c9f1e2d3b4a5c6d-AMM" });
    assert.equal(row.state, "up");
    assert.equal(row.detail, "clients.neonjo.com answered 200 in 320 ms, out through Cloudflare AMM and back in through the tunnel");
    assert.equal(rayColo("8c9f1e2d3b4a5c6d-AMM"), "AMM");
    assert.equal(rayColo("nonsense"), null);
  });

  it("names Cloudflare's 530 as the tunnel being down, and a 502 as the site behind it", () => {
    assert.match(publicRow({ url, ok: true, status: 530, ms: 90, ray: "x-AMM" }).detail, /tunnel \(neon-tunnel\) is not connected/);
    assert.equal(publicRow({ url, ok: true, status: 530, ms: 90, ray: "x-AMM" }).state, "down");
    assert.equal(publicRow({ url, ok: true, status: 502, ms: 90, ray: "x-AMM" }).state, "down");
    assert.equal(publicRow({ url, ok: true, status: 403, ms: 90, ray: "x-AMM" }).state, "degraded");
  });

  it("is amber when it answered without Cloudflare, or slowly; red with no answer", () => {
    assert.equal(publicRow({ url, ok: true, status: 200, ms: 90, ray: null }).state, "degraded");
    assert.equal(publicRow({ url, ok: true, status: 200, ms: 3000, ray: "x-AMM" }).state, "degraded");
    assert.equal(publicRow({ url, ok: false, error: "no answer within 4.0 s" }).state, "down");
  });
});

describe("the office cameras' relay", () => {
  it("counts a camera as streaming only when go2rtc says it is connected", () => {
    const streams = parseStreams({
      studio: { producers: [{ url: "rtsp://a" }], consumers: null },
      entrance: {
        producers: [{ id: 3, format_name: "rtsp", remote_addr: "192.168.1.10:554", url: "rtsp://b", bytes_recv: 1024 }],
        consumers: [{ id: 4 }],
      },
      empty: { producers: null, consumers: null },
    });
    assert.deepEqual(streams, [
      { name: "empty", producers: 0, online: 0 },
      { name: "entrance", producers: 1, online: 1 },
      { name: "studio", producers: 1, online: 0 },
    ]);
    assert.deepEqual(parseStreams(null), []);
    assert.deepEqual(parseStreams([1, 2]), []);
  });

  it("is not set up when there is no relay, rather than down", () => {
    assert.equal(camerasRow({ configured: false }).state, "unknown");
  });

  it("separates a relay that refuses from one that is not there", () => {
    assert.equal(camerasRow({ configured: true, at: "neon-cameras:1984", ok: false, error: "answered 401", status: 401 }).state, "degraded");
    assert.equal(camerasRow({ configured: true, at: "neon-cameras:1984", ok: false, error: "ECONNREFUSED" }).state, "down");
    assert.equal(camerasRow({ configured: true, at: "neon-cameras:1984", ok: true, streams: [] }).state, "degraded");
  });

  it("does not call an idle camera offline", () => {
    const row = camerasRow({
      configured: true,
      at: "neon-cameras:1984",
      ok: true,
      streams: [
        { name: "entrance", producers: 1, online: 1 },
        { name: "studio", producers: 1, online: 0 },
      ],
    });
    assert.equal(row.state, "up");
    assert.equal(row.value, "2 cameras");
    assert.equal(row.detail, "2 cameras listed · 1 streaming now: entrance");
    const idle = camerasRow({ configured: true, at: "neon-cameras:1984", ok: true, streams: [{ name: "studio", producers: 1, online: 0 }] });
    assert.match(idle.detail, /connects to a camera only while someone watches/);
  });
});

describe("the wiring the screen depends on", () => {
  const root = process.cwd();

  it("is the manager's alone", () => {
    const ops = readFileSync(join(root, "src", "lib", "mobile", "registry", "ops.ts"), "utf8");
    assert.match(ops, /"ops\/status": guarded\(requireAdmin, /);
  });

  it("stamps every run of the cron endpoint", () => {
    const route = readFileSync(join(root, "src", "app", "api", "cron", "notifications", "route.ts"), "utf8");
    assert.match(route, /cronStampKey\(/);
    assert.match(route, /setSetting\(stampKey, cronStampValue\(/);
  });

  it("mounts the backups into the site read-only", () => {
    const compose = readFileSync(join(root, "docker-compose.yml"), "utf8");
    assert.match(compose, /- \.\/local-backup\/docker:\/backups:ro/);
  });

  it("has the app translate every title the server can send", () => {
    const strings = readFileSync(join(root, "ios", "Resources", "ar.lproj", "Status.strings"), "utf8");
    for (const title of Object.values(STATUS_TITLES)) {
      assert.ok(strings.includes(`"${title}" = "`), `Status.strings has no Arabic for "${title}"`);
    }
  });
});
