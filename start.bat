@echo off
title A4KU Mass Discord Quest Runner (12 Slots)
color 0f
cls
echo ====================================================================
echo   A4KU // Mass Discord Quest Runner - 12-Slot Concurrency Pool
echo   Local & 24/7 VPS Hosting System
echo ====================================================================
echo.

cd /d "%~dp0"

echo [1/3] Checking Node.js runtime...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js 18+ from https://nodejs.org/
    pause
    exit /b 1
)

node -v

echo.
echo [2/3] Checking tokens.txt file...
if not exist "tokens.txt" (
    echo Creating default tokens.txt...
    echo # Put Discord tokens here ^(one per line^) > tokens.txt
)

echo.
echo [3/3] Launching A4KU Mass Quest Server...
echo --------------------------------------------------------------------
echo Web Dashboard will open at http://localhost:3001
echo --------------------------------------------------------------------
echo.

start "" "http://localhost:3001"
node server.js

pause
