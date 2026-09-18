/**
 * A4KU Mass Quest Runner - Admin Portal Controller
 * Full-featured Dispatcher with Engine Tuner, Cooldown Radar, Slot Controls, and Validator.
 */

let adminSessionToken = sessionStorage.getItem("a4ku_admin_session") || "";
let adminUser = sessionStorage.getItem("a4ku_admin_user") || "a4ku";

// Auth Elements
const authGate = document.getElementById("auth-gate");
const authGateForm = document.getElementById("auth-gate-form");
const authUserInput = document.getElementById("auth-user-input");
const authPassInput = document.getElementById("auth-pass-input");
const authGateError = document.getElementById("auth-gate-error");
const authGateSubmit = document.getElementById("auth-gate-submit");
const btnAdminLock = document.getElementById("btn-admin-lock");
const badgeAdminUser = document.getElementById("badge-admin-user");

// Telemetry Elements
const statAdminActive = document.getElementById("stat-admin-active");
const statAdminQueue = document.getElementById("stat-admin-queue");
const statAdminCooldowns = document.getElementById("stat-admin-cooldowns");
const statAdminRam = document.getElementById("stat-admin-ram");
const statAdminUptime = document.getElementById("stat-admin-uptime");
const adminSlotsSummary = document.getElementById("admin-slots-summary");
const adminSlotsContainer = document.getElementById("admin-slots-container");

// Cooldown Radar Elements
const cooldownSummaryPill = document.getElementById("cooldown-summary-pill");
const cooldownTableContainer = document.getElementById("cooldown-table-container");

// Tuner Elements
const tunerConcurrencySlider = document.getElementById("tuner-concurrency-slider");
const tunerSlotsBadge = document.getElementById("tuner-slots-badge");
const tunerHeartbeatInput = document.getElementById("tuner-heartbeat-input");
const tunerVideoInput = document.getElementById("tuner-video-input");
const btnSaveTuner = document.getElementById("btn-save-tuner");

// Search & Filter Elements
const slotSearchInput = document.getElementById("slot-search-input");
const filterTabs = document.querySelectorAll(".filter-tab[data-filter]");
const countAllSlots = document.getElementById("count-all-slots");
const countActiveSlots = document.getElementById("count-active-slots");
const countPausedSlots = document.getElementById("count-paused-slots");
const countIdleSlots = document.getElementById("count-idle-slots");

// Queue Elements
const adminQueueTbody = document.getElementById("admin-queue-tbody");
const adminQueueCount = document.getElementById("admin-queue-count");
const btnClearQueue = document.getElementById("btn-clear-queue");

// History & Failed Manager Elements
const adminHistoryTbody = document.getElementById("admin-history-tbody");
const tabHistoryAll = document.getElementById("tab-history-all");
const tabHistoryFailed = document.getElementById("tab-history-failed");
const failedAccountsBadge = document.getElementById("failed-accounts-badge");
const failedManagerActions = document.getElementById("failed-manager-actions");
const btnRetryAllFailed = document.getElementById("btn-retry-all-failed");
const btnClearFailed = document.getElementById("btn-clear-failed");

// Terminal Log Elements
const adminTerminalLogs = document.getElementById("admin-terminal-logs");
const adminLogCount = document.getElementById("admin-log-count");

// Command Deck Elements
const btnAdminSweep = document.getElementById("btn-admin-sweep");
const btnAdminReload = document.getElementById("btn-admin-reload");
const btnAdminReset = document.getElementById("btn-admin-reset");
const btnAdminExportTxt = document.getElementById("btn-admin-export-txt");
const btnAdminExportJson = document.getElementById("btn-admin-export-json");

// Modal Elements
const modalValidator = document.getElementById("modal-validator");
const modalSettings = document.getElementById("modal-settings");
const validatorInput = document.getElementById("validator-input");
const btnRunAudit = document.getElementById("btn-run-audit");
const btnQueueValid = document.getElementById("btn-queue-valid");
const validTokenCount = document.getElementById("valid-token-count");
const validatorResultsContainer = document.getElementById("validator-results-container");
const validatorTbody = document.getElementById("validator-tbody");

const settingsNewUser = document.getElementById("settings-new-user");
const settingsNewPass = document.getElementById("settings-new-pass");
const btnSaveCredentials = document.getElementById("btn-save-credentials");
const settingsWebhookUrl = document.getElementById("settings-webhook-url");
const btnSaveWebhook = document.getElementById("btn-save-webhook");
const btnTestWebhook = document.getElementById("btn-test-webhook");

// State Cache
let currentAdminState = null;
let currentCooldowns = [];
let currentFilter = "all";
let currentSearchQuery = "";
let currentHistoryTab = "all"; // 'all' or 'failed'
let verifiedTokensToQueue = [];
let totalAdminEvents = 0;
let cooldownTickerTimer = null;

// ── Auth Gate Logic ─────────────────────────────────────────────────────────
function showAuthGate(customMessage) {
  authGate.style.display = "flex";
  authPassInput.value = "";
  if (customMessage) {
    authGateError.textContent = customMessage;
    authGateError.style.display = "block";
  } else {
    authGateError.style.display = "none";
  }
  authPassInput.focus();
}

function hideAuthGate() {
  authGate.style.display = "none";
  authGateError.style.display = "none";
}

if (btnAdminLock) {
  btnAdminLock.addEventListener("click", async () => {
    try {
      if (adminSessionToken) {
        await fetch("/api/admin/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${adminSessionToken}` },
        });
      }
    } catch (e) {}
    sessionStorage.removeItem("a4ku_admin_session");
    sessionStorage.removeItem("a4ku_admin_user");
    adminSessionToken = "";
    showAuthGate("Console securely locked.");
  });
}

authGateForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = authUserInput.value.trim();
  const pass = authPassInput.value.trim();
  if (!user || !pass) return;

  authGateError.style.display = "none";
  if (authGateSubmit) {
    authGateSubmit.disabled = true;
    authGateSubmit.textContent = "VERIFYING CREDENTIALS...";
  }

  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, pass }),
    });

    const data = await res.json();
    if (res.ok && data.ok) {
      adminUser = data.user || user;
      adminSessionToken = data.token;
      sessionStorage.setItem("a4ku_admin_session", adminSessionToken);
      sessionStorage.setItem("a4ku_admin_user", adminUser);
      badgeAdminUser.textContent = adminUser;
      hideAuthGate();
      initAdminView();
    } else {
      authGateError.textContent = data.error || "Authentication failed. Access denied.";
      authGateError.style.display = "block";
      authPassInput.value = "";
      authPassInput.focus();
    }
  } catch (err) {
    authGateError.textContent = "Security Connection Error: " + err.message;
    authGateError.style.display = "block";
  } finally {
    if (authGateSubmit) {
      authGateSubmit.disabled = false;
      authGateSubmit.textContent = "UNLOCK CONSOLE";
    }
  }
});

// Authorized Request Wrapper (Cryptographic Bearer Session)
async function adminFetch(url, options = {}) {
  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${adminSessionToken}`,
    "x-admin-key": adminSessionToken,
  };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    sessionStorage.removeItem("a4ku_admin_session");
    sessionStorage.removeItem("a4ku_admin_user");
    adminSessionToken = "";
    showAuthGate("Session expired due to inactivity. Please sign in again.");
  }
  return res;
}

// ── Modal Controllers ────────────────────────────────────────────────────────
window.openValidatorModal = function () {
  modalValidator.style.display = "flex";
  validatorInput.focus();
};

window.closeValidatorModal = function () {
  modalValidator.style.display = "none";
};

window.openSettingsModal = function () {
  if (currentAdminState?.config) {
    settingsNewUser.value = currentAdminState.config.adminUser || adminUser;
    settingsWebhookUrl.value = currentAdminState.config.webhookUrl || "";
  }
  modalSettings.style.display = "flex";
};

window.closeSettingsModal = function () {
  modalSettings.style.display = "none";
};

// ── Feature 1: Live Cooldown Radar & Ticker ─────────────────────────────────
function renderCooldowns(cooldowns = []) {
  currentCooldowns = cooldowns;
  const activeList = cooldowns.filter((c) => !c.isExpired && c.remainingSec > 0);

  statAdminCooldowns.textContent = `${activeList.length} Active`;

  if (cooldowns.length === 0) {
    cooldownSummaryPill.textContent = "ALL CLEAR";
    cooldownSummaryPill.className = "cooldown-pill ready";
    cooldownTableContainer.innerHTML = `
      <div style="font-size: 12px; color: var(--text-tertiary); font-style: italic; padding: 6px 0;">
        ✓ All Discord API routes clear. No active rate-limit delays.
      </div>
    `;
    return;
  }

  cooldownSummaryPill.textContent = activeList.length > 0 ? `${activeList.length} COOLDOWN ACTIVE` : "ALL READY";
  cooldownSummaryPill.className = `cooldown-pill ${activeList.length > 0 ? "active" : "ready"}`;

  cooldownTableContainer.innerHTML = `
    <table class="cooldown-table">
      <thead>
        <tr>
          <th>Quest Title</th>
          <th>Rate-Limit Reason</th>
          <th>Cooldown Remaining</th>
          <th>Resolver Strategy</th>
        </tr>
      </thead>
      <tbody>
        ${cooldowns
          .map((c) => {
            const mm = String(Math.floor(c.remainingSec / 60)).padStart(2, "0");
            const ss = String(c.remainingSec % 60).padStart(2, "0");
            const pillClass = c.remainingSec > 0 ? "active" : "ready";
            const statusLabel = c.remainingSec > 0 ? `⏳ ${mm}:${ss} remaining` : "✓ Cooldown Expired (Ready)";
            return `
              <tr>
                <td style="font-weight: 600; color: #ffffff;">${c.questName}</td>
                <td style="color: var(--text-secondary); font-family: var(--font-mono); font-size: 11px;">Discord 429 Route Burst Protection</td>
                <td><span class="cooldown-pill ${pillClass}">${statusLabel}</span></td>
                <td style="font-size: 11.5px; color: #a1a1aa;">Auto-completes in 2nd Pass after active quests</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

// 1s ticker for live countdowns
if (!cooldownTickerTimer) {
  cooldownTickerTimer = setInterval(() => {
    if (!currentCooldowns || currentCooldowns.length === 0) return;
    let hasChanges = false;
    currentCooldowns.forEach((c) => {
      if (c.remainingSec > 0) {
        c.remainingSec--;
        hasChanges = true;
      }
    });
    if (hasChanges) {
      renderCooldowns(currentCooldowns);
    }
  }, 1000);
}

// ── Feature 2: Engine Tuner Slider & Controls ────────────────────────────────
if (tunerConcurrencySlider) {
  tunerConcurrencySlider.addEventListener("input", (e) => {
    tunerSlotsBadge.textContent = `${e.target.value} Slots`;
  });
}

if (btnSaveTuner) {
  btnSaveTuner.addEventListener("click", async () => {
    const maxConcurrent = Number(tunerConcurrencySlider.value);
    const heartbeatIntervalSeconds = Number(tunerHeartbeatInput.value);
    const videoStepSeconds = Number(tunerVideoInput.value);

    btnSaveTuner.disabled = true;
    btnSaveTuner.innerHTML = "<span>⏳</span> <span>Applying...</span>";

    try {
      const res = await adminFetch("/api/admin/tuning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxConcurrent, heartbeatIntervalSeconds, videoStepSeconds }),
      });
      const data = await res.json();
      if (data.ok) {
        updateAdminDashboard(data.status);
        btnSaveTuner.innerHTML = "<span>✓</span> <span>Tunings Applied!</span>";
        setTimeout(() => {
          btnSaveTuner.innerHTML = "<span>💾</span> <span>Apply Engine Tunings</span>";
          btnSaveTuner.disabled = false;
        }, 1500);
      } else {
        alert("Error updating tuning: " + (data.error || "Unknown"));
        btnSaveTuner.disabled = false;
      }
    } catch (e) {
      alert("Network error: " + e.message);
      btnSaveTuner.disabled = false;
    }
  });
}

// ── Feature 3 & 7: Render Concurrency Matrix with Filter & Controls ──────────
function renderAdminSlots(slots = []) {
  if (!Array.isArray(slots)) return;

  // Update counts
  const total = slots.length;
  const active = slots.filter((s) => s.isBusy && !s.state?.isPaused).length;
  const paused = slots.filter((s) => s.isBusy && s.state?.isPaused).length;
  const idle = slots.filter((s) => !s.isBusy).length;

  if (countAllSlots) countAllSlots.textContent = total;
  if (countActiveSlots) countActiveSlots.textContent = active;
  if (countPausedSlots) countPausedSlots.textContent = paused;
  if (countIdleSlots) countIdleSlots.textContent = idle;

  // Filter slots
  const query = currentSearchQuery.toLowerCase().trim();
  const filtered = slots.filter((s) => {
    // 1. Tab filter
    if (currentFilter === "active" && (!s.isBusy || s.state?.isPaused)) return false;
    if (currentFilter === "paused" && (!s.isBusy || !s.state?.isPaused)) return false;
    if (currentFilter === "idle" && s.isBusy) return false;

    // 2. Search query filter
    if (query) {
      const u = s.state?.user;
      const username = (u?.username || "").toLowerCase();
      const globalName = (u?.global_name || "").toLowerCase();
      const uid = (u?.id || "").toLowerCase();
      const token = (s.tokenMasked || "").toLowerCase();
      const slotStr = `slot #${s.slotId + 1}`.toLowerCase();
      const matches =
        username.includes(query) ||
        globalName.includes(query) ||
        uid.includes(query) ||
        token.includes(query) ||
        slotStr.includes(query);
      if (!matches) return false;
    }

    return true;
  });

  adminSlotsContainer.innerHTML = "";

  if (filtered.length === 0) {
    adminSlotsContainer.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; color: var(--text-tertiary); font-style: italic; padding: 40px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px;">
        No slots matching current filter criteria.
      </div>
    `;
    return;
  }

  filtered.forEach((s) => {
    const card = document.createElement("div");
    const isPaused = Boolean(s.state?.isPaused);
    card.className = `admin-slot-card ${s.isBusy ? (isPaused ? "is-active is-paused" : "is-active") : "is-idle"}`;

    const state = s.state;
    const status = isPaused ? "PAUSED" : state ? state.status.toUpperCase() : "IDLE";
    const statusClass = isPaused ? "status-paused" : state ? `status-${state.status}` : "status-idle";
    const user = state ? state.user : null;
    const quests = state ? state.quests || [] : [];
    const hasToken = Boolean(s.hasToken);
    const maskedToken = s.tokenMasked || "None";

    const userHtml = user
      ? `
        <div class="slot-user-details">
          <img src="${user.avatar_url}" alt="Avatar" class="slot-avatar" onerror="this.src='favicon.png'">
          <div class="slot-user-meta">
            <div class="slot-user-title">${user.global_name || user.username}</div>
            <div class="slot-user-tagline">@${user.username} (ID: ${user.id})</div>
          </div>
        </div>
      `
      : s.isBusy
      ? `
        <div class="slot-user-details">
          <div class="slot-avatar"></div>
          <div class="slot-user-meta">
            <div class="slot-user-title">Authenticating...</div>
            <div class="slot-user-tagline">Validating token</div>
          </div>
        </div>
      `
      : `
        <div class="slot-user-details">
          <div class="slot-avatar"></div>
          <div class="slot-user-meta">
            <div class="slot-user-title">Available Slot</div>
            <div class="slot-user-tagline">Ready for next queue promotion</div>
          </div>
        </div>
      `;

    const tokenHtml = s.isBusy && s.hasToken
      ? `
        <div class="slot-token-bar">
          <span class="slot-token-text" id="token-text-${s.slotId}" data-masked="${maskedToken}" data-revealed="false">${maskedToken}</span>
          <div style="display: flex; gap: 4px;">
            <button type="button" class="btn-toggle-eye" onclick="toggleTokenReveal(${s.slotId})" title="Reveal/Hide Token" style="font-size: 11px; padding: 2px 4px;">👁️</button>
            <button type="button" class="btn-toggle-eye" onclick="copySlotToken(${s.slotId})" title="Copy Token" style="font-size: 11px; padding: 2px 4px;">📋</button>
          </div>
        </div>
      `
      : "";

    const questsHtml = quests.length > 0
      ? `
        <div class="slot-quests-list" style="margin: 4px 0;">
          ${quests
            .map((q) => {
              const isDone = q.status === "done";
              const isSkipped = q.status === "skipped";
              const isQPaused = q.status === "paused";
              const barColor = isDone ? "var(--color-success)" : isSkipped ? "rgba(255,255,255,0.15)" : isQPaused ? "rgba(255,255,255,0.3)" : "var(--color-accent)";
              const pctLabel = isDone ? "100%" : isSkipped ? "Skipped" : isQPaused ? "Paused" : `${q.progressPct}%`;
              return `
                <div class="slot-quest-item">
                  <div class="slot-quest-title">
                    <span class="q-name" title="${q.name}">${q.name}</span>
                    <span style="font-size: 10px; font-weight: 600; color: ${isDone ? 'var(--color-success)' : isSkipped ? 'var(--text-tertiary)' : 'var(--text-primary)'}">${pctLabel}</span>
                  </div>
                  <div class="slot-progress-bar">
                    <div class="slot-progress-fill" style="width: ${isDone ? 100 : isSkipped ? 100 : q.progressPct}%; background: ${barColor}"></div>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      `
      : `<div style="font-size: 11px; color: var(--text-tertiary); font-style: italic; padding: 4px 0;">No active quests</div>`;

    // Per-Slot Action Controls
    const actionsHtml = s.isBusy
      ? `
        <div class="slot-actions-bar">
          <button type="button" class="btn-slot-ctrl" onclick="skipQuestAction(${s.slotId})" title="Skip the current running quest on this slot">
            <span>⏭️</span> <span>Skip</span>
          </button>
          <button type="button" class="btn-slot-ctrl" onclick="pauseSlotAction(${s.slotId})" title="${isPaused ? 'Resume this slot' : 'Pause this slot'}">
            <span>${isPaused ? '▶️' : '⏸️'}</span> <span>${isPaused ? 'Resume' : 'Pause'}</span>
          </button>
          <button type="button" class="btn-slot-ctrl terminate" onclick="stopSlotAction(${s.slotId})" title="Terminate account on this slot">
            <span>⏹</span> <span>Stop</span>
          </button>
        </div>
      `
      : "";

    const sec = state?.elapsedSeconds || 0;
    const mm = String(Math.floor(sec / 60)).padStart(2, "0");
    const ss = String(sec % 60).padStart(2, "0");

    card.innerHTML = `
      <div class="slot-top-row">
        <span class="slot-num-badge">SLOT #${s.slotId + 1}</span>
        <span class="slot-status-pill ${statusClass}">${status}</span>
      </div>
      ${userHtml}
      ${tokenHtml}
      ${questsHtml}
      <div class="slot-bottom-meta">
        <span>⏱ ${mm}:${ss}</span>
        <span>${state?.completedCount || 0}/${state?.totalQuests || 0} quests</span>
      </div>
      ${actionsHtml}
    `;

    adminSlotsContainer.appendChild(card);
  });
}

// Search & Filter event listeners
if (slotSearchInput) {
  slotSearchInput.addEventListener("input", (e) => {
    currentSearchQuery = e.target.value;
    if (currentAdminState) renderAdminSlots(currentAdminState.slots);
  });
}

filterTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    filterTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    currentFilter = tab.getAttribute("data-filter");
    if (currentAdminState) renderAdminSlots(currentAdminState.slots);
  });
});

// ── Per-Slot Action Handlers ────────────────────────────────────────────────
window.skipQuestAction = async function (slotId) {
  try {
    const res = await adminFetch("/api/admin/slot/skip-quest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotId }),
    });
    const data = await res.json();
    if (data.ok) {
      updateAdminDashboard(data.status);
    } else {
      alert("Error skipping quest: " + (data.error || "Unknown"));
    }
  } catch (e) {
    alert("Network error: " + e.message);
  }
};

window.pauseSlotAction = async function (slotId) {
  try {
    const res = await adminFetch("/api/admin/slot/pause", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotId }),
    });
    const data = await res.json();
    if (data.ok) {
      updateAdminDashboard(data.status);
    } else {
      alert("Error toggling pause: " + (data.error || "Unknown"));
    }
  } catch (e) {
    alert("Network error: " + e.message);
  }
};

window.stopSlotAction = async function (slotId) {
  if (!confirm(`Are you sure you want to STOP Slot #${slotId + 1}? The current account will finish and the next waiting account will be promoted.`)) {
    return;
  }
  try {
    const res = await adminFetch("/api/admin/stop-slot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotId }),
    });
    const data = await res.json();
    if (data.ok) {
      updateAdminDashboard(data.status);
    } else {
      alert("Error stopping slot: " + (data.error || "Unknown"));
    }
  } catch (e) {
    alert("Network error: " + e.message);
  }
};

window.toggleTokenReveal = async function (slotId) {
  const el = document.getElementById(`token-text-${slotId}`);
  if (!el) return;
  const isCurrentlyRevealed = el.getAttribute("data-revealed") === "true";
  if (isCurrentlyRevealed) {
    el.textContent = el.getAttribute("data-masked") || "••••••••••••";
    el.setAttribute("data-revealed", "false");
    return;
  }
  try {
    const res = await adminFetch("/api/admin/reveal-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotId }),
    });
    const data = await res.json();
    if (data.ok && data.token) {
      el.textContent = data.token;
      el.setAttribute("data-revealed", "true");
    } else {
      alert("Failed to reveal token: " + (data.error || "Access denied"));
    }
  } catch (e) {
    alert("Reveal error: " + e.message);
  }
};

window.copySlotToken = async function (slotId) {
  try {
    const res = await adminFetch("/api/admin/reveal-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotId }),
    });
    const data = await res.json();
    if (data.ok && data.token) {
      await navigator.clipboard.writeText(data.token);
      alert(`✓ Slot #${slotId + 1} token copied to clipboard!`);
    } else {
      alert("Failed to copy token: " + (data.error || "Access denied"));
    }
  } catch (e) {
    alert("Copy error: " + e.message);
  }
};

window.copyQueueToken = async function (index) {
  try {
    const res = await adminFetch("/api/admin/reveal-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queueIndex: index }),
    });
    const data = await res.json();
    if (data.ok && data.token) {
      await navigator.clipboard.writeText(data.token);
      alert(`✓ Queue #${index + 1} token copied to clipboard!`);
    } else {
      alert("Failed to copy token: " + (data.error || "Access denied"));
    }
  } catch (e) {
    alert("Copy error: " + e.message);
  }
};

window.copyTokenToClipboard = async function (token) {
  try {
    await navigator.clipboard.writeText(token);
    alert("✓ Token copied to clipboard!");
  } catch (e) {
    alert("Failed to copy: " + e.message);
  }
};

// ── Queue Management ────────────────────────────────────────────────────────
function renderAdminQueue(queue = []) {
  adminQueueCount.textContent = queue.length;
  if (!queue || queue.length === 0) {
    adminQueueTbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; color: var(--text-tertiary); font-style: italic; padding: 20px;">
          Waiting queue is currently empty.
        </td>
      </tr>
    `;
    return;
  }

  adminQueueTbody.innerHTML = queue
    .map(
      (item) => `
      <tr>
        <td style="font-family: var(--font-mono); font-weight: 700; color: var(--text-secondary);">#${item.index + 1}</td>
        <td style="font-family: var(--font-mono); font-size: 11.5px;">
          <span>${item.tokenMasked}</span>
          <button type="button" class="btn-toggle-eye" onclick="copyQueueToken(${item.index})" title="Copy Token" style="font-size: 11px; margin-left: 6px;">📋</button>
        </td>
        <td style="font-size: 11.5px; color: var(--text-secondary);">${new Date(item.addedAt).toLocaleTimeString()}</td>
        <td style="text-align: right;">
          <button type="button" class="btn-admin-action secondary" onclick="removeQueueAction(${item.index})" style="font-size: 10.5px; padding: 3px 8px;" title="Remove this token from queue">
            <span>✕</span> <span>Remove</span>
          </button>
        </td>
      </tr>
    `
    )
    .join("");
}

window.removeQueueAction = async function (index) {
  try {
    const res = await adminFetch("/api/admin/queue/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index }),
    });
    const data = await res.json();
    if (data.ok) {
      updateAdminDashboard(data.status);
    }
  } catch (e) {
    alert("Failed to remove token: " + e.message);
  }
};

if (btnClearQueue) {
  btnClearQueue.addEventListener("click", async () => {
    if (!confirm("Clear ALL pending tokens from the waiting queue?")) return;
    try {
      const res = await adminFetch("/api/admin/queue/clear", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        updateAdminDashboard(data.status);
      }
    } catch (e) {
      alert("Failed to clear queue: " + e.message);
    }
  });
}

// ── Feature 6: Processed History & Failed Accounts Manager ──────────────────
function renderAdminHistory(completed = [], failed = []) {
  failedAccountsBadge.textContent = failed.length;

  let displayItems = [];
  if (currentHistoryTab === "failed") {
    failedManagerActions.style.display = "flex";
    displayItems = (failed || []).map((x) => ({ ...x, isSuccess: false }));
  } else {
    failedManagerActions.style.display = "none";
    displayItems = [
      ...(completed || []).map((x) => ({ ...x, isSuccess: true })),
      ...(failed || []).map((x) => ({ ...x, isSuccess: false })),
    ].sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt));
  }

  if (displayItems.length === 0) {
    adminHistoryTbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-tertiary); font-style: italic; padding: 20px;">
          ${currentHistoryTab === "failed" ? "No failed accounts recorded! All operations running smoothly." : "No accounts processed in this session yet."}
        </td>
      </tr>
    `;
    return;
  }

  adminHistoryTbody.innerHTML = displayItems
    .slice(0, 40)
    .map((item) => {
      const pillClass = item.isSuccess ? "status-done" : "status-failed";
      const pillText = item.isSuccess ? "COMPLETED" : (item.outcome || "FAILED").toUpperCase();
      const uTag = item.user ? `@${item.user.username}` : `[Slot ${item.slotId}]`;
      const tokenMasked = item.tokenMasked || "Masked";
      const tokenToRetry = item.tokenMasked || "";

      const actionHtml = !item.isSuccess && tokenToRetry
        ? `
          <button type="button" class="btn-admin-action" onclick="retrySingleAccount('${tokenToRetry}')" style="font-size: 10px; padding: 2px 7px;" title="Retry this account immediately">
            <span>⚡</span> <span>Retry</span>
          </button>
        `
        : "-";

      return `
        <tr>
          <td><span class="slot-status-pill ${pillClass}">${pillText}</span></td>
          <td>
            <div style="font-weight: 600;">${item.user ? item.user.global_name || item.user.username : uTag}</div>
            <div style="font-size: 11px; color: var(--text-secondary);">${uTag}</div>
          </td>
          <td style="font-family: var(--font-mono);">${item.completedCount || 0}/${item.totalQuests || 0} quests</td>
          <td style="font-family: var(--font-mono); font-size: 11px;">${item.durationSec || 0}s</td>
          <td style="font-size: 11px; color: var(--text-secondary);">${new Date(item.finishedAt).toLocaleTimeString()}</td>
          <td style="font-family: var(--font-mono); font-size: 11px;">
            <span>${tokenMasked}</span>
            ${item.tokenRaw ? `<button type="button" class="btn-toggle-eye" onclick="copyTokenToClipboard('${item.tokenRaw}')" title="Copy Token" style="font-size: 11px; margin-left: 4px;">📋</button>` : ""}
          </td>
          <td style="text-align: right;">${actionHtml}</td>
        </tr>
      `;
    })
    .join("");
}

if (tabHistoryAll) {
  tabHistoryAll.addEventListener("click", () => {
    tabHistoryAll.classList.add("active");
    tabHistoryFailed.classList.remove("active");
    currentHistoryTab = "all";
    if (currentAdminState) renderAdminHistory(currentAdminState.completedAccounts, currentAdminState.failedAccounts);
  });
}

if (tabHistoryFailed) {
  tabHistoryFailed.addEventListener("click", () => {
    tabHistoryFailed.classList.add("active");
    tabHistoryAll.classList.remove("active");
    currentHistoryTab = "failed";
    if (currentAdminState) renderAdminHistory(currentAdminState.completedAccounts, currentAdminState.failedAccounts);
  });
}

window.retrySingleAccount = async function (token) {
  try {
    const res = await adminFetch("/api/admin/retry-failed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (data.ok) {
      updateAdminDashboard(data.status);
    }
  } catch (e) {
    alert("Retry error: " + e.message);
  }
};

if (btnRetryAllFailed) {
  btnRetryAllFailed.addEventListener("click", async () => {
    try {
      const res = await adminFetch("/api/admin/retry-failed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.ok) {
        alert(`✓ Re-queued ${data.enqueuedCount} failed accounts into waiting queue!`);
        updateAdminDashboard(data.status);
      }
    } catch (e) {
      alert("Retry error: " + e.message);
    }
  });
}

if (btnClearFailed) {
  btnClearFailed.addEventListener("click", async () => {
    try {
      const res = await adminFetch("/api/admin/clear-failed", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        updateAdminDashboard(data.status);
      }
    } catch (e) {
      alert("Error clearing failed accounts: " + e.message);
    }
  });
}

// ── Feature 5: Bulk Pre-Flight Token Validator ──────────────────────────────
if (btnRunAudit) {
  btnRunAudit.addEventListener("click", async () => {
    const text = validatorInput.value.trim();
    if (!text) {
      alert("Please paste one or more Discord tokens to audit.");
      return;
    }

    btnRunAudit.disabled = true;
    btnRunAudit.innerHTML = "<span>⏳</span> <span>Auditing Tokens...</span>";
    validatorResultsContainer.style.display = "block";
    validatorTbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 20px; color: var(--text-secondary);">
          Checking tokens against Discord API...
        </td>
      </tr>
    `;

    try {
      const res = await adminFetch("/api/admin/validate-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokens: text }),
      });
      const data = await res.json();

      if (data.ok && Array.isArray(data.results)) {
        verifiedTokensToQueue = data.results.filter((r) => r.valid && r.eligibleQuests > 0).map((r) => r.token);
        validTokenCount.textContent = verifiedTokensToQueue.length;

        if (verifiedTokensToQueue.length > 0) {
          btnQueueValid.style.display = "inline-flex";
        } else {
          btnQueueValid.style.display = "none";
        }

        validatorTbody.innerHTML = data.results
          .map((r) => {
            const pillClass = r.status === "READY" ? "status-done" : r.status === "ALL_DONE" ? "status-farming" : "status-failed";
            const userDisplay = r.user ? `@${r.user.username} (${r.user.global_name || ""})` : r.error || "Invalid";
            return `
              <tr>
                <td><span class="slot-status-pill ${pillClass}">${r.status}</span></td>
                <td><div style="font-weight: 600;">${userDisplay}</div></td>
                <td style="font-family: var(--font-mono);">${r.eligibleQuests} eligible</td>
                <td style="font-family: var(--font-mono); font-size: 11px;">${r.masked}</td>
              </tr>
            `;
          })
          .join("");
      } else {
        alert("Validation error: " + (data.error || "Unknown"));
      }
    } catch (e) {
      alert("Network error: " + e.message);
    } finally {
      btnRunAudit.disabled = false;
      btnRunAudit.innerHTML = "<span>🚀</span> <span>Run Pre-Flight Audit</span>";
    }
  });
}

if (btnQueueValid) {
  btnQueueValid.addEventListener("click", async () => {
    if (verifiedTokensToQueue.length === 0) return;
    btnQueueValid.disabled = true;
    btnQueueValid.innerHTML = "<span>⏳</span> <span>Enqueuing...</span>";

    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokens: verifiedTokensToQueue }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(`✓ Enqueued ${data.added} valid tokens into the runner queue!`);
        closeValidatorModal();
        loadAdminData();
      } else {
        alert("Enqueuing error: " + (data.error || "Unknown"));
      }
    } catch (e) {
      alert("Network error: " + e.message);
    } finally {
      btnQueueValid.disabled = false;
      btnQueueValid.innerHTML = `<span>⚡</span> <span>1-Click Queue Eligible Tokens (${verifiedTokensToQueue.length})</span>`;
    }
  });
}

// ── Feature 4 & 8: Settings (Credentials & Webhook) ─────────────────────────
if (btnSaveCredentials) {
  btnSaveCredentials.addEventListener("click", async () => {
    const user = settingsNewUser.value.trim();
    const pass = settingsNewPass.value.trim();
    if (!user || !pass) {
      alert("Please enter both username and password.");
      return;
    }

    try {
      const res = await adminFetch("/api/admin/settings/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, pass }),
      });
      const data = await res.json();
      if (data.ok) {
        adminUser = user;
        adminSessionToken = data.token;
        sessionStorage.setItem("a4ku_admin_session", adminSessionToken);
        sessionStorage.setItem("a4ku_admin_user", adminUser);
        badgeAdminUser.textContent = adminUser;
        alert("✓ Administrator credentials updated successfully!");
        closeSettingsModal();
      } else {
        alert("Error: " + (data.error || "Failed to update credentials"));
      }
    } catch (e) {
      alert("Network error: " + e.message);
    }
  });
}

if (btnSaveWebhook) {
  btnSaveWebhook.addEventListener("click", async () => {
    const webhookUrl = settingsWebhookUrl.value.trim();
    try {
      const res = await adminFetch("/api/admin/webhook/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl }),
      });
      const data = await res.json();
      if (data.ok) {
        alert("✓ Discord Webhook settings saved!");
      }
    } catch (e) {
      alert("Network error: " + e.message);
    }
  });
}

if (btnTestWebhook) {
  btnTestWebhook.addEventListener("click", async () => {
    const webhookUrl = settingsWebhookUrl.value.trim();
    if (!webhookUrl) {
      alert("Please enter a Discord Webhook URL first.");
      return;
    }
    btnTestWebhook.disabled = true;
    btnTestWebhook.textContent = "Testing...";

    try {
      const res = await adminFetch("/api/admin/webhook/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl }),
      });
      const data = await res.json();
      if (data.ok) {
        alert("✓ Discord ping delivered successfully! Check your staff channel.");
      } else {
        alert("Webhook test failed: " + (data.error || `HTTP ${data.status}`));
      }
    } catch (e) {
      alert("Network error: " + e.message);
    } finally {
      btnTestWebhook.disabled = false;
      btnTestWebhook.innerHTML = "<span>🔔</span> <span>Test Ping</span>";
    }
  });
}

// ── Append Terminal Logs ────────────────────────────────────────────────────
function appendAdminLog(log) {
  if (!log) return;
  totalAdminEvents++;
  adminLogCount.textContent = `${totalAdminEvents} events`;

  const entry = document.createElement("div");
  entry.className = `log-entry log-type-${log.type || "info"}`;
  entry.innerHTML = `
    <span class="log-time">[${log.timestamp || ""}]</span>
    <span class="log-slot">[Slot ${log.slotId}]</span>
    <span class="log-user">${log.userTag}:</span>
    <span class="log-msg">${log.message}</span>
  `;

  adminTerminalLogs.appendChild(entry);
  adminTerminalLogs.scrollTop = adminTerminalLogs.scrollHeight;

  if (adminTerminalLogs.children.length > 150) {
    adminTerminalLogs.removeChild(adminTerminalLogs.firstChild);
  }
}

// ── Update Dashboard Telemetry ──────────────────────────────────────────────
function updateAdminDashboard(data) {
  if (!data) return;
  currentAdminState = data;

  statAdminActive.textContent = `${data.activeCount || 0} / ${data.maxSlots || 12}`;
  statAdminQueue.textContent = data.waitingQueueCount || (data.waitingQueue ? data.waitingQueue.length : 0);

  if (data.telemetry) {
    statAdminRam.textContent = `${data.telemetry.memoryHeapUsedMb} / ${data.telemetry.memoryRssMb} MB`;
    const upSec = data.telemetry.uptimeSeconds || 0;
    const h = String(Math.floor(upSec / 3600)).padStart(2, "0");
    const m = String(Math.floor((upSec % 3600) / 60)).padStart(2, "0");
    const s = String(upSec % 60).padStart(2, "0");
    statAdminUptime.textContent = `${h}:${m}:${s}`;
  }

  adminSlotsSummary.textContent = `${data.activeCount || 0}/${data.maxSlots || 12} slots occupied (${data.waitingQueueCount || 0} in queue)`;

  if (data.config) {
    if (tunerConcurrencySlider && document.activeElement !== tunerConcurrencySlider) {
      tunerConcurrencySlider.value = data.config.maxConcurrent || data.maxSlots || 12;
      tunerSlotsBadge.textContent = `${tunerConcurrencySlider.value} Slots`;
    }
    if (tunerHeartbeatInput && document.activeElement !== tunerHeartbeatInput) {
      tunerHeartbeatInput.value = data.config.heartbeatIntervalSeconds || 20;
    }
    if (tunerVideoInput && document.activeElement !== tunerVideoInput) {
      tunerVideoInput.value = data.config.videoStepSeconds || 15;
    }
  }

  renderCooldowns(data.activeCooldowns || []);
  renderAdminSlots(data.slots || []);
  renderAdminQueue(data.waitingQueue || []);
  renderAdminHistory(data.completedAccounts || [], data.failedAccounts || []);
}

// ── Fetch Full Admin State ──────────────────────────────────────────────────
async function loadAdminData() {
  if (!adminSessionToken) return;
  try {
    const res = await adminFetch("/api/admin/status");
    if (res.status === 401) {
      sessionStorage.removeItem("a4ku_admin_session");
      adminSessionToken = "";
      showAuthGate();
      return;
    }
    if (res.ok) {
      const data = await res.json();
      updateAdminDashboard(data);
      if (data.recentLogs && totalAdminEvents === 0) {
        data.recentLogs.forEach(appendAdminLog);
      }
    }
  } catch (e) {
    console.error("Admin polling error:", e);
  }
}

// ── Command Deck Buttons ────────────────────────────────────────────────────
if (btnAdminSweep) {
  btnAdminSweep.addEventListener("click", async () => {
    btnAdminSweep.disabled = true;
    btnAdminSweep.textContent = "SWEEPING...";
    try {
      await fetch("/api/restart-all", { method: "POST" });
      await loadAdminData();
    } catch (e) {
      alert("Error: " + e.message);
    } finally {
      btnAdminSweep.disabled = false;
      btnAdminSweep.innerHTML = "<span>🔄</span> <span>Sweep Remaining</span>";
    }
  });
}

if (btnAdminReload) {
  btnAdminReload.addEventListener("click", async () => {
    btnAdminReload.disabled = true;
    btnAdminReload.textContent = "RELOADING...";
    try {
      await fetch("/api/reload", { method: "POST" });
      await loadAdminData();
    } catch (e) {
      alert("Error: " + e.message);
    } finally {
      btnAdminReload.disabled = false;
      btnAdminReload.innerHTML = "<span>📂</span> <span>Reload tokens.txt</span>";
    }
  });
}

if (btnAdminReset) {
  btnAdminReset.addEventListener("click", async () => {
    if (!confirm("⚠️ START FRESH RESET? This will stop all active slots, clear all accounts and queues, and wipe tokens.txt.")) {
      return;
    }
    try {
      await fetch("/api/clear", { method: "POST" });
      await loadAdminData();
    } catch (e) {
      alert("Error: " + e.message);
    }
  });
}

if (btnAdminExportTxt) {
  btnAdminExportTxt.addEventListener("click", () => {
    window.location.href = "/api/export-completed?format=text";
  });
}

if (btnAdminExportJson) {
  btnAdminExportJson.addEventListener("click", () => {
    window.location.href = "/api/export-completed?format=json";
  });
}

// ── Initialize Admin Portal ─────────────────────────────────────────────────
function initAdminView() {
  badgeAdminUser.textContent = adminUser;
  loadAdminData();

  // SSE Stream
  const evtSource = new EventSource("/api/stream");
  evtSource.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "log") {
        appendAdminLog(msg.data);
      } else if (msg.type === "status_update" || msg.type === "slot_update" || msg.type === "cooldown_update") {
        loadAdminData();
      }
    } catch (e) {}
  };

  setInterval(loadAdminData, 3000);
}

// Entry Check
if (!adminSessionToken) {
  showAuthGate();
} else {
  initAdminView();
}
