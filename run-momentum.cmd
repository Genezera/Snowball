@echo off
REM Modo agressivo: ts-momentum ao vivo, papel, multi-ativo, supervisionado.
REM US$ 200, risco 0.5%% por posicao (fracao fixa do capital, nao dividida
REM por concorrencia -- e o que o bootstrap por blocos mediu como o ponto
REM mais defensavel depois de corrigir por correlacao real entre posicoes).
REM NENHUMA ORDEM E ENVIADA - as exchanges sao apenas lidas.
cd /d "%~dp0"

:loop
echo [%date% %time%] iniciando modo agressivo (momentum) >> momentum\supervisor.log
node --env-file-if-exists=.env src\cli\momentum-live.ts --equity 200 --risco 0.005 --alavancagem 2 >> momentum\live.log 2>&1
echo [%date% %time%] terminou (codigo %errorlevel%), reiniciando em 60s >> momentum\supervisor.log
timeout /t 60 /nobreak > nul
goto loop
