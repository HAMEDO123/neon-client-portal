import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { autoPick, drawingKind, firstGuess, placeOf, areaOf, categoriesIn, wideAt, categoryOf, coverOf, moved, toPortfolioProject, whatsappLink, type PortfolioRow } from "../src/lib/portfolio";

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
    { name: "Living", images: [{ id: "a", imageUrl: "https://x/a.jpg", caption: null, inPortfolio: true }, { id: "b", imageUrl: "https://x/b.jpg", caption: " Sofa ", inPortfolio: true }] },
    { name: "Empty", images: [] },
    { name: "Kitchen", images: [{ id: "c", imageUrl: "https://x/c.jpg", caption: null, inPortfolio: true }] },
  ] as unknown as PortfolioRow["spaces"], // named as the studio names them, to show the names go nowhere
  drawings: [],
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

describe("a project published straight onto the portfolio", () => {
  it("is named by what it is, never by its name", () => {
    assert.deepEqual(firstGuess({ name: "فيلا السيد النابلسي", projectType: "Interior design", location: "salt" }), {
      category: "residential",
      place: "Salt",
      title: "Villa — Salt",
    });
    const named = firstGuess({ name: "Villa zaareer", projectType: "Interior Design", location: "AMMAN" });
    assert.equal(named.title, "Villa — Amman");
    assert.ok(!named.title.includes("zaareer"));
  });
  it("takes a kind that says something as its title", () => {
    assert.deepEqual(firstGuess({ name: "Hala and Farrah", projectType: "Dental clinic", location: "Amman" }), {
      category: "commercial",
      place: "Amman",
      title: "Dental clinic — Amman",
    });
    assert.equal(firstGuess({ name: "Watin Cafe", projectType: "Interior design", location: "Amman, North JU" }).title, "Café — Amman");
    assert.equal(firstGuess({ name: "مكتب المحامي", projectType: null, location: null }).title, "Office");
  });
  it("is an interior project when nothing says more", () => {
    assert.deepEqual(firstGuess({ name: "ARGON", projectType: "Interior Design", location: "" }), {
      category: null,
      place: null,
      title: "Interior project",
    });
  });
  it("keeps only the area of a location", () => {
    assert.equal(placeOf("Abdoun, street 5, building 12"), "Abdoun");
    assert.equal(placeOf("الصويفية"), "الصويفية");
    assert.equal(placeOf("  "), null);
  });
});

describe("photos with none ticked", () => {
  it("are chosen a room at a time, up to twelve", () => {
    assert.deepEqual(autoPick([["a1", "a2", "a3"], ["b1"], ["c1", "c2"]], 5), ["a1", "b1", "c1", "a2", "c2"]);
    assert.equal(autoPick([Array.from({ length: 40 }, (_, i) => i)]).length, 12);
    assert.deepEqual(autoPick([[], []]), []);
  });
  it("are used only while nothing is ticked", () => {
    const untouched = row({
      spaces: [
        { images: [{ id: "a", imageUrl: "u", caption: null, inPortfolio: false }] },
        { images: [{ id: "b", imageUrl: "v", caption: null, inPortfolio: false }] },
      ],
    });
    assert.deepEqual(toPortfolioProject(untouched)!.photos.map((photo) => photo.id), ["a", "b"]);
    const picked = row({
      spaces: [{ images: [{ id: "a", imageUrl: "u", caption: null, inPortfolio: false }, { id: "b", imageUrl: "v", caption: null, inPortfolio: true }] }],
    });
    assert.deepEqual(toPortfolioProject(picked)!.photos.map((photo) => photo.id), ["b"]);
  });
  it("is added on publishing, once, and never fails the publish", () => {
    const publish = read("src", "lib", "actions", "project-actions.ts");
    assert.match(publish, /if \(state === "PUBLISHED"\) \{\n\s+try \{\n\s+if \(await addOnPublish\(id\)\)/);
    assert.match(read("src", "lib", "portfolio-store.ts"), /where: \{ id: projectId, portfolioAddedAt: null \}/);
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
  // What the public pages read: the store's PUBLIC_FIELDS, without its comments.
  const whole = read("src", "lib", "portfolio-store.ts");
  const store = whole.slice(whole.indexOf("const PUBLIC_FIELDS"), whole.indexOf("} as const;")).replace(/^\s*\/\/.*$/gm, "");
  it("names every field it reads", () => {
    assert.doesNotMatch(store, /include:/);
    assert.doesNotMatch(store, /name: true/, "neither the project's name nor a room's");
    for (const field of ["clientName", "clientPhone", "clientEmail", "token", "accessCode", "name: true, portfolio", "pricingItems", "boqItems", "documents"]) {
      assert.ok(!store.includes(field), `portfolio-store.ts must not read ${field}`);
    }
  });
  it("reads only the ticked drawings, and never their own names", () => {
    assert.match(store, /drawings: \{\s*where: \{ inPortfolio: true \}/);
    const drawings = store.slice(store.indexOf("drawings:"));
    assert.match(drawings, /select: \{ id: true, fileUrl: true, fileType: true, portfolioLabel: true \}/);
  });
  it("reads only shown projects", () => {
    assert.match(whole, /where: \{ portfolioShown: true \}/);
    assert.match(whole, /where: \{ id, portfolioShown: true \}/);
  });
  it("keeps the pages out of search engines", () => {
    for (const page of [read("src", "app", "work", "page.tsx"), read("src", "app", "work", "[id]", "page.tsx")]) {
      assert.match(page, /robots: \{ index: false, follow: false \}/);
      assert.doesNotMatch(page, /@\/lib\/db|prisma\./, "the public pages read through portfolio-store.ts only");
    }
  });
});

describe("who chooses", () => {
  it("is the team as well as the manager for a project, and the manager alone for the order and the number", () => {
    const actions = read("src", "lib", "actions", "portfolio-actions.ts");
    const exported = actions.match(/export async function \w+/g) ?? [];
    assert.equal(exported.length, 4);
    assert.equal(actions.split("await requireStaff();").length - 1, 2);
    assert.equal(actions.split("await requireAdmin();").length - 1, 2);
  });
  it("puts the project tab in both portals, the same module in each", () => {
    assert.match(read("src", "components", "admin", "project-tabs.tsx"), /\{ key: "portfolio", label: "Portfolio" \}/);
    assert.match(
      read("src", "app", "employee", "(portal)", "projects", "[id]", "portfolio", "page.tsx"),
      /export \{ default \} from "@\/app\/admin\/\(dashboard\)\/projects\/\[id\]\/portfolio\/page";/
    );
  });
  it("ticks only the project's own photos", () => {
    assert.match(read("src", "lib", "actions", "portfolio-actions.ts"), /const mine = \{ space: \{ projectId \} \};/);
  });
});

describe("the hero as stories", () => {
  const work = read("src", "components", "portfolio", "work.tsx");
  it("moves on when its bar is full, not on a timer of its own", () => {
    assert.match(work, /onAnimationComplete=\{\(\) => step\(1\)\}/);
    assert.doesNotMatch(work, /setInterval/);
  });
  it("is a tap layer under the text, whose links keep their own clicks", () => {
    assert.match(work, /onClick=\{onTap\}/);
    assert.match(work, /pointer-events-none relative z-10/);
    assert.match(work, /className="group pointer-events-auto min-w-0"/);
  });
});

describe("the drawings on the portfolio", () => {
  // 2026-11-26: "لازم نحط مع كل مشروع مخططاته التنفيذية لانه في كثير ناس بهمهم".
  it("are the ones a browser can show: pictures and PDFs, not AutoCAD files", () => {
    assert.equal(drawingKind("pdf"), "pdf");
    assert.equal(drawingKind("PNG"), "image");
    assert.equal(drawingKind("image/jpeg"), "image");
    assert.equal(drawingKind("dwg"), null);
    assert.equal(drawingKind("", "https://x/a.pdf?v=2"), "pdf");
  });
  it("go out under the label written for the public, or none, and the dwg stays out", () => {
    const shown = toPortfolioProject(
      row({
        drawings: [
          { id: "d1", fileUrl: "https://x/1.pdf", fileType: "pdf", portfolioLabel: " Ground floor plan " },
          { id: "d2", fileUrl: "https://x/2.png", fileType: "png", portfolioLabel: "  " },
          { id: "d3", fileUrl: "https://x/3.dwg", fileType: "dwg", portfolioLabel: "CAD" },
        ],
      })
    );
    assert.deepEqual(shown?.drawings, [
      { id: "d1", label: "Ground floor plan", url: "https://x/1.pdf", kind: "pdf" },
      { id: "d2", label: null, url: "https://x/2.png", kind: "image" },
    ]);
  });
  it("are ticked only on the project's own drawings", () => {
    const actions = read("src", "lib", "actions", "portfolio-actions.ts");
    assert.match(actions, /prisma\.drawing\.updateMany\(\{ where: \{ projectId, id: \{ in: drawings \} \}/);
    assert.match(actions, /where: \{ id, projectId \}, data: \{ portfolioLabel: label \}/);
  });
  it("start unticked: a title block often carries the client's name", () => {
    assert.match(read("prisma", "schema.prisma"), /inPortfolio    Boolean @default\(false\)/);
  });
});
