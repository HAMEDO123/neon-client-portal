import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { issueWarning, warningsFor, withdrawWarning } from "@/lib/employee-warnings";
import { WARNING_LIMIT, warningKey } from "@/lib/warnings";

// Three warnings, against the real rows: the employee is told each time, the
// warnings are theirs alone, and the last one closes the account only after
// telling them why.
//
// Run with: npm run test:db   (needs the local dev database up)

const PREFIX = "zwarn-";

let reachable = false;
let wael = "";
let sally = "";

// Deleting the people takes their warnings, notifications and devices with them.
function cleanup() {
  return prisma.employee.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

// Push is off for both, so nothing here tries to reach a real phone.
function person(name: string) {
  return prisma.employee.create({
    data: {
      name: `${PREFIX}${name}`,
      email: `${PREFIX}${name.toLowerCase()}@test.local`,
      active: true,
      preference: { create: { pushEnabled: false } },
    },
  });
}

function notificationFor(warningId: string) {
  return prisma.notification.findUnique({ where: { dedupeKey: warningKey(warningId) } });
}

before(async () => {
  try {
    await prisma.$queryRaw`select 1`;
    reachable = true;
  } catch {
    reachable = false;
    return;
  }

  await cleanup();
  wael = (await person("Wael")).id;
  sally = (await person("Sally")).id;
});

after(async () => {
  if (reachable) await cleanup();
  await prisma.$disconnect();
});

describe("giving warnings", () => {
  it("records the first, tells the employee, and leaves the account open", async (t) => {
    if (!reachable) return t.skip("no database");

    const issued = await issueWarning(wael, "  Late to the site visit  ");
    assert.equal(issued.number, 1);
    assert.equal(issued.accountClosed, false);

    const warnings = await warningsFor(wael);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].reason, "Late to the site visit");

    const notification = await notificationFor(issued.warningId);
    assert.ok(notification, "the employee is told");
    assert.equal(notification.employeeId, wael);
    assert.equal(notification.type, "WARNING");
    assert.equal(notification.url, "/employee");
    assert.match(notification.title, /1 of 3/);

    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: wael } });
    assert.equal(employee.active, true);
  });

  it("keeps each person's warnings to themselves", async (t) => {
    if (!reachable) return t.skip("no database");
    assert.equal((await warningsFor(sally)).length, 0);
  });

  it("refuses a warning with no reason", async (t) => {
    if (!reachable) return t.skip("no database");
    await assert.rejects(issueWarning(wael, "   "), /reason/);
    assert.equal((await warningsFor(wael)).length, 1);
  });

  it("says on the second that the next one closes the account", async (t) => {
    if (!reachable) return t.skip("no database");

    const issued = await issueWarning(wael, "Missed the BOQ deadline");
    assert.equal(issued.number, 2);
    assert.equal(issued.accountClosed, false);
    assert.match((await notificationFor(issued.warningId))?.message ?? "", /One more warning closes your account/);
  });

  it("tells them about the last one, then closes the account and silences their devices", async (t) => {
    if (!reachable) return t.skip("no database");

    await prisma.pushSubscription.create({
      data: { employeeId: wael, endpoint: `https://push.example/${PREFIX}wael-phone`, p256dh: "p", auth: "a" },
    });

    const issued = await issueWarning(wael, "Third time");
    assert.equal(issued.number, WARNING_LIMIT);
    assert.equal(issued.accountClosed, true);

    // Told first, while the account could still hear it.
    const notification = await notificationFor(issued.warningId);
    assert.ok(notification, "the last warning is delivered before the account closes");
    assert.match(notification.title, /closed/);

    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: wael } });
    assert.equal(employee.active, false);
    assert.equal(await prisma.pushSubscription.count({ where: { employeeId: wael, active: true } }), 0);
  });

  it("refuses a warning for a closed account", async (t) => {
    if (!reachable) return t.skip("no database");
    await assert.rejects(issueWarning(wael, "Once more"), /disabled/);
  });

  it("will not give a fourth, even after the account is reopened", async (t) => {
    if (!reachable) return t.skip("no database");
    await prisma.employee.update({ where: { id: wael }, data: { active: true } });
    await assert.rejects(issueWarning(wael, "Once more"), /already has 3 warnings/);
  });
});

describe("taking a warning back", () => {
  it("removes one given by mistake, and only once", async (t) => {
    if (!reachable) return t.skip("no database");

    const [first] = await warningsFor(wael);
    assert.equal(await withdrawWarning(first.id), true);
    assert.equal(await withdrawWarning(first.id), false);
    assert.equal((await warningsFor(wael)).length, WARNING_LIMIT - 1);
  });
});
