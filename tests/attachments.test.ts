import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { attachmentLabel, extensionOf, isImage } from "../src/lib/attachments";

describe("reading what a stored file is", () => {
  it("knows the images a screen can draw", () => {
    for (const url of [
      "https://cdn.example.com/a.jpg",
      "https://cdn.example.com/a.JPEG",
      "https://cdn.example.com/a.png",
      "https://cdn.example.com/a.webp",
      "https://cdn.example.com/a.gif",
      "https://cdn.example.com/a.avif",
    ]) {
      assert.equal(isImage(url), true, url);
    }
  });

  it("knows what is not an image", () => {
    for (const url of ["https://cdn.example.com/a.pdf", "/uploads/plan.dwg", "x/y/sheet.xlsx", "clip.mp4"]) {
      assert.equal(isImage(url), false, url);
    }
  });

  it("reads through a query string, because a signed URL still ends in its type", () => {
    // Reading the extension off the whole string finds "pdf?token=abc" and
    // matches nothing, so the PDF would be drawn as a broken image.
    assert.equal(extensionOf("https://cdn.example.com/plan.pdf?token=abc&x=1"), "pdf");
    assert.equal(extensionOf("https://cdn.example.com/photo.jpg#page=2"), "jpg");
    assert.equal(isImage("https://cdn.example.com/photo.jpg?v=9"), true);
  });

  it("treats anything it cannot identify as not an image", () => {
    // The harmless way round: an unknown file is shown as a file and sent to a
    // person. Guessing the other way puts a broken icon on the review screen.
    assert.equal(isImage(""), false);
    assert.equal(isImage(null), false);
    assert.equal(isImage(undefined), false);
    assert.equal(isImage("https://cdn.example.com/nofiletype"), false);
    assert.equal(isImage("https://cdn.example.com/trailing."), false);
  });

  it("names a file the way a person would", () => {
    assert.equal(attachmentLabel("a.pdf"), "PDF");
    assert.equal(attachmentLabel("a.docx"), "Word document");
    assert.equal(attachmentLabel("a.xlsx"), "Spreadsheet");
    assert.equal(attachmentLabel("a.dwg"), "Drawing");
    assert.equal(attachmentLabel("a.mp4"), "Video");
    // Something unusual still gets a name rather than a blank.
    assert.equal(attachmentLabel("a.step"), "STEP");
    assert.equal(attachmentLabel("nofiletype"), "File");
  });
});
