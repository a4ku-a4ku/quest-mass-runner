# A4KU Mass Discord Quest Runner (12-Slot Concurrency Engine)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/a4ku-a4ku/quest-mass-runner)

High-performance, multi-account Discord Quest Auto-Completer hosted as a standalone Node.js server. Designed for bulk account farming with a strict 12-concurrent slot pool, automatic token file watcher, real-time web dashboard, and cryptographically hardened Admin Console.

---

## ⚡ Features

1. **Strict 12-Concurrent Account Pool**:
   - Up to 12 accounts run simultaneously to maximize speed while protecting IP reputation and avoiding burst bans.
   - Any additional tokens wait in a FIFO queue and **automatically launch the millisecond a slot frees up**.
2. **File-Based & Web-Based Ingestion**:
   - Users can paste tokens directly into the web dashboard or paste into `tokens.txt`.
   - The server automatically detects new tokens added while running — zero restarts needed.
3. **2-Pass Rate Limit Protection**:
   - Quests hitting Discord 429 rate limits are automatically paused and saved for a 2nd pass after active quests finish.
4. **Live Real-Time Dashboard**:
   - 12 interactive slot cards showing live Discord avatar, username, quest list, and animated progress bars.
   - Server-Sent Events (SSE) live event log stream.
   - Bulk "Add Tokens" modal directly from the browser.
5. **Hardened Administrator Console (`/admin`)**:
   - PBKDF2 100,000-round salted password security.
   - 64-character ephemeral session tokens with automatic 30-min inactivity timeout.
   - Anti-brute force IP lockout (15-min lock after 5 failed attempts).
   - Live Cooldown Radar tracking Discord 429 rate limit timers.
   - Engine Tuner slider (1 to 24 slots).
   - Failed accounts manager with 1-click re-queue.
   - Discord webhook notifications for completions and errors.
6. **Zero External Dependencies**:
   - Built on native Node.js (Node 18+). No `npm install` required.

---

## ☁️ 1-Click Cloud Deployment (Render)

Click the button below to deploy this repository to Render for free:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/a4ku-a4ku/quest-mass-runner)

Render automatically detects `render.yaml` and configures:
- Name: **`unq`** ➔ Live at `https://unq.onrender.com`
- Environment: Node 18
- Start Command: `npm start`
- Auto-deploy on git push

---

## 🚀 How to Run Locally

### Windows (1-Click)
Double-click:
```
start.bat
```
This starts the Node.js server and automatically opens `http://localhost:3001` in your browser.

### Linux / VPS / Docker / Pterodactyl
```bash
chmod +x start.sh
./start.sh
```

Or directly with Node:
```bash
node server.js
```

---

## 📁 File Structure

```
quest-mass-runner/
├── tokens.txt               # Put your Discord user tokens here (1 per line)
├── config.json              # Concurrency limit (default 12), port, intervals, admin hash
├── package.json             # Project definition
├── render.yaml              # Render Cloud Blueprint (unq.onrender.com)
├── server.js                # HTTP Server with SSE stream, REST API and Security Engine
├── engine/
│   ├── discord.js           # Discord API client (Super Properties, retry backoff, pacing)
│   ├── quest-worker.js      # Single account quest execution engine (2-pass completion)
│   └── pool.js              # 12-slot concurrency controller & queue manager
├── public/
│   ├── index.html           # 12-slot monitoring dashboard
│   ├── style.css            # Obsidian monochrome UI
│   ├── dashboard.js         # Real-time SSE dashboard client
│   ├── admin.html           # Hardened Admin Console
│   ├── admin.js             # Admin Console controller & radar
│   ├── logo.png             # A4KU Brand logo
│   └── og-banner.jpg        # Discord Quest banner
├── start.bat                # Windows 1-click launcher
└── start.sh                 # Linux / VPS launcher
```

---

## ⚙️ Configuration (`config.json`)

```json
{
  "port": 3001,
  "maxConcurrentAccounts": 12,
  "tokensFilePath": "tokens.txt",
  "heartbeatIntervalSeconds": 20,
  "videoStepSeconds": 15,
  "autoReloadTokens": true,
  "adminUser": "a4ku",
  "webhookUrl": "",
  "reloadIntervalSeconds": 10
}
```
