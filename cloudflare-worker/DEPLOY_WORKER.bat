@echo off
title A4KU - Deploy Cloudflare Worker Proxy
color 0b
echo ============================================================
echo   A4KU // Deploy Discord Proxy Cloudflare Worker
echo ============================================================
echo.
echo Step 1: Logging into Cloudflare (or using cached login)...
echo.
npx wrangler deploy
echo.
echo ============================================================
echo Once deployed, copy your worker URL (e.g. https://b2r-discord-proxy.<name>.workers.dev)
echo and set it in your Render environment variables or config.json:
echo   DISCORD_API_BASE = https://b2r-discord-proxy.<name>.workers.dev/api/v9
echo ============================================================
pause
