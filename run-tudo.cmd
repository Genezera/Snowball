@echo off
REM ---------------------------------------------------------------------------
REM Sobe os cinco processos do sistema, cada um com seu proprio supervisor.
REM
REM   VIGILANCIA  varre o mercado inteiro (3.492 pares) e mantem o historico
REM   CUSTODIA    saude das exchanges, sinal de evacuacao
REM   MOTOR       gerencia a posicao, consumindo o ranking da vigilancia
REM   DASHBOARD   painel em http://localhost:8787
REM   COLETOR     arquiva pra sempre o que a poda de 7 dias apagaria
REM
REM A ordem importa: a vigilancia sobe primeiro para que o motor ja encontre
REM dado fresco no primeiro ciclo, em vez de cair para a varredura estreita.
REM
REM NENHUMA ORDEM E ENVIADA. As exchanges sao apenas lidas.
REM ---------------------------------------------------------------------------
cd /d "%~dp0"

start "Snowball Vigilancia" /min cmd /c run-vigilancia.cmd
start "Snowball Custodia" /min cmd /c run-custodia.cmd
timeout /t 25 /nobreak > nul
start "Snowball Motor" /min cmd /c run-spread.cmd
timeout /t 5 /nobreak > nul
start "Snowball Dashboard" /min cmd /c run-dashboard.cmd
start "Snowball Coletor" /min cmd /c run-coletor.cmd

echo Cinco processos iniciados.
echo   vigilancia  varre o mercado a cada 5 min
echo   motor       gerencia a posicao a cada 20 min
echo   dashboard   http://localhost:8787
echo   coletor     arquiva historico de longo prazo a cada 5 min
echo.
echo   npm run analise   -^> relatorio do que foi coletado, a qualquer momento
