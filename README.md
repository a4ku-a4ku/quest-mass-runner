# A4KU Mass Discord Quest Runner (10-Slot Concurrency Engine)

High-performance, multi-account Discord Quest Auto-Completer hosted as a standalone Node.js server. Designed for bulk account farming with a strict 10-concurrent slot pool, automatic token file watcher, and a real-time web dashboard.

---

## ⚡ Features

1. **Strict 10-Concurrent Account Pool**:
   - Only 10 accounts run at any given time to protect IP reputation and avoid burst bans.
   - Any additional tokens added wait in the queue and **automatically launch the millisecond a slot frees up**.
2. **File-Based Ingestion (`tokens.txt`)**:
   - Simply paste your Discord tokens (one per line) into `tokens.txt`.
   - The server automatically detects new tokens added while running — zero restarts needed.
3. **Simultaneous Quest Farming Per Account**:
   - All eligible video and desktop game quests for an active account farm in parallel with 1-second staggers.
   - Stepped video progression and 20-second game heartbeats conforming to Discord anti-cheat standards.
4. **Live Real-Time Dashboard**:
   - 10 interactive slot cards showing live Discord avatar, username, quest list, and animated progress bars.
   - Server-Sent Events (SSE) live event log stream.
   - Bulk "Add Tokens" modal directly from the browser.
5. **Zero Dependencies**:
   - Built on native Node.js (Node 18+). No `npm install` required.

---

## 🚀 How to Run

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
├── config.json              # Concurrency limit (default 10), port, intervals
├── package.json             # Project definition
├── server.js                # HTTP Server with SSE stream and REST API
├── engine/
│   ├── discord.js           # Discord API client (Super Properties, retry backoff)
│   ├── quest-worker.js      # Single account quest execution engine
│   └── pool.js              # 10-slot concurrency controller & queue manager
├── public/
│   ├── index.html           # 10-slot monitoring dashboard
│   ├── style.css            # Obsidian monochrome UI
│   ├── dashboard.js         # Real-time SSE dashboard client
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
  "maxConcurrentAccounts": 10,
  "tokensFilePath": "tokens.txt",
  "heartbeatIntervalSeconds": 20,
  "videoStepSeconds": 15,
  "autoReloadTokens": true,
  "reloadIntervalSeconds": 10
}
```

- `maxConcurrentAccounts`: Maximum number of accounts farming at the same time (default `10`).
- `tokensFilePath`: File name for token list (default `tokens.txt`).
- `autoReloadTokens`: Check `tokens.txt` periodically for newly pasted tokens.
