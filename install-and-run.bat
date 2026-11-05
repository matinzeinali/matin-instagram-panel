@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Matin Instagram Panel

cd /d "%~dp0"

echo.
echo ==========================================
echo       MATIN INSTAGRAM PANEL
echo ==========================================
echo.

if not exist "package.json" (
    echo [ERROR] package.json was not found.
    echo Put this BAT file in the project root folder.
    goto :failed
)

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found in PATH.
    echo Install Node.js LTS, then close and reopen this window.
    goto :failed
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm was not found in PATH.
    echo Repair or reinstall Node.js, then try again.
    goto :failed
)

echo Node.js:
node -v
echo npm:
call npm -v
echo.

if not exist ".env.local" (
    if exist ".env.example" (
        echo Creating .env.local from .env.example...
        copy /y ".env.example" ".env.local" >nul
        if errorlevel 1 (
            echo [ERROR] Could not create .env.local.
            goto :failed
        )
        echo Add your Zernio API key to .env.local if you have one.
        start "Edit .env.local" notepad.exe "%CD%\.env.local"
        echo Save and close Notepad to continue.
        pause
    ) else (
        echo [WARNING] .env.example was not found. Continuing without .env.local.
    )
) else (
    echo .env.local already exists. Keeping it unchanged.
)

echo.
if not exist "node_modules" (
    echo Installing project dependencies...
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] npm install failed. Check your internet connection and try again.
        goto :failed
    )
) else (
    echo Dependencies are already installed.
)

echo.
echo Starting the development server...
echo Open http://localhost:3000 in your browser.
echo Keep this window open while using the panel.
echo Press Ctrl+C to stop the server.
echo.
call npm run dev
set "SERVER_EXIT=%ERRORLEVEL%"

echo.
echo The development server has stopped with exit code %SERVER_EXIT%.
pause
endlocal
exit /b %SERVER_EXIT%

:failed
echo.
pause
endlocal
exit /b 1