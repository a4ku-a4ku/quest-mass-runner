/**
 * A4KU Concurrency Pool Manager
 * Manages up to 10 concurrent active accounts, automatically promoting waiting tokens.
 */

const fs = require("fs");
const path = require("path");
const { QuestWorker } = require("./quest-worker");

function sanitizeToken(raw) {
  if (!raw || typeof raw !== "string") return "";
  let clean = raw.trim();
  if (
    (clean.startsWith('"') && clean.endsWith('"')) ||
    (clean.startsWith("'") && clean.endsWith("'")) ||
    (clean.startsWith("`") && clean.endsWith("`"))
  ) {
    clean = clean.slice(1, -1).trim();
  }
  clean = clean.replace(/^(authorization|token):\s*/i, "").trim();
  return clean;
}

class PoolManager {
  constructor(config = {}) {
    this.maxConcurrent = Number(config.maxConcurrentAccounts || 12);
    this.tokensFilePath = path.resolve(process.cwd(), config.tokensFilePath || "tokens.txt");
    this.completedTokensFilePath = path.resolve(process.cwd(), "completed_tokens.txt");
    this.config = config;

    // Concurrency slots: Array of length maxConcurrent (0 to 11)
    this.slots = new Array(this.maxConcurrent).fill(null);

    // Queues and records
    this.waitingQueue = []; // Array of { token, addedAt }
    this.completedAccounts = []; // Array of finished account summaries
    this.failedAccounts = []; // Array of failed account summaries
    this.seenTokens = new Set(); // Prevent duplicate runs in the same session
    this.activeCooldowns = new Map(); // questId -> { questId, questName, retryAfterSec, expiresAt, recordedAt }

    // Logs buffer (last 200 events for live dashboard)
    this.logs = [];
    this.maxLogs = 200;

    // SSE Subscribers
    this.subscribers = new Set();

    // Auto-reload file watcher
    this.fileWatchTimer = null;
  }

  log(slotId, userTag, message, type = "info") {
    const event = {
      id: Date.now() + Math.random().toString(36).substring(2, 6),
      slotId: slotId !== null ? slotId + 1 : "SYSTEM",
      userTag: userTag || "[System]",
      message,
      type,
      timestamp: new Date().toLocaleTimeString(),
    };

    this.logs.push(event);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    console.log(`[${event.timestamp}][Slot ${event.slotId}] ${event.userTag}: ${event.message}`);
    this.broadcast({ type: "log", data: event });
  }

  broadcast(message) {
    const payload = `data: ${JSON.stringify(message)}\n\n`;
    for (const res of this.subscribers) {
      try {
        res.write(payload);
      } catch (e) {
        this.subscribers.delete(res);
      }
    }
  }

  addSubscriber(res) {
    this.subscribers.add(res);
    res.on("close", () => this.subscribers.delete(res));

    // Send initial snapshot
    res.write(`data: ${JSON.stringify({ type: "snapshot", data: this.getStatus() })}\n\n`);
  }

  init() {
    this.log(null, "A4KU-Pool", `Initializing ${this.maxConcurrent}-Slot Concurrency Pool (Max concurrent: ${this.maxConcurrent})`, "ok");
    this.loadTokensFromFile();

    if (this.config.autoReloadTokens) {
      const intervalSec = this.config.reloadIntervalSeconds || 10;
      this.fileWatchTimer = setInterval(() => {
        this.loadTokensFromFile();
      }, intervalSec * 1000);
    }
  }

  loadTokensFromFile() {
    if (!fs.existsSync(this.tokensFilePath)) {
      try {
        fs.writeFileSync(this.tokensFilePath, "# Paste Discord tokens here (1 per line)\n", "utf8");
      } catch (e) {}
      return;
    }

    try {
      const content = fs.readFileSync(this.tokensFilePath, "utf8");
      const lines = content.split(/\r?\n/);
      const newTokens = [];

      for (let line of lines) {
        const clean = sanitizeToken(line);
        if (!clean || clean.startsWith("#")) continue;
        if (!this.seenTokens.has(clean)) {
          newTokens.push(clean);
        }
      }

      if (newTokens.length > 0) {
        this.log(null, "A4KU-Pool", `Detected ${newTokens.length} new tokens in ${path.basename(this.tokensFilePath)}!`, "ok");
        this.enqueueTokens(newTokens);
      }
    } catch (err) {
      this.log(null, "A4KU-Pool", `Error reading tokens file: ${err.message}`, "error");
    }
  }

  enqueueTokens(tokens, options = {}) {
    const isDirect = Boolean(options.direct);
    let addedCount = 0;
    const busyAccounts = [];

    for (const t of tokens) {
      const clean = sanitizeToken(t);
      if (!clean || clean.startsWith("#")) continue;

      const activeWorker = this.slots.find((w) => w && w.token === clean);
      const isWaiting = this.waitingQueue.some((item) => item.token === clean);

      if (activeWorker) {
        busyAccounts.push({ token: clean, reason: `already running in Slot ${activeWorker.slotId + 1}` });
        continue;
      }
      if (isWaiting) {
        busyAccounts.push({ token: clean, reason: "already waiting in queue" });
        continue;
      }

      // For auto-reload from file, don't re-enqueue finished tokens in the same session.
      // But if user directly clicks submit on the dashboard, always allow them to re-run!
      if (!isDirect && this.seenTokens.has(clean)) {
        continue;
      }

      this.seenTokens.add(clean);
      this.waitingQueue.push({
        token: clean,
        addedAt: Date.now(),
      });
      addedCount++;
    }

    if (addedCount > 0) {
      this.log(null, "A4KU-Pool", `Enqueued ${addedCount} tokens. Queue length: ${this.waitingQueue.length}`, "info");
      this.pumpQueue();
    }

    return { addedCount, busyAccounts };
  }

  pumpQueue() {
    let launched = 0;
    // Find free slots and launch waiting tokens with polite stagger
    for (let slotIndex = 0; slotIndex < this.maxConcurrent; slotIndex++) {
      if (this.slots[slotIndex] === null && this.waitingQueue.length > 0) {
        const item = this.waitingQueue.shift();
        const delay = launched * 1200; // 1.2s stagger per worker to prevent IP burst rate limits
        launched++;
        setTimeout(() => {
          this.launchWorker(slotIndex, item.token);
        }, delay);
      }
    }

    this.broadcast({ type: "status_update", data: this.getStatus() });
  }

  launchWorker(slotIndex, token) {
    this.log(slotIndex, `Account`, `Slot ${slotIndex + 1} allocated. Starting worker...`, "info");

    const worker = new QuestWorker(slotIndex, token, {
      heartbeatIntervalSec: this.config.heartbeatIntervalSeconds || 20,
      videoStepSec: this.config.videoStepSeconds || 15,

      onProgress: (state) => {
        this.broadcast({
          type: "slot_update",
          data: { slotId: slotIndex, state },
        });
      },

      onLog: (logEvent) => {
        this.log(slotIndex, logEvent.userTag, logEvent.message, logEvent.type);
      },

      onCooldown: (cdInfo) => {
        this.recordCooldown(cdInfo);
      },

      onComplete: (state) => {
        this.handleWorkerFinished(slotIndex, worker, "completed", state);
      },

      onError: (state) => {
        this.handleWorkerFinished(slotIndex, worker, "failed", state);
      },
    });

    this.slots[slotIndex] = worker;
    worker.start();
  }

  handleWorkerFinished(slotIndex, worker, outcome, state) {
    const summary = {
      slotId: slotIndex + 1,
      user: worker.user,
      tokenMasked: worker.token.slice(0, 10) + "..." + worker.token.slice(-5),
      outcome,
      totalQuests: worker.totalQuests,
      completedCount: worker.completedCount,
      durationSec: Math.floor((Date.now() - worker.startTime) / 1000),
      finishedAt: new Date().toISOString(),
      error: worker.error,
      tokenRaw: worker.token,
    };

    if (outcome === "completed") {
      this.completedAccounts.unshift(summary);
      if (this.completedAccounts.length > 200) {
        this.completedAccounts.pop();
      }

      // Automatically append to completed_tokens.txt
      try {
        const uTag = worker.user ? `@${worker.user.username}` : `Slot ${slotIndex + 1}`;
        const logLine = `${worker.token} # ${uTag} - ${worker.completedCount}/${worker.totalQuests} quests completed at ${new Date().toLocaleString()}\n`;
        fs.appendFileSync(this.completedTokensFilePath, logLine, "utf8");
      } catch (err) {
        console.error("Failed to append to completed_tokens.txt:", err.message);
      }

      this.log(slotIndex, worker.user ? `@${worker.user.username}` : "Account", `🎉 Completed all available quests! Slot ${slotIndex + 1} is now FREE.`, "ok");

      // Dispatch Discord Webhook
      this.sendDiscordWebhook(
        "🎉 Account Quests 100% Completed",
        `Account **${worker.user ? worker.user.username : `Slot #${slotIndex + 1}`}** finished all eligible quests!`,
        [
          { name: "User", value: worker.user ? `${worker.user.global_name || worker.user.username} (@${worker.user.username})` : "Account", inline: true },
          { name: "Slot", value: `#${slotIndex + 1}`, inline: true },
          { name: "Quests", value: `${worker.completedCount} / ${worker.totalQuests}`, inline: true },
          { name: "Duration", value: `${summary.durationSec}s`, inline: true },
        ],
        0xffffff
      );
    } else {
      this.failedAccounts.unshift(summary);
      if (this.failedAccounts.length > 200) {
        this.failedAccounts.pop();
      }
      this.log(slotIndex, worker.user ? `@${worker.user.username}` : "Account", `⚠️ Account finished with status: ${outcome}. Slot ${slotIndex + 1} is now FREE.`, "warn");

      // Dispatch Discord Webhook
      this.sendDiscordWebhook(
        "⚠️ Account Worker Warning",
        `Slot **#${slotIndex + 1}** encountered an issue.`,
        [
          { name: "User", value: worker.user ? `@${worker.user.username}` : "Unauthenticated", inline: true },
          { name: "Slot", value: `#${slotIndex + 1}`, inline: true },
          { name: "Error", value: String(worker.error || outcome), inline: false },
        ],
        0xa1a1aa
      );
    }

    // Free the slot
    this.slots[slotIndex] = null;
    if (worker && worker.token) {
      this.seenTokens.delete(worker.token);
    }

    // Immediately trigger next waiting account from the queue!
    this.pumpQueue();
  }

  getStatus() {
    const activeSlots = this.slots.map((worker, index) => {
      if (!worker) {
        return {
          slotId: index,
          isBusy: false,
          state: null,
        };
      }
      return {
        slotId: index,
        isBusy: true,
        state: worker.getPublicState(),
      };
    });

    const activeCount = activeSlots.filter((s) => s.isBusy).length;

    return {
      maxSlots: this.maxConcurrent,
      activeCount,
      waitingQueueCount: this.waitingQueue.length,
      completedCount: this.completedAccounts.length,
      failedCount: this.failedAccounts.length,
      totalLoaded: this.seenTokens.size,
      slots: activeSlots,
      recentCompleted: this.completedAccounts.slice(0, 10),
      recentLogs: this.logs.slice(-50),
    };
  }

  restartAll() {
    this.log(null, "A4KU-Pool", "🔄 Re-queueing all 44 accounts to complete all remaining quests!", "ok");
    this.seenTokens.clear();
    this.completedAccounts = [];
    this.failedAccounts = [];
    this.waitingQueue = [];
    this.loadTokensFromFile();
    return this.getStatus();
  }

  clearAll() {
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i]) {
        try {
          this.slots[i].stop();
        } catch (e) {}
        this.slots[i] = null;
      }
    }
    this.seenTokens.clear();
    this.completedAccounts = [];
    this.failedAccounts = [];
    this.waitingQueue = [];
    this.logs = [];

    // Ensure tokens.txt is clean
    try {
      fs.writeFileSync(
        this.tokensFilePath,
        "# ====================================================================\n# A4KU // Mass Discord Quest Runner - Clean Token List\n# Paste user Discord tokens here (1 per line) or use the website dashboard!\n# ====================================================================\n",
        "utf8"
      );
    } catch (e) {}

    this.log(null, "A4KU-Pool", "✨ Clean Session Initialized: Ready for user tokens!", "ok");
    const status = this.getStatus();
    this.broadcast({ type: "snapshot", data: status });
    return status;
  }

  getCompletedTokens(format = "text") {
    const tokensMap = new Map();

    // 1. Read from completed_tokens.txt if exists
    if (fs.existsSync(this.completedTokensFilePath)) {
      try {
        const fileContent = fs.readFileSync(this.completedTokensFilePath, "utf8");
        for (const line of fileContent.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const [tokenOnly, note] = trimmed.split("#");
          const cleanToken = (tokenOnly || "").trim();
          if (cleanToken) {
            tokensMap.set(cleanToken, {
              token: cleanToken,
              info: (note || "").trim(),
            });
          }
        }
      } catch (e) {}
    }

    // 2. Include all in-memory completed accounts
    for (const acc of this.completedAccounts) {
      if (acc.tokenRaw) {
        tokensMap.set(acc.tokenRaw, {
          token: acc.tokenRaw,
          user: acc.user ? `@${acc.user.username}` : "Account",
          completedCount: acc.completedCount,
          totalQuests: acc.totalQuests,
          finishedAt: acc.finishedAt,
        });
      }
    }

    const items = Array.from(tokensMap.values());

    if (format === "json") {
      return items;
    }

    // Return clean plain-text list (1 token per line)
    return items.map((x) => x.token).join("\n");
  }

  stopSlot(slotIndex) {
    const idx = Number(slotIndex);
    if (idx < 0 || idx >= this.slots.length) return false;
    const worker = this.slots[idx];
    if (!worker) return false;

    this.log(idx, worker.user ? `@${worker.user.username}` : "Account", `🛑 Admin manually terminated slot ${idx + 1}.`, "warn");
    try {
      worker.stop();
    } catch (e) {}

    // Free the slot and trigger the next account in queue
    this.handleWorkerFinished(idx, worker, "stopped", worker.getPublicState());
    return true;
  }

  removeFromQueue(index) {
    const idx = Number(index);
    if (idx < 0 || idx >= this.waitingQueue.length) return false;
    const removed = this.waitingQueue.splice(idx, 1)[0];
    this.log(null, "Admin", `Removed token #${idx + 1} from waiting queue.`, "info");
    this.broadcast({ type: "status_update", data: this.getStatus() });
    return removed;
  }

  clearWaitingQueue() {
    const count = this.waitingQueue.length;
    this.waitingQueue = [];
    this.log(null, "Admin", `Cleared all ${count} tokens from waiting queue.`, "warn");
    this.broadcast({ type: "status_update", data: this.getStatus() });
    return count;
  }

  recordCooldown(cdInfo) {
    if (!cdInfo || !cdInfo.questId) return;
    this.activeCooldowns.set(cdInfo.questId, {
      questId: cdInfo.questId,
      questName: cdInfo.questName || `Quest#${cdInfo.questId}`,
      retryAfterSec: cdInfo.retryAfterSec || 0,
      expiresAt: cdInfo.expiresAt || Date.now() + (cdInfo.retryAfterSec || 0) * 1000,
      recordedAt: Date.now(),
    });
    this.broadcast({ type: "cooldown_update", data: this.getActiveCooldowns() });
  }

  getActiveCooldowns() {
    const now = Date.now();
    const list = [];
    for (const [qid, item] of this.activeCooldowns.entries()) {
      const remainingSec = Math.max(0, Math.ceil((item.expiresAt - now) / 1000));
      if (now - item.expiresAt < 180000) {
        list.push({
          ...item,
          remainingSec,
          isExpired: remainingSec === 0,
        });
      } else {
        this.activeCooldowns.delete(qid);
      }
    }
    return list;
  }

  skipQuestInSlot(slotIndex) {
    const idx = Number(slotIndex);
    if (idx < 0 || idx >= this.slots.length) return false;
    const worker = this.slots[idx];
    if (!worker) return false;
    const skipped = worker.skipCurrentQuest();
    this.log(idx, worker.user ? `@${worker.user.username}` : "Account", `⏭️ Admin requested skip for current quest in Slot ${idx + 1}.`, "warn");
    return skipped;
  }

  togglePauseSlot(slotIndex) {
    const idx = Number(slotIndex);
    if (idx < 0 || idx >= this.slots.length) return null;
    const worker = this.slots[idx];
    if (!worker) return null;
    const isPaused = worker.togglePause();
    this.log(idx, worker.user ? `@${worker.user.username}` : "Account", isPaused ? `⏸️ Admin PAUSED Slot ${idx + 1}.` : `▶️ Admin RESUMED Slot ${idx + 1}.`, "info");
    this.broadcast({ type: "slot_update", data: { slotId: idx, state: worker.getPublicState() } });
    return isPaused;
  }

  setConcurrency(newMax) {
    const max = Math.max(1, Math.min(24, Number(newMax) || 12));
    const oldMax = this.maxConcurrent;
    if (max === oldMax) return max;

    this.maxConcurrent = max;
    this.config.maxConcurrentAccounts = max;

    if (max > oldMax) {
      for (let i = oldMax; i < max; i++) {
        this.slots.push(null);
      }
    } else {
      for (let i = max; i < oldMax; i++) {
        const w = this.slots[i];
        if (w) {
          try {
            w.stop();
          } catch (e) {}
          if (w.token) {
            this.waitingQueue.unshift({ token: w.token, addedAt: Date.now() });
          }
        }
      }
      this.slots = this.slots.slice(0, max);
    }

    this.saveConfigFile();
    this.log(null, "A4KU-Pool", `Engine concurrency dynamically adjusted to ${max} slots (was ${oldMax}).`, "ok");
    this.pumpQueue();
    this.broadcast({ type: "status_update", data: this.getStatus() });
    return max;
  }

  setTuning(options = {}) {
    if (options.maxConcurrent) {
      this.setConcurrency(options.maxConcurrent);
    }
    if (options.heartbeatIntervalSeconds) {
      this.config.heartbeatIntervalSeconds = Math.max(5, Math.min(60, Number(options.heartbeatIntervalSeconds)));
    }
    if (options.videoStepSeconds) {
      this.config.videoStepSeconds = Math.max(5, Math.min(30, Number(options.videoStepSeconds)));
    }
    this.saveConfigFile();
    this.log(
      null,
      "Admin",
      `Engine tuning saved: Heartbeat=${this.config.heartbeatIntervalSeconds}s, VideoStep=${this.config.videoStepSeconds}s, Slots=${this.maxConcurrent}`,
      "ok"
    );
    return {
      maxConcurrent: this.maxConcurrent,
      heartbeatIntervalSeconds: this.config.heartbeatIntervalSeconds,
      videoStepSeconds: this.config.videoStepSeconds,
    };
  }

  retryFailedAccounts(tokenFilter = null) {
    const toRetry = [];
    if (tokenFilter) {
      const idx = this.failedAccounts.findIndex(
        (a) => (a.tokenRaw && a.tokenRaw === tokenFilter) || a.tokenMasked === tokenFilter
      );
      if (idx !== -1) {
        toRetry.push(this.failedAccounts.splice(idx, 1)[0]);
      }
    } else {
      while (this.failedAccounts.length > 0) {
        toRetry.push(this.failedAccounts.pop());
      }
    }

    let enqueued = 0;
    for (const item of toRetry) {
      const token = item.tokenRaw || item.token;
      if (token) {
        this.seenTokens.delete(token);
        this.enqueueTokens([token], { direct: true });
        enqueued++;
      }
    }
    this.log(null, "Admin", `Re-queued ${enqueued} failed account(s) into waiting queue!`, "ok");
    this.broadcast({ type: "status_update", data: this.getStatus() });
    return enqueued;
  }

  clearFailedAccounts() {
    const count = this.failedAccounts.length;
    this.failedAccounts = [];
    this.log(null, "Admin", `Cleared all ${count} failed accounts records.`, "info");
    this.broadcast({ type: "status_update", data: this.getStatus() });
    return count;
  }

  saveConfigFile() {
    try {
      const configPath = path.resolve(process.cwd(), "config.json");
      fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2), "utf8");
    } catch (err) {
      console.error("Failed to save config.json:", err.message);
    }
  }

  async sendDiscordWebhook(title, description, fields = [], color = 0xffffff) {
    const url = this.config.webhookUrl;
    if (!url || typeof url !== "string" || !url.startsWith("https://discord.com/api/webhooks/")) {
      return { ok: false, error: "No webhook configured" };
    }
    return this.postWebhookPayload(url, {
      username: "A4KU Central Dispatcher",
      embeds: [
        {
          title,
          description,
          color,
          fields,
          footer: { text: "A4KU Mass Discord Quest Engine • Central Ops" },
          timestamp: new Date().toISOString(),
        },
      ],
    });
  }

  async testDiscordWebhook(url) {
    const targetUrl = url || this.config.webhookUrl;
    if (!targetUrl || !targetUrl.startsWith("https://discord.com/api/webhooks/")) {
      return { ok: false, error: "Invalid Discord Webhook URL. Must start with https://discord.com/api/webhooks/" };
    }
    return this.postWebhookPayload(targetUrl, {
      username: "A4KU Central Dispatcher",
      embeds: [
        {
          title: "🔔 A4KU Webhook Test Ping",
          description: "Discord webhook integration successfully configured for A4KU Mass Discord Quest Runner!",
          color: 0xffffff,
          fields: [
            { name: "Engine Version", value: "A4KU 2.0 (High Concurrency)", inline: true },
            { name: "Max Slots", value: `${this.maxConcurrent}`, inline: true },
            { name: "Status", value: "ONLINE & HEALTHY", inline: true },
          ],
          footer: { text: "A4KU Mass Discord Quest Engine" },
          timestamp: new Date().toISOString(),
        },
      ],
    });
  }

  async postWebhookPayload(url, payload) {
    try {
      const https = require("https");
      return new Promise((resolve) => {
        const u = new URL(url);
        const data = JSON.stringify(payload);
        const req = https.request(
          {
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(data),
            },
          },
          (res) => {
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode });
          }
        );
        req.on("error", (e) => resolve({ ok: false, error: e.message }));
        req.write(data);
        req.end();
      });
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  getAdminStatus() {
    const baseStatus = this.getStatus();
    const mem = process.memoryUsage();

    const adminSlots = this.slots.map((worker, index) => {
      if (!worker) {
        return {
          slotId: index,
          isBusy: false,
          state: null,
          tokenMasked: null,
          hasToken: false,
        };
      }
      const rawToken = worker.token || "";
      return {
        slotId: index,
        isBusy: true,
        state: worker.getPublicState(),
        tokenMasked: rawToken ? `${rawToken.slice(0, 10)}...${rawToken.slice(-5)}` : null,
        hasToken: Boolean(rawToken),
      };
    });

    return {
      ...baseStatus,
      maxSlots: this.maxConcurrent,
      slots: adminSlots,
      activeCooldowns: this.getActiveCooldowns(),
      config: {
        maxConcurrent: this.maxConcurrent,
        heartbeatIntervalSeconds: this.config.heartbeatIntervalSeconds || 20,
        videoStepSeconds: this.config.videoStepSeconds || 15,
        webhookUrl: this.config.webhookUrl || "",
        adminUser: this.config.adminUser || "a4ku",
      },
      waitingQueue: this.waitingQueue.map((item, idx) => ({
        index: idx,
        tokenMasked: item.token ? `${item.token.slice(0, 10)}...${item.token.slice(-5)}` : "Masked",
        addedAt: item.addedAt,
      })),
      completedAccounts: this.completedAccounts.map((a) => ({
        ...a,
        tokenRaw: undefined, // Never expose raw token in general state
      })),
      failedAccounts: this.failedAccounts.map((a) => ({
        ...a,
        tokenRaw: undefined, // Never expose raw token in general state
      })),
      telemetry: {
        uptimeSeconds: Math.floor(process.uptime()),
        memoryRssMb: Math.round(mem.rss / 1024 / 1024),
        memoryHeapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        memoryHeapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
        subscribersCount: this.subscribers.size,
        nodeVersion: process.version,
      },
    };
  }

  getSlotToken(slotIndex) {
    const idx = Number(slotIndex);
    if (idx < 0 || idx >= this.slots.length) return null;
    const worker = this.slots[idx];
    return worker ? worker.token : null;
  }

  getQueueToken(index) {
    const idx = Number(index);
    if (idx < 0 || idx >= this.waitingQueue.length) return null;
    return this.waitingQueue[idx] ? this.waitingQueue[idx].token : null;
  }

  stopAll() {
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i]) {
        this.slots[i].stop();
        this.slots[i] = null;
      }
    }
    this.waitingQueue = [];
    if (this.fileWatchTimer) clearInterval(this.fileWatchTimer);
  }
}

module.exports = {
  PoolManager,
};
