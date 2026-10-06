import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DICTATION_SYSTEM,
  HORIZON_DAYS,
  MAX_DRAFTS,
  briefingCopy,
  buildDictationBrief,
  dayWord,
  dictationSchema,
  readDictation,
  readDraft,
  type TaskDraft,
} from "../src/lib/task-dictation";

// Handing work out by saying it. The model reads the words; these pin what is
// done with its answer — because the answer becomes jobs on real people's
// phones, and the list the manager approves comes back from a browser.

const TODAY = "2026-10-06"; // a Tuesday
const team = new Set(["wael", "sally"]);
const context = { personIds: team, todayKey: TODAY };

const task = (over: Record<string, unknown> = {}) => ({
  person_id: "wael",
  title: "يتصل مع مورد الرخام",
  details: null,
  done_when: null,
  start_day: TODAY,
  end_day: TODAY,
  priority: "MEDIUM",
  ...over,
});

describe("what the model may answer", () => {
  // The ids are an enum of the real team: an answer naming somebody who does
  // not exist cannot be produced, so an unknown name has one way out — said.
  it("only lets a task be given to somebody on the team", () => {
    const schema = dictationSchema(["wael", "sally"]) as {
      properties: { tasks: { items: { properties: { person_id: { enum: string[] } }; additionalProperties: boolean } } };
    };
    assert.deepEqual(schema.properties.tasks.items.properties.person_id.enum, ["wael", "sally"]);
    assert.equal(schema.properties.tasks.items.additionalProperties, false);
  });

  it("is told never to guess a name, invent work or translate it", () => {
    assert.match(DICTATION_SYSTEM, /do not guess/);
    assert.match(DICTATION_SYSTEM, /never translate/);
    assert.match(DICTATION_SYSTEM, /Never add work that was not asked for/);
  });
});

describe("the brief", () => {
  const brief = buildDictationBrief({
    words: "  وائل اليوم يتصل مع المورد  ",
    people: [
      { id: "wael", name: "Wael", role: "Sales" },
      { id: "sally", name: "Sally", role: null },
    ],
    todayKey: TODAY,
    tomorrowKey: "2026-10-07",
    isWorkingDay: (key) => key !== "2026-10-09", // closed that Friday
  });

  it("says what today and tomorrow are, and hands over a calendar to resolve weekdays", () => {
    assert.match(brief, /Today is 2026-10-06/);
    assert.match(brief, /"Tomorrow" means 2026-10-07/);
    assert.match(brief, /2026-10-06 — Tuesday 6 October — .*\(today\)/);
    assert.match(brief, /2026-10-09 — Friday 9 October — .*\(the studio is closed\)/);
  });

  it("names each person with the id the answer must use", () => {
    assert.match(brief, /- id: wael — Wael \(Sales\)/);
    assert.match(brief, /- id: sally — Sally\n/);
  });

  it("carries the words as they were said", () => {
    assert.match(brief, /<<<\nوائل اليوم يتصل مع المورد\n>>>/);
  });
});

describe("reading a draft", () => {
  it("reads the model's shape and the browser's shape the same way", () => {
    const fromModel = readDraft(task({ details: "الساعة ٣", done_when: "يبعث صورة" }), context);
    assert.deepEqual(fromModel, {
      employeeId: "wael",
      title: "يتصل مع مورد الرخام",
      note: "الساعة ٣",
      acceptance: "يبعث صورة",
      startKey: TODAY,
      endKey: TODAY,
      priority: "MEDIUM",
    } satisfies TaskDraft);

    // What the screen sends back when the manager presses Assign.
    assert.deepEqual(readDraft(fromModel, context), fromModel);
  });

  // The list comes back from a browser. An id in it is not evidence of anything.
  it("refuses a person who is not on the team", () => {
    assert.equal(readDraft(task({ person_id: "somebody-else" }), context), null);
    assert.equal(readDraft({ ...task(), person_id: undefined, employeeId: "manager-row" }, context), null);
  });

  it("refuses a task with no words", () => {
    assert.equal(readDraft(task({ title: "   " }), context), null);
    assert.equal(readDraft(null, context), null);
  });

  // A wrong day is seen on the list and corrected; a vanished task is not
  // missed until somebody asks why it was never done.
  it("puts a day it cannot read on today rather than losing the task", () => {
    assert.equal(readDraft(task({ start_day: "tomorrow", end_day: "tomorrow" }), context)?.startKey, TODAY);
    assert.equal(readDraft(task({ start_day: "2026-02-31", end_day: "2026-02-31" }), context)?.startKey, TODAY);
  });

  it("never plans into the past, or further out than a slip of the tongue", () => {
    assert.equal(readDraft(task({ start_day: "2026-10-01", end_day: "2026-10-01" }), context)?.startKey, TODAY);
    assert.ok(HORIZON_DAYS < 100);
    assert.equal(readDraft(task({ start_day: "2027-01-15", end_day: "2027-01-15" }), context)?.startKey, TODAY);
  });

  it("reads a range said backwards as the same range", () => {
    const draft = readDraft(task({ start_day: "2026-10-08", end_day: "2026-10-07" }), context);
    assert.equal(draft?.startKey, "2026-10-07");
    assert.equal(draft?.endKey, "2026-10-08");
  });

  it("takes an unknown priority as ordinary", () => {
    assert.equal(readDraft(task({ priority: "ASAP" }), context)?.priority, "MEDIUM");
    assert.equal(readDraft(task({ priority: "HIGH" }), context)?.priority, "HIGH");
  });

  it("cuts a title to what the database holds", () => {
    assert.equal(readDraft(task({ title: "x".repeat(500) }), context)?.title.length, 200);
  });
});

describe("reading the whole answer", () => {
  it("keeps what could not be placed, with the reason", () => {
    const read = readDictation(
      { tasks: [task()], unplaced: [{ said: "وحمزة يروح عالبنك", why: "حمزة غير موجود في الفريق" }] },
      context
    );
    assert.equal(read.drafts.length, 1);
    assert.deepEqual(read.unplaced, [{ said: "وحمزة يروح عالبنك", why: "حمزة غير موجود في الفريق" }]);
  });

  // Asked for, and not a job: it must be seen, not silently dropped.
  it("says so when a task cannot be given to anybody", () => {
    const read = readDictation({ tasks: [task({ person_id: "ghost", title: "يدفع الفاتورة" })], unplaced: [] }, context);
    assert.equal(read.drafts.length, 0);
    assert.equal(read.unplaced.length, 1);
    assert.equal(read.unplaced[0].said, "يدفع الفاتورة");
  });

  it("stops at a ceiling and says how many were left", () => {
    const many = Array.from({ length: MAX_DRAFTS + 5 }, (_, index) => task({ title: `task ${index}` }));
    const read = readDictation({ tasks: many, unplaced: [] }, context);
    assert.equal(read.drafts.length, MAX_DRAFTS);
    assert.match(read.unplaced[0].said, /5 more tasks/);
  });

  it("survives an answer that is not the shape it asked for", () => {
    assert.deepEqual(readDictation(null, context), { drafts: [], unplaced: [] });
    assert.deepEqual(readDictation({ tasks: "none" }, context), { drafts: [], unplaced: [] });
  });
});

describe("telling each person once", () => {
  const draft = (title: string, startKey = TODAY): TaskDraft => ({
    employeeId: "wael",
    title,
    note: null,
    acceptance: null,
    startKey,
    endKey: startKey,
    priority: "MEDIUM",
  });

  it("names the day in words", () => {
    assert.equal(dayWord(TODAY, TODAY), "today");
    assert.equal(dayWord("2026-10-07", TODAY), "tomorrow");
    assert.equal(dayWord("2026-10-11", TODAY), "Sun 11 Oct");
  });

  it("says one task as itself", () => {
    assert.deepEqual(briefingCopy([draft("Call the supplier", "2026-10-07")], TODAY), {
      title: "New Task Assigned",
      message: "Call the supplier — tomorrow.",
    });
  });

  // Four jobs said in one breath are one piece of news, not four buzzes.
  it("says several as one notification, numbered", () => {
    const copy = briefingCopy([draft("Call the supplier"), draft("Visit the site"), draft("Send the photos")], TODAY);
    assert.equal(copy.title, "3 new tasks for today");
    assert.equal(copy.message, "1. Call the supplier  2. Visit the site  3. Send the photos");
  });

  it("does not name one day for work spread over several", () => {
    const copy = briefingCopy([draft("One"), draft("Two", "2026-10-07")], TODAY);
    assert.equal(copy.title, "2 new tasks");
  });

  it("keeps a long list to something a lock screen can show", () => {
    const copy = briefingCopy(
      Array.from({ length: 12 }, (_, index) => draft(`A fairly long task title number ${index}`)),
      TODAY
    );
    assert.ok(copy.message.length <= 220);
    assert.ok(copy.message.endsWith("…"));
  });
});
