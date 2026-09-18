/**
 * A4KU Discord API Client for Node.js
 * Handles Discord API communication, Super-Properties, and automatic rate-limit backoff.
 */


// Global enroll rate throttle (max ~25 requests/min across all 12 worker slots to avoid 429)
let nextEnrollSlotTime = 0;
const MIN_ENROLL_GAP_MS = 2200;

async function throttleEnroll() {
  const now = Date.now();
  const scheduledTime = Math.max(now, nextEnrollSlotTime);
  nextEnrollSlotTime = scheduledTime + MIN_ENROLL_GAP_MS;
  const waitMs = scheduledTime - now;
  if (waitMs > 0) {
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

function makeSuperProperties(buildNumber = 504649) {
  const obj = {
    os: "Windows",
    browser: "Discord Client",
    release_channel: "stable",
    client_version: "1.0.9175",
    os_version: "10.0.26100",
    os_arch: "x64",
    app_arch: "x64",
    system_locale: "en-US",
    browser_user_agent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9175 Chrome/128.0.6613.186 Electron/32.2.7 Safari/537.36",
    browser_version: "32.2.7",
    client_build_number: buildNumber,
    native_build_number: 59498,
    client_event_source: null,
  };
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}

function getDiscordHeaders(token, extra = {}) {
  return {
    Authorization: token,
    "Content-Type": "application/json",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9175 Chrome/128.0.6613.186 Electron/32.2.7 Safari/537.36",
    "X-Super-Properties": makeSuperProperties(),
    "X-Discord-Locale": "en-US",
    "X-Discord-Timezone": "UTC",
    Origin: "https://discord.com",
    Referer: "https://discord.com/channels/@me",
    ...extra,
  };
}

let nextRequestSlotTime = 0;
const MIN_REQUEST_GAP_MS = 120; // Fast and safe for 12 accounts with atomic slot pacing

async function throttle() {
  const now = Date.now();
  const jitter = Math.floor(Math.random() * 50) + 20; // Natural 20-70ms jitter
  const targetGap = MIN_REQUEST_GAP_MS + jitter;
  const scheduledTime = Math.max(now, nextRequestSlotTime);
  nextRequestSlotTime = scheduledTime + targetGap;
  const waitMs = scheduledTime - now;
  if (waitMs > 0) {
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await throttle();
    try {
      const resp = await fetch(url, options);

      if (resp.status === 429) {
        // If enroll is IP-rate-limited, return immediately so the worker can skip gracefully
        if (url.includes("/enroll")) {
          return resp;
        }

        let waitSeconds = 3;
        try {
          const body = await resp.clone().json();
          waitSeconds = Math.min(Number(body.retry_after || 3), 10);
        } catch (e) {}
        await new Promise((r) => setTimeout(r, (waitSeconds + 1) * 1000));
        continue;
      }

      return resp;
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  return fetch(url, options);
}

class DiscordClient {
  constructor(token) {
    this.token = token.trim();
  }

  async validate() {
    const resp = await fetchWithRetry("https://discord.com/api/v9/users/@me", {
      headers: getDiscordHeaders(this.token),
    });

    if (!resp.ok) {
      return { valid: false, status: resp.status, user: null };
    }

    const data = await resp.json();
    return {
      valid: true,
      status: 200,
      user: {
        id: data.id,
        username: data.username,
        discriminator: data.discriminator,
        global_name: data.global_name || data.username,
        avatar: data.avatar,
        avatar_url: data.avatar
          ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png?size=128`
          : "https://cdn.discordapp.com/embed/avatars/0.png",
      },
    };
  }

  async fetchQuests() {
    const resp = await fetchWithRetry("https://discord.com/api/v9/quests/@me", {
      headers: getDiscordHeaders(this.token),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return { ok: false, status: resp.status, quests: [], error: errText };
    }

    const data = await resp.json();
    const quests = Array.isArray(data) ? data : data.quests || [];
    return { ok: true, status: 200, quests };
  }

  async enroll(questId, payload = {}) {
    await throttleEnroll();

    const body = {
      location: 11,
      is_targeted: false,
      metadata_raw: null,
      metadata_sealed: null,
      traffic_metadata_raw: payload.traffic_metadata_raw || null,
      traffic_metadata_sealed: payload.traffic_metadata_sealed || null,
    };

    const resp = await fetchWithRetry(`https://discord.com/api/v9/quests/${questId}/enroll`, {
      method: "POST",
      headers: getDiscordHeaders(this.token),
      body: JSON.stringify(body),
    });

    if (resp.status === 429) {
      let waitSec = 5;
      try {
        const body = await resp.clone().json();
        waitSec = Number(body.retry_after || 5);
      } catch (e) {}

      if (waitSec <= 15) {
        await new Promise((r) => setTimeout(r, (waitSec + 1) * 1000));
        await throttleEnroll();
        const retryResp = await fetch(`https://discord.com/api/v9/quests/${questId}/enroll`, {
          method: "POST",
          headers: getDiscordHeaders(this.token),
          body: JSON.stringify(body),
        });
        const retryData = await retryResp.json().catch(() => ({}));
        return { ok: retryResp.ok, status: retryResp.status, data: retryData };
      }
    }

    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, data };
  }

  async sendVideoProgress(questId, timestamp) {
    const resp = await fetchWithRetry(`https://discord.com/api/v9/quests/${questId}/video-progress`, {
      method: "POST",
      headers: getDiscordHeaders(this.token, {
        Referer: `https://discord.com/quests/${questId}`,
      }),
      body: JSON.stringify({ timestamp: Number(timestamp) }),
    });

    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, data };
  }

  async sendHeartbeat(questId, streamKey, terminal = false) {
    const resp = await fetchWithRetry(`https://discord.com/api/v9/quests/${questId}/heartbeat`, {
      method: "POST",
      headers: getDiscordHeaders(this.token),
      body: JSON.stringify({
        stream_key: streamKey,
        terminal: Boolean(terminal),
      }),
    });

    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, data };
  }
}

module.exports = {
  DiscordClient,
  getDiscordHeaders,
  makeSuperProperties,
};
