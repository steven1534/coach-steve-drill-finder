import { clearSessionCookie, json, previewDiagnostics, setSessionCookie, unlock } from "../lib/drillAccess.js";

const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function ip(request) {
  return String(request.headers["x-forwarded-for"] || request.socket?.remoteAddress || "")
    .split(",")[0].trim();
}
function limited(key) {
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((t) => now - t < WINDOW_MS);
  attempts.set(key, recent);
  return recent.length >= MAX_ATTEMPTS;
}
function fail(key) {
  attempts.set(key, [...(attempts.get(key) || []), Date.now()]);
}

export default async function handler(request, response) {
  if (request.method === "GET" && process.env.VERCEL_ENV === "preview") {
    return json(response, 200, await previewDiagnostics(request));
  }
  if (request.method === "DELETE") {
    clearSessionCookie(response);
    return json(response, 200, { ok: true });
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST, DELETE");
    return json(response, 405, { message: "Method not allowed." });
  }

  const key = ip(request);
  if (limited(key)) return json(response, 429, { message: "Too many attempts. Try again later." });

  let body = request.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  try {
    const result = await unlock(request, body?.code);
    if (!result) {
      fail(key);
      return json(response, 401, { message: "That access code did not work." });
    }
    attempts.delete(key);
    setSessionCookie(response, result.code);
    return json(response, 200, { ok: true, accessId: result.accessId, role: result.role });
  } catch {
    return json(response, 503, { message: "Access service is temporarily unavailable." });
  }
}
