@echo off
setlocal
cd /d "%~dp0"

echo.
echo ==========================================
echo  Cubecraft - test local (version minimale)
echo ==========================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERREUR] Node.js n'est pas trouve dans le PATH.
  echo Installe Node.js puis relance ce script.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installation des dependances...
  call npm install
  if %errorlevel% neq 0 (
    echo [ERREUR] npm install a echoue.
    pause
    exit /b 1
  )
)

echo Lancement du serveur local...
start "" "http://localhost:8080"
node server.js
