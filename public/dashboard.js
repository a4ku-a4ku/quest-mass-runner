/**
 * A4KU Mass Quest Runner - Dashboard Controller
 * Connects via Server-Sent Events (SSE) for zero-latency live slot updates.
 */

const MAX_SLOTS = 12;
const slotsContainer = document.getElementById("slots-container");
const terminalLogs = document.getElementById("terminal-logs");
const logCountEl = document.getElementById("log-count");

const statActive = document.getElementById("stat-active");
const statQueue = document.getElementById("stat-queue");
const statCompleted = document.getElementById("stat-completed");
const statFailed = document.getElementById("stat-failed");
const statTotal = document.getElementById("stat-total");
const slotSummaryText = document.getElementById("slot-summary-text");

const btnReloadFile = document.getElementById("btn-reload-file");
const btnOpenModal = document.getElementById("btn-open-modal");
const tokenModal = document.getElementById("token-modal");
const modalClose = document.getElementById("modal-close");
const modalCancel = document.getElementById("modal-cancel");
const modalSubmit = document.getElementById("modal-submit");
const modalTokensInput = document.getElementById("modal-tokens-input");

let totalEvents = 0;
let slotElements = [];

// Initialize Dynamic Slot Cards
function initSlotGrid(count = MAX_SLOTS) {
  slotsContainer.innerHTML = "";
  slotElements = [];

  for (let i = 0; i < count; i++) {
    const card = document.createElement("div");
    card.className = "slot-card is-idle";
    card.id = `slot-card-${i}`;

    card.innerHTML = `
      <div class="slot-top-row">
        <span class="slot-num-badge">SLOT #${i + 1}</span>
        <span class="slot-status-pill status-idle" id="slot-status-${i}">IDLE</span>
      </div>
      <div class="slot-user-box" id="slot-user-${i}">
        <div class="slot-avatar"></div>
        <div class="slot-user-info">
          <span class="slot-user-name">Available Slot</span>
          <span class="slot-user-tag">Waiting for token...</span>
        </div>
      </div>
      <div class="slot-quests-list" id="slot-quests-${i}">
        <div style="font-size: 11px; color: var(--text-tertiary); font-style: italic; padding: 8px 0;">
          No active quests
        </div>
      </div>
      <div class="slot-bottom-meta">
        <span id="slot-meta-left-${i}">⏱ 00:00</span>
        <span id="slot-meta-right-${i}">0/0 quests</span>
      </div>
    `;

    slotsContainer.appendChild(card);
    slotElements.push(card);
  }
}

function updateSlotUI(slotId, isBusy, state) {
  const card = document.getElementById(`slot-card-${slotId}`);
  const statusPill = document.getElementById(`slot-status-${slotId}`);
  const userBox = document.getElementById(`slot-user-${slotId}`);
  const questsBox = document.getElementById(`slot-quests-${slotId}`);
  const metaLeft = document.getElementById(`slot-meta-left-${slotId}`);
  const metaRight = document.getElementById(`slot-meta-right-${slotId}`);

  if (!card) return;

  if (!isBusy || !state) {
    card.className = "slot-card is-idle";
    statusPill.className = "slot-status-pill status-idle";
    statusPill.textContent = "IDLE";
    userBox.innerHTML = `
      <div class="slot-avatar"></div>
      <div class="slot-user-info">
        <span class="slot-user-name">Available Slot</span>
        <span class="slot-user-tag">Waiting for token...</span>
      </div>
    `;
    questsBox.innerHTML = `
      <div style="font-size: 11px; color: var(--text-tertiary); font-style: italic; padding: 8px 0;">
        No active quests
      </div>
    `;
    metaLeft.textContent = "⏱ 00:00";
    metaRight.textContent = "0/0 quests";
    return;
  }

  card.className = "slot-card is-active";
  statusPill.className = `slot-status-pill status-${state.status}`;
  statusPill.textContent = state.status.toUpperCase();

  // User Profile
  if (state.user) {
    userBox.innerHTML = `
      <img src="${state.user.avatar_url}" alt="Avatar" class="slot-avatar" onerror="this.src='favicon.png'">
      <div class="slot-user-info">
        <span class="slot-user-name">${state.user.global_name || state.user.username}</span>
        <span class="slot-user-tag">@${state.user.username}</span>
      </div>
    `;
  } else {
    userBox.innerHTML = `
      <div class="slot-avatar"></div>
      <div class="slot-user-info">
        <span class="slot-user-name">Authenticating...</span>
        <span class="slot-user-tag">Checking token</span>
      </div>
    `;
  }

  // Quests list
  const quests = state.quests || [];
  if (quests.length > 0) {
    questsBox.innerHTML = quests
      .map(
        (q) => {
          const isDone = q.status === "done";
          const isSkipped = q.status === "skipped";
          const isPaused = q.status === "paused";
          const barColor = isDone ? "var(--color-success)" : isPaused ? "rgba(255,255,255,0.4)" : isSkipped ? "rgba(255,255,255,0.2)" : "var(--color-accent)";
          const pctLabel = isDone ? "100%" : isPaused ? "⏸️ Paused (2nd Pass)" : isSkipped ? "Skipped" : `${q.progressPct}%`;
          const titleStyle = isSkipped ? 'style="opacity: 0.6;"' : isPaused ? 'style="opacity: 0.85;"' : '';
          return `
          <div class="slot-quest-item" ${titleStyle}>
            <div class="slot-quest-title">
              <span class="q-name" title="${q.name}${isPaused && q.pauseReason ? ' (' + q.pauseReason + ')' : isSkipped && q.skipReason ? ' (' + q.skipReason + ')' : ''}">${q.name}</span>
              <span style="font-size: 10px; font-weight: 600; color: ${isDone ? 'var(--color-success)' : isPaused ? '#ffffff' : isSkipped ? 'var(--text-tertiary)' : 'var(--text-primary)'}">${pctLabel}</span>
            </div>
            <div class="slot-progress-bar">
              <div class="slot-progress-fill" style="width: ${isDone ? 100 : isSkipped ? 100 : q.progressPct}%; background: ${barColor}"></div>
            </div>
          </div>
        `;
        }
      )
      .join("");
  } else {
    questsBox.innerHTML = `
      <div style="font-size: 11px; color: var(--text-secondary); font-style: italic; padding: 8px 0;">
        Scanning quest catalog...
      </div>
    `;
  }

  // Bottom Meta
  const sec = state.elapsedSeconds || 0;
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  metaLeft.textContent = `⏱ ${mm}:${ss}`;
  metaRight.textContent = `${state.completedCount || 0}/${state.totalQuests || 0} done`;
}

function updateGlobalStats(data) {
  if (!data) return;

  statActive.textContent = `${data.activeCount} / ${data.maxSlots || 12}`;
  statQueue.textContent = data.waitingQueueCount || 0;
  statCompleted.textContent = data.completedCount || 0;
  statFailed.textContent = data.failedCount || 0;
  statTotal.textContent = data.totalLoaded || 0;

  slotSummaryText.textContent = `${data.activeCount}/${data.maxSlots || 12} slots occupied (${data.waitingQueueCount || 0} in queue)`;

  if (Array.isArray(data.slots)) {
    if (data.slots.length !== slotElements.length) {
      initSlotGrid(data.slots.length);
    }
    data.slots.forEach((s) => {
      updateSlotUI(s.slotId, s.isBusy, s.state);
    });
  }
}

function appendLog(log) {
  if (!log) return;
  totalEvents++;
  logCountEl.textContent = `${totalEvents} events`;

  const entry = document.createElement("div");
  entry.className = `log-entry log-type-${log.type || "info"}`;
  entry.innerHTML = `
    <span class="log-time">[${log.timestamp || ""}]</span>
    <span class="log-slot">[Slot ${log.slotId}]</span>
    <span class="log-user">${log.userTag}:</span>
    <span class="log-msg">${log.message}</span>
  `;

  terminalLogs.appendChild(entry);
  terminalLogs.scrollTop = terminalLogs.scrollHeight;

  // Prune oldest if > 150
  if (terminalLogs.children.length > 150) {
    terminalLogs.removeChild(terminalLogs.firstChild);
  }
}

// ── SSE Connection ────────────────────────────────────────────────────────────
function connectSSE() {
  const evtSource = new EventSource("/api/stream");

  evtSource.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "snapshot" || msg.type === "status_update") {
        updateGlobalStats(msg.data);
        if (msg.data.recentLogs && totalEvents === 0) {
          msg.data.recentLogs.forEach(appendLog);
        }
      } else if (msg.type === "slot_update") {
        updateSlotUI(msg.data.slotId, true, msg.data.state);
      } else if (msg.type === "log") {
        appendLog(msg.data);
      }
    } catch (e) {
      console.error("SSE parse error:", e);
    }
  };

  evtSource.onerror = () => {
    evtSource.close();
    // Reconnect after 3s
    setTimeout(connectSSE, 3000);
  };
}

// Fallback Polling
async function pollStatus() {
  try {
    const res = await fetch("/api/status");
    if (res.ok) {
      const data = await res.json();
      updateGlobalStats(data);
    }
  } catch (e) {}
}

// ── Button Handlers ───────────────────────────────────────────────────────────
const btnSweepAll = document.getElementById("btn-sweep-all");
if (btnSweepAll) {
  btnSweepAll.addEventListener("click", async () => {
    btnSweepAll.disabled = true;
    btnSweepAll.textContent = "SWEEPING...";
    try {
      const res = await fetch("/api/restart-all", { method: "POST" });
      const data = await res.json();
      updateGlobalStats(data.status);
    } catch (e) {
      alert("Error sweeping: " + e.message);
    } finally {
      btnSweepAll.disabled = false;
      btnSweepAll.innerHTML = "<span>↻</span><span>SWEEP REMAINING</span>";
    }
  });
}

const btnClearSession = document.getElementById("btn-clear-session");
if (btnClearSession) {
  btnClearSession.addEventListener("click", async () => {
    if (
      !confirm(
        "Start completely fresh? This will clear all old accounts, reset the 12 slots to IDLE, and prepare the website for new user tokens."
      )
    ) {
      return;
    }

    btnClearSession.disabled = true;
    btnClearSession.innerHTML = "<span>⏳</span><span>RESETTING...</span>";

    try {
      const res = await fetch("/api/clear", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        initSlotGrid();
        terminalLogs.innerHTML = "";
        totalEvents = 0;
        if (logCountEl) logCountEl.textContent = "0 events";
        updateGlobalStats(data.status);
      }
    } catch (e) {
      alert("Error resetting session: " + e.message);
    } finally {
      btnClearSession.disabled = false;
      btnClearSession.innerHTML = "<span>🧹</span><span>FRESH RESET</span>";
    }
  });
}

if (btnReloadFile) {
  btnReloadFile.addEventListener("click", async () => {
    btnReloadFile.disabled = true;
    btnReloadFile.textContent = "Reloading...";
    try {
      const res = await fetch("/api/reload", { method: "POST" });
      const data = await res.json();
      updateGlobalStats(data.status);
    } catch (e) {
      alert("Error reloading tokens file: " + e.message);
    } finally {
      btnReloadFile.disabled = false;
      btnReloadFile.innerHTML = "<span>📂</span><span>RELOAD FILE</span>";
    }
  });
}

// ── Quick Token Form (Single User Input) ──────────────────────────────────────
const quickForm = document.getElementById("quick-token-form");
const quickInput = document.getElementById("quick-token-input");
const quickToggle = document.getElementById("quick-token-toggle");
const quickStatus = document.getElementById("quick-token-status");
const tokenHelpToggle = document.getElementById("token-help-toggle");
const tokenHelpContent = document.getElementById("token-help-content");

if (quickToggle && quickInput) {
  quickToggle.addEventListener("click", () => {
    const isPassword = quickInput.type === "password";
    quickInput.type = isPassword ? "text" : "password";
    quickToggle.textContent = isPassword ? "🔒" : "👁️";
  });
}

if (tokenHelpToggle && tokenHelpContent) {
  tokenHelpToggle.addEventListener("click", () => {
    const isHidden = tokenHelpContent.style.display === "none";
    tokenHelpContent.style.display = isHidden ? "block" : "none";
  });
}

async function handleQuickTokenSubmit(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const token = quickInput ? quickInput.value.trim() : "";
  if (!token) {
    if (quickStatus) {
      quickStatus.className = "quick-token-status error";
      quickStatus.textContent = "⚠️ Please paste your Discord token into the box first!";
      quickStatus.style.display = "block";
    }
    if (quickInput) quickInput.focus();
    return;
  }

  const submitBtn = document.getElementById("quick-token-submit");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = "<span>⏳</span><span>VALIDATING...</span>";
  }
  if (quickStatus) quickStatus.style.display = "none";

  try {
    const res = await fetch("/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokens: [token] }),
    });

    const data = await res.json();
    if (data.ok) {
      if (quickStatus) {
        quickStatus.className = "quick-token-status ok";
        if (data.isRunningImmediately || !data.queuePosition || data.queuePosition === 0) {
          quickStatus.innerHTML = `✓ <strong>Token Accepted & Running!</strong> Your account is now active in a background slot. Quests will complete in ~15 mins even if you close this page!`;
        } else {
          quickStatus.innerHTML = `✓ <strong>Token Accepted & In Queue!</strong> All active slots are currently running. Your account is <strong>#${data.queuePosition} in queue</strong> and will automatically start the moment a slot finishes!`;
        }
        quickStatus.style.display = "block";
      }
      if (quickInput) quickInput.value = "";
      pollStatus();
    } else {
      if (quickStatus) {
        quickStatus.className = "quick-token-status error";
        quickStatus.textContent = `❌ ${data.error || "Failed to submit token. Please verify."}`;
        quickStatus.style.display = "block";
      }
    }
  } catch (err) {
    if (quickStatus) {
      quickStatus.className = "quick-token-status error";
      quickStatus.textContent = `❌ Network error: ${err.message}`;
      quickStatus.style.display = "block";
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = "<span>🚀</span><span>START QUESTING</span>";
    }
  }
}

if (quickForm) {
  quickForm.addEventListener("submit", handleQuickTokenSubmit);
}
const quickSubmitBtn = document.getElementById("quick-token-submit");
if (quickSubmitBtn) {
  quickSubmitBtn.addEventListener("click", handleQuickTokenSubmit);
}

if (btnOpenModal) {
  btnOpenModal.addEventListener("click", () => {
    tokenModal.classList.add("open");
    modalTokensInput.focus();
  });
}

function closeModal() {
  tokenModal.classList.remove("open");
  modalTokensInput.value = "";
}

if (modalClose) modalClose.addEventListener("click", closeModal);
if (modalCancel) modalCancel.addEventListener("click", closeModal);

if (modalSubmit) {
  modalSubmit.addEventListener("click", async () => {
    const text = modalTokensInput ? modalTokensInput.value.trim() : "";
    if (!text) {
      alert("Please enter at least one Discord token.");
      return;
    }

    modalSubmit.disabled = true;
    modalSubmit.textContent = "ENQUEUEING...";

    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokens: text }),
      });

      const data = await res.json();
      if (data.ok) {
        closeModal();
        pollStatus();
      } else {
        alert("Error: " + (data.error || "Failed to add tokens"));
      }
    } catch (err) {
      alert("Request failed: " + err.message);
    } finally {
      modalSubmit.disabled = false;
      modalSubmit.textContent = "ENQUEUE TOKENS";
    }
  });
}

// Initialize on page load
initSlotGrid();
connectSSE();
setInterval(pollStatus, 3000);
