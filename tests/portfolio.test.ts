import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { areaOf, categoriesIn, wideAt, categoryOf, coverOf, moved, toPortfolioProject, whatsappLink, type PortfolioRow } from "../src/lib/portfolio";

// The public portfolio (/work), asked for on 2026-11-25: one link to send a
// would-be client, showing the projects and photos the manager picks.

const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), "utf8");

const row = (over: Partial<PortfolioRow> = {}): PortfolioRow => ({
  id: "p1",
  portfolioTitle: "Villa — Dabouq",
  portfolioNote: "  ",
  portfolioCoverId: null,
  portfolioCategory: "residential",
  portfolioPlace: " Dabouq, Amman ",
  projectType: "Villa",
  area: "450 m²",
  watermarkEnabled: false,
  spaces: [
    { name: "Living", images: [{ id: "a", imageUrl: "https://x/a.jpg", caption: null }, { id: "b", imageUrl: "https://x/b.jpg", caption: " Sofa " }] },
    { name: "Empty", images: [] },
    { name: "Kitchen", images: [{ id: "c", imageUrl: "https://x/c.jpg", caption: null }] },
  ] as unknown as PortfolioRow["spaces"], // named as the studio names them, to show the names go nowhere
  ...over,
});

describe("what the public sees of a project", () => {
  it("is its ticked photos, room after room, and no room's name", () => {
    const project = toPortfolioProject(row())!;
    assert.deepEqual(project.photos.map((photo) => photo.id), ["a", "b", "c"]);
    assert.equal(project.photoCount, 3);
    assert.equal(project.photos[1].caption, "Sofa");
    assert.ok(!JSON.stringify(project).includes("Living"), "a room is named for the studio, not the public");
    assert.equal(project.note, null, "blank words are no words");
  });

  it("is nothing at all with no photo ticked", () => {
    assert.equal(toPortfolioProject(row({ spaces: [{ images: [] }] })), null);
  });

  it("never falls back to the project's own name, which is the client's", () => {
    assert.equal(toPortfolioProject(row({ portfolioTitle: " " }))!.title, "Villa");
    assert.equal(toPortfolioProject(row({ portfolioTitle: null, projectType: null }))!.title, "Interior project");
  });

  it("opens on the chosen cover while it is still shown, the first photo otherwise", () => {
    assert.equal(toPortfolioProject(row({ portfolioCoverId: "c" }))!.cover, "https://x/c.jpg");
    assert.equal(toPortfolioProject(row({ portfolioCoverId: "gone" }))!.cover, "https://x/a.jpg");
    assert.equal(coverOf([{ id: "a", url: "u", caption: null }], null).id, "a");
  });
});

describe("the categories", () => {
  it("are the fixed list's, and nothing else", () => {
    assert.equal(toPortfolioProject(row())!.category, "residential");
    assert.equal(toPortfolioProject(row())!.place, "Dabouq, Amman");
    assert.equal(categoryOf("Cafe"), null);
    assert.equal(toPortfolioProject(row({ portfolioCategory: "made-up" }))!.category, null);
  });
  it("offer as filters only those in use, in the list's order", () => {
    const used = categoriesIn([{ category: "offices" }, { category: null }, { category: "residential" }, { category: "offices" }]);
    assert.deepEqual(used.map((category) => category.value), ["residential", "offices"]);
  });
});

describe("a room's photos", () => {
  it("go one wide, then two side by side, and never leave one alone in a row of two", () => {
    assert.deepEqual(wideAt(1), [true]);
    assert.deepEqual(wideAt(2), [true, true]);
    assert.deepEqual(wideAt(3), [true, false, false]);
    assert.deepEqual(wideAt(5), [true, false, false, true, true]);
    assert.deepEqual(wideAt(6), [true, false, false, true, false, false]);
  });
});

describe("the area", () => {
  it("gets its square metres when written as a bare number", () => {
    assert.equal(areaOf("350"), "350 m²");
    assert.equal(areaOf("70 m²"), "70 m²");
    assert.equal(areaOf(" "), null);
  });
});

describe("the WhatsApp button", () => {
  it("takes a Jordanian number however it is written", () => {
    assert.equal(whatsappLink("079 123 4567"), "https://wa.me/962791234567");
    assert.equal(whatsappLink("+962 79 123 4567"), "https://wa.me/962791234567");
    assert.equal(whatsappLink("00962791234567"), "https://wa.me/962791234567");
  });
  it("carries its message, and is not drawn without a number", () => {
    assert.equal(whatsappLink("0791234567", "Hi there"), "https://wa.me/962791234567?text=Hi%20there");
    assert.equal(whatsappLink(""), null);
    assert.equal(whatsappLink("123"), null);
  });
});

describe("the order", () => {
  it("moves one place, and not past either end", () => {
    assert.deepEqual(moved(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
    assert.deepEqual(moved(["a", "b", "c"], "b", 1), ["a", "c", "b"]);
    assert.deepEqual(moved(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
    assert.deepEqual(moved(["a", "b", "c"], "c", 1), ["a", "b", "c"]);
    assert.deepEqual(moved(["a"], "x", 1), ["a"]);
  });
});

describe("nothing of the client's reaches the public page", () => {
  // The code, without its comments, which name the client's fields to say why they are left out.
  const store = read("src", "lib", "portfolio-store.ts").replace(/^\s*\/\/.*$/gm, "");
  it("names every field it reads", () => {
    assert.doesNotMatch(store, /include:/);
    assert.doesNotMatch(store, /name: true/, "neither the project's name nor a room's");
    for (const field of ["clientName", "clientPhone", "clientEmail", "token", "accessCode", "name: true, portfolio", "pricingItems", "boqItems", "documents", "drawings"]) {
      assert.ok(!store.includes(field), `portfolio-store.ts must not read ${field}`);
    }
  });
  it("reads only ticked photos of shown projects", () => {
    assert.match(store, /where: \{ inPortfolio: true \}/);
    assert.match(store, /where: \{ portfolioShown: true \}/);
    assert.match(store, /where: \{ id, portfolioShown: true \}/);
  });
  it("keeps the pages out of search engines", () => {
    for (const page of [read("src", "app", "work", "page.tsx"), read("src", "app", "work", "[id]", "page.tsx")]) {
      assert.match(page, /robots: \{ index: false, follow: false \}/);
      assert.doesNotMatch(page, /@\/lib\/db|prisma\./, "the public pages read through portfolio-store.ts only");
    }
  });
});

describe("the choosing is the manager's", () => {
  it("guards every action with requireAdmin", () => {
    const actions = read("src", "lib", "actions", "portfolio-actions.ts");
    const exported = actions.match(/export async function \w+/g) ?? [];
    assert.equal(exported.length, 4);
    assert.equal(actions.split("await requireAdmin();").length - 1, exported.length);
    assert.ok(!actions.includes("requireStaff"));
  });
  it("puts the project tab in the admin only", () => {
    assert.match(read("src", "components", "admin", "project-tabs.tsx"), /\{ key: "portfolio", label: "Portfolio", only: "\/admin" \}/);
  });
  it("ticks only the project's own photos", () => {
    assert.match(read("src", "lib", "actions", "portfolio-actions.ts"), /const mine = \{ space: \{ projectId \} \};/);
  });
});
