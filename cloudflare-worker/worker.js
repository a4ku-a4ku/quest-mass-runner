/**
 * A4KU Discord API Cloudflare Worker Reverse Proxy
 * Bypasses Cloudflare 429 IP Bans on Render and datacenter hosts.
 *
 * Incoming:  https://your-worker.workers.dev/api/v9/...
 * Outgoing:  https://discord.com/api/v9/...
 */

export default {
  async fetch(request, env, ctx) {
    // 1. Handle CORS Preflight for web clients
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    try {
      const url = new URL(request.url);

      // Map incoming path to Discord v9 API
      let targetPath = url.pathname;
      if (!targetPath.startsWith("/api/v9") && !targetPath.startsWith("/api/")) {
        targetPath = "/api/v9" + targetPath;
      } else if (targetPath.startsWith("/api/") && !targetPath.startsWith("/api/v9")) {
        targetPath = targetPath.replace(/^\/api/, "/api/v9");
      }

      const targetUrl = new URL(targetPath + url.search, "https://discord.com");

      // Clone and sanitize incoming headers to prevent Discord Cloudflare flagging
      const forwardHeaders = new Headers(request.headers);

      // Strip Cloudflare & proxy tracking headers
      forwardHeaders.delete("host");
      forwardHeaders.delete("cf-connecting-ip");
      forwardHeaders.delete("cf-ipcountry");
      forwardHeaders.delete("cf-ray");
      forwardHeaders.delete("cf-visitor");
      forwardHeaders.delete("x-forwarded-for");
      forwardHeaders.delete("x-forwarded-proto");
      forwardHeaders.delete("x-real-ip");

      // Set legitimate headers for Discord
      forwardHeaders.set("Host", "discord.com");
      if (!forwardHeaders.has("Origin")) {
        forwardHeaders.set("Origin", "https://discord.com");
      }
      if (!forwardHeaders.has("Referer")) {
        forwardHeaders.set("Referer", "https://discord.com/channels/@me");
      }

      // Forward request to Discord API
      const response = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: forwardHeaders,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "follow",
      });

      // Clone response and attach permissive CORS
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      responseHeaders.set("Access-Control-Allow-Headers", "*");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Worker Proxy Error: " + err.message }), {
        status: 502,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  },
};
