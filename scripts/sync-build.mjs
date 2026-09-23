import {
  createCipheriv,
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  randomBytes,
} from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  dedupeDisplayLevels,
  hasRawLabelSpillover,
  partitionBySyncFlag,
  sanitizeNotionRow,
} from "./sync-field-sanitizer.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = existsSync(path.join(ROOT, "public", "data.js"))
  ? path.join(ROOT, "public")
  : ROOT;

export function decryptAesGcm(key, iv, sealed) {
  const body = sealed.subarray(0, -16);
  const tag = sealed.subarray(-16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export function encryptAesGcm(key, iv, plaintext) {
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
}

export function parseEnvelope(source) {
  const match = source.match(/const ENC_DRILLS = (\{.*\});?\s*$/s);
  if (!match) throw new Error("Encrypted drill envelope was not found.");
  return JSON.parse(match[1]);
}

export function unwrapMaster(envelope, accessCode) {
  const normalized = accessCode.trim().toUpperCase();
  if (!normalized) throw new Error("DRILL_SYNC_ACCESS_CODE is empty.");
  const kek = pbkdf2Sync(
    normalized,
    Buffer.from(envelope.salt, "base64"),
    envelope.iter,
    32,
    "sha256",
  );
  for (const wrap of envelope.wraps) {
    try {
      return decryptAesGcm(
        kek,
        Buffer.from(wrap.iv, "base64"),
        Buffer.from(wrap.wk, "base64"),
      );
    } catch {
      // A valid code opens exactly one existing wrapper.
    }
  }
  throw new Error("The protected sync code did not open the current dataset.");
}

export function wrapMaster(envelope, accessCode, master, label) {
  const normalized = accessCode.trim().toUpperCase();
  if (!normalized) throw new Error("Maintenance sync code is empty.");
  const kek = pbkdf2Sync(
    normalized,
    Buffer.from(envelope.salt, "base64"),
    envelope.iter,
    32,
    "sha256",
  );
  const iv = randomBytes(12);
  return {
    label,
    iv: iv.toString("base64"),
    wk: encryptAesGcm(kek, iv, master).toString("base64"),
  };
}

function list(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (value === null || value === undefined || value === "") return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch {
      // A scalar Notion value becomes a one-item list.
    }
  }
  return [String(value)];
}

function normalizedName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function newId(name, notionUrl) {
  const slug = normalizedName(name).replace(/\s+/g, "-").slice(0, 48) || "drill";
  const suffix = createHash("sha256").update(String(notionUrl)).digest("hex").slice(0, 8);
  return `${slug}-${suffix}`;
}

function deriveFocus(row) {
  const source = [...list(row.tags), ...list(row.goal), ...list(row.problem)]
    .join(" ")
    .toLowerCase();
  const focus = new Set();
  if (/timing|rhythm/.test(source)) focus.add("Timing & Rhythm");
  if (/path|direction|casting|barrel|pull-off/.test(source)) {
    focus.add("Direction & Bat Path");
  }
  if (/contact|coverage|connection/.test(source)) focus.add("Contact Quality");
  if (/separation|power|bat speed|lower half/.test(source)) {
    focus.add("Separation & Power");
  }
  if (/balance|posture|lunge|drift|stance/.test(source)) {
    focus.add("Balance & Posture");
  }
  if (/vision|recognition|approach|zone|decision/.test(source)) {
    focus.add("Vision & Approach");
  }
  if (/field|throw|arm strength|infield|outfield/.test(source)) {
    focus.add("Fielding & Throwing");
  }
  return [...focus];
}

function richText(value) {
  return Array.isArray(value)
    ? value.map((item) => item?.plain_text || "").join("")
    : "";
}

function notionPropertyValue(property) {
  if (!property) return "";
  switch (property.type) {
    case "title":
      return richText(property.title);
    case "rich_text":
      return richText(property.rich_text);
    case "select":
      return property.select?.name || "";
    case "multi_select":
      return (property.multi_select || []).map((item) => item.name);
    case "url":
      return property.url || "";
    case "checkbox":
      return property.checkbox ? "__YES__" : "__NO__";
    case "number":
      return property.number ?? "";
    case "relation":
      return (property.relation || []).map((item) => item.id);
    default:
      return "";
  }
}

export function notionPageToRow(page) {
  const row = {
    url: page.url,
    createdTime: page.created_time,
    notionId: page.id,
  };
  for (const [name, property] of Object.entries(page.properties || {})) {
    row[name] = notionPropertyValue(property);
  }
  return row;
}

export async function fetchNotionRows(
  token,
  dataSourceId = "5c35b9e8-f83e-4547-99d6-47a88c7c00ce",
  fetcher = fetch,
) {
  const rows = [];
  let cursor;
  do {
    const response = await fetcher(
      `https://api.notion.com/v1/data_sources/${dataSourceId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2026-03-11",
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
    const page = await response.json();
    rows.push(...(page.results || []).map(notionPageToRow));
    cursor = page.has_more ? page.next_cursor : null;
    if (rows.length > 1000) {
      throw new Error("Notion safety limit exceeded.");
    }
  } while (cursor);
  return rows;
}

export function mergeNotionRows(oldDrills, rows, expected) {
  const oldByName = new Map();
  for (const drill of oldDrills) {
    const key = normalizedName(drill.name);
    if (!key || oldByName.has(key)) {
      throw new Error("Existing dataset contains a missing or duplicate normalized name.");
    }
    oldByName.set(key, drill);
  }

  const seen = new Set();
  let matched = 0;
  let added = 0;
  const merged = rows.map((row) => {
    const name = String(row.drillName || row.Dr || "").trim();
    if (!name) throw new Error("Notion export contains a drill without a name.");
    const key = normalizedName(name);
    if (seen.has(key)) throw new Error("Notion export contains duplicate drill names.");
    seen.add(key);

    const old = oldByName.get(key);
    if (old) matched += 1;
    else added += 1;

    const displayLevels = dedupeDisplayLevels(
      row.foundationOrAdvanced,
      list(row.ageLevel),
    );
    const mapped = {
      id: old?.id ?? newId(name, row.url),
      notionId: String(row.notionId || old?.notionId || ""),
      name,
      description: String(row.description ?? ""),
      category: String(row.category || "Hitting"),
      drillType: String(row.drillType ?? ""),
      duration: String(row.duration ?? ""),
      difficulty: String(row.difficulty ?? ""),
      level: displayLevels.level,
      ages: displayLevels.ages,
      focus: old?.focus?.length ? old.focus : deriveFocus(row),
      problems: list(row.problem),
      goals: list(row.goal),
      tags: list(row.tags),
      equipment: list(row.equipment),
      purpose: String(row.purpose ?? ""),
      cue: String(row.coachCue ?? ""),
      fixes: String(row.whatThisFixes ?? ""),
      howTo: String(row.howToDoIt ?? ""),
      feel: String(row.whatToFeel ?? ""),
      watchFor: String(row.watchFor ?? ""),
      mistakes: String(row.commonMistakes ?? ""),
      nextStepsText: String(row.nextSteps ?? ""),
      video: String(row.videoUrl ?? ""),
      thumb: String(row.thumbnailUrl ?? ""),
      ...(old?.nextDrill ? { nextDrill: old.nextDrill } : {}),
      ...(old?.nextReason ? { nextReason: old.nextReason } : {}),
    };
    const displayText = {
      description: mapped.description,
      purpose: mapped.purpose,
      cue: mapped.cue,
      fixes: mapped.fixes,
      howTo: mapped.howTo,
      feel: mapped.feel,
      watchFor: mapped.watchFor,
      mistakes: mapped.mistakes,
      nextStepsText: mapped.nextStepsText,
    };
    for (const [field, value] of Object.entries(displayText)) {
      if (hasRawLabelSpillover(value)) {
        throw new Error(`Raw Notion property label leaked into ${name}.${field}.`);
      }
    }
    return old ? { ...old, ...mapped } : mapped;
  });

  const removed = oldDrills.length - matched;
  if (expected) {
    if (
      oldDrills.length !== expected.oldCount ||
      rows.length !== expected.newCount ||
      matched !== expected.matched ||
      added !== expected.added ||
      removed !== expected.removed
    ) {
      throw new Error(
        `Guard failed: old=${oldDrills.length}, notion=${rows.length}, ` +
          `matched=${matched}, added=${added}, removed=${removed}.`,
      );
    }
  } else {
    const overlapFloor = Math.floor(Math.min(oldDrills.length, rows.length) * 0.75);
    if (
      oldDrills.length < 150 ||
      rows.length < 150 ||
      rows.length > 500 ||
      matched < overlapFloor ||
      added > 30 ||
      removed > 30
    ) {
      throw new Error(
        `Automated guard failed: old=${oldDrills.length}, notion=${rows.length}, ` +
          `matched=${matched}, added=${added}, removed=${removed}.`,
      );
    }
  }

  const ids = new Set(merged.map((drill) => drill.id));
  if (ids.size !== merged.length) throw new Error("Merged dataset contains duplicate IDs.");
  merged.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return { drills: merged, matched, added, removed };
}

function decryptTransport(envelope, secret) {
  const key = Buffer.from(secret, "base64");
  if (key.length !== 32) throw new Error("DRILL_SYNC_EXPORT_KEY is invalid.");
  return decryptAesGcm(
    key,
    Buffer.from(envelope.iv, "base64"),
    Buffer.from(envelope.data, "base64"),
  );
}

async function main() {
  const accessCode = process.env.DRILL_SYNC_ACCESS_CODE;
  const maintenanceCode = process.env.DRILL_SYNC_MAINTENANCE_CODE;
  const exportKey = process.env.DRILL_SYNC_EXPORT_KEY;
  const notionToken = process.env.NOTION_API_KEY;
  const productionAccessConfigured = Boolean(process.env.DRILL_ACCESS_CODES);
  const previewAccessConfigured = Boolean(
    process.env.VERCEL_ENV === "preview" &&
    process.env.DRILL_PREVIEW_ACCESS_CODES &&
    notionToken
  );
  const mappedAccessConfigured =
    productionAccessConfigured || previewAccessConfigured;

  if (mappedAccessConfigured) {
    if (!notionToken) {
      throw new Error("NOTION_API_KEY is required for server-side drill access.");
    }

    let rows = await fetchNotionRows(notionToken);
    if (!Array.isArray(rows)) throw new Error("Notion export has no results array.");

    const syncPartition = partitionBySyncFlag(rows);
    rows = syncPartition.enabled.map(sanitizeNotionRow);
    if (rows.length < 150 || rows.length > 500) {
      throw new Error(`Notion drill count is outside the safety range: ${rows.length}.`);
    }

    const seedDrills = rows.map((row) => {
      const name = String(row.drillName || row.Dr || "").trim();
      if (!name) throw new Error("Notion export contains a drill without a name.");
      return {
        id: newId(name, row.url),
        notionId: String(row.notionId || ""),
        name,
        focus: deriveFocus(row),
      };
    });

    const { drills } = mergeNotionRows(seedDrills, rows);
    await writeFile(
      path.join(ROOT, "lib", "drills.generated.js"),
      `export default ${JSON.stringify(drills)};\n`,
      { mode: 0o600 },
    );

    await mkdir(path.join(ROOT, "dist"), { recursive: true });
    for (const file of ["index.html", "app.js", "styles.css"]) {
      await cp(path.join(SOURCE, file), path.join(ROOT, "dist", file));
    }

    const digest = createHash("sha256")
      .update(JSON.stringify(drills))
      .digest("hex");
    const generatedAt = new Date().toISOString();
    await writeFile(
      path.join(ROOT, "dist", "sync-status.json"),
      JSON.stringify({
        generatedAt,
        drillCount: drills.length,
        syncEnabledCount: syncPartition.enabled.length,
        syncDisabledCount: syncPartition.disabled.length,
        contentSha256: digest,
      }),
    );

    const syncDirectory = path.join(ROOT, "sync");
    if (existsSync(path.join(syncDirectory, "sync.html"))) {
      await cp(path.join(syncDirectory, "sync.html"), path.join(ROOT, "dist", "sync.html"));
      await cp(path.join(syncDirectory, "sync.css"), path.join(ROOT, "dist", "sync.css"));
      await cp(path.join(syncDirectory, "sync-client.js"), path.join(ROOT, "dist", "sync-client.js"));
    }

    console.log(JSON.stringify({
      result: "server-access-notion",
      generatedAt,
      drillCount: drills.length,
      syncEnabledCount: syncPartition.enabled.length,
      syncDisabledCount: syncPartition.disabled.length,
      contentSha256: digest,
    }));
    return;
  }

  if (process.env.VERCEL_ENV === "preview") {
    await mkdir(path.join(ROOT, "dist"), { recursive: true });
    for (const file of ["index.html", "app.js", "styles.css", "data.js"]) {
      await cp(path.join(SOURCE, file), path.join(ROOT, "dist", file));
    }
    const syncDirectory = path.join(ROOT, "sync");
    if (existsSync(path.join(syncDirectory, "sync.html"))) {
      await cp(path.join(syncDirectory, "sync.html"), path.join(ROOT, "dist", "sync.html"));
      await cp(path.join(syncDirectory, "sync.css"), path.join(ROOT, "dist", "sync.css"));
      await cp(path.join(syncDirectory, "sync-client.js"), path.join(ROOT, "dist", "sync-client.js"));
    }
    console.log(JSON.stringify({
      result: "preview-static",
      protectedSyncSkipped: true,
    }));
    return;
  }

  if (!accessCode && !maintenanceCode) {
    throw new Error("Required protected sync build variables are missing.");
  }
  if (!notionToken && !exportKey) {
    throw new Error("Notion or protected export configuration is missing.");
  }

  const dataSource = await readFile(path.join(SOURCE, "data.js"), "utf8");
  const envelope = parseEnvelope(dataSource);
  if (envelope.v !== 3 || !Array.isArray(envelope.wraps) || envelope.wraps.length < 1) {
    throw new Error("Unsupported encrypted dataset format.");
  }

  let master;
  for (const candidate of [accessCode, maintenanceCode].filter(Boolean)) {
    try {
      master = unwrapMaster(envelope, candidate);
      break;
    } catch {
      // The initial migration uses the recovered live code; later builds
      // use only the dedicated maintenance code.
    }
  }
  if (!master) throw new Error("No protected sync code opened the current dataset.");
  const oldPlaintext = decryptAesGcm(
    master,
    Buffer.from(envelope.iv, "base64"),
    Buffer.from(envelope.data, "base64"),
  );
  const oldDrills = JSON.parse(oldPlaintext.toString("utf8"));

  let rows;
  let expected = null;
  if (notionToken) {
    rows = await fetchNotionRows(notionToken);
  } else {
    const transport = JSON.parse(
      await readFile(path.join(ROOT, "private", "notion-export.enc.json"), "utf8"),
    );
    expected = JSON.parse(
      await readFile(path.join(ROOT, "private", "sync-expectations.json"), "utf8"),
    );
    const exportPayload = JSON.parse(
      decryptTransport(transport, exportKey).toString("utf8"),
    );
    rows = exportPayload.results;
  }
  if (!Array.isArray(rows)) throw new Error("Notion export has no results array.");
  const syncPartition = partitionBySyncFlag(rows);
  rows = syncPartition.enabled.map(sanitizeNotionRow);
  if (!rows.length) {
    throw new Error("No Notion drills are enabled for Sync to Site.");
  }

  const { drills, matched, added, removed } = mergeNotionRows(
    oldDrills,
    rows,
    expected,
  );
  const iv = randomBytes(12);
  const sealed = encryptAesGcm(master, iv, Buffer.from(JSON.stringify(drills)));
  const wraps = [...envelope.wraps];
  if (
    maintenanceCode &&
    !wraps.some((wrap) => wrap.label === "sync-maintenance")
  ) {
    wraps.push(
      wrapMaster(envelope, maintenanceCode, master, "sync-maintenance"),
    );
  }
  const updatedEnvelope = {
    ...envelope,
    wraps,
    iv: iv.toString("base64"),
    data: sealed.toString("base64"),
  };

  await mkdir(path.join(ROOT, "dist"), { recursive: true });
  for (const file of ["index.html", "app.js", "styles.css"]) {
    await cp(path.join(SOURCE, file), path.join(ROOT, "dist", file));
  }
  await writeFile(
    path.join(ROOT, "dist", "data.js"),
    `const ENC_DRILLS = ${JSON.stringify(updatedEnvelope)};\n`,
    { mode: 0o644 },
  );

  const digest = createHash("sha256")
    .update(JSON.stringify(drills))
    .digest("hex");
  const generatedAt = new Date().toISOString();
  await writeFile(
    path.join(ROOT, "dist", "sync-status.json"),
    JSON.stringify({
      generatedAt,
      drillCount: drills.length,
      matched,
      added,
      removed,
      syncEnabledCount: syncPartition.enabled.length,
      syncDisabledCount: syncPartition.disabled.length,
      contentSha256: digest,
    }),
  );

  const syncDirectory = path.join(ROOT, "sync");
  if (existsSync(path.join(syncDirectory, "sync.html"))) {
    await cp(
      path.join(syncDirectory, "sync.html"),
      path.join(ROOT, "dist", "sync.html"),
    );
    await cp(
      path.join(syncDirectory, "sync.css"),
      path.join(ROOT, "dist", "sync.css"),
    );
    await cp(
      path.join(syncDirectory, "sync-client.js"),
      path.join(ROOT, "dist", "sync-client.js"),
    );
  }

  console.log(
    JSON.stringify({
      result: "ok",
      generatedAt,
      oldCount: oldDrills.length,
      newCount: drills.length,
      matched,
      added,
      removed,
      wrapCount: updatedEnvelope.wraps.length,
      plaintextSha256: digest,
    }),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`SYNC_BUILD_FAILED: ${error.message}`);
    process.exit(1);
  });
}
