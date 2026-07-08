@echo off
title PronostiGol
cd /d "%~dp0"
echo.
echo  Iniciando PronostiGol...
echo  Esta ventana debe permanecer abierta mientras usas la aplicacion.
echo.
start "" "http://localhost:8000"
where python >nul 2>nul
if %errorlevel%==0 (
  python server.py
) else (
  py server.py
)
if errorlevel 1 (
  echo.
  echo No se pudo iniciar. Verifica que Python este instalado.
  pause
)
