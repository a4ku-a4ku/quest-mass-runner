# A4KU Discord Proxy (Cloudflare Worker)

Bypasses Cloudflare / Discord datacenter IP bans (Status: 429) on Render by routing all Discord API calls through Cloudflare Workers.

---

## 🚀 Option A: Deploy from Laptop (1-Click)
1. Double-click `DEPLOY_WORKER.bat` (or run `npx wrangler deploy` in this folder).
2. Follow the browser login prompt to sign in with your free Cloudflare account.
3. Once deployed, Wrangler will print your worker URL:
   `https://unq-discord-proxy.<your-subdomain>.workers.dev`

---

## 🌐 Option B: Deploy via Cloudflare Dashboard (30 Seconds, No Installs)
1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Navigate to **Workers & Pages** ➔ **Create Application** ➔ **Create Worker**.
3. Name it `unq-discord-proxy` and click **Deploy**.
4. Click **Edit code**, select all, and paste the code from `worker.js`.
5. Click **Deploy**. Your worker URL is ready!

---

## 🔗 Connect to Render (Auto-Restart on Same Domain)
1. Go to your Render Dashboard ➔ `unq-02h0` service ➔ **Environment**.
2. Add a new Environment Variable:
   - **Key**: `DISCORD_API_BASE`
   - **Value**: `https://unq-discord-proxy.<your-subdomain>.workers.dev/api/v9`
3. Click **Save Changes**. Render will automatically restart on `https://unq-02h0.onrender.com` using the proxy — **zero 429 errors!**
