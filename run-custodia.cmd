@echo off
REM Monitor de saude de custodia das exchanges, supervisionado.
REM Saque suspenso e o sinal de evacuacao: aparece nos dados antes da noticia.
REM NENHUMA ORDEM E ENVIADA.
cd /d "%~dp0"

:loop
echo [%date% %time%] iniciando monitor de custodia >> vigilancia\supervisor.log
node src\cli\custodia.ts --intervalo 15 >> vigilancia\custodia.log 2>&1
echo [%date% %time%] terminou (codigo %errorlevel%), reiniciando em 60s >> vigilancia\supervisor.log
timeout /t 60 /nobreak > nul
goto loop
