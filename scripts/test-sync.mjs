import assert from "node:assert/strict";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import {
  decryptAesGcm,
  encryptAesGcm,
  mergeNotionRows,
  unwrapMaster,
  wrapMaster,
} from "./sync-build.mjs";

const code = "GENERATED-TEST-CODE";
const salt = randomBytes(16);
const master = randomBytes(32);
const kek = pbkdf2Sync(code, salt, 1000, 32, "sha256");
const wrapIv = randomBytes(12);
const wrapped = encryptAesGcm(kek, wrapIv, master);
const envelope = {
  v: 3,
  iter: 1000,
  salt: salt.toString("base64"),
  wraps: [
    {
      label: "fixture",
      iv: wrapIv.toString("base64"),
      wk: wrapped.toString("base64"),
    },
  ],
};

assert.deepEqual(unwrapMaster(envelope, code), master);
assert.throws(() => unwrapMaster(envelope, "WRONG-GENERATED-CODE"));
const maintenance = "GENERATED-MAINTENANCE-CODE";
const maintenanceWrap = wrapMaster(envelope, maintenance, master, "sync-maintenance");
assert.deepEqual(
  unwrapMaster({ ...envelope, wraps: [...envelope.wraps, maintenanceWrap] }, maintenance),
  master,
);

const payload = Buffer.from(JSON.stringify({ generated: true }));
const iv = randomBytes(12);
assert.deepEqual(decryptAesGcm(master, iv, encryptAesGcm(master, iv, payload)), payload);

const old = Array.from({ length: 217 }, (_, index) => ({
  id: `existing-${index}`,
  name: `Generated Drill ${index}`,
  focus: ["Timing & Rhythm"],
  ages: ["Beginner"],
  problems: [],
  goals: [],
  tags: [],
  equipment: [],
}));
const rows = [
  ...old.map((drill) => ({
    url: `https://notion.test/${drill.id}`,
    drillName: drill.name,
    ageLevel: "[\"Beginner\"]",
  })),
  {
    url: "https://notion.test/new",
    drillName: "Generated New Drill",
    ageLevel: "[\"Intermediate\"]",
    tags: "[\"Bat path\"]",
  },
];
const merged = mergeNotionRows(old, rows, {
  oldCount: 217,
  newCount: 218,
  matched: 217,
  added: 1,
  removed: 0,
});
assert.equal(merged.drills.length, 218);
assert.equal(merged.matched, 217);
assert.equal(merged.added, 1);
assert.equal(merged.removed, 0);
assert.equal(merged.drills.find((d) => d.name === "Generated Drill 12").id, "existing-12");

console.log("sync_tests=PASS");
