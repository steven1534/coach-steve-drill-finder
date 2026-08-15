import assert from "node:assert/strict";
import {
  dedupeDisplayLevels,
  hasRawLabelSpillover,
  parseLabeledSegments,
  partitionBySyncFlag,
  sanitizeNotionRow,
} from "./sync-field-sanitizer.mjs";

const offSpeed = sanitizeNotionRow({
  whatThisFixes:
    "equipment: Baseball, Bat, Optional net or fence<br>whatThisFixes: Lunging and early swings caused by misreading off-speed pitches",
  whatToFeel: "equipment: Bat, baseball, glove",
  coachCue: "Stay back and wait for the slow release.",
  commonMistakes:
    "**equipment:** Bat, baseball, glove**howToDoIt:** Use a slow arm circle.",
});

assert.equal(
  offSpeed.whatThisFixes,
  "Lunging and early swings caused by misreading off-speed pitches",
);
assert.equal(offSpeed.whatToFeel, "");
assert.equal(offSpeed.coachCue, "Stay back and wait for the slow release.");
assert.equal(offSpeed.commonMistakes, "");

const recovered = sanitizeNotionRow({
  description:
    "description: Clean description<br>whatToFeel: Stay centered<br>coachCue: Let the ball travel",
  whatToFeel: "equipment: Bat",
  coachCue: "equipment: Bat",
});
assert.equal(recovered.description, "Clean description");
assert.equal(recovered.whatToFeel, "Stay centered");
assert.equal(recovered.coachCue, "Let the ball travel");

const fielding = sanitizeNotionRow({
  description:
    "description: Field the backhand cleanly\ncommonMistakes: Reaching instead of shuffling\nbestFor: Beginner infielders\nnextSteps: Add live runners",
  commonMistakes: "problem: Poor backhand posture",
  nextSteps: "goal: Build game speed",
});
assert.equal(fielding.description, "Field the backhand cleanly");
assert.equal(fielding.commonMistakes, "Reaching instead of shuffling");
assert.equal(fielding.nextSteps, "Add live runners");
assert.equal(hasRawLabelSpillover(fielding.commonMistakes), false);
assert.equal(hasRawLabelSpillover("Sync to Site: __YES__"), true);

assert.deepEqual(
  parseLabeledSegments("<properties>purpose: Build rhythm�</properties>").segments,
  { purpose: "Build rhythm" },
);

assert.deepEqual(dedupeDisplayLevels("Intermediate", ["Intermediate"]), {
  level: "",
  ages: ["Intermediate"],
});

const partition = partitionBySyncFlag([
  { "Sync to Site": "__YES__" },
  { "Sync to Site": "__NO__" },
  {},
]);
assert.equal(partition.enabled.length, 1);
assert.equal(partition.disabled.length, 2);

console.log("sync-field-sanitizer: all tests passed");
