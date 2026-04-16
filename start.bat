@echo off
title AutoRewardPlus
cd /d "%~dp0"
echo ========================================
echo   AutoRewardPlus - Microsoft Rewards
echo ========================================
echo.

:: Check if node is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found! Please install from https://nodejs.org
    pause
    exit /b 1
)

:: Always rebuild before running
echo [INFO] Building project...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Build failed!
    pause
    exit /b 1
)

:: Run
echo.
echo [INFO] Starting bot...
echo.
node ./dist/index.js
echo.
echo ========================================
echo   Bot finished. Press any key to close.
echo ========================================
pause
