import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { monthSalesFor, salesCountsForMonth, salesForMonth } from "@/lib/sales-queries";
import { DEFAULT_SALES_TARGET } from "@/lib/sales";
import { dayKeyToDate } from "@/lib/time";
import { generateProjectToken } from "@/lib/tokens";

// A month's sales, against the real rows: the month a project counts in comes
// from its Sold on date, and it counts for exactly one person.
//
// Run with: npm run test:db   (needs the local dev database up)

const PREFIX = "zsale-";
const MONTH = "2026-09";

let reachable = false;
let wael = "";
let sally = "";

async function cleanup() {
  // Projects first: a deleted seller would only blank the sale, not remove it.
  await prisma.project.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.employee.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

function person(name: string) {
  return prisma.employee.create({ data: { name: `${PREFIX}${name}`, active: true } });
}

function sale(name: string, employeeId: string | null, dayKey: string | null) {
  return prisma.project.create({
    data: {
      name: `${PREFIX}${name}`,
      token: generateProjectToken(`${PREFIX}${name}`),
      clientName: "Test client",
      soldById: employeeId,
      soldOn: dayKey ? dayKeyToDate(dayKey) : null,
    },
  });
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

  await sale("first", wael, "2026-09-01");
  await sale("last", wael, "2026-09-30");
  await sale("hers", sally, "2026-09-15");
  // Just outside the month on either side, and one nobody sold.
  await sale("august", wael, "2026-08-31");
  await sale("october", wael, "2026-10-01");
  await sale("unsold", null, null);
});

after(async () => {
  if (reachable) await cleanup();
  await prisma.$disconnect();
});

describe("a month's sales", () => {
  it("counts the first and last day of the month, and nothing either side", async (t) => {
    if (!reachable) return t.skip("no database");

    const sold = await salesForMonth(wael, MONTH);
    assert.equal(sold.length, 2);
    assert.deepEqual(
      sold.map((project) => project.name).sort(),
      [`${PREFIX}first`, `${PREFIX}last`]
    );
  });

  it("keeps each person's sales to themselves", async (t) => {
    if (!reachable) return t.skip("no database");
    assert.equal((await salesForMonth(sally, MONTH)).length, 1);
  });

  it("counts everyone's month in one go, and nobody's for an unsold project", async (t) => {
    if (!reachable) return t.skip("no database");

    const counts = await salesCountsForMonth(MONTH);
    assert.equal(counts.get(wael), 2);
    assert.equal(counts.get(sally), 1);
    assert.equal(counts.get("nobody"), undefined);
  });

  it("comes with the person's own target, three unless it is changed", async (t) => {
    if (!reachable) return t.skip("no database");

    const before = await monthSalesFor(wael, MONTH);
    assert.equal(before.target, DEFAULT_SALES_TARGET);
    assert.equal(before.projects.length, 2);

    await prisma.employee.update({ where: { id: wael }, data: { monthlySalesTarget: 5 } });
    assert.equal((await monthSalesFor(wael, MONTH)).target, 5);
  });

  it("moves the sale when the manager picks a different seller", async (t) => {
    if (!reachable) return t.skip("no database");

    const project = await prisma.project.findFirstOrThrow({ where: { name: `${PREFIX}first` } });
    await prisma.project.update({ where: { id: project.id }, data: { soldById: sally } });

    assert.equal((await salesForMonth(wael, MONTH)).length, 1);
    assert.equal((await salesForMonth(sally, MONTH)).length, 2);
  });
});
