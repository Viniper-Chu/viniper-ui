@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
if "%VINIPER_UI_PORT%"=="" set VINIPER_UI_PORT=17373
echo.
echo   Viniper UI Starting...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $port=[int]$env:VINIPER_UI_PORT; $url=\"http://127.0.0.1:$port\"; $localVersion=(Get-Content -Raw -LiteralPath 'VERSION' -ErrorAction SilentlyContinue).Trim(); try { $status=Invoke-RestMethod -Uri \"$url/api/status\" -TimeoutSec 2; if ($localVersion -and $status.version -and $status.version -ne $localVersion) { $conn=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($conn) { Stop-Process -Id $conn.OwningProcess -Force; Start-Sleep -Milliseconds 800; exit 1 } }; Start-Process $url; exit 0 } catch { exit 1 }"
if %errorlevel%==0 exit /b 0
call python -m pip install -q -r requirements.txt
call python server.py
pause
