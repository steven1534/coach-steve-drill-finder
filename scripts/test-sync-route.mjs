import assert from "node:assert/strict";
import { verifyCoachCredentials } from "../api/sync.js";

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

console.log("sync_route_tests=PASS");
