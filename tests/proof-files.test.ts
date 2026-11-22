import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_PROOF_FILES, proofFiles, proofUrls } from "../src/lib/attachments";
import { MAX_UPLOAD_BYTES } from "../src/lib/upload-limits";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

describe("a proof of several files", () => {
  it("is every one of them, first one first", () => {
    assert.deepEqual(proofUrls({ imageUrl: "a.jpg", extraUrls: ["b.jpg", "c.pdf"] }), ["a.jpg", "b.jpg", "c.pdf"]);
    assert.deepEqual(proofUrls({ imageUrl: "a.jpg" }), ["a.jpg"], "one sent before there could be several");
  });

  it("reads every photo a form carries, and one from an older phone build", () => {
    const form = new FormData();
    form.append("photo", new File(["1"], "one.jpg", { type: "image/jpeg" }));
    assert.equal(proofFiles(form).length, 1);
    form.append("photo", new File(["2"], "two.pdf", { type: "application/pdf" }));
    form.append("photo", new File([], "empty.jpg"));
    form.append("photo", "not a file");
    assert.deepEqual(
      proofFiles(form).map((file) => file.name),
      ["one.jpg", "two.pdf"]
    );
    assert.deepEqual(proofFiles(new FormData()), []);
  });

  it("has a limit the server holds to as well as the form", () => {
    assert.ok(MAX_PROOF_FILES >= 5);
    assert.match(read("src", "lib", "task-proof.ts"), /photos\.length > MAX_PROOF_FILES/);
    assert.match(read("src", "components", "employee", "proof-picker.tsx"), /MAX_PROOF_FILES - picked\.length/);
  });

  // Written a second time in Swift, where a refusal costs an upload from a site.
  it("is held to the same limits in the phone app", () => {
    const sheet = read("ios", "Sources", "Features", "Me", "ProofSheet.swift");
    assert.equal(Number(sheet.match(/static let most = (\d+)/)?.[1]), MAX_PROOF_FILES);
    assert.equal(Number(sheet.match(/static let mostBytes = (\d+) \* 1024 \* 1024/)?.[1]) * 1024 * 1024, MAX_UPLOAD_BYTES);
    assert.match(sheet, /files: files\.map\(\\\.file\)/, "everything picked is sent");
  });

  // Work approved on one photo of five is what a screen that forgets the rest does.
  it("is shown whole everywhere it is shown", () => {
    for (const file of [
      ["src", "app", "admin", "(dashboard)", "reviews", "page.tsx"],
      ["src", "app", "employee", "(portal)", "tasks", "[id]", "page.tsx"],
      ["src", "components", "employee", "assigned-task-detail.tsx"],
      ["src", "components", "chat", "task-card.tsx"],
    ]) {
      assert.match(read(...file), /<ProofThumbs /, file.at(-1));
    }
    assert.match(read("src", "lib", "mobile", "home-reads.ts"), /extraFiles:/);
    for (const file of [
      ["Home", "ReviewsRootView.swift"],
      ["Chat", "ChatRoomCards.swift"],
      ["Me", "AssignedJobs.swift"],
    ]) {
      assert.match(read("ios", "Sources", "Features", ...file), /ProofStrip\(files: /, file.at(-1));
    }
    assert.match(read("src", "lib", "monthly-export.ts"), /proofUrls\(submission\)/);
    assert.match(read("src", "lib", "ai", "verify-submission.ts"), /pictures\.map/);
  });

  it("is picked the same way on a task's page and on a chat card", () => {
    for (const file of [
      ["src", "components", "employee", "completion-form.tsx"],
      ["src", "components", "chat", "task-card.tsx"],
    ]) {
      const source = read(...file);
      assert.match(source, /useProofFiles\(\)/);
      assert.match(source, /whileBusy\(/, "an upload is held against the live refresh");
    }
  });
});
