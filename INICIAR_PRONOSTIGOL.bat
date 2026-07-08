@echo off
title PronostiGol Demo
cd /d "%~dp0"
echo.
echo  Iniciando PronostiGol Demo...
echo  Esta version usa http://localhost:8010 para no mezclar tu historial privado.
echo  Esta ventana debe permanecer abierta mientras usas la aplicacion.
echo.
set PORT=8010
start "" "http://localhost:8010"
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
