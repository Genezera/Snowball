@echo off
REM Motor de spread entre exchanges, 5x, supervisionado.
REM US$ 100 EM CADA exchange, 6 exchanges (binanceusdm, bybit, okx, gate,
REM bitget, bingx) -- lucro rastreado por exchange individualmente, pra
REM comparar qual rende mais. Nenhum saque entre elas -- o socorro de
REM margem vem da reserva na propria exchange.
REM NENHUMA ORDEM E ENVIADA - as exchanges sao apenas lidas.
cd /d "%~dp0"

:loop
echo [%date% %time%] iniciando motor de spread 5x >> spread\supervisor.log
node --env-file-if-exists=.env src\cli\spread-live.ts --porExchange 100 --alavancagem 5 --exchanges binanceusdm,bybit,okx,gate,bitget,bingx >> spread\live.log 2>&1
echo [%date% %time%] terminou (codigo %errorlevel%), reiniciando em 60s >> spread\supervisor.log
timeout /t 60 /nobreak > nul
goto loop
