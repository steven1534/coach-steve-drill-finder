const TEXT_FIELDS = [
  "description",
  "purpose",
  "howToDoIt",
  "watchFor",
  "whatToFeel",
  "coachCue",
  "commonMistakes",
  "nextSteps",
  "whatThisFixes",
];

const LABEL_ALIASES = new Map([
  ["dr", "Dr"],
  ["drillname", "drillName"],
  ["featured", "Featured"],
  ["relateddrills", "Related Drills"],
  ["synctosite", "Sync to Site"],
  ["agelevel", "ageLevel"],
  ["description", "description"],
  ["purpose", "purpose"],
  ["howtodoit", "howToDoIt"],
  ["watchfor", "watchFor"],
  ["whattofeel", "whatToFeel"],
  ["coachcue", "coachCue"],
  ["coachstevecue", "coachCue"],
  ["coachingcue", "coachCue"],
  ["commonmistakes", "commonMistakes"],
  ["bestfor", "bestFor"],
  ["nextsteps", "nextSteps"],
  ["whatthisfixes", "whatThisFixes"],
  ["whatitfixes", "whatThisFixes"],
  ["equipment", "equipment"],
  ["category", "category"],
  ["difficulty", "difficulty"],
  ["drilltype", "drillType"],
  ["foundationoradvanced", "foundationOrAdvanced"],
  ["goal", "goal"],
  ["problem", "problem"],
  ["duration", "duration"],
  ["sourceurl", "sourceUrl"],
  ["tags", "tags"],
  ["thumbnailurl", "thumbnailUrl"],
  ["videourl", "videoUrl"],
]);

const LABEL_PATTERN =
  /\*{0,2}\s*(related\s*drills|sync\s*to\s*site|foundation\s*or\s*advanced|thumbnail\s*url|drill\s*name|drill\s*type|source\s*url|video\s*url|age\s*level|description|purpose|how\s*to\s*do\s*it|howToDoIt|watch\s*for|watchFor|what\s*to\s*feel|whatToFeel|coach\s*(?:steve\s*)?cue|coachCue|coachingCue|common\s*mistakes|commonMistakes|best\s*for|bestFor|next\s*steps|nextSteps|what\s*(?:this|it)\s*fixes|whatThisFixes|equipment|featured|category|difficulty|goal|problem|duration|tags|dr)\s*:\s*\*{0,2}/gi;

function canonicalLabel(label) {
  return LABEL_ALIASES.get(String(label).toLowerCase().replace(/\s+/g, "")) || "";
}

export function cleanImportedText(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?properties>/gi, "")
    .replace(/\uFFFD/g, "")
    .replace(/\*\*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n\s*-\s*$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseLabeledSegments(value) {
  const text = cleanImportedText(value);
  const matches = [];
  let match;
  LABEL_PATTERN.lastIndex = 0;
  while ((match = LABEL_PATTERN.exec(text))) {
    matches.push({
      start: match.index,
      end: LABEL_PATTERN.lastIndex,
      key: canonicalLabel(match[1]),
    });
  }

  const segments = {};
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    const segment = cleanImportedText(
      text.slice(current.end, next ? next.start : text.length),
    ).replace(/^[\s\-–—:]+|[\s]+$/g, "");
    if (current.key && segment && !segments[current.key]) {
      segments[current.key] = segment;
    }
  }

  return {
    text,
    hasLabels: matches.length > 0,
    segments,
  };
}

function recoverSegment(row, field) {
  for (const sourceField of TEXT_FIELDS) {
    const parsed = parseLabeledSegments(row[sourceField]);
    if (parsed.segments[field]) return parsed.segments[field];
  }
  return "";
}

export function sanitizeTextField(row, field) {
  const parsed = parseLabeledSegments(row[field]);
  if (!parsed.text) return "";
  if (!parsed.hasLabels) return parsed.text;
  return parsed.segments[field] || recoverSegment(row, field);
}

export function sanitizeNotionRow(row) {
  const sanitized = { ...row };
  for (const field of TEXT_FIELDS) {
    sanitized[field] = sanitizeTextField(row, field);
  }
  return sanitized;
}

export function hasRawLabelSpillover(value) {
  return parseLabeledSegments(value).hasLabels;
}

export function isSyncEnabled(row) {
  return row?.["Sync to Site"] === "__YES__";
}

export function partitionBySyncFlag(rows) {
  const enabled = [];
  const disabled = [];
  for (const row of rows) {
    (isSyncEnabled(row) ? enabled : disabled).push(row);
  }
  return { enabled, disabled };
}

export function dedupeDisplayLevels(level, ages) {
  const normalizedLevel = cleanImportedText(level);
  const normalizedAges = Array.isArray(ages)
    ? ages.map(cleanImportedText).filter(Boolean)
    : [];
  return {
    level: normalizedAges.some(
      (age) => age.toLowerCase() === normalizedLevel.toLowerCase(),
    )
      ? ""
      : normalizedLevel,
    ages: [...new Set(normalizedAges)],
  };
}
