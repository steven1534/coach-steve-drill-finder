import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  decryptAesGcm,
  parseEnvelope,
  unwrapMaster,
  wrapMaster,
} from "./sync-build.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "public");

async function main() {
  const maintenanceCode = process.env.DRILL_SYNC_MAINTENANCE_CODE;
  const newTempCode = process.env.DRILL_NEW_TEMP_CODE;
  if (!maintenanceCode || !newTempCode) {
    throw new Error("Required protected rotation variables are missing.");
  }

  const source = await readFile(path.join(SOURCE, "data.js"), "utf8");
  const envelope = parseEnvelope(source);
  const master = unwrapMaster(envelope, maintenanceCode);
  const drills = JSON.parse(
    decryptAesGcm(
      master,
      Buffer.from(envelope.iv, "base64"),
      Buffer.from(envelope.data, "base64"),
    ).toString("utf8"),
  );
  if (!Array.isArray(drills) || drills.length !== 218) {
    throw new Error("Current encrypted dataset did not validate as 218 drills.");
  }

  const tempIndexes = envelope.wraps
    .map((wrap, index) => (wrap.label === "temp" ? index : -1))
    .filter((index) => index >= 0);
  if (tempIndexes.length !== 1) {
    throw new Error("Expected exactly one temp wrapper.");
  }

  const wraps = [...envelope.wraps];
  wraps[tempIndexes[0]] = wrapMaster(envelope, newTempCode, master, "temp");
  const updated = { ...envelope, wraps };

  await mkdir(path.join(ROOT, "dist"), { recursive: true });
  for (const file of ["index.html", "app.js", "styles.css"]) {
    await cp(path.join(SOURCE, file), path.join(ROOT, "dist", file));
  }
  await writeFile(
    path.join(ROOT, "dist", "data.js"),
    `const ENC_DRILLS = ${JSON.stringify(updated)};\n`,
  );

  console.log(
    JSON.stringify({
      result: "ok",
      drillCount: drills.length,
      wrapCount: wraps.length,
      tempRotated: true,
      otherWrappersPreserved: wraps.length - 1,
    }),
  );
}

main().catch((error) => {
  console.error(`TEMP_ROTATION_FAILED: ${error.message}`);
  process.exit(1);
});
