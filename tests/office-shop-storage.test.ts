import { test } from "node:test";
import assert from "node:assert/strict";
import { readShopStorage } from "../src/lib/office-shop-storage";

test("an entry needs a key and an https origin", () => {
  assert.deepEqual(
    readShopStorage([
      { origin: "https://www.yasermallonline.com", key: "wk_token", value: "abc" },
      { origin: "http://www.yasermallonline.com", key: "wk_token", value: "abc" },
      { origin: "https://www.yasermallonline.com/path", key: "x", value: "y" },
      { origin: "https://www.yasermallonline.com", key: "", value: "y" },
      null,
      "nonsense",
    ]),
    [{ origin: "https://www.yasermallonline.com", key: "wk_token", value: "abc" }]
  );
});

test("not a list is nothing, and the list is capped", () => {
  assert.deepEqual(readShopStorage({ key: "x" }), []);
  const many = Array.from({ length: 80 }, (_, i) => ({ origin: "https://a.example", key: `k${i}`, value: "v" }));
  assert.equal(readShopStorage(many).length, 50);
});

test("a missing value is an empty one, and long values are cut", () => {
  const [one] = readShopStorage([{ origin: "https://a.example", key: "k" }]);
  assert.equal(one.value, "");
  const [long] = readShopStorage([{ origin: "https://a.example", key: "k", value: "x".repeat(10000) }]);
  assert.equal(long.value.length, 8192);
});
