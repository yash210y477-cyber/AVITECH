@echo off
setlocal
cd /d "%~dp0"
echo ==============================================
echo AVITECH - Proctoring Model Setup
echo ==============================================
python scripts\download_proctor_models.py
if errorlevel 1 (
  echo.
  echo Model setup failed. The exam must NOT be deployed until this succeeds.
  pause
  exit /b 1
)
echo.
echo Proctoring model installed successfully.
pause
