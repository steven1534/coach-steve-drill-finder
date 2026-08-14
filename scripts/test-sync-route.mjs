import assert from "node:assert/strict";
import { decodeJwtPayload, verifyCoachToken } from "../api/sync.js";

const encoded = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encoded({ alg: "ES256" })}.${encoded({
  sub: "coach-id",
  aal: "aal2",
})}.generated-signature`;

assert.deepEqual(decodeJwtPayload(token), {
  sub: "coach-id",
  aal: "aal2",
});
assert.equal(decodeJwtPayload("not-a-token"), null);

const env = {
  SUPABASE_URL: "https://generated.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_generated",
  COACH_USER_ID: "coach-id",
};
const accepted = await verifyCoachToken(token, env, async () => ({
  ok: true,
  async json() {
    return { id: "coach-id" };
  },
}));
assert.deepEqual(accepted, { userId: "coach-id" });

const wrongUser = await verifyCoachToken(token, env, async () => ({
  ok: true,
  async json() {
    return { id: "different-user" };
  },
}));
assert.equal(wrongUser, null);

const aal1 = `${encoded({ alg: "ES256" })}.${encoded({
  sub: "coach-id",
  aal: "aal1",
})}.generated-signature`;
assert.equal(
  await verifyCoachToken(aal1, env, async () => ({
    ok: true,
    async json() {
      return { id: "coach-id" };
    },
  })),
  null,
);

console.log("sync_route_tests=PASS");
