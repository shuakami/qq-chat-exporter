@echo off
title QQ Chat Exporter Pro V3
echo.
echo ================================
echo   QQ Chat Exporter Pro V3
echo ================================
echo.
echo Starting program...
echo.

if exist "qq-chat-exporter.exe" (
    qq-chat-exporter.exe
) else if exist "qq-chat-exporter-windows-amd64.exe" (
    qq-chat-exporter-windows-amd64.exe
) else if exist "qq-chat-exporter-windows-arm64.exe" (
    qq-chat-exporter-windows-arm64.exe
) else (
    echo Error: Cannot find executable file!
    echo Please make sure one of these files exists:
    echo - qq-chat-exporter.exe
    echo - qq-chat-exporter-windows-amd64.exe
    echo - qq-chat-exporter-windows-arm64.exe
    echo.
)

echo.
echo Program finished. Press any key to close...
pause >nul