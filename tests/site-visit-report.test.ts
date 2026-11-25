import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { photoReport } from "../src/lib/site-visit-report";

// Photos sent from a site visit's job are the visit's write-up (2026-11-25:
// Wael's proof of three visits came back as an error from the phone).

const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), "utf8");

describe("photos sent from a visit's job", () => {
  it("are the write-up, before the usual move check, and no longer turned away", () => {
    const proof = read("src", "lib", "task-proof.ts");
    assert.match(proof, /if \(visitId\) return proofAsVisitReport\(employee, visitId, photos, note\);/);
    assert.ok(proof.indexOf("proofAsVisitReport(") < proof.indexOf("canMove(subject.state"), "a visit is answered before the job's own move check");
    assert.ok(!proof.includes("VISIT_TASK_REFUSAL"));
  });
  it("say what came of it in the person's words, or how many photos came", () => {
    assert.equal(photoReport("  الموقع جاهز ", 2), "الموقع جاهز");
    assert.equal(photoReport(null, 1), "Sent 1 photo from the visit.");
    assert.equal(photoReport("", 3), "Sent 3 photos from the visit.");
  });
  it("go through the same write-up as the Site visits screen", () => {
    assert.match(read("src", "lib", "actions", "site-visit-actions.ts"), /await writeVisitReport\(actor, visit,/);
    const report = read("src", "lib", "site-visit-report.ts");
    assert.match(report, /await writeVisitReport\(employee, visit, "REPORTED", photoReport\(note, urls\.length\), urls\);/);
    assert.match(report, /visit\.employeeId !== employee\.id/);
    assert.match(report, /visit\.state !== "PLANNED"/);
  });
});
