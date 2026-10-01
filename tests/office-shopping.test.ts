import { test } from "node:test";
import assert from "node:assert/strict";
import { shoppingDedupeKey, shoppingLabel, shoppingMessage } from "../src/lib/office-shopping";

test("a label is one trimmed line, or nothing", () => {
  assert.equal(shoppingLabel("  Nescafe Gold\n 200g  "), "Nescafe Gold 200g");
  assert.equal(shoppingLabel(""), null);
  assert.equal(shoppingLabel(42), null);
  assert.equal(shoppingLabel("x".repeat(200))?.length, 80);
});

test("the same thing from the same person collapses within ten minutes", () => {
  const at = new Date("2026-10-01T10:01:00Z");
  const later = new Date("2026-10-01T10:08:00Z");
  const muchLater = new Date("2026-10-01T10:31:00Z");
  assert.equal(shoppingDedupeKey("e1", "Nescafe", at), shoppingDedupeKey("e1", "nescafe", later));
  assert.notEqual(shoppingDedupeKey("e1", "Nescafe", at), shoppingDedupeKey("e1", "Nescafe", muchLater));
  assert.notEqual(shoppingDedupeKey("e1", "Nescafe", at), shoppingDedupeKey("e2", "Nescafe", at));
});

test("the message says who and what", () => {
  assert.deepEqual(shoppingMessage("Wael", "Nescafe"), { title: "Wael added to the office cart", message: "Nescafe" });
  assert.equal(shoppingMessage("Wael", null).message, "Something new is in the cart.");
});
