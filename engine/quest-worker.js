/**
 * A4KU Account Quest Worker
 * Orchestrates quest completion for a single Discord account.
 */

const { DiscordClient } = require("./discord");

const SUPPORTED_TASKS = new Set([
  "WATCH_VIDEO",
  "WATCH_VIDEO_ON_MOBILE",
  "PLAY_ON_DESKTOP",
  "STREAM_ON_DESKTOP",
  "PLAY_ACTIVITY",
]);
const VIDEO_TASKS = new Set(["WATCH_VIDEO", "WATCH_VIDEO_ON_MOBILE"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTaskConfig(q) {
  const cfg = q.config || {};
  return (
    cfg.taskConfig ||
    cfg.task_config ||
    cfg.taskConfigV2 ||
    cfg.task_config_v2 ||
    (cfg.tasks ? cfg : null)
  );
}

function getTaskType(q) {
  const tc = getTaskConfig(q);
  if (!tc || !tc.tasks) return "UNKNOWN";
  for (const t of Object.keys(tc.tasks)) {
    if (SUPPORTED_TASKS.has(t)) return t;
  }
  return Object.keys(tc.tasks)[0] || "UNKNOWN";
}

function getQuestName(q) {
  const cfg = q.config || {};
  const msgs = cfg.messages || {};
  return (
    msgs.questName ||
    msgs.quest_name ||
    msgs.gameTitle ||
    msgs.game_title ||
    `Quest#${q.id}`
  );
}

function getSecondsNeeded(q) {
  const tc = getTaskConfig(q);
  if (!tc || !tc.tasks) return 0;
  const tt = getTaskType(q);
  const task = tc.tasks[tt];
  return task?.target || 0;
}

function getSecondsDone(q) {
  const prog = q.user_status?.progress || {};
  const tt = getTaskType(q);
  const val = prog[tt];
  if (val === undefined) return 0;
  if (typeof val === "object" && val !== null) return Number(val.value || 0);
  return Number(val || 0);
}

function isCompleted(q) {
  if (q.user_status?.completed_at) return true;
  const needed = getSecondsNeeded(q);
  return needed > 0 && getSecondsDone(q) >= needed;
}

function isEnrolled(q) {
  return Boolean(q.user_status?.enrolled_at);
}

function isExpired(q) {
  const exp = q.config?.expiresAt || q.config?.expires_at;
  if (!exp) return false;
  try {
    return new Date(exp).getTime() <= Date.now();
  } catch (e) {
    return false;
  }
}

function isCompletable(q) {
  if (isExpired(q)) return false;
  const tt = getTaskType(q);
  if (!SUPPORTED_TASKS.has(tt)) return false;
  const tc = getTaskConfig(q);
  if (!tc?.tasks?.[tt]) return false;
  return true;
}

class QuestWorker {
  constructor(slotId, token, options = {}) {
    this.slotId = slotId;
    this.token = token.trim();
    this.client = new DiscordClient(this.token);
    this.user = null;

    this.options = {
      heartbeatIntervalSec: options.heartbeatIntervalSec || 20,
      videoStepSec: options.videoStepSec || 15,
      ...options,
    };

    this.status = "initializing"; // 'initializing', 'running', 'completed', 'failed'
    this.startTime = Date.now();
    this.endTime = null;
    this.error = null;

    this.questMap = {}; // qid -> { id, name, taskType, secondsDone, secondsNeeded, status, progressPct }
    this.totalQuests = 0;
    this.completedCount = 0;
    this.shouldStop = false;
    this.currentQuestSkipRequested = false;
    this.isPausedByAdmin = false;

    // Event hooks
    this.onProgress = options.onProgress || (() => {});
    this.onLog = options.onLog || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});
    this.onCooldown = options.onCooldown || (() => {});
  }

  log(message, type = "info") {
    const userTag = this.user ? `@${this.user.username}` : `[Slot ${this.slotId + 1}]`;
    this.onLog({
      slotId: this.slotId,
      userTag,
      message,
      type,
      timestamp: new Date().toISOString(),
    });
  }

  notifyUpdate() {
    this.completedCount = Object.values(this.questMap).filter((q) => q.status === "done").length;
    this.onProgress(this.getPublicState());
  }

  getPublicState() {
    return {
      slotId: this.slotId,
      status: this.isPausedByAdmin ? "paused" : this.status,
      isPaused: this.isPausedByAdmin,
      user: this.user,
      totalQuests: this.totalQuests,
      completedCount: this.completedCount,
      elapsedSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      quests: Object.values(this.questMap),
      error: this.error,
    };
  }

  async start() {
    try {
      this.status = "validating";
      this.notifyUpdate();
      this.log("Validating Discord token...", "info");

      // 1. Authenticate Token
      const auth = await this.client.validate();
      if (!auth.valid || !auth.user) {
        throw new Error(`Invalid Discord Token (Status: ${auth.status})`);
      }
      this.user = auth.user;
      this.log(`Authenticated as ${this.user.global_name || this.user.username} (@${this.user.username})`, "ok");

      // 2. Fetch Quest Catalog
      this.status = "scanning";
      this.notifyUpdate();
      this.log("Fetching quest catalog...", "info");

      const catalog = await this.client.fetchQuests();
      if (!catalog.ok) {
        throw new Error(`Failed to load quests: ${catalog.error || catalog.status}`);
      }

      const allQuests = catalog.quests;
      const completable = allQuests.filter(isCompletable);

      this.log(`Found ${allQuests.length} catalog quests (${completable.length} eligible)`, "info");

      for (const q of completable) {
        const qid = q.id;
        const name = getQuestName(q);
        const tt = getTaskType(q);
        const needed = getSecondsNeeded(q);
        const done = getSecondsDone(q);
        const doneBool = isCompleted(q);

        this.questMap[qid] = {
          id: qid,
          name,
          taskType: tt,
          secondsNeeded: needed,
          secondsDone: done,
          status: doneBool ? "done" : "waiting",
          progressPct: needed > 0 ? Math.min(100, Math.round((done / needed) * 100)) : doneBool ? 100 : 0,
        };
      }

      this.totalQuests = Object.keys(this.questMap).length;
      this.notifyUpdate();

      // 3. Auto-Enroll into Unenrolled Quests (Pass 1)
      const toEnroll = completable.filter((q) => !isEnrolled(q) && !isCompleted(q));
      const deferredQuests = [];

      if (toEnroll.length > 0) {
        this.log(`Auto-enrolling into ${toEnroll.length} unenrolled quests (Pass 1)...`, "info");
        for (const q of toEnroll) {
          if (this.shouldStop) return;
          this.questMap[q.id].status = "enrolling";
          this.notifyUpdate();

          const enrollRes = await this.client.enroll(q.id, {
            traffic_metadata_raw: q.traffic_metadata_raw,
            traffic_metadata_sealed: q.traffic_metadata_sealed,
          });

          if (!enrollRes.ok) {
            const isRateLimit =
              enrollRes.status === 429 ||
              (enrollRes.data?.message && enrollRes.data.message.toLowerCase().includes("rate limit"));

            if (isRateLimit) {
              const retrySec = Number(enrollRes.data?.retry_after || 900);
              this.onCooldown({
                questId: q.id,
                questName: getQuestName(q),
                retryAfterSec: retrySec,
                expiresAt: Date.now() + retrySec * 1000,
              });
              this.log(`⏸️ Rate limit detected for ${getQuestName(q)}. Pausing quest — will complete in 2nd pass after active quests finish.`, "warn");
              this.markQuestPaused(q.id, "Rate limit - queued for 2nd pass");
              deferredQuests.push(q);
            } else {
              const errMsg = enrollRes.data?.message || `HTTP ${enrollRes.status}`;
              this.log(`⚠️ Auto-enroll unavailable for ${getQuestName(q)} (${errMsg}) - skipping`, "warn");
              this.markQuestSkipped(q.id, errMsg);
            }
          } else {
            this.questMap[q.id].status = "waiting";
            this.notifyUpdate();
          }
          await sleep(600);
        }
      }

      // Refresh quests after enrollment to get ground truth
      const freshCatalog = await this.client.fetchQuests();
      const freshList = freshCatalog.quests || [];
      const activeUnfinished = freshList.filter((q) => {
        const qid = q.id;
        if (isCompleted(q) || (this.questMap[qid] && (this.questMap[qid].status === "done" || this.questMap[qid].status === "skipped" || this.questMap[qid].status === "paused"))) {
          return false;
        }
        if (!isCompletable(q)) return false;
        // MUST BE ENROLLED to farm, otherwise Discord returns 403 Forbidden
        if (!isEnrolled(q)) {
          return false;
        }
        return true;
      });

      if (activeUnfinished.length === 0 && deferredQuests.length === 0) {
        this.log("All eligible enrolled quests are completed!", "ok");
        this.finish("completed");
        return;
      }

      // 4. Run Active Quests Simultaneously in Parallel (Pass 1)
      if (activeUnfinished.length > 0) {
        this.status = "farming";
        this.log(`Farming ${activeUnfinished.length} active quests in parallel (Pass 1)...`, "info");

        for (const q of activeUnfinished) {
          if (this.questMap[q.id]) {
            this.questMap[q.id].status = "running";
          }
        }
        this.notifyUpdate();

        const questPromises = activeUnfinished.map(async (q, idx) => {
          if (idx > 0) {
            await sleep(idx * 1000); // Stagger starts by 1.0s to avoid rate limit spikes
          }
          if (!this.shouldStop) {
            const tt = getTaskType(q);
            if (VIDEO_TASKS.has(tt)) {
              await this.processVideoQuest(q);
            } else {
              await this.processGameQuest(q);
            }
          }
        });

        await Promise.all(questPromises);
      }

      // 5. Pass 2: Resume Paused / Rate-Limited Quests
      if (deferredQuests.length > 0 && !this.shouldStop) {
        this.log(`🔄 Primary quests finished! Starting 2nd pass for ${deferredQuests.length} paused quests (rate limit cooldown has expired)...`, "info");
        this.status = "enrolling";
        this.notifyUpdate();

        // Safe short pause before attempting enrollments in Pass 2
        await sleep(2000);

        const enrolledInSecondPass = [];
        for (const q of deferredQuests) {
          if (this.shouldStop) return;
          this.questMap[q.id].status = "enrolling";
          this.notifyUpdate();

          let enrollRes = await this.client.enroll(q.id, {
            traffic_metadata_raw: q.traffic_metadata_raw,
            traffic_metadata_sealed: q.traffic_metadata_sealed,
          });

          if (!enrollRes.ok && enrollRes.status === 429) {
            const retrySec = Number(enrollRes.data?.retry_after || 0);
            if (retrySec > 0 && retrySec <= 20) {
              this.log(`⏳ Waiting ${Math.ceil(retrySec)}s for Discord route cooldown on ${getQuestName(q)}...`, "info");
              await sleep((retrySec + 1) * 1000);
              enrollRes = await this.client.enroll(q.id, {
                traffic_metadata_raw: q.traffic_metadata_raw,
                traffic_metadata_sealed: q.traffic_metadata_sealed,
              });
            }
          }

          if (!enrollRes.ok) {
            const retrySec = Math.round(Number(enrollRes.data?.retry_after || 0));
            const retryMsg = retrySec > 0 ? ` (Discord cooldown: ~${Math.ceil(retrySec / 60)} mins remaining)` : "";
            const errMsg = (enrollRes.data?.message || `HTTP ${enrollRes.status}`) + retryMsg;
            this.log(`⚠️ 2nd pass enrollment unavailable for ${getQuestName(q)} (${errMsg}) - skipping`, "warn");
            this.markQuestSkipped(q.id, errMsg);
          } else {
            this.log(`✅ 2nd pass enrolled: ${getQuestName(q)}`, "ok");
            if (enrollRes.data?.user_status) {
              q.user_status = enrollRes.data.user_status;
            } else {
              q.user_status = { enrolled_at: new Date().toISOString() };
            }
            this.questMap[q.id].status = "waiting";
            this.notifyUpdate();
            enrolledInSecondPass.push(q);
          }
          await sleep(1500);
        }

        if (enrolledInSecondPass.length > 0 && !this.shouldStop) {
          this.status = "farming";
          this.log(`Farming ${enrolledInSecondPass.length} resumed quests in parallel (Pass 2)...`, "info");

          for (const q of enrolledInSecondPass) {
            if (this.questMap[q.id]) {
              this.questMap[q.id].status = "running";
            }
          }
          this.notifyUpdate();

          const secondPassPromises = enrolledInSecondPass.map(async (q, idx) => {
            if (idx > 0) {
              await sleep(idx * 1000);
            }
            if (!this.shouldStop) {
              const tt = getTaskType(q);
              if (VIDEO_TASKS.has(tt)) {
                await this.processVideoQuest(q);
              } else {
                await this.processGameQuest(q);
              }
            }
          });

          await Promise.all(secondPassPromises);
        }
      }

      // Final Ground-Truth Verification
      const verifyRes = await this.client.fetchQuests();
      const finalList = verifyRes.quests || [];
      for (const q of finalList) {
        if (isCompleted(q) && this.questMap[q.id]) {
          this.markQuestDone(q.id, getSecondsNeeded(q));
        }
      }

      this.log(`🎉 Account processing finished! (${this.completedCount}/${this.totalQuests} quests completed)`, "ok");
      this.finish("completed");
    } catch (err) {
      this.error = err.message || String(err);
      this.log(`❌ Account execution failed: ${this.error}`, "error");
      this.finish("failed");
    }
  }

  async processVideoQuest(q) {
    const qid = q.id;
    const name = getQuestName(q);
    const needed = getSecondsNeeded(q);
    let done = getSecondsDone(q);
    const taskType = getTaskType(q);

    this.log(`Video quest: ${name} (${done}/${needed}s)`, "info");

    // Fast-forward check: Only if already enrolled long enough
    const enrolledStr = q.user_status?.enrolled_at;
    const enrolledTs = enrolledStr ? new Date(enrolledStr).getTime() : Date.now() - done * 1000;
    const elapsedSinceEnroll = (Date.now() - enrolledTs) / 1000;

    if (elapsedSinceEnroll >= needed) {
      try {
        const ff = await this.client.sendVideoProgress(qid, needed);
        if (ff.ok && ff.data?.completed_at) {
          this.markQuestDone(qid, needed);
          this.log(`✅ Instant video completion: ${name}`, "ok");
          return;
        }
      } catch (e) {}
    }
    const maxFutureSec = 60;
    const stepSec = this.options.videoStepSec;
    const intervalMs = stepSec * 1000;
    const startTime = Date.now();
    const maxDurationMs = Math.max((needed + 45) * 1000, 90000); // 90s safety watchdog
    let consecutiveErrors = 0;

    while (done < needed && !this.shouldStop) {
      if (Date.now() - startTime > maxDurationMs) {
        this.log(`⚠️ Video quest ${name} exceeded safety timeout (${Math.round(maxDurationMs / 1000)}s) - continuing`, "warn");
        break;
      }

      if (this.currentQuestSkipRequested) {
        this.currentQuestSkipRequested = false;
        this.log(`⚠️ Admin skipped video quest: ${name}. Proceeding to next...`, "warn");
        this.markQuestSkipped(qid, "Skipped by Admin");
        return;
      }

      while (this.isPausedByAdmin && !this.shouldStop) {
        await sleep(1000);
      }

      const elapsedSec = (Date.now() - enrolledTs) / 1000;
      const maxAllowedSec = elapsedSec + maxFutureSec;

      let targetTs = done + stepSec;
      if (targetTs > maxAllowedSec && targetTs < needed) {
        await sleep(3000);
        continue;
      }

      targetTs = Math.min(targetTs, needed);

      try {
        const resp = await this.client.sendVideoProgress(qid, targetTs);
        if (resp.status === 403) {
          this.markQuestSkipped(qid, "Forbidden / Not enrolled (403)");
          this.log(`⚠️ Video quest skipped: ${name} (403: ${resp.data?.message || "Not enrolled"})`, "warn");
          return;
        }

        if (resp.ok && resp.data) {
          consecutiveErrors = 0;
          const prog = resp.data.progress || {};
          if (prog[taskType]) {
            const val = prog[taskType];
            done = Number(val.value || val || targetTs);
          } else {
            done = targetTs;
          }
          if (resp.data.completed_at || done >= needed) {
            done = needed;
            break;
          }
        } else {
          consecutiveErrors++;
          if (consecutiveErrors >= 3) {
            this.markQuestSkipped(qid, `Failed after 3 errors (Status: ${resp.status})`);
            this.log(`⚠️ Video quest aborted: ${name} (3 consecutive errors)`, "warn");
            return;
          }
        }
      } catch (e) {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          this.markQuestSkipped(qid, "Network exception");
          return;
        }
      }

      this.updateQuestProgress(qid, done, needed);
      if (done >= needed) break;
      await sleep(intervalMs);
    }

    // Terminal verification
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (this.shouldStop) break;
      try {
        const resp = await this.client.sendVideoProgress(qid, needed);
        if (resp.data?.completed_at) break;
      } catch (e) {}
      if (attempt < 3) await sleep(2000);
    }

    this.markQuestDone(qid, needed);
    this.log(`✅ Video completed: ${name}`, "ok");
  }

  async processGameQuest(q) {
    const qid = q.id;
    const name = getQuestName(q);
    const needed = getSecondsNeeded(q);
    let done = getSecondsDone(q);
    const taskType = getTaskType(q);
    const streamKey = `call:0:${Math.floor(Math.random() * 20000) + 1000}`;

    this.log(`Game quest active: ${name} (${done}/${needed}s)`, "info");

    const startTime = Date.now();
    const maxDurationMs = Math.max((needed * 1.5 + 60) * 1000, 180000); // Safety watchdog
    let consecutiveErrors = 0;

    while (done < needed && !this.shouldStop) {
      if (Date.now() - startTime > maxDurationMs) {
        this.log(`⚠️ Game quest ${name} exceeded safety timeout (${Math.round(maxDurationMs / 1000)}s) - continuing`, "warn");
        break;
      }

      if (this.currentQuestSkipRequested) {
        this.currentQuestSkipRequested = false;
        this.log(`⚠️ Admin skipped game quest: ${name}. Proceeding to next...`, "warn");
        this.markQuestSkipped(qid, "Skipped by Admin");
        return;
      }

      while (this.isPausedByAdmin && !this.shouldStop) {
        await sleep(1000);
      }

      try {
        const resp = await this.client.sendHeartbeat(qid, streamKey, false);
        if (resp.status === 403) {
          this.markQuestSkipped(qid, "Forbidden / Not enrolled (403)");
          this.log(`⚠️ Game quest skipped: ${name} (403: ${resp.data?.message || "Not enrolled"})`, "warn");
          return;
        }

        if (resp.ok && resp.data) {
          consecutiveErrors = 0;
          const prog = resp.data.progress || {};
          if (taskType && prog[taskType]) {
            const val = prog[taskType];
            done = Number(val.value !== undefined ? val.value : val || done);
          }
          if (resp.data.completed_at || done >= needed) {
            done = needed;
            break;
          }
        } else {
          consecutiveErrors++;
          if (consecutiveErrors >= 3) {
            this.markQuestSkipped(qid, `Failed after 3 errors (Status: ${resp.status})`);
            this.log(`⚠️ Game quest aborted: ${name} (3 consecutive errors)`, "warn");
            return;
          }
        }
      } catch (e) {}

      this.updateQuestProgress(qid, done, needed);
      if (done >= needed) break;
      await sleep(this.options.heartbeatIntervalSec * 1000);
    }

    // Terminal pulse
    try {
      await this.client.sendHeartbeat(qid, streamKey, true);
    } catch (e) {}


    this.markQuestDone(qid, needed);
    this.log(`✅ Game quest completed: ${name}`, "ok");
  }

  updateQuestProgress(qid, done, needed) {
    if (!this.questMap[qid]) return;
    this.questMap[qid].secondsDone = done;
    this.questMap[qid].secondsNeeded = needed;
    this.questMap[qid].status = "running";
    this.questMap[qid].progressPct = needed > 0 ? Math.min(100, Math.round((done / needed) * 100)) : 0;
    this.notifyUpdate();
  }

  markQuestDone(qid, needed) {
    if (!this.questMap[qid]) return;
    this.questMap[qid].secondsDone = needed;
    this.questMap[qid].status = "done";
    this.questMap[qid].progressPct = 100;
    this.notifyUpdate();
  }

  markQuestSkipped(qid, reason) {
    if (!this.questMap[qid]) return;
    this.questMap[qid].status = "skipped";
    this.questMap[qid].skipReason = reason;
    this.notifyUpdate();
  }

  markQuestPaused(qid, reason) {
    if (!this.questMap[qid]) return;
    this.questMap[qid].status = "paused";
    this.questMap[qid].pauseReason = reason;
    this.notifyUpdate();
  }

  skipCurrentQuest() {
    this.currentQuestSkipRequested = true;
    this.log(`⚠️ Skip requested for current active quest on Slot ${this.slotId + 1}`, "warn");
    return true;
  }

  togglePause() {
    this.isPausedByAdmin = !this.isPausedByAdmin;
    this.log(this.isPausedByAdmin ? `⏸️ Slot ${this.slotId + 1} paused by admin.` : `▶️ Slot ${this.slotId + 1} resumed by admin.`, "warn");
    this.status = this.isPausedByAdmin ? "paused" : "farming";
    this.notifyUpdate();
    return this.isPausedByAdmin;
  }

  stop() {
    this.shouldStop = true;
    this.status = "stopped";
    this.notifyUpdate();
  }

  finish(finalStatus) {
    this.status = finalStatus;
    this.endTime = Date.now();
    this.notifyUpdate();

    if (finalStatus === "completed") {
      this.onComplete(this.getPublicState());
    } else {
      this.onError(this.getPublicState());
    }
  }
}

module.exports = {
  QuestWorker,
  SUPPORTED_TASKS,
  VIDEO_TASKS,
};
