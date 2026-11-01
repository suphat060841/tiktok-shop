@echo off
title TikTok Live AI - Smart Selling Studio
color 0b
cls
echo ======================================================================
echo       TikTok Live AI - Smart Selling Studio (v3.0)
echo ======================================================================
echo.
echo [1] Dashboard:      http://localhost:3000
echo [2] Stream Overlay: http://localhost:3000/stream-overlay
echo.
echo Starting Server and opening browser...
start http://localhost:3000 2>nul
echo.
cd /d "%~dp0"
node server.js
pause
