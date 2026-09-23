import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const COOKIE = "__Host-csdf-session";

function b64(value) {
  return Buffer.from(value, "base64");
}

function decryptAesGcm(key, iv, sealed) {
  const body = sealed.subarray(0, -16);
  const tag = sealed.subarray(-16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

async function loadEnvelope(request) {
  let source = "";
  try {
    source = readFileSync(path.join(process.cwd(), "data.js"), "utf8");
  } catch {
    const host = request.headers["x-forwarded-host"] || request.headers.host || process.env.VERCEL_URL;
    const proto = request.headers["x-forwarded-proto"] || "https";
    if (!host) throw new Error("Deployment host unavailable.");
    const response = await fetch(`${proto}://${host}/data.js`, { cache: "no-store" });
    if (!response.ok) throw new Error("Protected drill data unavailable.");
    source = await response.text();
  }
  const match = source.match(/const ENC_DRILLS = (\{.*\});?\s*$/s);
  if (!match) throw new Error("Protected drill envelope unavailable.");
  return JSON.parse(match[1]);
}

function decryptWithCode(envelope, normalized) {
  const key = pbkdf2Sync(normalized, b64(envelope.salt), envelope.iter, 32, "sha256");
  for (const wrap of envelope.wraps || []) {
    try {
      const masterRaw = decryptAesGcm(key, b64(wrap.iv), b64(wrap.wk));
      const drills = JSON.parse(
        decryptAesGcm(masterRaw, b64(envelope.iv), b64(envelope.data)).toString("utf8"),
      );
      return { wrap, drills };
    } catch {}
  }
  return null;
}

function previewAccess(normalized) {
  if (process.env.VERCEL_ENV !== "preview") return null;
  const raw = String(process.env.DRILL_PREVIEW_ACCESS_CODES || "").trim();
  if (!raw) return null;

  // Preferred preview format:
  // coach=CODE;player01=CODE;player02=CODE
  if (raw.includes("=")) {
    for (const entry of raw.split(";")) {
      const [accessId, value] = entry.split("=");
      if (
        accessId &&
        String(value || "").trim().toUpperCase() === normalized
      ) return accessId.trim();
    }
  }

  // Backward compatibility with the earlier JSON format.
  try {
    const codes = JSON.parse(raw);
    for (const [accessId, value] of Object.entries(codes || {})) {
      if (String(value || "").trim().toUpperCase() === normalized) return accessId;
    }
  } catch {}

  return null;
}

export async function unlock(request, code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return null;
  const envelope = await loadEnvelope(request);

  const direct = decryptWithCode(envelope, normalized);
  if (direct) {
    return {
      code: normalized,
      accessId: direct.wrap.label || "player",
      role: ["master", "sync-maintenance"].includes(direct.wrap.label) ? "coach" : "player",
      drills: direct.drills,
    };
  }

  const accessId = previewAccess(normalized);
  const maintenanceCode = String(process.env.DRILL_SYNC_MAINTENANCE_CODE || "").trim().toUpperCase();
  if (!accessId || !maintenanceCode) return null;
  const maintenance = decryptWithCode(envelope, maintenanceCode);
  if (!maintenance) return null;

  return {
    code: normalized,
    accessId,
    role: accessId === "coach" ? "coach" : "player",
    drills: maintenance.drills,
  };
}

export function readSessionCode(request) {
  const raw = String(request.headers.cookie || "");
  const match = raw.match(new RegExp("(?:^|; )" + COOKIE.replace(/[-]/g, "\\$&") + "=([^;]*)"));
  if (!match) return "";
  try { return decodeURIComponent(match[1]); } catch { return ""; }
}

export function setSessionCookie(response, code) {
  response.setHeader("Set-Cookie",
    `${COOKIE}=${encodeURIComponent(code)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`
  );
}

export function clearSessionCookie(response) {
  response.setHeader("Set-Cookie",
    `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  );
}

export function json(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(body));
}

export async function previewDiagnostics(request) {
  if (process.env.VERCEL_ENV !== "preview") return { preview: false };
  const raw = String(process.env.DRILL_PREVIEW_ACCESS_CODES || "").trim();
  const maintenanceCode = String(process.env.DRILL_SYNC_MAINTENANCE_CODE || "").trim().toUpperCase();
  let entryCount = 0;
  if (raw.includes("=")) entryCount = raw.split(";").filter(Boolean).length;
  else {
    try { entryCount = Object.keys(JSON.parse(raw) || {}).length; } catch {}
  }

  let envelope;
  try {
    envelope = await loadEnvelope(request);
  } catch (error) {
    return {
      preview: true,
      hasPreviewCodes: Boolean(raw),
      previewEntryCount: entryCount,
      hasMaintenanceCode: Boolean(maintenanceCode),
      envelopeLoaded: false,
      envelopeError: error?.message || "unknown",
    };
  }

  return {
    preview: true,
    hasPreviewCodes: Boolean(raw),
    previewEntryCount: entryCount,
    hasMaintenanceCode: Boolean(maintenanceCode),
    envelopeLoaded: true,
    wrapperLabels: (envelope.wraps || []).map((wrap) => wrap.label || "unlabeled"),
    maintenanceDecrypts: Boolean(maintenanceCode && decryptWithCode(envelope, maintenanceCode)),
  };
}
