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

function bearer(request) {
  const header = request.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
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

export function decodeJwtPayload(token) {
  try {
    const segment = token.split(".")[1];
    const padded =
      segment.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (segment.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export async function verifyCoachToken(token, env = process.env, fetcher = fetch) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  const coachId = env.COACH_USER_ID;
  if (!url || !key || !coachId || key.startsWith("sb_secret_")) return null;

  const result = await fetcher(`${url}/auth/v1/user`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!result.ok) return null;
  const user = await result.json();
  const claims = decodeJwtPayload(token);
  if (
    !claims ||
    user.id !== coachId ||
    claims.sub !== coachId ||
    claims.aal !== "aal2"
  ) {
    return null;
  }
  return { userId: user.id };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return json(response, 405, { message: "Method not allowed." });
  }

  const allowedOrigin =
    process.env.SYNC_ALLOWED_ORIGIN || "https://coachstevedrills.com";
  if (request.headers.origin !== allowedOrigin) {
    return json(response, 403, { message: "Not authorized." });
  }

  const ip = clientIp(request);
  if (limited(ip)) {
    return json(response, 429, {
      message: "Too many attempts. Please wait a few minutes.",
    });
  }

  const token = bearer(request);
  if (!token) {
    recordFailure(ip);
    return json(response, 401, { message: "Coach authentication is required." });
  }

  let coach;
  try {
    coach = await verifyCoachToken(token);
  } catch {
    coach = null;
  }
  if (!coach) {
    recordFailure(ip);
    return json(response, 403, {
      message: "Coach MFA verification is required.",
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
