const authStage = document.querySelector("#authStage");
const controlStage = document.querySelector("#controlStage");
const loginForm = document.querySelector("#loginForm");
const reviewButton = document.querySelector("#reviewButton");
const refreshButton = document.querySelector("#refreshButton");
const publishButton = document.querySelector("#publishButton");
const logoutButton = document.querySelector("#logoutButton");
const approveAllButton = document.querySelector("#approveAllButton");
const result = document.querySelector("#result");
const lastSync = document.querySelector("#lastSync");
const liveCount = document.querySelector("#liveCount");
const needsReviewCount = document.querySelector("#needsReviewCount");
const suggestionsCount = document.querySelector("#suggestionsCount");
const changedSection = document.querySelector("#changedSection");
const changedList = document.querySelector("#changedList");
const suggestionsSection = document.querySelector("#suggestionsSection");
const reviewQueue = document.querySelector("#reviewQueue");
const progressWrap = document.querySelector("#progressWrap");
const progressBar = document.querySelector("#progressBar");
const progressText = document.querySelector("#progressText");

let coachEmail = "";
let coachPassword = "";
let scanState = null;
let statusBeforeSync = null;

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function show(message, tone = "") {
  result.textContent = message;
  result.className = `result ${tone}`.trim();
}

function setBusy(button, busy) {
  if (button) button.disabled = busy;
}

async function api(action, extra = {}) {
  const response = await fetch("/api/ai-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      email: coachEmail,
      password: coachPassword,
      action,
      ...extra,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "Coach action failed.");
  return body;
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
  return status;
}

function splitBatches(items, size) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function pills(values) {
  if (!Array.isArray(values) || !values.length) return '<span class="muted">None</span>';
  return values.map((value) => `<span class="pill">${esc(value)}</span>`).join("");
}

function renderChanged(items) {
  const changed = items.filter((item) => item.changed);
  changedSection.hidden = changed.length === 0;
  changedList.innerHTML = changed.slice(0, 60).map((item) => `
    <div class="compact-row">
      <div>
        <strong>${esc(item.name)}</strong>
        <span>${esc(item.reasons.join(" · ") || "Changed since last review")}</span>
      </div>
    </div>
  `).join("");
  if (changed.length > 60) {
    changedList.insertAdjacentHTML(
      "beforeend",
      `<p class="muted">+${changed.length - 60} more drills waiting for review.</p>`,
    );
  }
}

function renderSuggestionCard(item) {
  const review = item.review;
  const suggestion = review?.suggestions || {};
  const changed = review?.changedFields || [];
  const issues = review?.issues || [];
  return `
    <article class="review-card" data-page-id="${esc(item.pageId)}">
      <div class="review-card-head">
        <div>
          <p class="eyebrow">${esc(review?.confidence || "medium")} confidence</p>
          <h3>${esc(item.name)}</h3>
          <p class="review-summary">${esc(review?.reviewSummary || "")}</p>
        </div>
        <span class="change-count">${changed.length} suggested change${changed.length === 1 ? "" : "s"}</span>
      </div>

      ${issues.length ? `<div class="issues"><strong>AI flags:</strong> ${esc(issues.join(" · "))}</div>` : ""}

      <div class="field-grid">
        <label>
          <span>Coach Steve Cue</span>
          <textarea data-field="coachCue" rows="2">${esc(suggestion.coachCue || "")}</textarea>
        </label>
        <label>
          <span>Why fixing this matters</span>
          <textarea data-field="whyImportant" rows="4">${esc(suggestion.whyImportant || "")}</textarea>
        </label>
        <label>
          <span>What it fixes</span>
          <textarea data-field="whatThisFixes" rows="4">${esc(suggestion.whatThisFixes || "")}</textarea>
        </label>
      </div>

      <div class="metadata-grid">
        <div><strong>Problems</strong><div class="pill-row">${pills(suggestion.problem)}</div></div>
        <div><strong>Goals</strong><div class="pill-row">${pills(suggestion.goal)}</div></div>
        <div><strong>Tags</strong><div class="pill-row">${pills(suggestion.tags)}</div></div>
        <div><strong>Type</strong><div class="pill-row">${pills(suggestion.drillType)}</div></div>
        <div><strong>Age</strong><div class="pill-row">${pills(suggestion.ageLevel)}</div></div>
        <div><strong>Difficulty</strong><div class="pill-row">${pills([suggestion.difficulty])}</div></div>
      </div>

      <div class="review-actions">
        <button type="button" data-action="approve">Approve & Write to Notion</button>
        <button type="button" data-action="ignore" class="secondary">Ignore Until This Drill Changes</button>
      </div>
    </article>
  `;
}

function renderSuggestions(items) {
  const ready = items.filter(
    (item) => item.status === "Suggestions Ready" && item.review,
  );
  suggestionsSection.hidden = ready.length === 0;
  reviewQueue.innerHTML = ready.map(renderSuggestionCard).join("");
}

async function refreshScan({ quiet = false } = {}) {
  if (!quiet) show("Reading the LIVE Drill Library…");
  const data = await api("scan");
  scanState = data;
  liveCount.textContent = String(data.total ?? "—");
  needsReviewCount.textContent = String(data.needsReview ?? "—");
  suggestionsCount.textContent = String(data.suggestionsReady ?? "—");
  reviewButton.disabled = !data.aiConfigured || data.needsReview < 1;
  reviewButton.textContent = data.needsReview > 0
    ? `Review ${data.needsReview} New & Changed Drill${data.needsReview === 1 ? "" : "s"}`
    : "No New Changes to Review";
  if (!data.aiConfigured) {
    show("GPT-6 Luna is not configured yet. Add OPENAI_API_KEY in Vercel.", "error");
  } else if (!quiet) {
    show(
      data.needsReview
        ? `${data.needsReview} drill${data.needsReview === 1 ? "" : "s"} waiting for AI review.`
        : "LIVE Drill Library is fully reviewed.",
      data.needsReview ? "" : "success",
    );
  }
  renderChanged(data.items || []);
  renderSuggestions(data.items || []);
  return data;
}

function setProgress(current, total, label) {
  progressWrap.hidden = false;
  const percent = total ? Math.round((current / total) * 100) : 0;
  progressBar.style.width = `${percent}%`;
  progressText.textContent = `${label} ${current} of ${total}`;
}

function hideProgress() {
  progressWrap.hidden = true;
  progressBar.style.width = "0%";
  progressText.textContent = "";
}

async function runAiReview() {
  if (!scanState) await refreshScan({ quiet: true });
  const pending = (scanState.items || []).filter((item) => item.changed);
  if (!pending.length) return show("There are no new or changed drills to review.", "success");

  setBusy(reviewButton, true);
  setBusy(refreshButton, true);
  setBusy(publishButton, true);
  const batches = splitBatches(pending, 6);
  let reviewed = 0;
  try {
    show("GPT-6 Luna is reviewing the changed drills…");
    for (const batch of batches) {
      setProgress(reviewed, pending.length, "Reviewed");
      await api("review", { pageIds: batch.map((item) => item.pageId) });
      reviewed += batch.length;
      setProgress(reviewed, pending.length, "Reviewed");
    }
    show(`AI review complete. ${reviewed} drill${reviewed === 1 ? "" : "s"} are ready for approval.`, "success");
    await refreshScan({ quiet: true });
  } catch (error) {
    show(error.message || "AI review failed.", "error");
    await refreshScan({ quiet: true }).catch(() => {});
  } finally {
    hideProgress();
    setBusy(refreshButton, false);
    setBusy(publishButton, false);
    reviewButton.disabled = !scanState?.aiConfigured || !scanState?.needsReview;
  }
}

function cardValues(card) {
  return {
    coachCue: card.querySelector('[data-field="coachCue"]').value.trim(),
    whyImportant: card.querySelector('[data-field="whyImportant"]').value.trim(),
    whatThisFixes: card.querySelector('[data-field="whatThisFixes"]').value.trim(),
  };
}

async function approveCard(card) {
  const pageId = card.dataset.pageId;
  const button = card.querySelector('[data-action="approve"]');
  setBusy(button, true);
  try {
    await api("apply", { pageId, values: cardValues(card) });
    card.remove();
    show("Approved changes were written to the LIVE Drill Library.", "success");
    await refreshScan({ quiet: true });
  } catch (error) {
    show(error.message || "Could not approve this drill.", "error");
    setBusy(button, false);
  }
}

async function ignoreCard(card) {
  const pageId = card.dataset.pageId;
  const button = card.querySelector('[data-action="ignore"]');
  setBusy(button, true);
  try {
    await api("ignore", { pageId });
    card.remove();
    show("Ignored. It will stay quiet until that drill changes again.", "success");
    await refreshScan({ quiet: true });
  } catch (error) {
    show(error.message || "Could not ignore this drill.", "error");
    setBusy(button, false);
  }
}

async function approveAll() {
  const cards = [...reviewQueue.querySelectorAll(".review-card")];
  if (!cards.length) return;
  approveAllButton.disabled = true;
  setBusy(reviewButton, true);
  setBusy(publishButton, true);
  try {
    let done = 0;
    for (const card of cards) {
      setProgress(done, cards.length, "Approved");
      await api("apply", {
        pageId: card.dataset.pageId,
        values: cardValues(card),
      });
      done += 1;
      card.remove();
      setProgress(done, cards.length, "Approved");
    }
    show(`${cards.length} AI suggestion${cards.length === 1 ? "" : "s"} approved and written to Notion.`, "success");
    await refreshScan({ quiet: true });
  } catch (error) {
    show(error.message || "Bulk approval stopped before completion.", "error");
    await refreshScan({ quiet: true }).catch(() => {});
  } finally {
    hideProgress();
    approveAllButton.disabled = false;
    setBusy(publishButton, false);
  }
}

async function publish() {
  publishButton.disabled = true;
  reviewButton.disabled = true;
  show("Starting the production publish from the LIVE Drill Library…");
  try {
    statusBeforeSync = (await readStatus()) || statusBeforeSync;
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: coachEmail, password: coachPassword }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || "Publish could not start.");

    show("Publish started. Waiting for the new Drill Finder deployment…");
    const original = statusBeforeSync?.generatedAt;
    for (let attempt = 0; attempt < 36; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      const current = await readStatus();
      if (current?.generatedAt && current.generatedAt !== original) {
        statusBeforeSync = current;
        show(`Publish complete. ${current.drillCount} drills are live.`, "success");
        return;
      }
    }
    show("The deployment is still building. Refresh this page in a minute.");
  } catch (error) {
    show(error.message || "Publish failed.", "error");
  } finally {
    publishButton.disabled = false;
    reviewButton.disabled = !scanState?.aiConfigured || !scanState?.needsReview;
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = loginForm.querySelector("button");
  submit.disabled = true;
  coachEmail = loginForm.email.value.trim();
  coachPassword = loginForm.password.value;
  show("Opening coach controls…");
  try {
    await refreshScan({ quiet: true });
    loginForm.password.value = "";
    authStage.hidden = true;
    controlStage.hidden = false;
    statusBeforeSync = await readStatus();
    if (scanState?.aiConfigured) {
      show(
        scanState.needsReview
          ? `${scanState.needsReview} drill${scanState.needsReview === 1 ? "" : "s"} waiting for AI review.`
          : "LIVE Drill Library is fully reviewed.",
        scanState.needsReview ? "" : "success",
      );
    }
  } catch (error) {
    coachPassword = "";
    show(error.message || "Could not open coach controls.", "error");
  } finally {
    submit.disabled = false;
  }
});

reviewButton.addEventListener("click", runAiReview);
refreshButton.addEventListener("click", () => refreshScan());
publishButton.addEventListener("click", publish);
approveAllButton.addEventListener("click", approveAll);

reviewQueue.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const card = button.closest(".review-card");
  if (!card) return;
  if (button.dataset.action === "approve") approveCard(card);
  if (button.dataset.action === "ignore") ignoreCard(card);
});

logoutButton.addEventListener("click", () => {
  coachPassword = "";
  coachEmail = "";
  scanState = null;
  controlStage.hidden = true;
  authStage.hidden = false;
  reviewQueue.innerHTML = "";
  changedList.innerHTML = "";
  hideProgress();
  show("Signed out.");
});

readStatus().catch(() => {});
