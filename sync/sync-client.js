import { createClient } from "@supabase/supabase-js";

const authStage = document.querySelector("#authStage");
const readyStage = document.querySelector("#readyStage");
const loginForm = document.querySelector("#loginForm");
const mfaForm = document.querySelector("#mfaForm");
const syncButton = document.querySelector("#syncButton");
const logoutButton = document.querySelector("#logoutButton");
const result = document.querySelector("#result");
const lastSync = document.querySelector("#lastSync");
const liveCount = document.querySelector("#liveCount");

let supabase;
let factorId = null;
let accessToken = null;
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
  lastSync.textContent = new Date(status.generatedAt).toLocaleString();
  liveCount.textContent = String(status.drillCount);
  return status;
}

async function showReady() {
  authStage.hidden = true;
  readyStage.hidden = false;
  statusBeforeSync = await readStatus();
  show("Ready to sync the LIVE Drill Library.");
}

function safeAuthMessage(message) {
  const text = String(message || "").toLowerCase();
  if (text.includes("invalid login")) return "That email or password is not correct.";
  if (text.includes("invalid totp") || text.includes("invalid code")) {
    return "That six-digit code is not correct. Use the current code from Google Authenticator.";
  }
  if (text.includes("rate") || text.includes("too many")) {
    return "Too many attempts. Please wait a few minutes.";
  }
  return "Coach sign-in is temporarily unavailable.";
}

async function initialize() {
  const response = await fetch("/sync-config.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Sync configuration is unavailable.");
  const config = await response.json();
  supabase = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  show("Signing in…");
  const submit = loginForm.querySelector("button");
  submit.disabled = true;
  try {
    const email = loginForm.email.value.trim();
    const password = loginForm.password.value;
    loginForm.password.value = "";
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    accessToken = data.session?.access_token || null;
    const [{ data: assurance }, { data: factors, error: factorError }] =
      await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);
    if (factorError) throw factorError;

    if (assurance?.currentLevel === "aal2") {
      await showReady();
      return;
    }
    const verified = factors?.totp?.find((factor) => factor.status === "verified");
    if (!verified) {
      show("No verified Google Authenticator factor is enrolled for this account.", "error");
      return;
    }
    factorId = verified.id;
    loginForm.hidden = true;
    mfaForm.hidden = false;
    mfaForm.totp.focus();
    show("Enter the current code from Google Authenticator.");
  } catch (error) {
    accessToken = null;
    show(safeAuthMessage(error?.message), "error");
  } finally {
    submit.disabled = false;
  }
});

mfaForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = mfaForm.querySelector("button");
  submit.disabled = true;
  show("Verifying…");
  try {
    const { data: challenge, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) throw challengeError;
    const { data, error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: mfaForm.totp.value.trim(),
    });
    mfaForm.totp.value = "";
    if (error) throw error;
    accessToken = data.access_token;
    await showReady();
  } catch (error) {
    show(safeAuthMessage(error?.message), "error");
  } finally {
    submit.disabled = false;
  }
});

syncButton.addEventListener("click", async () => {
  if (!accessToken) return show("Sign in again before syncing.", "error");
  syncButton.disabled = true;
  show("Starting the Notion sync…");
  try {
    statusBeforeSync = statusBeforeSync || (await readStatus());
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || "Sync could not start.");
    show("Sync started. Waiting for the new deployment…");

    const original = statusBeforeSync?.generatedAt;
    for (let attempt = 0; attempt < 36; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      const current = await readStatus();
      if (current?.generatedAt && current.generatedAt !== original) {
        statusBeforeSync = current;
        show(
          `Sync complete. ${current.drillCount} drills are live. ` +
            `${current.added} added, ${current.removed} removed.`,
          "success",
        );
        return;
      }
    }
    show("The sync is still building. Check this page again in a minute.");
  } catch (error) {
    show(error.message || "Sync failed. Please try again.", "error");
  } finally {
    syncButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  await supabase.auth.signOut();
  accessToken = null;
  factorId = null;
  readyStage.hidden = true;
  authStage.hidden = false;
  loginForm.hidden = false;
  mfaForm.hidden = true;
  show("Signed out.");
});

initialize().catch((error) => show(error.message, "error"));
