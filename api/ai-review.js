import { createHash, timingSafeEqual } from "node:crypto";
import {
  AI_REVIEW_MODEL,
  applyReview,
  drillForModel,
  fetchLiveRows,
  findRows,
  ignoreReview,
  reviewWithLuna,
  scanRows,
  storeReview,
} from "../lib/aiReview.js";

const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

function json(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(body));
}

function digest(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest();
}

function secureEqual(left, right) {
  return timingSafeEqual(digest(left), digest(right));
}

function verifyCredentials(email, password) {
  const expectedEmail = String(process.env.SYNC_COACH_EMAIL || "").trim().toLowerCase();
  const expectedPassword = String(process.env.SYNC_COACH_PASSWORD || "");
  const suppliedEmail = String(email || "").trim().toLowerCase();
  const suppliedPassword = String(password || "");
  if (!expectedEmail || !expectedPassword || !suppliedEmail || !suppliedPassword) return false;
  return secureEqual(suppliedEmail, expectedEmail) && secureEqual(suppliedPassword, expectedPassword);
}

function clientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  return String(Array.isArray(forwarded) ? forwarded[0] : forwarded || request.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();
}

function isLimited(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  attempts.set(ip, recent);
  return recent.length >= MAX_FAILURES;
}

function fail(ip) {
  const recent = attempts.get(ip) || [];
  recent.push(Date.now());
  attempts.set(ip, recent);
}

function sameOriginAllowed(request) {
  const origin = String(request.headers.origin || "");
  const forwardedHost = String(request.headers["x-forwarded-host"] || "");
  const host = forwardedHost || String(request.headers.host || "");
  const proto = String(request.headers["x-forwarded-proto"] || "https");
  const sameOrigin = host ? `${proto}://${host}` : "";
  const configuredOrigin = String(
    process.env.SYNC_ALLOWED_ORIGIN || "https://coachstevedrills.com"
  );
  return Boolean(origin && (origin === sameOrigin || origin === configuredOrigin));
}

function parseBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body); } catch {}
  }
  return {};
}

function publicScan(scan) {
  return {
    total: scan.total,
    needsReview: scan.needsReview,
    suggestionsReady: scan.suggestionsReady,
    approved: scan.approved,
    ignored: scan.ignored,
    items: scan.items.map((item) => ({
      pageId: item.pageId,
      name: item.name,
      changed: item.changed,
      reasons: item.reasons,
      status: item.status,
      current: item.current,
      review: item.review,
      lastEditedTime: item.lastEditedTime,
    })),
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return json(response, 405, { message: "Method not allowed." });
  }
  if (!sameOriginAllowed(request)) {
    return json(response, 403, { message: "Not authorized." });
  }

  const ip = clientIp(request);
  if (isLimited(ip)) {
    return json(response, 429, { message: "Too many failed sign-in attempts. Please wait a few minutes." });
  }

  const body = parseBody(request);
  if (!verifyCredentials(body.email, body.password)) {
    fail(ip);
    return json(response, 401, { message: "That email or password is not correct." });
  }
  attempts.delete(ip);

  const notionToken = process.env.NOTION_API_KEY;
  if (!notionToken) {
    return json(response, 503, { message: "Notion is not configured for AI review." });
  }

  const action = String(body.action || "scan");
  try {
    const rows = await fetchLiveRows(notionToken);

    if (action === "scan") {
      const scan = scanRows(rows);
      return json(response, 200, {
        ok: true,
        model: AI_REVIEW_MODEL,
        aiConfigured: Boolean(process.env.OPENAI_API_KEY),
        ...publicScan(scan),
      });
    }

    if (action === "review") {
      if (!process.env.OPENAI_API_KEY) {
        return json(response, 503, {
          message: "GPT-6 Luna is not configured yet. Add OPENAI_API_KEY in Vercel.",
        });
      }
      const pageIds = Array.isArray(body.pageIds) ? body.pageIds.map(String) : [];
      if (pageIds.length < 1 || pageIds.length > 6) {
        return json(response, 400, { message: "Choose between 1 and 6 drills per AI review batch." });
      }
      const selected = findRows(rows, pageIds);
      if (selected.length !== pageIds.length) {
        return json(response, 400, { message: "One or more selected drills are unavailable or not synced." });
      }

      const ai = await reviewWithLuna(
        selected.map(drillForModel),
        process.env.OPENAI_API_KEY,
      );
      const byId = new Map(ai.reviews.map((review) => [String(review.pageId), review]));
      const saved = [];
      for (const row of selected) {
        const review = byId.get(row.pageId);
        if (!review) throw new Error(`Luna did not return a review for ${row.drillName || row.Dr}.`);
        saved.push(await storeReview(row, review, notionToken, ai.usage));
      }
      return json(response, 200, {
        ok: true,
        model: ai.model,
        reviewed: saved.length,
        reviews: saved,
        usage: ai.usage,
      });
    }

    if (action === "apply") {
      const pageId = String(body.pageId || "");
      const selected = findRows(rows, [pageId]);
      if (selected.length !== 1) {
        return json(response, 404, { message: "That drill was not found in the LIVE Drill Library." });
      }
      const approved = await applyReview(selected[0], body.values || null, notionToken);
      return json(response, 200, { ok: true, pageId, approved });
    }

    if (action === "ignore") {
      const pageId = String(body.pageId || "");
      const selected = findRows(rows, [pageId]);
      if (selected.length !== 1) {
        return json(response, 404, { message: "That drill was not found in the LIVE Drill Library." });
      }
      await ignoreReview(selected[0], notionToken);
      return json(response, 200, { ok: true, pageId });
    }

    return json(response, 400, { message: "Unknown AI review action." });
  } catch (error) {
    return json(response, 500, {
      message: error?.message || "AI drill review failed.",
    });
  }
}
