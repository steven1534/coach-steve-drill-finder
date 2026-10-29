import assert from "node:assert/strict";
import handler, { verifyCoachCredentials } from "../api/sync.js";
import { mock } from "node:test";

const env = {
  SYNC_COACH_EMAIL: "coach@example.com",
  SYNC_COACH_PASSWORD: "Generated-Strong-Password-123!",
};

assert.equal(
  verifyCoachCredentials("coach@example.com", "Generated-Strong-Password-123!", env),
  true,
);
assert.equal(
  verifyCoachCredentials("COACH@example.com", "Generated-Strong-Password-123!", env),
  true,
);
assert.equal(
  verifyCoachCredentials("coach@example.com", "wrong-password", env),
  false,
);
assert.equal(
  verifyCoachCredentials("other@example.com", "Generated-Strong-Password-123!", env),
  false,
);
assert.equal(verifyCoachCredentials("", "", env), false);
assert.equal(verifyCoachCredentials("coach@example.com", "Generated-Strong-Password-123!", {}), false);

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
Object.assign(process.env, env, {
  DRILL_SYNC_DEPLOY_HOOK_URL: "https://api.vercel.com/v1/integrations/deploy/test/test",
});

async function request(password = env.SYNC_COACH_PASSWORD) {
  const response = {
    setHeader() {},
    end(body) { this.body = JSON.parse(body); },
  };
  await handler({
    method: "POST",
    headers: { origin: "https://coachstevedrills.com", host: "coachstevedrills.com" },
    body: { email: env.SYNC_COACH_EMAIL, password },
  }, response);
  return response;
}

try {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: true }; };
  assert.equal((await request("incorrect")).statusCode, 401);
  assert.equal(calls, 0, "Invalid credentials must never trigger deployment");
  assert.equal((await request()).statusCode, 202);

  globalThis.fetch = async () => ({ ok: false });
  assert.equal((await request()).statusCode, 502);

  mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  globalThis.fetch = (_url, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      setTimeout(() => resolve({ ok: true }), 15_000);
    });
  };
  const slow = request();
  mock.timers.tick(15_000);
  assert.equal((await slow).statusCode, 202, "A response beyond the old 10-second limit must succeed");
  mock.timers.tick(45_000);
  assert.equal(signal.aborted, false, "Successful requests must clear their timeout");

  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  const stalled = request();
  mock.timers.tick(45_000);
  const timeoutResponse = await stalled;
  assert.equal(timeoutResponse.statusCode, 502);
  assert.match(timeoutResponse.body.message, /Check the last sync time/);
} finally {
  mock.timers.reset();
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
}

console.log("sync_route_tests=PASS");

