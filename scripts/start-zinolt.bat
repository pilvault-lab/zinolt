@echo off
REM Auto-started by the "ZinoltProdServer" scheduled task at Windows logon.
REM Serves the pre-built Next.js production server on port 3001.
REM Rebuild after code changes with:  npm run build

cd /d "%~dp0.."
set PATH=C:\ffmpeg\bin;%PATH%
set PORT=3001
call npm start
