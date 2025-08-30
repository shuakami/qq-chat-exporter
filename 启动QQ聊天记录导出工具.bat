@echo off
chcp 65001 >nul
title QQ Chat Exporter Pro V3
echo.
echo ================================
echo   QQ Chat Exporter Pro V3
echo ================================
echo.
echo 正在启动程序...
echo.

if exist "qq-chat-exporter.exe" (
    qq-chat-exporter.exe
) else if exist "qq-chat-exporter-windows-amd64.exe" (
    qq-chat-exporter-windows-amd64.exe
) else if exist "qq-chat-exporter-windows-arm64.exe" (
    qq-chat-exporter-windows-arm64.exe
) else (
    echo 错误：找不到可执行文件！
    echo 请确认以下文件之一存在：
    echo - qq-chat-exporter.exe
    echo - qq-chat-exporter-windows-amd64.exe
    echo - qq-chat-exporter-windows-arm64.exe
    echo.
)

echo.
echo 程序已结束，按任意键关闭窗口...
pause >nul