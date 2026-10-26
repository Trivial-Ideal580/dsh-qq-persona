@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

set "PROFILE=%~1"
if "%PROFILE%"=="" set "PROFILE=qqbot"

set "NODE="
node -v >nul 2>nul
if not errorlevel 1 set "NODE=node"
if defined NODE goto run
set "DSHNODE=%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
if exist "%DSHNODE%" set "NODE=%DSHNODE%"
if defined NODE goto run
goto nonode

:run
set "OPENFLAG=--open"
if defined QQ_PERSONA_NO_OPEN set "OPENFLAG="
echo.
echo   Starting QQ Persona Studio ...
echo.
"%NODE%" "%~dp0studio\server.mjs" --profile %PROFILE% %OPENFLAG%
set "CODE=%errorlevel%"
echo.
if not "%CODE%"=="0" echo   Studio exited with code %CODE%.
echo   Studio closed.
pause
exit /b %CODE%

:nonode
echo.
echo   [ERROR] Node.js not found.
echo   Install Node.js 20+ or add node.exe to PATH.
echo.
pause
exit /b 1
