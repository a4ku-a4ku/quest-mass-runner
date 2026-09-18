@echo off
title A4KU Mass Quest Runner - Share With Friends (Public Tunnel)
color 0f
cls
echo ====================================================================
echo   A4KU // Share Local Dashboard with Friends (Instant Public Link)
echo ====================================================================
echo.
echo Connecting secure public tunnel to http://localhost:3001...
echo.
echo Look for the "https://....lhr.life" link below and copy it for your friend!
echo (Keep this window open while sharing)
echo --------------------------------------------------------------------
echo.

ssh -o StrictHostKeyChecking=no -R 80:localhost:3001 nokey@localhost.run

pause
