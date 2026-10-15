# GPT-6 Drill Auditor audit and release checklist — October 14, 2026

## Actual implementation audited

Repository: `steven1534/coach-steve-drill-finder`
Existing AI feature branch: `feature/ai-drill-auditor`
Live website mainline: `master` (AI auditor code not present in that branch at audit time).

The feature already runs `gpt-6-luna` with `reasoning.effort: low` through `POST /v1/responses`, a developer instruction block, strict JSON-schema output, and prompt caching. The OpenAI request is in `lib/aiReview.js` (called from `api/ai-review.js`). This workflow audits existing Notion drill descriptions and taxonomy, then stores proposed metadata changes for coach approval. It is **not** a player-diagnosis assistant or an AI drill finder.

### Model decision

Keep **GPT-6 Luna** as the default for this high-volume, bounded editorial/taxonomy task. It is already in the latest GPT-6 family and is much more economical than GPT-6.1 Sol for repeated review batches. Retain `low` reasoning effort until representative comparisons show a quality improvement from a different setting or model. Do **not** turn every review into a more costly Sol call by default.

For a separate future feature requiring complex interpretation of player assessments, video analysis, and multi-source training plans, evaluate `gpt-6.1-sol` independently against `gpt-6-luna`. That would be a **new feature**, not a migration of the current auditor.

Official migration guidance: https://developers.openai.com/api/docs/guides/latest-model

## Improvements in this review branch

- Clarify that drill JSON is **untrusted source data**, not further developer instructions.
- Ground claims, taxonomy tags, cue edits, and benefits in the actual drill record; do not fabricate outcomes.
- Preserve already good coach-approved copy; modify only evidence-backed fields.
- Require `changedFields` to reflect material edits and restore original values when a field was not marked as changed.
- Validate returned review count and page IDs, reject duplicate/unknown IDs, and reject incomplete responses before writing to Notion.
- Expand offline regression coverage for the request model, schema, prompt policy, preservation behavior, missing reviews, and fabricated IDs.

## Release checklist

1. Review this branch's pull request against `feature/ai-drill-auditor`, not `master`. No production deployment should be implied by a successful preview build.
2. Run `npm test` and `npm run build`. These tests mock OpenAI; they do **not** prove the real API accepts a live request.
3. The Vercel project did **not** have an `OPENAI_API_KEY` environment variable at audit time. Add a restricted project key to the **preview** environment only when ready to do a live test; never commit it.
4. Test a small authorized sample of real Notion drills with the preview UI, including: a strong already-complete hitting drill, a partially incomplete hitting drill, a fielding drill, a poorly tagged drill, a deliberately ambiguous drill, and a record containing instruction-like text. Do not approve/write back AI suggestions during initial inspection.
5. Score each result for **supported claims**, appropriate taxonomy, unchanged strong wording, correct fielding-vs-hitting language, and valid page IDs. Review API latency, token usage, and cost. Require zero invented drills, zero fabricated outcomes, and zero mismatched page IDs before allowing coach approvals.
6. If Luna at low effort consistently fails the quality bar, compare Luna at medium effort with GPT-6.1 Sol at low effort on the same samples. Pick the lowest-cost configuration meeting quality and latency requirements.
7. Only after approval, merge this PR into the auditor feature branch, verify preview, then separately plan integrating the auditor into `master` and configuring production credentials.

## Rollback

No model change is required. This PR is isolated and can be closed without affecting `master` or production. Revert its commits or return to the pre-change `feature/ai-drill-auditor` commit to restore prior prompt/review behavior. Remove the preview `OPENAI_API_KEY` to disable AI review calls without disabling the drill finder.
