const syncForm = document.querySelector("#syncForm");
const syncButton = document.querySelector("#syncButton");
const result = document.querySelector("#result");
const lastSync = document.querySelector("#lastSync");
const liveCount = document.querySelector("#liveCount");

let statusBeforeSync = null;

function show(message, tone = "") {
  result.textContent = message;
  result.className = `result ${tone}`.trim();
}

async function readStatus() {
  const response = await fetch(`/sync-status.json?t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!response.ok) return null;
  const status = await response.json();
  lastSync.textContent = status.generatedAt
    ? new Date(status.generatedAt).toLocaleString()
    : "Not available";
  liveCount.textContent = String(status.drillCount ?? "—");
  return status;
}

async function initialize() {
  statusBeforeSync = await readStatus();
}

syncForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  syncButton.disabled = true;
  show("Starting the Notion sync…");

  const email = syncForm.email.value.trim();
  const password = syncForm.password.value;
  syncForm.password.value = "";

  try {
    statusBeforeSync = (await readStatus()) || statusBeforeSync;

    const response = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.message || "Sync could not start.");
    }

    show("Login accepted. Pulling the latest drills from Notion…");

    const original = statusBeforeSync?.generatedAt;
    for (let attempt = 0; attempt < 36; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      const current = await readStatus();
      if (current?.generatedAt && current.generatedAt !== original) {
        statusBeforeSync = current;
        show(
          `Sync complete. ${current.drillCount} drills are live.`,
          "success",
        );
        return;
      }
    }

    show("The deployment is still building. Check this page again in a minute.");
  } catch (error) {
    show(error.message || "Sync failed. Please try again.", "error");
  } finally {
    syncButton.disabled = false;
  }
});

initialize().catch(() => show("Could not read the current sync status.", "error"));
