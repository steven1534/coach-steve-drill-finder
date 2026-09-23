import { createHash, timingSafeEqual } from "node:crypto";

const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function json(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(body));
}

function clientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  return String(Array.isArray(forwarded) ? forwarded[0] : forwarded || request.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();
}

function limited(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  attempts.set(ip, recent);
  return recent.length >= MAX_ATTEMPTS;
}

function recordFailure(ip) {
  const entries = attempts.get(ip) || [];
  entries.push(Date.now());
  attempts.set(ip, entries);
}

function digest(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest();
}

function secureEqual(left, right) {
  return timingSafeEqual(digest(left), digest(right));
}

export function verifyCoachCredentials(email, password, env = process.env) {
  const expectedEmail = String(env.SYNC_COACH_EMAIL || "").trim().toLowerCase();
  const expectedPassword = String(env.SYNC_COACH_PASSWORD || "");
  const suppliedEmail = String(email || "").trim().toLowerCase();
  const suppliedPassword = String(password || "");

  if (!expectedEmail || !expectedPassword || !suppliedEmail || !suppliedPassword) {
    return false;
  }

  return (
    secureEqual(suppliedEmail, expectedEmail) &&
    secureEqual(suppliedPassword, expectedPassword)
  );
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return json(response, 405, { message: "Method not allowed." });
  }

  const origin = String(request.headers.origin || "");
  const forwardedHost = String(request.headers["x-forwarded-host"] || "");
  const host = forwardedHost || String(request.headers.host || "");
  const proto = String(request.headers["x-forwarded-proto"] || "https");
  const sameOrigin = host ? `${proto}://${host}` : "";
  const configuredOrigin = String(
    process.env.SYNC_ALLOWED_ORIGIN || "https://coachstevedrills.com"
  );

  if (!origin || (origin !== sameOrigin && origin !== configuredOrigin)) {
    return json(response, 403, { message: "Not authorized." });
  }

  const ip = clientIp(request);
  if (limited(ip)) {
    return json(response, 429, {
      message: "Too many attempts. Please wait a few minutes.",
    });
  }

  let body = request.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  if (!process.env.SYNC_COACH_EMAIL || !process.env.SYNC_COACH_PASSWORD) {
    return json(response, 503, {
      message: "Coach sync login is not configured yet.",
    });
  }

  if (!verifyCoachCredentials(body?.email, body?.password)) {
    recordFailure(ip);
    return json(response, 401, {
      message: "That email or password is not correct.",
    });
  }

  const hook = process.env.DRILL_SYNC_DEPLOY_HOOK_URL;
  if (!hook || !hook.startsWith("https://api.vercel.com/")) {
    return json(response, 503, {
      message: "The sync service is not configured yet.",
    });
  }

  try {
    const triggered = await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!triggered.ok) {
      return json(response, 502, {
        message: "Vercel could not start the sync. Please try again.",
      });
    }
  } catch {
    return json(response, 502, {
      message: "Vercel could not start the sync. Please try again.",
    });
  }

  attempts.delete(ip);
  return json(response, 202, {
    ok: true,
    message: "Sync started.",
  });
}
