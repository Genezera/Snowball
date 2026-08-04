@echo off
REM Coletor de longo prazo, supervisionado.
REM Arquiva o que a poda de 7 dias da vigilancia apagaria: observacoes brutas,
REM ciclos de vida fechados, saude de custodia ao longo do tempo.
REM NENHUMA ORDEM E ENVIADA - so leitura de arquivo local.
cd /d "%~dp0"

:loop
echo [%date% %time%] iniciando coletor >> vigilancia\supervisor.log
node src\cli\coletor.ts --intervalo 5 >> vigilancia\coletor.log 2>&1
echo [%date% %time%] terminou (codigo %errorlevel%), reiniciando em 60s >> vigilancia\supervisor.log
timeout /t 60 /nobreak > nul
goto loop
