import { createDecipheriv, pbkdf2Sync } from "node:crypto";

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
  const host = request.headers["x-forwarded-host"] || request.headers.host || process.env.VERCEL_URL;
  const proto = request.headers["x-forwarded-proto"] || "https";
  if (!host) throw new Error("Deployment host unavailable.");
  const response = await fetch(`${proto}://${host}/data.js`, { cache: "no-store" });
  if (!response.ok) throw new Error("Protected drill data unavailable.");
  const source = await response.text();
  const match = source.match(/const ENC_DRILLS = (\{.*\});?\s*$/s);
  if (!match) throw new Error("Protected drill envelope unavailable.");
  return JSON.parse(match[1]);
}

export async function unlock(request, code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return null;
  const envelope = await loadEnvelope(request);
  const key = pbkdf2Sync(normalized, b64(envelope.salt), envelope.iter, 32, "sha256");
  for (const wrap of envelope.wraps || []) {
    try {
      const masterRaw = decryptAesGcm(key, b64(wrap.iv), b64(wrap.wk));
      const drills = JSON.parse(
        decryptAesGcm(masterRaw, b64(envelope.iv), b64(envelope.data)).toString("utf8"),
      );
      return {
        code: normalized,
        accessId: wrap.label || "player",
        role: ["master", "sync-maintenance"].includes(wrap.label) ? "coach" : "player",
        drills,
      };
    } catch {}
  }
  return null;
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
