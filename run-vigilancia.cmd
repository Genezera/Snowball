@echo off
REM Vigilancia continua do mercado inteiro, supervisionada.
REM Varre 3.492 pares em 5 exchanges e mantem o historico de cada oportunidade.
REM NENHUMA ORDEM E ENVIADA.
cd /d "%~dp0"

:loop
echo [%date% %time%] iniciando vigilancia >> vigilancia\supervisor.log
node src\cli\vigilancia.ts --equity 100 --intervalo 5 >> vigilancia\live.log 2>&1
echo [%date% %time%] terminou (codigo %errorlevel%), reiniciando em 60s >> vigilancia\supervisor.log
timeout /t 60 /nobreak > nul
goto loop
