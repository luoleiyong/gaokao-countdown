@echo off
setlocal
set "HERE=%~dp0"
set "APP="
for %%I in ("%HERE%..\dist*\win-unpacked\*.exe") do if not defined APP set "APP=%%~fI"
if not defined APP for %%I in ("%HERE%..\*.exe") do if not defined APP set "APP=%%~fI"
where node >nul 2>nul
if not errorlevel 1 (
  node "%HERE%admin-unlock-ui.js" %*
  goto :done
)
if defined APP (
  set "ELECTRON_RUN_AS_NODE=1"
  "%APP%" "%HERE%admin-unlock-ui.js" %*
  goto :done
)
echo Node.js not found. Install Node.js, or keep a built app under dist*.
pause
:done
