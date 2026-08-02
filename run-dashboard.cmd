@echo off
REM Dashboard do motor de spread. Somente leitura.
cd /d "%~dp0"

:loop
echo [%date% %time%] iniciando dashboard >> spread\dashboard.log
node src\dashboard\server.ts >> spread\dashboard.log 2>&1
timeout /t 30 /nobreak > nul
goto loop
