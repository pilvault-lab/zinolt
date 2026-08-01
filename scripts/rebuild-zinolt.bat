@echo off
REM One-click: rebuild Zinolt and restart the always-on prod server.
REM   1. npm run build   (compile the new code)
REM   2. stop the running server (Stop-ScheduledTask + kill node.exe)
REM   3. re-fire the scheduled task so the server picks up the new build
REM Hard-refresh the browser tab (Ctrl+Shift+R) after this finishes.

setlocal
cd /d "%~dp0.."

echo.
echo === Building Zinolt (npm run build) ===
call npm run build
if errorlevel 1 (
    echo.
    echo BUILD FAILED. Server not restarted.
    pause
    exit /b 1
)

echo.
echo === Restarting the prod server ===
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Stop-ScheduledTask -TaskName 'ZinoltProdServer' -ErrorAction SilentlyContinue;" ^
  "Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force;" ^
  "Start-Sleep -Seconds 1;" ^
  "Start-ScheduledTask -TaskName 'ZinoltProdServer';" ^
  "Start-Sleep -Seconds 5;" ^
  "try { $r = Invoke-WebRequest -Uri 'http://localhost:3001/clip-studio' -UseBasicParsing -TimeoutSec 5; Write-Host ('  Server up: HTTP ' + $r.StatusCode) } catch { Write-Host ('  Server did not respond: ' + $_.Exception.Message) }"

echo.
echo Done. Hard-refresh your browser tab (Ctrl+Shift+R).
timeout /t 3 >nul
