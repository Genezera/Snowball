@echo off
REM ---------------------------------------------------------------------------
REM Para os 8 processos e o watchdog, com seguranca. A logica de verdade fica
REM em scripts/parar.ps1 -- mesma razao do iniciar.cmd (robustez de quoting).
REM
REM   1. Mata o WATCHDOG primeiro -- se matasse os processos antes, ele
REM      religaria por cima no meio da parada.
REM   2. So depois mata os 8 processos, por nome do arquivo.
REM
REM Nao apaga nenhum estado, diario ou log -- cada motor grava o proprio
REM estado.json a cada ciclo, entao nao ha "perda" ao matar o processo.
REM ---------------------------------------------------------------------------
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\parar.ps1"
echo.
pause
