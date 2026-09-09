import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";

// One device, two people, and the rule that keeps them apart.
//
// A push subscription belongs to the browser, not to the session: it survives
// signing out. So the studio phone that Wael enabled push on kept delivering
// Wael's tasks to Sally after she signed in on it. These are the guarantees
// that stop that, expressed against the same rows the actions write.
//
// Run with: npm run test:db   (needs the local dev database up)

const PREFIX = "zdev-";
const ENDPOINT = `https://push.example/${PREFIX}shared-studio-phone`;
const startedAt = new Date();

let reachable = false;
let wael = "";
let sally = "";

async function cleanup() {
  await prisma.notificationDelivery.deleteMany({ where: { createdAt: { gte: startedAt } } });
  await prisma.notification.deleteMany({ where: { createdAt: { gte: startedAt } } });
  await prisma.pushSubscription.deleteMany({ where: { endpoint: { startsWith: `https://push.example/${PREFIX}` } } });
  await prisma.employee.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

/** What claimDevice does, minus the session lookup it takes from a cookie. */
async function claim(endpoint: string, employeeId: string) {
  const existing = await prisma.pushSubscription.findUnique({
    where: { endpoint },
    select: { employeeId: true, active: true },
  });
  if (!existing) return { changed: false };
  if (existing.employeeId === employeeId && existing.active) return { changed: false };

  await prisma.pushSubscription.update({
    where: { endpoint },
    data: { employeeId, active: true, failureCount: 0 },
  });
  return { changed: true, from: existing.employeeId };
}

/** What releaseDevice does — scoped, so it can only give up your own device. */
function release(endpoint: string, employeeId: string) {
  return prisma.pushSubscription.deleteMany({ where: { endpoint, employeeId } });
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

  const [a, b] = await Promise.all([
    prisma.employee.create({ data: { name: `${PREFIX}Wael`, email: `${PREFIX}wael@test.local`, active: true } }),
    prisma.employee.create({ data: { name: `${PREFIX}Sally`, email: `${PREFIX}sally@test.local`, active: true } }),
  ]);
  wael = a.id;
  sally = b.id;
});

after(async () => {
  if (reachable) await cleanup();
  await prisma.$disconnect();
});

describe("a device belongs to whoever is signed in on it", () => {
  it("hands the phone over when the next person opens the portal", async (t) => {
    if (!reachable) return t.skip("no database");

    // Wael turns push on.
    await prisma.pushSubscription.create({
      data: { employeeId: wael, endpoint: ENDPOINT, p256dh: "p", auth: "a", userAgent: "iPhone" },
    });

    // Sally signs in on the same phone. This is the moment that used to leave
    // Wael's notifications arriving in her hand.
    const result = await claim(ENDPOINT, sally);

    assert.equal(result.changed, true);
    assert.equal(result.from, wael);

    const row = await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: ENDPOINT } });
    assert.equal(row.employeeId, sally);
    assert.equal(row.active, true);

    // And Wael has no device any more, so nothing of his goes there.
    assert.equal(await prisma.pushSubscription.count({ where: { employeeId: wael } }), 0);
  });

  it("changes nothing when the same person opens it again", async (t) => {
    if (!reachable) return t.skip("no database");
    assert.equal((await claim(ENDPOINT, sally)).changed, false);
  });

  it("starts clean rather than inheriting the last owner's failures", async (t) => {
    if (!reachable) return t.skip("no database");

    await prisma.pushSubscription.update({
      where: { endpoint: ENDPOINT },
      data: { employeeId: wael, failureCount: 7, active: false },
    });

    await claim(ENDPOINT, sally);

    const row = await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: ENDPOINT } });
    assert.equal(row.employeeId, sally);
    assert.equal(row.failureCount, 0);
    assert.equal(row.active, true);
  });

  it("ignores a device nobody has registered", async (t) => {
    if (!reachable) return t.skip("no database");

    // Claiming must never conjure a subscription: enabling push is what
    // creates one, and only it has the browser's keys.
    const result = await claim(`https://push.example/${PREFIX}never-seen`, sally);
    assert.equal(result.changed, false);
    assert.equal(await prisma.pushSubscription.count({ where: { endpoint: { contains: "never-seen" } } }), 0);
  });
});

describe("signing out gives the device up", () => {
  it("stops the phone receiving once its owner signs out", async (t) => {
    if (!reachable) return t.skip("no database");

    assert.equal(await prisma.pushSubscription.count({ where: { endpoint: ENDPOINT } }), 1);

    await release(ENDPOINT, sally);

    assert.equal(await prisma.pushSubscription.count({ where: { endpoint: ENDPOINT } }), 0);
  });

  it("will not let one account give up another's device", async (t) => {
    if (!reachable) return t.skip("no database");

    await prisma.pushSubscription.create({
      data: { employeeId: wael, endpoint: ENDPOINT, p256dh: "p", auth: "a" },
    });

    // Sally signing out must not unregister Wael's phone.
    await release(ENDPOINT, sally);
    assert.equal(await prisma.pushSubscription.count({ where: { endpoint: ENDPOINT } }), 1);

    await release(ENDPOINT, wael);
    assert.equal(await prisma.pushSubscription.count({ where: { endpoint: ENDPOINT } }), 0);
  });
});

describe("delivery follows ownership", () => {
  it("sends an employee's notifications only to their own devices", async (t) => {
    if (!reachable) return t.skip("no database");

    await prisma.pushSubscription.createMany({
      data: [
        { employeeId: wael, endpoint: `https://push.example/${PREFIX}wael-phone`, p256dh: "p", auth: "a" },
        { employeeId: wael, endpoint: `https://push.example/${PREFIX}wael-ipad`, p256dh: "p", auth: "a" },
        { employeeId: sally, endpoint: `https://push.example/${PREFIX}sally-phone`, p256dh: "p", auth: "a" },
        // Muted: hers, but she asked this one to stay quiet.
        {
          employeeId: sally,
          endpoint: `https://push.example/${PREFIX}sally-laptop`,
          p256dh: "p",
          auth: "a",
          active: false,
        },
      ],
    });

    // The exact query the engine fans out over.
    const waelTargets = await prisma.pushSubscription.findMany({
      where: { employeeId: wael, active: true },
      select: { endpoint: true },
    });
    const sallyTargets = await prisma.pushSubscription.findMany({
      where: { employeeId: sally, active: true },
      select: { endpoint: true },
    });

    assert.equal(waelTargets.length, 2);
    assert.equal(sallyTargets.length, 1);
    assert.ok(waelTargets.every((row) => row.endpoint.includes("wael")));
    // A muted device of her own is left out too.
    assert.ok(sallyTargets.every((row) => row.endpoint.includes("sally-phone")));
  });
});
