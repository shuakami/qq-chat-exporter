@echo off
chcp 65001
set NAPCAT_PATCH_PACKAGE=%cd%\qqnt.json
set NAPCAT_LOAD_PATH=%cd%\loadNapCat.js
set NAPCAT_INJECT_PATH=%cd%\NapCatWinBootHook.dll
set NAPCAT_LAUNCHER_PATH=%cd%\NapCatWinBootMain.exe
set NAPCAT_MAIN_PATH=%cd%\napcat.mjs
:loop_read
for /f "tokens=2*" %%a in ('reg query "HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\QQ" /v "UninstallString"') do (
    set RetString=%%b
    goto :napcat_boot
)

:napcat_boot
for %%a in ("%RetString%") do (
    set "pathWithoutUninstall=%%~dpa"
)

SET QQPath=%pathWithoutUninstall%QQ.exe

if not exist "%QQpath%" (
    echo provided QQ path is invalid
    pause
    exit /b
)
set NAPCAT_MAIN_PATH=%NAPCAT_MAIN_PATH:\=/%
echo (async () =^> {await import("file:///%NAPCAT_MAIN_PATH%")})() > "%NAPCAT_LOAD_PATH%"

REM 增加 Node.js 内存限制以支持大量消息导出并启用垃圾回收
set NODE_OPTIONS=--max-old-space-size=8192 --expose-gc
"%NAPCAT_LAUNCHER_PATH%" "%QQPath%" "%NAPCAT_INJECT_PATH%" %1

REM "%NAPCAT_LAUNCHER_PATH%" "%QQPath%" "%NAPCAT_INJECT_PATH%" 123456

pause