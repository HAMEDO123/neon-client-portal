import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { allSiteVisits, siteVisitsFor } from "@/lib/site-visit-queries";

// The diary is one person's to write and the manager's to read, and those two
// readings must not be the same query with a filter bolted on afterwards. What
// is pinned here is the scoping — one person's view never contains somebody
// else's visit — and the order the manager gets, which is what makes an
// unanswered visit findable at all.

let reachable = false;
let wael = "";
let other = "";

before(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    reachable = true;
  } catch {
    return;
  }

  const one = await prisma.employee.create({
    data: { name: "zvisit-Wael", email: "zvisit-wael@test.local", active: true, canLogSiteVisits: true },
    select: { id: true },
  });
  wael = one.id;

  const two = await prisma.employee.create({
    data: { name: "zvisit-Other", email: "zvisit-other@test.local", active: true },
    select: { id: true },
  });
  other = two.id;

  const hours = (h: number) => new Date(Date.now() + h * 3_600_000);

  // One at a time: the local database closes the connection under a Promise.all.
  await prisma.siteVisit.create({
    data: { employeeId: wael, title: "zvisit-overdue", scheduledAt: hours(-30) },
  });
  await prisma.siteVisit.create({
    data: { employeeId: wael, title: "zvisit-upcoming", scheduledAt: hours(24) },
  });
  await prisma.siteVisit.create({
    data: {
      employeeId: wael,
      title: "zvisit-done",
      scheduledAt: hours(-4),
      state: "VISITED",
      report: "Measured the kitchen.",
      reportedAt: new Date(),
    },
  });
  await prisma.siteVisit.create({
    data: { employeeId: other, title: "zvisit-somebody-elses", scheduledAt: hours(-2) },
  });
});

after(async () => {
  if (!reachable) return;
  await prisma.siteVisit.deleteMany({ where: { employeeId: { in: [wael, other] } } }).catch(() => null);
  await prisma.employee.deleteMany({ where: { id: { in: [wael, other] } } }).catch(() => null);
});

describe("one person's diary", () => {
  it("holds their own visits and nobody else's", async (t) => {
    if (!reachable) return t.skip("no database");

    const mine = await siteVisitsFor(wael);
    const titles = mine.map((visit) => visit.title);

    assert.ok(titles.includes("zvisit-overdue"));
    assert.ok(titles.includes("zvisit-done"));
    assert.ok(!titles.includes("zvisit-somebody-elses"), "another person's visit must not appear");
    assert.ok(mine.every((visit) => visit.employeeId === wael));
  });
});

describe("the manager's reading of it", () => {
  it("puts a visit nobody has written up above everything else", async (t) => {
    if (!reachable) return t.skip("no database");

    const all = await allSiteVisits();
    const ours = all.filter((visit) => visit.title.startsWith("zvisit-"));

    // The unanswered ones lead, whichever person they belong to — that is the
    // whole point of the manager's order.
    const first = ours.slice(0, 2).map((visit) => visit.title).sort();
    assert.deepEqual(first, ["zvisit-overdue", "zvisit-somebody-elses"]);

    // And the settled one is last of ours, not buried among them.
    assert.equal(ours[ours.length - 1].title, "zvisit-done");
  });

  it("carries who it was for, so the screen never has to guess", async (t) => {
    if (!reachable) return t.skip("no database");

    const all = await allSiteVisits();
    const one = all.find((visit) => visit.title === "zvisit-done");

    assert.ok(one);
    assert.equal(one.employee.name, "zvisit-Wael");
    assert.equal(one.report, "Measured the kitchen.");
  });
});
