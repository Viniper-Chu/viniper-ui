@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set VINIPER_UI_PORT=17373
echo.
echo   Viniper UI Starting...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:17373/api/status' -TimeoutSec 2 | Out-Null; Start-Process 'http://127.0.0.1:17373'; exit 0 } catch { exit 1 }"
if %errorlevel%==0 exit /b 0
call python -m pip install -q -r requirements.txt
call python server.py
pause
