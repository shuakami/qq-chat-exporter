@echo off
chcp 65001 > nul
title QCE 独立模式

echo.
echo [QCE] 独立模式启动器
echo [QCE] 无需登录QQ即可浏览已导出的聊天记录
echo.

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

:: 检查依赖
if not exist "node_modules\" (
    echo [信息] 首次运行，正在安装依赖...
    call npm install
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
)

:: 检查插件依赖
if not exist "plugins\qq-chat-exporter\node_modules\" (
    echo [信息] 正在安装插件依赖...
    cd plugins\qq-chat-exporter
    call npm install
    cd ..\..
)

:: 启动独立模式
echo [信息] 正在启动独立模式服务器...
echo.
node scripts/start-standalone.mjs %1

pause
