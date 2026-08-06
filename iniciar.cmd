@echo off
REM ---------------------------------------------------------------------------
REM Sobe o watchdog (scripts/supervisor.sh), que por sua vez sobe e supervisiona
REM os 8 processos do sistema, cada um lendo o proprio estado salvo em disco
REM (nao ha "resetar" ao reiniciar -- cada motor retoma de onde parou):
REM
REM   VIGILANCIA     varre o mercado inteiro e mantem o historico
REM   CUSTODIA       saude das exchanges, sinal de evacuacao
REM   MOTOR          delta-neutro, gerencia posicao pelo ranking da vigilancia
REM   DASHBOARD      painel em http://localhost:8787
REM   COLETOR        arquiva pra sempre o que a poda de 7 dias apagaria
REM   MODO AGRESSIVO ts-momentum multi-ativo, capital proprio
REM   PARES          pares cointegrados, mercado-neutro, capital proprio
REM   PREENCHIMENTO  mede se ordem limite preenche rapido o bastante
REM
REM O watchdog cuida da ORDEM e da religada automatica sozinho -- por isso
REM este arquivo so precisa subir UM processo, nao oito.
REM
REM A logica de verdade fica em scripts/iniciar.ps1 -- PowerShell embutido
REM dentro de um .cmd (aspas simples dentro de aspas duplas dentro de
REM 'for /f') e fragil o bastante pra falhar de formas diferentes dependendo
REM de como este .cmd e chamado. Achado rodando de verdade, nao em teoria.
REM
REM NENHUMA ORDEM E ENVIADA EM NENHUM MODO. As exchanges sao apenas lidas.
REM ---------------------------------------------------------------------------
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\iniciar.ps1"
echo.
pause
