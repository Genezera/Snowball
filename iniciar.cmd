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
REM NENHUMA ORDEM E ENVIADA EM NENHUM MODO. As exchanges sao apenas lidas.
REM ---------------------------------------------------------------------------
cd /d "%~dp0"

for /f %%c in ('powershell -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \"Name='"'"'bash.exe'"'"'\" | Where-Object { $_.CommandLine -like '"'"'*supervisor.sh*'"'"' }).Count"') do set JA_RODANDO=%%c

if not "%JA_RODANDO%"=="0" (
  echo O watchdog ja esta rodando ^(%JA_RODANDO% processo^(s^) bash encontrados^).
  echo Nao subi uma segunda instancia -- isso faria dois processos escreverem
  echo no mesmo estado.json ao mesmo tempo. Se quer reiniciar de verdade,
  echo rode parar.cmd primeiro.
  echo.
  echo Dashboard: http://localhost:8787
  pause
  exit /b 0
)

where bash >nul 2>nul
if %errorlevel%==0 (
  set BASH_EXE=bash
) else if exist "C:\Program Files\Git\bin\bash.exe" (
  set "BASH_EXE=C:\Program Files\Git\bin\bash.exe"
) else (
  echo Nao encontrei o bash do Git for Windows nem no PATH nem no local padrao.
  echo Instale o Git for Windows ^(https://git-scm.com/download/win^) ou rode
  echo manualmente: bash scripts/supervisor.sh
  pause
  exit /b 1
)

start "Snowball - Watchdog (supervisor.sh)" /min "%BASH_EXE%" scripts/supervisor.sh

echo Watchdog iniciado. Ele sobe os 8 processos na ordem certa e religa
echo sozinho qualquer um que cair.
echo.
echo Aguardando o dashboard responder...
set TENTATIVAS=0
:esperar
timeout /t 2 /nobreak > nul
set /a TENTATIVAS+=1
powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri http://localhost:8787/api/dados -UseBasicParsing -TimeoutSec 2).StatusCode } catch { 0 }" | findstr "200" >nul
if %errorlevel%==0 goto pronto
if %TENTATIVAS% GEQ 30 (
  echo Ainda subindo depois de 60s -- normal se for a primeira vez ^(a
  echo vigilancia varre o mercado inteiro antes do motor comecar^). Confira
  echo vigilancia\supervisor-watchdog.log se demorar muito mais que isso.
  goto fim
)
goto esperar

:pronto
echo.
echo Tudo no ar. Dashboard: http://localhost:8787

:fim
echo.
pause
