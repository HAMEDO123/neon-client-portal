import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { databaseTarget } from "./db-target";

// The tripwire. It fails rather than skipping, on purpose: a run that says
// `pass 0 … skipped N` is the exact shape the README warns is believed as
// "everything is fine", and this is the one thing that must never be.

describe("the database these tests are pointed at", () => {
  it("is not the studio's live one", () => {
    const target = databaseTarget(process.env.DATABASE_URL);
    assert.ok(target.safe, target.why);
  });
});

describe("which databases are allowed", () => {
  const dev = "postgres://u:p@127.0.0.1:51214/template1?sslmode=disable";
  const live = "postgres://u:p@127.0.0.1:55432/neon";

  it("allows the development database", () => {
    assert.equal(databaseTarget(dev).safe, true);
    assert.equal(databaseTarget(dev.replace("127.0.0.1", "localhost")).safe, true);
  });

  it("refuses the studio's own, and says which one it is", () => {
    const target = databaseTarget(live);
    assert.equal(target.safe, false);
    assert.match(target.why, /live database/);
    assert.match(target.why, /clients\.neonjo\.com/);
  });

  it("refuses anything it has not been told about, rather than allowing it", () => {
    // An allow-list, because the failure mode of getting this wrong is writing
    // into client data — a block-list would pass every database nobody thought of.
    assert.equal(databaseTarget("postgres://u:p@db.example.com:5432/neon").safe, false);
    assert.equal(databaseTarget("postgres://u:p@127.0.0.1:5432/neon").safe, false);
    assert.equal(databaseTarget("not-an-address").safe, false);
  });

  it("says nothing about having no database at all", () => {
    // The dev one being down is the documented outcome, and the db tests skip
    // themselves for it. Not this check's business.
    assert.equal(databaseTarget(undefined).safe, true);
    assert.equal(databaseTarget("").safe, true);
  });
});
