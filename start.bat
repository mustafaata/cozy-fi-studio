@echo off
chcp 65001 >nul
title Cozy-Fi Studio

cd /d "%~dp0"

REM -----------------------------------------------------------------------------
REM GIPHY API Anahtari
REM -----------------------------------------------------------------------------
if not defined COZY_PORT set "COZY_PORT=5000"
REM Sanal ortami aktif et
if exist ".venv\Scripts\activate.bat" (
    call ".venv\Scripts\activate.bat"
) else (
    echo Uyari: .venv sanal ortami bulunamadi.
)

echo ==================================================
echo Cozy-Fi Studio Baslatiliyor...
echo Adres: http://127.0.0.1:%COZY_PORT%
echo ==================================================

python serve.py
pause
