@echo off
REM Lance un serveur HTTP local pour Cubecraft.
REM Necessite Python 3 installe et accessible dans le PATH.

cd /d "%~dp0"
echo.
echo ==========================================
echo  Cubecraft - serveur local
echo ==========================================
echo.
echo  Ouvre ton navigateur sur :
echo    http://localhost:8080
echo.
echo  Appuie sur Ctrl+C pour arreter.
echo.

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERREUR] Python n'a pas ete trouve dans le PATH.
    echo Installe Python 3 depuis https://www.python.org/ ou utilise une autre methode (voir README.md).
    pause
    exit /b 1
)

start "" "http://localhost:8080"
python -m http.server 8080
