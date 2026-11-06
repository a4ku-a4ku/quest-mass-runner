/**
 * BORN TO RIZZ™ // Discord Quest System - Web Notice & Redirect Server
 * Optimized for Render.com & VPS deployments.
 * Zero-Retention Architecture: No token storage, no disk logging.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "10000", 10);
const PUBLIC_DIR = path.join(__dirname, "public");

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
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  let pathname = reqUrl.pathname;

  // Add security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // Render Health Check Endpoint
  if (pathname === "/health" || pathname === "/ping") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      service: "B2R Quest System Notice",
      webRunner: "retired",
      discord: "https://discord.gg/b2r",
      channel: "#🐉・quest﹒𓂃",
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // Handle any legacy API endpoints (Tokens, Admin, Queue) with clean retired notice
  if (pathname.startsWith("/api/") || pathname === "/tokens" || pathname === "/queue") {
    res.writeHead(410, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      error: "Gone",
      message: "The Web Quest Engine is permanently offline for security & token protection. Join discord.gg/b2r and request the quest role from staff/moderators to use the bot in #🐉・quest﹒𓂃.",
      discord: "https://discord.gg/b2r",
      success: false
    }));
    return;
  }

  // Redirect legacy /admin to home notice
  if (pathname === "/admin" || pathname === "/admin.html") {
    res.writeHead(302, { Location: "/" });
    res.end();
    return;
  }

  // Default to index.html for root path
  if (pathname === "/" || pathname === "") {
    pathname = "/index.html";
  }

  // Sanitize path to prevent directory traversal
  const safeSuffix = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, "");
  let filePath = path.join(PUBLIC_DIR, safeSuffix);

  // If file doesn't exist, fallback to index.html
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, "index.html");
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
      return;
    }

    // Cache static assets, but don't cache index.html
    if (ext === ".html") {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    } else {
      res.setHeader("Cache-Control", "public, max-age=86400"); // 1 day
    }

    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[B2R Web System] Server active on http://0.0.0.0:${PORT}`);
  console.log(`[B2R Web System] Mode: Web Quest Runner Offline Notice`);
  console.log(`[B2R Web System] Target Discord: https://discord.gg/b2r`);
});

// Graceful termination
process.on("SIGTERM", () => {
  console.log("[B2R Web System] Received SIGTERM, shutting down gracefully...");
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  console.log("[B2R Web System] Received SIGINT, shutting down gracefully...");
  server.close(() => process.exit(0));
});
