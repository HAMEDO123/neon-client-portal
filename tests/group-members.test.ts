import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { memberLine } from "../src/lib/group-members";

describe("the members under the group's name", () => {
  it("lists everybody and puts you last, as You", () => {
    assert.equal(memberLine(["Manager", "Wael", "Sally", "Salem"], "Sally"), "Manager, Wael, Salem, You");
  });

  it("does the same for the manager", () => {
    assert.equal(memberLine(["Manager", "Wael", "Sally", "Salem"], "Manager"), "Wael, Sally, Salem, You");
  });

  it("names each person once", () => {
    assert.equal(memberLine(["Manager", "Wael", "Wael", "Sally"], "Sally"), "Manager, Wael, You");
  });

  it("ignores blank names", () => {
    assert.equal(memberLine(["Manager", "  ", "Wael"], null), "Manager, Wael");
  });

  it("lists everybody when there is no viewer to single out", () => {
    assert.equal(memberLine(["Manager", "Wael"]), "Manager, Wael");
  });
});
