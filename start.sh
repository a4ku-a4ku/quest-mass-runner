#!/usr/bin/env bash
# ====================================================================
# A4KU // Mass Discord Quest Runner (10-Slot Concurrency Pool)
# Linux & 24/7 Cloud / VPS / Pterodactyl Launcher
# ====================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================================"
echo "⚡ A4KU Mass Discord Quest Runner (10-Slot Engine)"
echo "============================================================"

# Check node
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed!"
    echo "Please install Node.js 18+ to run this server."
    exit 1
fi

echo "Node.js Version: $(node -v)"

# Ensure tokens.txt exists
if [ ! -f "tokens.txt" ]; then
    echo "Creating tokens.txt..."
    echo "# Put Discord tokens here (one per line)" > tokens.txt
fi

echo "Starting Server on port 3001..."
exec node server.js
