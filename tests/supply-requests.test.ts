import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { countedOf, headlineOf, readSupplyLines, summaryOf, totalOf } from "../src/lib/supply-requests";

// A form is untyped, so a caller sending field names nothing reads typechecks,
// lints, builds and passes every other test — and fails only when somebody
// presses the button. These pin both shapes the platform actually sends.

function form(pairs: [string, string][]) {
  const data = new FormData();
  for (const [key, value] of pairs) data.append(key, value);
  return data;
}

describe("the website's list of things to buy", () => {
  it("keeps every row, in the order they were typed", () => {
    const lines = readSupplyLines(
      form([
        ["lineName", "Coffee"],
        ["lineCount", "2"],
        ["lineCost", "9.5"],
        ["lineName", "A4 paper"],
        ["lineCount", ""],
        ["lineCost", "12"],
      ])
    );

    assert.equal(lines.length, 2);
    assert.deepEqual(lines[0], { name: "Coffee", count: 2, estimatedCost: 9.5, position: 0 });
    assert.deepEqual(lines[1], { name: "A4 paper", count: null, estimatedCost: 12, position: 1 });
  });

  it("takes the price as the line's own, never as the price of one", () => {
    // The studio's choice: 3 of them for 15 means 15, not 45. Nothing in the
    // reading or the total may multiply, and this is the test that says so.
    const lines = readSupplyLines(form([["lineName", "Chairs"], ["lineCount", "3"], ["lineCost", "15"]]));

    assert.equal(lines[0].estimatedCost, 15);
    assert.equal(totalOf(lines), 15);
  });

  it("reads a count that is still posted under the box's old name", () => {
    // A page left open across the deploy posts lineQuantity. "3" typed into it
    // is still three — the lesson of the release before this one.
    const lines = readSupplyLines(form([["lineName", "Pens"], ["lineQuantity", "3"]]));
    assert.equal(lines[0].count, 3);
  });

  it("refuses a count that is not a whole number of things", () => {
    const of = (value: string) => readSupplyLines(form([["lineName", "x"], ["lineCount", value]]))[0].count;

    assert.equal(of(""), null, "an empty box is no answer");
    assert.equal(of("0"), null, "nought of something is not a request for it");
    assert.equal(of("-2"), null, "nor is a negative");
    assert.equal(of("abc"), null);
    assert.equal(of("2.7"), 2, "half a chair is not a thing to buy");
    assert.equal(of("99999999"), 9999, "a long press on a phone key is not a quantity");
  });

  it("drops a box nobody filled in, and renumbers what is left", () => {
    // Somebody adds three rows and uses two. The empty one is not a thing to
    // buy, and the positions must not keep its gap.
    const lines = readSupplyLines(
      form([
        ["lineName", "Coffee"],
        ["lineCount", ""],
        ["lineCost", ""],
        ["lineName", "   "],
        ["lineCount", ""],
        ["lineCost", ""],
        ["lineName", "Pens"],
        ["lineCount", ""],
        ["lineCost", ""],
      ])
    );

    assert.deepEqual(
      lines.map((line) => [line.name, line.position]),
      [
        ["Coffee", 0],
        ["Pens", 1],
      ]
    );
  });
});

describe("the one thing the iOS app sends", () => {
  // The app was written against the form as it was before the list, and it
  // posts item/quantity/estimatedCost. Reading only the list fields made every
  // request from a phone answer "Add at least one thing to buy" with nothing
  // wrong at the sending end. This is that case.
  it("is read as a list of one", () => {
    const lines = readSupplyLines(
      form([
        ["item", "Printer ink"],
        ["quantity", "1"],
        ["estimatedCost", "22.5"],
        ["note", "the black one"],
        ["urgent", "on"],
      ])
    );

    assert.deepEqual(lines, [{ name: "Printer ink", count: 1, estimatedCost: 22.5, position: 0 }]);
  });

  it("works with the optional boxes left out entirely, as the app leaves them", () => {
    // MeAPI.swift omits a field rather than sending an empty one.
    const lines = readSupplyLines(form([["item", "Bin bags"]]));
    assert.deepEqual(lines, [{ name: "Bin bags", count: null, estimatedCost: null, position: 0 }]);
  });

  it("still refuses a form with nothing in it at all", () => {
    assert.deepEqual(readSupplyLines(form([])), []);
    assert.deepEqual(readSupplyLines(form([["item", "  "]])), []);
  });
});

describe("what the manager is shown in the one line they have room for", () => {
  it("names a single thing outright", () => {
    assert.equal(headlineOf([{ name: "Coffee", count: null, estimatedCost: null, position: 0 }]), "Coffee");
  });

  it("counts the rest, so a shop run does not read as one item", () => {
    const lines = ["Coffee", "Pens", "Paper"].map((name, position) => ({
      name,
      count: null,
      estimatedCost: null,
      position,
    }));
    assert.equal(headlineOf(lines), "Coffee and 2 more");
  });
});

describe("what it adds up to", () => {
  it("is null when nobody put a figure on anything, never zero", () => {
    // Zero would read as "they say it is free", which is not what an empty box
    // means — the screens print a cost only when there is one.
    assert.equal(totalOf([{ name: "Coffee", count: null, estimatedCost: null, position: 0 }]), null);
  });

  it("does not reach the manager with floating-point dust", () => {
    const lines = [0.1, 0.2].map((estimatedCost, position) => ({
      name: `thing ${position}`,
      count: null,
      estimatedCost,
      position,
    }));
    assert.equal(totalOf(lines), 0.3);
  });
});

describe("how many things, in the one line the old screens have room for", () => {
  const line = (name: string, count: number | null) => ({ name, count, estimatedCost: null, position: 0 });

  it("adds the counts across every item", () => {
    assert.equal(countedOf([line("Coffee", 2), line("Pens", 10)]), 12);
  });

  it("says nothing rather than nought when nobody counted", () => {
    // "0 things" says the opposite of what an uncounted request means.
    assert.equal(countedOf([line("Coffee", null)]), null);
    assert.equal(summaryOf([line("Coffee", null)]), null);
  });

  it("gives one item its own number and several the tally of both", () => {
    assert.equal(summaryOf([line("Coffee", 3)]), "3");
    assert.equal(summaryOf([line("Coffee", 2), line("Pens", 10)]), "2 items · 12 things");
    assert.equal(summaryOf([line("Coffee", null), line("Pens", null)]), "2 items");
  });
});
