@echo off
title A4KU - Push to GitHub
echo ============================================================
echo   Pushing Quest Mass Runner to GitHub...
echo ============================================================
echo.

"%LOCALAPPDATA%\GitHubDesktop\app-3.6.4\resources\app\git\cmd\git.exe" push -u origin main

echo.
if %ERRORLEVEL% EQU 0 (
  echo [SUCCESS] Code successfully pushed to GitHub!
  echo Repository: https://github.com/a4ku-a4ku/quest-mass-runner
) else (
  echo [INFO] If your repository is not yet created on GitHub, please
  echo make sure you have clicked "Create repository" on GitHub:
  echo https://github.com/new?name=quest-mass-runner
)
echo.
pause
