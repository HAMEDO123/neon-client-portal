import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { headlineOf, readSupplyLines, totalOf } from "../src/lib/supply-requests";

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
        ["lineQuantity", "2 boxes"],
        ["lineCost", "9.5"],
        ["lineName", "A4 paper"],
        ["lineQuantity", ""],
        ["lineCost", "12"],
      ])
    );

    assert.equal(lines.length, 2);
    assert.deepEqual(lines[0], { name: "Coffee", quantity: "2 boxes", estimatedCost: 9.5, position: 0 });
    assert.deepEqual(lines[1], { name: "A4 paper", quantity: null, estimatedCost: 12, position: 1 });
  });

  it("drops a box nobody filled in, and renumbers what is left", () => {
    // Somebody adds three rows and uses two. The empty one is not a thing to
    // buy, and the positions must not keep its gap.
    const lines = readSupplyLines(
      form([
        ["lineName", "Coffee"],
        ["lineQuantity", ""],
        ["lineCost", ""],
        ["lineName", "   "],
        ["lineQuantity", ""],
        ["lineCost", ""],
        ["lineName", "Pens"],
        ["lineQuantity", ""],
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

    assert.deepEqual(lines, [{ name: "Printer ink", quantity: "1", estimatedCost: 22.5, position: 0 }]);
  });

  it("works with the optional boxes left out entirely, as the app leaves them", () => {
    // MeAPI.swift omits a field rather than sending an empty one.
    const lines = readSupplyLines(form([["item", "Bin bags"]]));
    assert.deepEqual(lines, [{ name: "Bin bags", quantity: null, estimatedCost: null, position: 0 }]);
  });

  it("still refuses a form with nothing in it at all", () => {
    assert.deepEqual(readSupplyLines(form([])), []);
    assert.deepEqual(readSupplyLines(form([["item", "  "]])), []);
  });
});

describe("what the manager is shown in the one line they have room for", () => {
  it("names a single thing outright", () => {
    assert.equal(headlineOf([{ name: "Coffee", quantity: null, estimatedCost: null, position: 0 }]), "Coffee");
  });

  it("counts the rest, so a shop run does not read as one item", () => {
    const lines = ["Coffee", "Pens", "Paper"].map((name, position) => ({
      name,
      quantity: null,
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
    assert.equal(totalOf([{ name: "Coffee", quantity: null, estimatedCost: null, position: 0 }]), null);
  });

  it("does not reach the manager with floating-point dust", () => {
    const lines = [0.1, 0.2].map((estimatedCost, position) => ({
      name: `thing ${position}`,
      quantity: null,
      estimatedCost,
      position,
    }));
    assert.equal(totalOf(lines), 0.3);
  });
});
