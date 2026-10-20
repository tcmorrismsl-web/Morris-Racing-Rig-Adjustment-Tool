@echo off
title Morris Racing bridge
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
node "bridge\bridge.js"
echo.
pause
exit /b 0

:nonode
echo.
echo   Node.js is not installed yet. It runs the bridge.
echo.
echo   1. Your browser is opening nodejs.org. Download the LTS version for Windows.
echo   2. Install it with the default options.
echo   3. Double-click this file again.
echo.
start "" "https://nodejs.org/en/download"
pause
exit /b 1
