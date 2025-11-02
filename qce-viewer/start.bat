@echo off
chcp 65001 > nul

REM Check if Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not detected. Please install Node.js first.
    echo Download: https://nodejs.org/
    pause
    exit /b 1
)

REM Check if dependencies are installed
if not exist "node_modules\" (
    echo [INFO] First run, installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
    echo.
)

REM Start server
echo [INFO] Starting server...
node server.js
