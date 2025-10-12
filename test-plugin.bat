@echo off
chcp 65001 >nul
echo ========================================
echo QCE Plugin Test
echo ========================================
echo.
cd /d "%~dp0"
node test-plugin-loader.mjs
echo.
echo ========================================
echo Test completed
echo ========================================
pause

