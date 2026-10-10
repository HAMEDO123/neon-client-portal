import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  TASK_MARK,
  aboutTaskUrl,
  questionBody,
  quotedTitle,
  readAboutKind,
  readAskWhere,
  splitQuestion,
} from "../src/lib/task-questions";

// Asking about a task in a chat: the message names the task on its first line,
// and the row says which task it was.

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");

describe("a question about a task", () => {
  it("names the task on its first line, then says what was asked", () => {
    assert.equal(questionBody("تنظيف الشركة", "  متى لازم أخلص؟ "), `${TASK_MARK} تنظيف الشركة\nمتى لازم أخلص؟`);
  });

  // The first line IS the quote. A line break inside the title would end it
  // early and leave half the task's name reading as the question.
  it("quotes a title as one line, and not the whole of a long one", () => {
    assert.equal(quotedTitle("  Site visit\n  Villa   12 "), "Site visit Villa 12");
    const long = quotedTitle("x".repeat(400));
    assert.equal(long.length, 140);
    assert.ok(long.endsWith("…"));
  });

  it("comes apart again into the quote and the words", () => {
    const body = questionBody("تنظيف الشركة", "متى؟\nوبأي غرفة أبدأ؟");
    assert.deepEqual(splitQuestion(body, "تنظيف الشركة"), { quoted: "تنظيف الشركة", text: "متى؟\nوبأي غرفة أبدأ؟" });
  });

  it("round-trips a title that had to be shortened", () => {
    const title = quotedTitle(`Kitchen drawings · ${"Villa ".repeat(40)}`);
    assert.deepEqual(splitQuestion(questionBody(title, "Which revision?"), title), { quoted: title, text: "Which revision?" });
  });

  it("leaves an ordinary message exactly as it was written", () => {
    assert.deepEqual(splitQuestion("hello", null), { quoted: null, text: "hello" });
    assert.deepEqual(splitQuestion(`${TASK_MARK} my own list\nmilk`, null), { quoted: null, text: `${TASK_MARK} my own list\nmilk` });
    assert.deepEqual(splitQuestion(null, undefined), { quoted: null, text: null });
  });

  // Only the line this module wrote is taken off. Anything else is somebody's
  // own words, and losing a line of those would be worse than a quote drawn twice.
  it("never takes a line off that it did not write", () => {
    assert.deepEqual(splitQuestion("just words", "Clean the office"), { quoted: "Clean the office", text: "just words" });
    assert.deepEqual(splitQuestion(`${TASK_MARK} Clean the office!\nwhen?`, "Clean the office"), {
      quoted: "Clean the office",
      text: `${TASK_MARK} Clean the office!\nwhen?`,
    });
    assert.deepEqual(splitQuestion(`${TASK_MARK} Clean the office`, "Clean the office"), { quoted: "Clean the office", text: null });
  });

  it("reads what a form says and nothing it does not", () => {
    assert.equal(readAskWhere("manager"), "manager");
    assert.equal(readAskWhere("team"), "team");
    assert.equal(readAskWhere("g-abc"), null);
    assert.equal(readAskWhere(null), null);
    assert.equal(readAboutKind("assigned"), "assigned");
    assert.equal(readAboutKind("board"), "board");
    assert.equal(readAboutKind("chat"), null);
  });
});

describe("where a quoted task opens", () => {
  const job = { aboutAssignedTaskId: "job1", aboutEntryId: null, aboutTitle: "x" };
  const cell = { aboutAssignedTaskId: null, aboutEntryId: "cell1", aboutTitle: "x" };
  const gone = { aboutAssignedTaskId: null, aboutEntryId: null, aboutTitle: "x" };

  it("is the task's own page for whoever asked", () => {
    assert.equal(aboutTaskUrl("EMPLOYEE", job, true), "/employee/assigned/job1");
    assert.equal(aboutTaskUrl("EMPLOYEE", cell, true), "/employee/tasks/cell1");
  });

  // In the company's group everybody sees the quote, and a task's page is its
  // owner's alone: a link would open "not found" for all but one of them.
  it("is nowhere for a colleague reading it in the group", () => {
    assert.equal(aboutTaskUrl("EMPLOYEE", job, false), null);
    assert.equal(aboutTaskUrl("EMPLOYEE", cell, false), null);
  });

  // The manager cannot sign in to the team's portal at all.
  it("is never the team's portal for the manager", () => {
    assert.equal(aboutTaskUrl("ADMIN", job, false), "/admin/tasks/job/job1");
    assert.equal(aboutTaskUrl("ADMIN", cell, false), "/admin/tasks");
    for (const about of [job, cell]) {
      assert.equal(aboutTaskUrl("ADMIN", about, false)?.startsWith("/employee"), false);
    }
  });

  it("is nowhere once the task has been deleted", () => {
    assert.equal(aboutTaskUrl("ADMIN", gone, false), null);
    assert.equal(aboutTaskUrl("EMPLOYEE", gone, true), null);
  });
});

// Everything below typechecks, builds and passes every other test when it is
// wrong, so it is read off the source.
describe("asking is only ever about your own task, as yourself", () => {
  const action = read("src", "lib", "actions", "task-question-actions.ts");

  it("takes who is asking from the session and finds the task as theirs", () => {
    assert.match(action, /const employee = await requireEmployee\(\);/);
    assert.match(action, /await taskAskedAbout\(employee\.id, kind, id\)/);
    // Nothing in the form may say who is asking or what the task is called.
    assert.equal(/formData\.get\("(employeeId|authorId|title|aboutTitle)"\)/.test(action), false);
  });

  it("opens the conversation through the chat's own check", () => {
    assert.match(action, /await channelFor\(viewer, conversation\)/);
    assert.match(action, /\{ kind: "direct", employeeId: employee\.id \}/);
  });

  it("looks a task up the way its own page does", () => {
    const store = read("src", "lib", "task-question-store.ts");
    assert.match(store, /await myAssignedTask\(employeeId, id\)/);
    assert.match(store, /await taskForEmployee\(employeeId, id\)/);
    assert.equal(/^"use server"/.test(store), false, "the lookups are callable over the network");
  });

  // A thrown sentence does not reach a production page (lib/refusal.ts), and an
  // answer handed straight to the phone is a 200 the app reads as "it worked".
  it("answers in words, and reaches the phone through heard()", () => {
    assert.match(action, /^export async function askAboutTask\(formData: FormData\): Promise<Answer> \{\n  return answering\(/m);
    assert.equal(action.includes("throw new Error("), false);
    assert.match(read("src", "lib", "mobile", "registry", "me.ts"), /"me\/tasks\/ask": async \(input\) => heard\(await askAboutTask\(input\.form\)\)/);
  });
});

describe("a message that asks about a task", () => {
  // A fifth relation in this one select closes the local database's connection
  // (see the note under it). The task rides on three plain columns instead.
  it("is read through columns, not a fifth relation", () => {
    const chat = read("src", "lib", "chat.ts");
    const select = chat.slice(chat.indexOf("export const messageSelect = {"), chat.indexOf("} as const;", chat.indexOf("export const messageSelect = {")));
    for (const column of ["aboutAssignedTaskId: true", "aboutEntryId: true", "aboutTitle: true"]) {
      assert.ok(select.includes(column), column);
    }
    const relations = select.match(/^  \w+: \{ select:/gm) ?? [];
    assert.equal(relations.length, 4, "messageSelect reads a different number of relations than it did");
  });

  it("keeps its question when the task is deleted", () => {
    const schema = read("prisma", "schema.prisma");
    assert.match(schema, /aboutAssignedTask\s+AssignedTask\?\s+@relation\(fields: \[aboutAssignedTaskId\], references: \[id\], onDelete: SetNull\)/);
    assert.match(schema, /aboutEntry\s+ProjectTaskEntry\?\s+@relation\(fields: \[aboutEntryId\], references: \[id\], onDelete: SetNull\)/);
  });

  // The team's group is deliberately not pushed to the manager. A question
  // about a job they handed out is the one thing in it addressed to them.
  it("reaches the manager when it is asked in the group", () => {
    assert.match(read("src", "lib", "actions", "task-question-actions.ts"), /alsoManager: where === "team"/);
    assert.match(read("src", "lib", "chat-send.ts"), /alsoManager && sender\.type === "EMPLOYEE" \? await managerRecipient\(\) : \[\]/);
  });

  it("is drawn as a quote, with what was said under it", () => {
    const room = read("src", "components", "chat", "chat-room.tsx");
    assert.match(room, /const asked = splitQuestion\(message\.body, message\.aboutTitle\);/);
    assert.match(room, /<TaskQuote title=\{asked\.quoted\} href=\{aboutTaskUrl\(as, message, mine\)\}/);
  });
});
