import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_SAMPLE,
  deliveryAdherence,
  describeEstimate,
  estimateAccuracy,
  firstReviewAcceptance,
  reworkRate,
  waitingOnBlockers,
} from "../src/lib/performance";

// The guard these tests exist for: a number that reads like a verdict must not
// come out of one or two measurements.

describe("refusing to report a number it cannot support", () => {
  it("says nothing at all when there is nothing to measure", () => {
    const empty = deliveryAdherence([]);

    assert.equal(empty.value, null);
    assert.equal(empty.sample, 0);
    assert.match(empty.why ?? "", /nothing to measure/i);
  });

  it("says nothing from a sample too small to mean anything", () => {
    const two = deliveryAdherence([{ onTime: true }, { onTime: false }]);

    assert.equal(two.value, null);
    assert.equal(two.sample, 2);
    assert.match(two.why ?? "", /only 2/i);
    assert.equal(MIN_SAMPLE, 3);
  });

  it("speaks once there is enough", () => {
    const three = deliveryAdherence([{ onTime: true }, { onTime: true }, { onTime: false }]);

    assert.equal(three.value, 67);
    assert.equal(three.sample, 3);
    assert.equal(three.why, null);
  });
});

describe("what was delivered against the date it was given", () => {
  it("leaves out work that never had a deadline", () => {
    const facts = [{ onTime: true }, { onTime: null }, { onTime: null }, { onTime: false }, { onTime: true }];
    const result = deliveryAdherence(facts);

    // Three had a date; the two without are not counted as met or missed.
    assert.equal(result.sample, 3);
    assert.equal(result.value, 67);
  });

  it("has nothing to say when nothing had a deadline", () => {
    const result = deliveryAdherence([{ onTime: null }, { onTime: null }, { onTime: null }]);

    assert.equal(result.value, null);
    assert.equal(result.sample, 0);
  });
});

describe("what the review made of it", () => {
  const reviews = [
    { acceptedFirstTime: true, sendBacks: 0 },
    { acceptedFirstTime: false, sendBacks: 2 },
    { acceptedFirstTime: true, sendBacks: 0 },
    { acceptedFirstTime: true, sendBacks: 0 },
  ];

  it("counts acceptance on the first send", () => {
    assert.equal(firstReviewAcceptance(reviews).value, 75);
  });

  it("reports rework as a rate, so more work is not worse work", () => {
    assert.equal(reworkRate(reviews).value, 0.5);

    const busier = [...reviews, ...reviews].map((review) => ({ ...review }));
    assert.equal(reworkRate(busier).value, 0.5);
  });

  it("ignores a negative number of send-backs rather than subtracting", () => {
    const odd = [
      { acceptedFirstTime: true, sendBacks: -3 },
      { acceptedFirstTime: true, sendBacks: 0 },
      { acceptedFirstTime: false, sendBacks: 2 },
    ];

    assert.equal(reworkRate(odd).value, Math.round((2 / 3) * 100) / 100);
  });
});

describe("time lost waiting on somebody else", () => {
  it("is reported from the first one, because it is about the studio", () => {
    const result = waitingOnBlockers([{ minutesWaiting: 120 }]);

    assert.equal(result.value, 120);
    assert.equal(result.sample, 1);
  });

  it("adds up, and says so plainly when nothing was blocked", () => {
    assert.equal(waitingOnBlockers([{ minutesWaiting: 30 }, { minutesWaiting: 90 }]).value, 120);

    const none = waitingOnBlockers([]);
    assert.equal(none.value, null);
    assert.match(none.why ?? "", /nothing has been blocked/i);
  });
});

describe("how close the estimates were", () => {
  it("uses the median, so one bad afternoon does not define somebody", () => {
    const facts = [
      { estimatedMinutes: 60, actualMinutes: 60 },
      { estimatedMinutes: 60, actualMinutes: 66 },
      { estimatedMinutes: 60, actualMinutes: 600 },
    ];

    // The mean ratio would be about 3.7; the median is 1.1.
    assert.equal(estimateAccuracy(facts).value, 1.1);
  });

  it("ignores work with no estimate or no time recorded", () => {
    const facts = [
      { estimatedMinutes: 0, actualMinutes: 90 },
      { estimatedMinutes: 60, actualMinutes: 0 },
      { estimatedMinutes: 60, actualMinutes: 60 },
    ];

    assert.equal(estimateAccuracy(facts).value, null);
    assert.equal(estimateAccuracy(facts).sample, 1);
  });

  it("reads the way a person would say it", () => {
    assert.equal(describeEstimate(null), "Not enough to say");
    assert.equal(describeEstimate(1), "About right");
    assert.equal(describeEstimate(1.05), "About right");
    assert.match(describeEstimate(1.6), /1\.6× the estimate/);
    assert.match(describeEstimate(0.6), /Finishes/);
  });
});
