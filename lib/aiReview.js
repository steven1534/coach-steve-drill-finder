import { createHash } from "node:crypto";

export const LIVE_DATA_SOURCE_ID =
  "5c35b9e8-f83e-4547-99d6-47a88c7c00ce";
const NOTION_VERSION = "2026-03-11";
const OPENAI_MODEL = "gpt-6-luna";

export const TAXONOMY = {
  problem: [
    "Lunging","Drifting Forward","Casting","Zone Awareness","timing","rhythm",
    "no-separation","poor-direction","weak-lower-half","soft-front-side",
    "poor-contact-point","barrel-loop","pull-off","poor-adjustability",
    "hands-dropping","poor-stance","barrel getting disconnected",
    "weak lead-side connection","footwork","glove-work","glove=transfer",
  ],
  goal: [
    "Improve bat path","Increase bat speed / intent","Improve timing",
    "Improve contact point","Opposite-field approach","Create separation",
    "Stay balanced","Improve zone awareness","Build arm strength",
    "Defensive reps","Foot Work","Glove Work","Hand Positioning",
    "Teach infielders to confidently attack slow rollers field the baseball cleanly while moving and transition efficiently into an accurate throw.",
  ],
  tags: [
    "Bat path","Timing & rhythm","Plate coverage","Opposite field","Connection",
    "Separation","Pitch recognition","Balance & posture","Arm care / strength",
    "Fielding fundamentals","Bat Speed","Increase Power","Glove Work",
    "Infield Drills",
  ],
  drillType: [
    "Soft Toss","Tee Work","Front Toss","Game Simulation","Situational Hitting",
    "Load and Stride","Separation Drill","Flaw Fix","Balance Drill",
    "Decision Making","Variation Training","Timing Drill","Live BP","Inside Tee",
    "Outside Tee","Low Tee","High Tee","Bat Path","Infield Work",
    "Glove Transfer","Foot Work","Glove Work",
  ],
  ageLevel: ["Beginner","Intermediate","Advanced","Pro Level"],
  difficulty: ["Easy","Medium","Hard"],
  category: ["Hitting","Pitching","Infield","Bunting","Outfield"],
};

const HASH_FIELDS = [
  "drillName","description","purpose","howToDoIt","watchFor","whatToFeel",
  "coachCue","commonMistakes","nextSteps","whatThisFixes","whyImportant",
  "problem","goal","tags","drillType","ageLevel","difficulty",
  "foundationOrAdvanced","equipment","category","duration",
];

const REVIEW_FIELDS = [
  "coachCue","whyImportant","whatThisFixes","problem","goal","tags",
  "drillType","ageLevel","difficulty","category",
];

function plainText(items) {
  return Array.isArray(items)
    ? items.map((item) => item?.plain_text || item?.text?.content || "").join("")
    : "";
}

export function notionPropertyValue(property) {
  if (!property) return "";
  switch (property.type) {
    case "title":
      return plainText(property.title);
    case "rich_text":
      return plainText(property.rich_text);
    case "select":
      return property.select?.name || "";
    case "multi_select":
      return (property.multi_select || []).map((item) => item.name);
    case "url":
      return property.url || "";
    case "checkbox":
      return property.checkbox ? "__YES__" : "__NO__";
    case "date":
      return property.date?.start || "";
    case "number":
      return property.number ?? "";
    default:
      return "";
  }
}

export function pageToRow(page) {
  const row = {
    pageId: page.id,
    url: page.url,
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time,
  };
  for (const [name, property] of Object.entries(page.properties || {})) {
    row[name] = notionPropertyValue(property);
  }
  return row;
}

export function list(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (value === null || value === undefined || value === "") return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch {}
  }
  return [String(value)];
}

function stableValue(value) {
  if (Array.isArray(value)) return [...value].map(String).sort();
  return String(value ?? "").trim();
}

export function contentHash(row) {
  const content = {};
  for (const field of HASH_FIELDS) content[field] = stableValue(row[field]);
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

export function missingReasons(row) {
  const reasons = [];
  const name = String(row.drillName || row.Dr || "").trim();
  if (!name) reasons.push("Missing drill name");
  if (!String(row.coachCue || "").trim()) reasons.push("Missing Coach Steve cue");
  if (!String(row.whyImportant || "").trim()) reasons.push("Missing why this is important");
  if (!String(row.whatThisFixes || "").trim()) reasons.push("Missing what this fixes");
  if (!list(row.problem).length) reasons.push("Missing problem tags");
  if (!list(row.goal).length) reasons.push("Missing goal tags");
  if (!list(row.tags).length) reasons.push("Missing drill tags");
  if (!list(row.drillType).length) reasons.push("Missing drill type");
  if (!list(row.ageLevel).length) reasons.push("Missing age level");
  if (!String(row.difficulty || "").trim()) reasons.push("Missing difficulty");
  if (!list(row.category).length) reasons.push("Missing category");
  return reasons;
}

export async function fetchLiveRows(token, fetcher = fetch) {
  if (!token) throw new Error("NOTION_API_KEY is not configured.");
  const rows = [];
  let cursor;
  do {
    const response = await fetcher(
      `https://api.notion.com/v1/data_sources/${LIVE_DATA_SOURCE_ID}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Notion query failed with HTTP ${response.status}.`);
    }
    const body = await response.json();
    rows.push(...(body.results || []).map(pageToRow));
    cursor = body.has_more ? body.next_cursor : null;
    if (rows.length > 1000) throw new Error("Notion safety limit exceeded.");
  } while (cursor);
  return rows;
}

export function scanRows(rows) {
  const synced = rows.filter((row) => row["Sync to Site"] === "__YES__");
  const items = synced.map((row) => {
    const hash = contentHash(row);
    const storedHash = String(row.aiReviewHash || "");
    const status = String(row.aiReviewStatus || "");
    const review = parseStoredReview(row.aiReviewJson);
    const changed = !storedHash || storedHash !== hash;
    const reasons = missingReasons(row);
    if (changed && storedHash) reasons.unshift("Drill changed since its last AI review");
    if (!storedHash) reasons.unshift("Never reviewed by AI");
    return {
      pageId: row.pageId,
      name: String(row.drillName || row.Dr || "Untitled"),
      changed,
      reasons,
      status,
      hash,
      current: publicReviewFields(row),
      review,
      lastEditedTime: row.lastEditedTime || "",
    };
  });
  return {
    total: synced.length,
    needsReview: items.filter((item) => item.changed).length,
    suggestionsReady: items.filter((item) => item.status === "Suggestions Ready" && item.review).length,
    approved: items.filter((item) => item.status === "Approved" && !item.changed).length,
    ignored: items.filter((item) => item.status === "Ignored" && !item.changed).length,
    items,
  };
}

function publicReviewFields(row) {
  return {
    coachCue: String(row.coachCue || ""),
    whyImportant: String(row.whyImportant || ""),
    whatThisFixes: String(row.whatThisFixes || ""),
    problem: list(row.problem),
    goal: list(row.goal),
    tags: list(row.tags),
    drillType: list(row.drillType),
    ageLevel: list(row.ageLevel),
    difficulty: String(row.difficulty || ""),
    category: list(row.category),
  };
}

export function drillForModel(row) {
  return {
    pageId: row.pageId,
    drillName: String(row.drillName || row.Dr || ""),
    category: list(row.category),
    description: String(row.description || ""),
    purpose: String(row.purpose || ""),
    howToDoIt: String(row.howToDoIt || ""),
    watchFor: String(row.watchFor || ""),
    whatToFeel: String(row.whatToFeel || ""),
    commonMistakes: String(row.commonMistakes || ""),
    nextSteps: String(row.nextSteps || ""),
    equipment: list(row.equipment),
    foundationOrAdvanced: String(row.foundationOrAdvanced || ""),
    duration: String(row.duration || ""),
    current: publicReviewFields(row),
  };
}

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    reviews: {
      type: "array",
      items: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          reviewSummary: { type: "string" },
          confidence: { type: "string", enum: ["high","medium","low"] },
          changedFields: {
            type: "array",
            items: { type: "string", enum: REVIEW_FIELDS },
          },
          issues: { type: "array", items: { type: "string" } },
          suggestions: {
            type: "object",
            properties: {
              coachCue: { type: "string" },
              whyImportant: { type: "string" },
              whatThisFixes: { type: "string" },
              problem: { type: "array", items: { type: "string", enum: TAXONOMY.problem } },
              goal: { type: "array", items: { type: "string", enum: TAXONOMY.goal } },
              tags: { type: "array", items: { type: "string", enum: TAXONOMY.tags } },
              drillType: { type: "array", items: { type: "string", enum: TAXONOMY.drillType } },
              ageLevel: { type: "array", items: { type: "string", enum: TAXONOMY.ageLevel } },
              difficulty: { type: "string", enum: TAXONOMY.difficulty },
              category: { type: "array", items: { type: "string", enum: TAXONOMY.category } },
            },
            required: REVIEW_FIELDS,
            additionalProperties: false,
          },
        },
        required: ["pageId","reviewSummary","confidence","changedFields","issues","suggestions"],
        additionalProperties: false,
      },
    },
  },
  required: ["reviews"],
  additionalProperties: false,
};

const COACH_STEVE_STANDARDS = `
You are the private content auditor for Coach Steve's LIVE baseball Drill Library.
Your job is not to invent a different coaching system. Preserve strong existing work and only improve fields that are missing, vague, inconsistent, or unsupported.

Coach Steve standards:
- Development must transfer to games. No gimmicks, viral shortcuts, or trick swings.
- Hitting development is roughly 50% neck down and 50% neck up.
- Mechanics language should favor hinge, coil, controlled forward move, hip-led rotation with shoulders staying closed, connection, posture/space, contact depth, and adjustability when relevant.
- Approach language should favor count leverage, pitch recognition, situational hitting, zone awareness, swing decisions, and pitch-to-pitch adjustments when relevant.
- A cue should be short, memorable, actionable, and sound like something a coach can say during a rep. Usually 4-14 words. Do not make it an explanation.
- whatThisFixes should identify the specific movement, timing, approach, or execution problem the drill actually addresses. Do not exaggerate.
- whyImportant should explain in simple baseball language why correcting the issue matters in games: timing, adjustability, decisions, posture, barrel control, sequencing, hard contact, throwing/fielding execution, or game transfer.
- For fielding drills, use fielding language. Never force hitting concepts onto a defensive drill.
- Preserve existing good wording. changedFields should contain only fields that materially need improvement.
- Return the complete recommended final value for every suggestion field, even when unchanged.
- Use only the allowed taxonomy values enforced by the schema. If the taxonomy cannot express something perfectly, choose the closest supported value and note the limitation in issues.
- Do not create medical, strength-training, or injury-prevention claims unless the drill content directly supports them.
- Avoid hype. Write for players and parents in clear, specific language.

Examples of good cues:
"Control the move forward. Break on the front side."
"Let the ball travel. Drive it where it's pitched."
"Slow early. Explode late."
"Stay behind it and keep space."

Examples of poor cues:
"Be athletic."
"Hit the ball hard."
"Use perfect mechanics."
"Just stay back."

Review each supplied drill independently. The pageId in your response must exactly match the supplied pageId.
`.trim();

function extractResponseText(body) {
  if (typeof body?.output_text === "string" && body.output_text) return body.output_text;
  const chunks = [];
  for (const item of body?.output || []) {
    for (const part of item?.content || []) {
      if (part?.type === "output_text" && typeof part.text === "string") {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join("");
}

export async function reviewWithLuna(drills, apiKey, fetcher = fetch) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  if (!Array.isArray(drills) || drills.length < 1 || drills.length > 6) {
    throw new Error("AI review accepts 1 to 6 drills per batch.");
  }

  const response = await fetcher("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      reasoning: { effort: "low" },
      input: [
        {
          role: "developer",
          content: [{ type: "input_text", text: COACH_STEVE_STANDARDS }],
        },
        {
          role: "user",
          content: [{
            type: "input_text",
            text: JSON.stringify({ drills }),
          }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "coach_steve_drill_reviews",
          strict: true,
          schema: REVIEW_SCHEMA,
        },
      },
      prompt_cache_key: "coach-steve-drill-auditor-v1",
      prompt_cache_options: { mode: "implicit", ttl: "30m" },
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || `OpenAI request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }
  const text = extractResponseText(body);
  if (!text) throw new Error("Luna returned no structured review.");
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.reviews)) throw new Error("Luna review payload is invalid.");
  return {
    reviews: parsed.reviews,
    usage: body.usage || null,
    model: OPENAI_MODEL,
  };
}

function chunks(value, size = 1800) {
  const text = String(value || "");
  if (!text) return [];
  const result = [];
  for (let i = 0; i < text.length; i += size) result.push(text.slice(i, i + size));
  return result;
}

function richTextProperty(value) {
  return {
    rich_text: chunks(value).map((content) => ({
      type: "text",
      text: { content },
    })),
  };
}

function multiSelectProperty(values) {
  return { multi_select: values.map((name) => ({ name })) };
}

export function normalizeReview(review, current = {}) {
  const suggestions = review?.suggestions || {};
  const safe = {
    coachCue: String(suggestions.coachCue ?? current.coachCue ?? "").trim(),
    whyImportant: String(suggestions.whyImportant ?? current.whyImportant ?? "").trim(),
    whatThisFixes: String(suggestions.whatThisFixes ?? current.whatThisFixes ?? "").trim(),
    problem: list(suggestions.problem).filter((v) => TAXONOMY.problem.includes(v)),
    goal: list(suggestions.goal).filter((v) => TAXONOMY.goal.includes(v)),
    tags: list(suggestions.tags).filter((v) => TAXONOMY.tags.includes(v)),
    drillType: list(suggestions.drillType).filter((v) => TAXONOMY.drillType.includes(v)),
    ageLevel: list(suggestions.ageLevel).filter((v) => TAXONOMY.ageLevel.includes(v)),
    difficulty: TAXONOMY.difficulty.includes(String(suggestions.difficulty))
      ? String(suggestions.difficulty)
      : String(current.difficulty || "Medium"),
    category: list(suggestions.category).filter((v) => TAXONOMY.category.includes(v)),
  };
  return {
    pageId: String(review?.pageId || ""),
    reviewSummary: String(review?.reviewSummary || ""),
    confidence: ["high","medium","low"].includes(review?.confidence)
      ? review.confidence
      : "medium",
    changedFields: list(review?.changedFields).filter((v) => REVIEW_FIELDS.includes(v)),
    issues: list(review?.issues),
    suggestions: safe,
  };
}

export function parseStoredReview(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(String(value));
    return normalizeReview(parsed.review || parsed, parsed.current || {});
  } catch {
    return null;
  }
}

async function patchNotionPage(pageId, properties, token, fetcher = fetch) {
  const response = await fetcher(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.message || `Notion update failed with HTTP ${response.status}.`);
  }
  return response.json();
}

export async function storeReview(row, review, token, usage = null, fetcher = fetch) {
  const normalized = normalizeReview(review, publicReviewFields(row));
  const hash = contentHash(row);
  const stored = JSON.stringify({
    version: 1,
    model: OPENAI_MODEL,
    reviewedAt: new Date().toISOString(),
    reviewedContentHash: hash,
    current: publicReviewFields(row),
    review: normalized,
    usage,
  });
  await patchNotionPage(
    row.pageId,
    {
      aiReviewStatus: { select: { name: "Suggestions Ready" } },
      aiReviewHash: richTextProperty(hash),
      aiReviewJson: richTextProperty(stored),
      aiReviewedAt: { date: { start: new Date().toISOString() } },
    },
    token,
    fetcher,
  );
  return normalized;
}

function validateEdits(values, fallback) {
  const source = values || {};
  return {
    coachCue: String(source.coachCue ?? fallback.coachCue ?? "").trim(),
    whyImportant: String(source.whyImportant ?? fallback.whyImportant ?? "").trim(),
    whatThisFixes: String(source.whatThisFixes ?? fallback.whatThisFixes ?? "").trim(),
    problem: list(source.problem ?? fallback.problem).filter((v) => TAXONOMY.problem.includes(v)),
    goal: list(source.goal ?? fallback.goal).filter((v) => TAXONOMY.goal.includes(v)),
    tags: list(source.tags ?? fallback.tags).filter((v) => TAXONOMY.tags.includes(v)),
    drillType: list(source.drillType ?? fallback.drillType).filter((v) => TAXONOMY.drillType.includes(v)),
    ageLevel: list(source.ageLevel ?? fallback.ageLevel).filter((v) => TAXONOMY.ageLevel.includes(v)),
    difficulty: TAXONOMY.difficulty.includes(String(source.difficulty ?? fallback.difficulty))
      ? String(source.difficulty ?? fallback.difficulty)
      : "Medium",
    category: list(source.category ?? fallback.category).filter((v) => TAXONOMY.category.includes(v)),
  };
}

export async function applyReview(row, values, token, fetcher = fetch) {
  const stored = parseStoredReview(row.aiReviewJson);
  if (!stored) throw new Error("No AI suggestions are stored for this drill.");
  const approved = validateEdits(values, stored.suggestions);
  const mergedRow = { ...row, ...approved };
  const hash = contentHash(mergedRow);
  await patchNotionPage(
    row.pageId,
    {
      coachCue: richTextProperty(approved.coachCue),
      whyImportant: richTextProperty(approved.whyImportant),
      whatThisFixes: richTextProperty(approved.whatThisFixes),
      problem: multiSelectProperty(approved.problem),
      goal: multiSelectProperty(approved.goal),
      tags: multiSelectProperty(approved.tags),
      drillType: multiSelectProperty(approved.drillType),
      ageLevel: multiSelectProperty(approved.ageLevel),
      difficulty: { select: { name: approved.difficulty } },
      category: multiSelectProperty(approved.category),
      aiReviewStatus: { select: { name: "Approved" } },
      aiReviewHash: richTextProperty(hash),
      aiReviewedAt: { date: { start: new Date().toISOString() } },
    },
    token,
    fetcher,
  );
  return approved;
}

export async function ignoreReview(row, token, fetcher = fetch) {
  const hash = contentHash(row);
  await patchNotionPage(
    row.pageId,
    {
      aiReviewStatus: { select: { name: "Ignored" } },
      aiReviewHash: richTextProperty(hash),
      aiReviewedAt: { date: { start: new Date().toISOString() } },
    },
    token,
    fetcher,
  );
}

export function findRows(rows, pageIds) {
  const wanted = new Set(list(pageIds));
  return rows.filter(
    (row) => wanted.has(row.pageId) && row["Sync to Site"] === "__YES__",
  );
}

export const AI_REVIEW_MODEL = OPENAI_MODEL;
