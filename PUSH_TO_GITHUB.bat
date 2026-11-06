@echo off
title B2R - Push to GitHub (Auto-Deploy to Render)
echo ============================================================
echo   Pushing B2R Quest Notice to GitHub...
echo   (Render will auto-deploy & restart on your domain)
echo ============================================================
echo.

set "GIT_EXE=git"
where git >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  if exist "%LOCALAPPDATA%\GitHubDesktop\app-3.6.4\resources\app\git\cmd\git.exe" (
    set "GIT_EXE=%LOCALAPPDATA%\GitHubDesktop\app-3.6.4\resources\app\git\cmd\git.exe"
  ) else if exist "C:\Program Files\Git\cmd\git.exe" (
    set "GIT_EXE=C:\Program Files\Git\cmd\git.exe"
  )
)

echo [1/3] Staging changes...
"%GIT_EXE%" add -A

echo [2/3] Committing changes...
"%GIT_EXE%" commit -m "Update: Web runner retired, B2R server notice with discord.gg/b2r & quest role instructions"

echo [3/3] Pushing to GitHub...
"%GIT_EXE%" push -u origin main

echo.
if %ERRORLEVEL% EQU 0 (
  echo [SUCCESS] Code successfully pushed to GitHub!
  echo Render is now automatically building & restarting with the new B2R notice!
) else (
  echo [INFO] Push finished or no remote changes. If using GitHub Desktop app, simply click 'Commit' & 'Push origin'.
)
echo.
pause
