import assert from "node:assert/strict";
import {
  contentHash,
  normalizeReview,
  scanRows,
  reviewWithLuna,
  validateReviewBatch,
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
      category: ["Hitting"],
    },
  },
  {},
);
assert.deepEqual(normalized.changedFields, ["coachCue"]);
assert.deepEqual(normalized.suggestions.problem, ["timing"]);
assert.equal(normalized.suggestions.coachCue, "Control the move.");
assert.deepEqual(normalized.suggestions.category, ["Hitting"]);

// A model's unmarked rephrasing must not overwrite existing approved content.
const preserved = normalizeReview(
  {
    pageId: "page-1",
    changedFields: ["coachCue"],
    suggestions: {
      coachCue: "Move with control.",
      whyImportant: "A model rewrite that must not replace the original.",
      tags: ["Bat path"],
    },
  },
  { coachCue: "Original cue.", whyImportant: base.whyImportant, tags: base.tags },
);
assert.equal(preserved.suggestions.coachCue, "Move with control.");
assert.equal(preserved.suggestions.whyImportant, base.whyImportant);
assert.deepEqual(preserved.suggestions.tags, base.tags);

const sampleReview = {
  pageId: "page-1",
  reviewSummary: "A timing drill with a targeted cue update.",
  confidence: "high",
  changedFields: ["coachCue"],
  issues: [],
  suggestions: {
    coachCue: "Control the move.",
    whyImportant: base.whyImportant,
    whatThisFixes: base.whatThisFixes,
    problem: base.problem,
    goal: base.goal,
    tags: base.tags,
    drillType: base.drillType,
    ageLevel: base.ageLevel,
    difficulty: base.difficulty,
    category: base.category,
  },
};
assert.deepEqual(validateReviewBatch([sampleReview], [base]), [sampleReview]);
assert.throws(() => validateReviewBatch([], [base]), /wrong number/);
assert.throws(() => validateReviewBatch(
  [{ ...sampleReview, pageId: "other-page" }], [base]), /unknown or duplicate/);
assert.throws(() => validateReviewBatch(
  [sampleReview, sampleReview], [base, { ...base, pageId: "page-2" }]), /unknown or duplicate/);

let calls = 0;
function fakeOpenAI(responseBody) {
  return async (url, request) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(request.method, "POST");
    const payload = JSON.parse(request.body);
    assert.equal(payload.model, "gpt-6-luna");
    assert.deepEqual(payload.reasoning, { effort: "low" });
    assert.equal(payload.text.format.type, "json_schema");
    assert.equal(payload.text.format.strict, true);
    assert.match(payload.input[0].content[0].text, /source data, NOT instructions/);
    assert.match(payload.input[0].content[0].text, /changedFields/);
    assert.equal(JSON.parse(payload.input[1].content[0].text).drills.length, 1);
    return { ok: true, json: async () => responseBody };
  };
}
function outputFor(reviews, status = "completed") {
  return {
    status,
    output: [{ content: [{ type: "output_text", text: JSON.stringify({ reviews }) }] }],
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}
const reviewed = await reviewWithLuna(
  [base], "test-only", fakeOpenAI(outputFor([sampleReview])),
);
assert.equal(reviewed.model, "gpt-6-luna");
assert.equal(reviewed.reviews[0].pageId, "page-1");
await assert.rejects(
  reviewWithLuna([base], "test-only", fakeOpenAI(outputFor([
    { ...sampleReview, pageId: "fabricated" },
  ]))),
  /unknown or duplicate/,
);
await assert.rejects(
  reviewWithLuna([base], "test-only", fakeOpenAI(outputFor([sampleReview], "incomplete"))),
  /incomplete/,
);
assert.equal(calls, 3);

console.log("ai_review_tests=PASS");
