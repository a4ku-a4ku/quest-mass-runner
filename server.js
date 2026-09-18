/**
 * A4KU Mass Quest Runner - HTTP Server & Live Dashboard API
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PoolManager } = require("./engine/pool");
const { DiscordClient } = require("./engine/discord");

// ── Security & Cryptography Engine ──────────────────────────────────────────
function generateSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), salt, 100000, 64, "sha512").toString("hex");
}

function timingSafeMatch(a, b) {
  const bufA = Buffer.from(String(a || ""));
  const bufB = Buffer.from(String(b || ""));
  if (bufA.length !== bufB.length) {
    const hashA = crypto.createHash("sha256").update(bufA).digest();
    const hashB = crypto.createHash("sha256").update(bufB).digest();
    crypto.timingSafeEqual(hashA, hashB);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyPassword(inputPassword, storedHash, salt) {
  if (!storedHash || !salt) return false;
  const inputHash = hashPassword(inputPassword, salt);
  return timingSafeMatch(inputHash, storedHash);
}

// ── Session Management (Crypto-random Tokens) ───────────────────────────────
const activeSessions = new Map(); // token -> { user, ip, createdAt, lastActive, expiresAt }
const SESSION_INACTIVITY_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function createSession(user, ip) {
  const token = generateSessionToken();
  const now = Date.now();
  activeSessions.set(token, {
    user,
    ip,
    createdAt: now,
    lastActive: now,
    expiresAt: now + SESSION_MAX_AGE_MS,
  });
  return token;
}

function validateSession(token, ip) {
  if (!token || typeof token !== "string") return null;
  const cleanToken = token.replace(/^bearer\s+/i, "").trim();
  const session = activeSessions.get(cleanToken);
  if (!session) return null;

  const now = Date.now();
  if (now > session.expiresAt || now - session.lastActive > SESSION_INACTIVITY_MS) {
    activeSessions.delete(cleanToken);
    return null;
  }

  session.lastActive = now;
  return session;
}

function revokeSession(token) {
  if (!token) return false;
  const cleanToken = token.replace(/^bearer\s+/i, "").trim();
  return activeSessions.delete(cleanToken);
}

// Cleanup stale sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [t, s] of activeSessions.entries()) {
    if (now > s.expiresAt || now - s.lastActive > SESSION_INACTIVITY_MS) {
      activeSessions.delete(t);
    }
  }
}, 5 * 60 * 1000);

// ── Anti-Brute Force Rate Limiter ───────────────────────────────────────────
const loginAttempts = new Map(); // ip -> { count, lockedUntil, lastAttempt }
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes lockout

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "127.0.0.1";
}

function checkRateLimit(ip) {
  const record = loginAttempts.get(ip);
  if (!record) return { allowed: true };

  const now = Date.now();
  if (record.lockedUntil && now < record.lockedUntil) {
    const remainingSec = Math.ceil((record.lockedUntil - now) / 1000);
    return {
      allowed: false,
      locked: true,
      remainingSec,
      message: `Access temporarily locked due to repeated failed attempts. Please try again in ${Math.ceil(remainingSec / 60)} minute(s).`,
    };
  }

  if (record.lockedUntil && now >= record.lockedUntil) {
    loginAttempts.delete(ip);
    return { allowed: true };
  }

  return { allowed: true, count: record.count };
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, lastAttempt: now };
  record.count++;
  record.lastAttempt = now;

  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_DURATION_MS;
    console.warn(`🚨 [Security Lockout] IP ${ip} locked out for 15m after ${record.count} failed attempts.`);
  }
  loginAttempts.set(ip, record);
  return record;
}

function recordSuccessfulLogin(ip) {
  loginAttempts.delete(ip);
}

// ── HTTP Security Headers ───────────────────────────────────────────────────
function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'"
  );
}

// ── Load & Migrate Configuration ────────────────────────────────────────────
let config = {
  port: 3001,
  maxConcurrentAccounts: 12,
  tokensFilePath: "tokens.txt",
  heartbeatIntervalSeconds: 20,
  videoStepSeconds: 15,
  autoReloadTokens: true,
  adminUser: "a4ku",
  webhookUrl: "",
};

const configPath = path.join(__dirname, "config.json");
if (fs.existsSync(configPath)) {
  try {
    config = { ...config, ...JSON.parse(fs.readFileSync(configPath, "utf8")) };
  } catch (e) {
    console.error("Failed to parse config.json, using defaults.", e);
  }
}

// Auto-migrate plaintext password to salted PBKDF2 hash on startup
if (!config.adminPassHash && (config.adminPass || config.adminKey)) {
  const rawPass = String(config.adminPass || config.adminKey.split(":")[1] || "842001").trim();
  const salt = generateSalt();
  config.adminSalt = salt;
  config.adminPassHash = hashPassword(rawPass, salt);
  delete config.adminPass;
  delete config.adminKey;

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
    console.log("🔒 [Security] Upgraded plaintext admin credentials to 100,000-round salted PBKDF2 hash.");
  } catch (e) {
    console.error("Failed to save upgraded credentials:", e.message);
  }
}

// Cloud Environment Variables Overrides (e.g. Render, Railway, VPS)
if (process.env.ADMIN_USER) {
  config.adminUser = String(process.env.ADMIN_USER).trim();
}
if (process.env.ADMIN_PASS) {
  const envSalt = generateSalt();
  config.adminSalt = envSalt;
  config.adminPassHash = hashPassword(String(process.env.ADMIN_PASS).trim(), envSalt);
}
if (process.env.MAX_CONCURRENT) {
  config.maxConcurrentAccounts = Number(process.env.MAX_CONCURRENT) || 12;
}
if (process.env.WEBHOOK_URL) {
  config.webhookUrl = String(process.env.WEBHOOK_URL).trim();
}

function checkAdminAuth(req, parsedUrl) {
  const authHeader = req.headers["authorization"] || req.headers["x-admin-key"];
  const authQuery = parsedUrl.searchParams.get("token") || parsedUrl.searchParams.get("key");
  const candidate = (authHeader || authQuery || "").trim();

  const ip = getClientIp(req);
  return validateSession(candidate, ip);
}

function parseJsonBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (e) {
        resolve({});
      }
    });
  });
}

const pool = new PoolManager(config);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, statusCode, data) {
  setSecurityHeaders(res);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-key",
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  // CORS Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // 1. SSE Live Event Stream
  if (pathname === "/api/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    pool.addSubscriber(res);
    return;
  }

  // 2. Status Snapshot API
  if (pathname === "/api/status" && req.method === "GET") {
    return sendJson(res, 200, pool.getStatus());
  }

  // 3. Add Tokens via API
  if (pathname === "/api/tokens" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const json = JSON.parse(body || "{}");
        const rawTokens = Array.isArray(json.tokens)
          ? json.tokens
          : typeof json.tokens === "string"
          ? json.tokens.split(/\r?\n/)
          : [];

        const cleanTokens = rawTokens
          .map((t) => {
            let s = typeof t === "string" ? t.trim() : "";
            if (
              (s.startsWith('"') && s.endsWith('"')) ||
              (s.startsWith("'") && s.endsWith("'")) ||
              (s.startsWith("`") && s.endsWith("`"))
            ) {
              s = s.slice(1, -1).trim();
            }
            return s.replace(/^(authorization|token):\s*/i, "").trim();
          })
          .filter((t) => t && !t.startsWith("#"));

        if (cleanTokens.length === 0) {
          return sendJson(res, 400, { error: "No valid token provided. Please paste your Discord token." });
        }

        const result = pool.enqueueTokens(cleanTokens, { direct: true });

        if (result.addedCount === 0 && result.busyAccounts && result.busyAccounts.length > 0) {
          const info = result.busyAccounts[0];
          return sendJson(res, 400, {
            error: `This Discord account is ${info.reason}. Please wait for it to finish!`,
          });
        }

        const currentQueue = pool.waitingQueue.length;
        return sendJson(res, 200, {
          ok: true,
          added: result.addedCount,
          totalQueue: currentQueue,
          queuePosition: currentQueue,
          isRunningImmediately: currentQueue === 0,
        });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    });
    return;
  }

  // 4. Force Reload Tokens from File
  if (pathname === "/api/reload" && req.method === "POST") {
    pool.loadTokensFromFile();
    return sendJson(res, 200, { ok: true, status: pool.getStatus() });
  }

  // 4b. Restart All Accounts to Sweep Remaining Quests
  if (pathname === "/api/restart-all" && req.method === "POST") {
    const status = pool.restartAll();
    return sendJson(res, 200, { ok: true, status });
  }

  // 4c. Wipe / Fresh Session
  if (pathname === "/api/clear" && req.method === "POST") {
    const status = pool.clearAll();
    return sendJson(res, 200, { ok: true, status });
  }

  // 4d. Export Completed Tokens (Download .txt or JSON)
  if (pathname === "/api/export-completed" && req.method === "GET") {
    const format = parsedUrl.searchParams.get("format") || "text";
    if (format === "json") {
      return sendJson(res, 200, {
        ok: true,
        count: pool.completedAccounts.length,
        tokens: pool.getCompletedTokens("json"),
      });
    }

    const textData = pool.getCompletedTokens("text");
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"completed_tokens.txt\"",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(textData);
    return;
  }

  // ── Admin Portal API & Routes ──────────────────────────────────────────────
  // A1. Serve Admin Portal Page
  if (pathname === "/admin" || pathname === "/admin/") {
    const adminPath = path.join(__dirname, "public", "admin.html");
    if (fs.existsSync(adminPath)) {
      setSecurityHeaders(res);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return fs.createReadStream(adminPath).pipe(res);
    }
  }

  // A2. Admin Login & Session Issuance (Timing-Safe, Rate-Limited & Lockout Protected)
  if ((pathname === "/api/admin/login" || pathname === "/api/admin/verify") && req.method === "POST") {
    const ip = getClientIp(req);
    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) {
      return sendJson(res, 429, {
        ok: false,
        error: rateCheck.message,
        locked: true,
        remainingSec: rateCheck.remainingSec,
      });
    }

    const json = await parseJsonBody(req);
    const inputUser = String(json.user || "").trim();
    const inputPass = String(json.pass || json.password || json.key || "").trim();

    const expectedUser = String(config.adminUser || "a4ku").trim();

    // Timing-safe user & password check
    const isUserValid = timingSafeMatch(inputUser, expectedUser);
    const isPassValid = verifyPassword(inputPass, config.adminPassHash, config.adminSalt);

    if (!isUserValid || !isPassValid) {
      // 800ms artificial delay to throttle brute force
      await new Promise((r) => setTimeout(r, 800));
      const failRecord = recordFailedLogin(ip);
      const remainingAttempts = Math.max(0, MAX_FAILED_ATTEMPTS - failRecord.count);

      pool.log(null, "Security", `Failed admin login attempt for user '${inputUser || "unknown"}' from IP ${ip}.`, "warn");

      return sendJson(res, 401, {
        ok: false,
        error: failRecord.lockedUntil
          ? "Account access locked for 15 minutes due to repeated failed attempts."
          : `Invalid username or password. (${remainingAttempts} attempt(s) remaining)`,
        locked: Boolean(failRecord.lockedUntil),
        remainingAttempts,
      });
    }

    // Success: reset rate limit and issue cryptographic session token
    recordSuccessfulLogin(ip);
    const sessionToken = createSession(expectedUser, ip);
    pool.log(null, "Security", `Admin '${expectedUser}' authenticated successfully from IP ${ip}.`, "ok");

    return sendJson(res, 200, {
      ok: true,
      user: expectedUser,
      token: sessionToken,
      expiresInSeconds: SESSION_INACTIVITY_MS / 1000,
    });
  }

  // A2b. Verify Session Endpoint (GET /api/admin/verify)
  if (pathname === "/api/admin/verify" && req.method === "GET") {
    const session = checkAdminAuth(req, parsedUrl);
    if (!session) {
      return sendJson(res, 401, { ok: false, error: "Unauthorized: Invalid or expired session token" });
    }
    return sendJson(res, 200, { ok: true, user: session.user });
  }

  // A2c. Logout (Server-Side Session Revocation)
  if (pathname === "/api/admin/logout" && req.method === "POST") {
    const authHeader = req.headers["authorization"] || req.headers["x-admin-key"];
    if (authHeader) {
      revokeSession(authHeader);
    }
    return sendJson(res, 200, { ok: true, message: "Logged out successfully" });
  }

  // A2c. Reveal Single Token (Authenticated Session Required)
  if (pathname === "/api/admin/reveal-token" && req.method === "POST") {
    const session = checkAdminAuth(req, parsedUrl);
    if (!session) {
      return sendJson(res, 401, { error: "Unauthorized: Active admin session required" });
    }
    const json = await parseJsonBody(req);
    let token = null;
    if (json.slotId !== undefined) {
      token = pool.getSlotToken(json.slotId);
    } else if (json.queueIndex !== undefined) {
      token = pool.getQueueToken(json.queueIndex);
    }
    if (!token) {
      return sendJson(res, 404, { error: "Token not found" });
    }
    pool.log(json.slotId !== undefined ? json.slotId : null, "Security", `Admin '${session.user}' unmasked token.`, "info");
    return sendJson(res, 200, { ok: true, token });
  }

  // A3. Detailed Admin Status & Telemetry
  if (pathname === "/api/admin/status" && req.method === "GET") {
    const session = checkAdminAuth(req, parsedUrl);
    if (!session) {
      return sendJson(res, 401, { error: "Unauthorized: Active admin session required or expired" });
    }
    return sendJson(res, 200, pool.getAdminStatus());
  }

  // A4. Terminate Specific Slot Worker
  if (pathname === "/api/admin/stop-slot" && req.method === "POST") {
    if (!checkAdminAuth(req, parsedUrl)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }
    const json = await parseJsonBody(req);
    const stopped = pool.stopSlot(json.slotId);
    return sendJson(res, 200, { ok: stopped, status: pool.getAdminStatus() });
  }

  // A4b. Skip Current Quest in Slot
  if (pathname === "/api/admin/slot/skip-quest" && req.method === "POST") {
    if (!checkAdminAuth(req, parsedUrl)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }
    const json = await parseJsonBody(req);
    const skipped = pool.skipQuestInSlot(json.slotId);
    return sendJson(res, 200, { ok: skipped, status: pool.getAdminStatus() });
  }

  // A4c. Toggle Pause / Resume on Slot
  if (pathname === "/api/admin/slot/pause" && req.method === "POST") {
    if (!checkAdminAuth(req, parsedUrl)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }
    const json = await parseJsonBody(req);
    const isPaused = pool.togglePauseSlot(json.slotId);
    return sendJson(res, 200, { ok: true, isPaused, status: pool.getAdminStatus() });
  }

  // A4d. Engine Tuning & Concurrency Slider
  if (pathname === "/api/admin/tuning" && req.method === "POST") {
    if (!checkAdminAuth(req, parsedUrl)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }
    const json = await parseJsonBody(req);
    const result = pool.setTuning(json);
    config = { ...config, ...pool.config };
    return sendJson(res, 200, { ok: true, tuning: result, status: pool.getAdminStatus() });
  }

  // A4e. Discord Webhook Settings
  if (pathname === "/api/admin/webhook/save" && req.method === "POST") {
    if (!checkAdminAuth(req, parsedUrl)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }
    const json = await parseJsonBody(req);
    const webhookUrl = String(json.webhookUrl || "").trim();
    pool.config.webhookUrl = webhookUrl;
    config.webhookUrl = webhookUrl;
    pool.saveConfigFile();
    pool.log(null, "Admin", webhookUrl ? "Configured Discord Webhook notifications." : "Disabled Discord Webhooks.", "ok");
    return sendJson(res, 200, { ok: true, webhookUrl });
  }

  if (pathname === "/api/admin/webhook/test" && req.method === "POST") {
    if (!checkAdminAuth(req, parsedUrl)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }
    const json = await parseJsonBody(req);
    const testRes = await pool.testDiscordWebhook(json.webhookUrl);
    return sendJson(res, testRes.ok ? 200 : 400, testRes);
  }

  // A4f. Failed Accounts Manager (Retry & Clear)
  if (pathname === "/api/admin/retry-failed" && req.method === "POST") {
    if (!checkAdminAuth(req, parsedUrl)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }
    const json = await parseJsonBody(req);
    const count = pool.retryFailedAccounts(json.token);
    return sendJson(res, 200, { ok: true, enqueuedCount: count, status: pool.getAdminStatus() });
  }

  if (pathname === "/api/admin/clear-failed" && req.method === "POST") {
    if (!checkAdminAuth(req, parsedUrl)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }
    const count = pool.clearFailedAccounts();
    return sendJson(res, 200, { ok: true, clearedCount: count, status: pool.getAdminStatus() });
  }

  // A4g. Admin Security Credentials Update (Salted PBKDF2 Hashing)
  if (pathname === "/api/admin/settings/credentials" && req.method === "POST") {
    const session = checkAdminAuth(req, parsedUrl);
    if (!session) {
      return sendJson(res, 401, { error: "Unauthorized: Active session required" });
    }
    const json = await parseJsonBody(req);
    const newUser = String(json.user || "").trim();
    const newPass = String(json.pass || "").trim();
    if (!newUser || !newPass) {
      return sendJson(res, 400, { error: "Both username and password are required." });
    }
    if (newPass.length < 6) {
      return sendJson(res, 400, { error: "Password must be at least 6 characters long." });
    }

    const salt = generateSalt();
    const passHash = hashPassword(newPass, salt);

    config.adminUser = newUser;
    config.adminSalt = salt;
    config.adminPassHash = passHash;
    delete config.adminPass;
    delete config.adminKey;

    pool.config.adminUser = newUser;
    pool.config.adminSalt = salt;
    pool.config.adminPassHash = passHash;
    delete pool.config.adminPass;
    delete pool.config.adminKey;
    pool.saveConfigFile();

    // Revoke old sessions and issue fresh session token
    const newSessionToken = createSession(newUser, getClientIp(req));
    pool.log(null, "Security", `Administrator credentials updated (User: '${newUser}').`, "ok");
    return sendJson(res, 200, { ok: true, user: newUser, token: newSessionToken });
  }

  // A4h. Bulk Pre-Flight Token Validator
  if (pathname === "/api/admin/validate-bulk" && req.method === "POST") {
    if (!checkAdminAuth(req, parsedUrl)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }
    const json = await parseJsonBody(req);
    const rawTokens = Array.isArray(json.tokens)
      ? json.tokens
      : typeof json.tokens === "string"
      ? json.tokens.split(/\r?\n/)
      : [];

    const cleanTokens = rawTokens
      .map((t) => {
        let s = typeof t === "string" ? t.trim() : "";
        if (
          (s.startsWith('"') && s.endsWith('"')) ||
          (s.startsWith("'") && s.endsWith("'")) ||
          (s.startsWith("`") && s.endsWith("`"))
        ) {
          s = s.slice(1, -1).trim();
        }
        return s.replace(/^(authorization|token):\s*/i, "").trim();
      })
      .filter((t) => t && !t.startsWith("#"));

    if (cleanTokens.length === 0) {
      return sendJson(res, 400, { error: "No tokens provided for pre-flight validation." });
    }

    const results = [];
    const BATCH_SIZE = 6;
    for (let i = 0; i < cleanTokens.length; i += BATCH_SIZE) {
      const chunk = cleanTokens.slice(i, i + BATCH_SIZE);
      const chunkResults = await Promise.all(
        chunk.map(async (token) => {
          const client = new DiscordClient(token);
          const masked = token.slice(0, 8) + "..." + token.slice(-4);
          try {
            const auth = await client.validate();
            if (!auth.valid || !auth.user) {
              return {
                token,
                masked,
                valid: false,
                status: auth.status === 403 ? "LOCKED" : "INVALID",
                user: null,
                eligibleQuests: 0,
                error: auth.status === 403 ? "Verification / Phone Locked (403)" : `Bad Token (HTTP ${auth.status || 401})`,
              };
            }

            let eligibleCount = 0;
            const questNames = [];
            const catalog = await client.fetchQuests();
            if (catalog.ok && Array.isArray(catalog.quests)) {
              for (const q of catalog.quests) {
                const isDone = Boolean(q.user_status?.completed_at);
                if (!isDone) {
                  eligibleCount++;
                  const qName = q.config?.messages?.questName || q.config?.messages?.quest_name || `Quest#${q.id}`;
                  questNames.push(qName);
                }
              }
            }

            return {
              token,
              masked,
              valid: true,
              status: eligibleCount > 0 ? "READY" : "ALL_DONE",
              user: auth.user,
              eligibleQuests: eligibleCount,
              questNames,
              error: null,
            };
          } catch (err) {
            return {
              token,
              masked,
              valid: false,
              status: "ERROR",
              user: null,
              eligibleQuests: 0,
              error: err.message,
            };
          }
        })
      );
      results.push(...chunkResults);
    }

    return sendJson(res, 200, {
      ok: true,
      total: results.length,
      validCount: results.filter((r) => r.valid).length,
      results,
    });
  }

  // A5. Remove Token from Waiting Queue
  if (pathname === "/api/admin/queue/remove" && req.method === "POST") {
    if (!checkAdminAuth(req, parsedUrl)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }
    const json = await parseJsonBody(req);
    const removed = pool.removeFromQueue(json.index);
    return sendJson(res, 200, { ok: Boolean(removed), status: pool.getAdminStatus() });
  }

  // A6. Clear Waiting Queue
  if (pathname === "/api/admin/queue/clear" && req.method === "POST") {
    if (!checkAdminAuth(req, parsedUrl)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }
    const count = pool.clearWaitingQueue();
    return sendJson(res, 200, { ok: true, clearedCount: count, status: pool.getAdminStatus() });
  }

  // Any unhandled /api/ route returns 404 JSON (no fallback to SPA index.html)
  if (pathname.startsWith("/api/")) {
    return sendJson(res, 404, { error: "API endpoint not found" });
  }

  // 5. Static File Serving from /public
  let filePath = path.join(__dirname, "public", pathname === "/" ? "index.html" : pathname);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, "public", "index.html");
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found");
      return;
    }
    setSecurityHeaders(res);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  });
});

const PORT = process.env.PORT || config.port || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log("============================================================");
  console.log("⚡ A4KU Mass Discord Quest Runner (12-Slot Engine)");
  console.log(`🌐 Live Dashboard: http://0.0.0.0:${PORT}`);
  console.log(`📁 Tokens File:    ${pool.tokensFilePath}`);
  console.log(`🚀 Max Concurrent: ${pool.maxConcurrent} accounts`);
  console.log("============================================================\n");

  // Start pool processor and token reader
  pool.init();
});
