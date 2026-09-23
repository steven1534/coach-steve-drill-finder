import assert from "node:assert/strict";
import {
  contentHash,
  normalizeReview,
  scanRows,
} from "../lib/aiReview.js";

const base = {
  pageId: "page-1",
  drillName: "Example Drill",
  Dr: "example-drill",
  description: "Train timing and controlled movement.",
  purpose: "Improve timing.",
  howToDoIt: "Load, move, swing.",
  watchFor: "Do not rush.",
  whatToFeel: "Controlled move.",
  coachCue: "Slow early. Explode late.",
  commonMistakes: "",
  nextSteps: "",
  whatThisFixes: "Rushing the move.",
  whyImportant: "Better timing gives the hitter more adjustability in games.",
  problem: ["timing"],
  goal: ["Improve timing"],
  tags: ["Timing & rhythm"],
  drillType: ["Timing Drill"],
  ageLevel: ["Intermediate"],
  difficulty: "Medium",
  foundationOrAdvanced: "Intermediate",
  equipment: ["Bat"],
  category: ["Hitting"],
  duration: "10m",
  "Sync to Site": "__YES__",
  aiReviewStatus: "",
  aiReviewHash: "",
  aiReviewJson: "",
};

const hash = contentHash(base);
assert.equal(typeof hash, "string");
assert.equal(hash.length, 64);
assert.equal(contentHash({ ...base, aiReviewStatus: "Approved" }), hash);
assert.notEqual(contentHash({ ...base, coachCue: "Different cue" }), hash);

const fresh = scanRows([base]);
assert.equal(fresh.total, 1);
assert.equal(fresh.needsReview, 1);
assert.equal(fresh.items[0].changed, true);

const approved = scanRows([
  { ...base, aiReviewStatus: "Approved", aiReviewHash: hash },
]);
assert.equal(approved.needsReview, 0);
assert.equal(approved.approved, 1);

const normalized = normalizeReview(
  {
    pageId: "page-1",
    reviewSummary: "Good drill.",
    confidence: "high",
    changedFields: ["coachCue", "not-real"],
    issues: [],
    suggestions: {
      coachCue: "Control the move.",
      whyImportant: "Timing improves adjustability.",
      whatThisFixes: "Rushing.",
      problem: ["timing", "made-up"],
      goal: ["Improve timing"],
      tags: ["Timing & rhythm"],
      drillType: ["Timing Drill"],
      ageLevel: ["Intermediate"],
      difficulty: "Medium",
    },
  },
  {},
);
assert.deepEqual(normalized.changedFields, ["coachCue"]);
assert.deepEqual(normalized.suggestions.problem, ["timing"]);
assert.equal(normalized.suggestions.coachCue, "Control the move.");

console.log("ai_review_tests=PASS");
