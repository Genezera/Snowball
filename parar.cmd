@echo off
REM ---------------------------------------------------------------------------
REM Para os 8 processos e o watchdog, com seguranca:
REM
REM   1. Mata o WATCHDOG primeiro -- se matasse os processos antes, ele
REM      religaria por cima no meio da parada (a mesma cascata ja documentada
REM      neste projeto quando duas camadas de supervisao coexistiam).
REM   2. So depois mata os 8 processos, um por um, por nome do arquivo (o
REM      mesmo jeito que o watchdog usa pra achar cada um).
REM
REM Nao apaga nenhum estado, diario ou log -- cada motor grava o proprio
REM estado.json a cada ciclo, entao nao ha "perda" ao matar o processo: ao
REM rodar iniciar.cmd de novo, cada um retoma exatamente de onde parou.
REM ---------------------------------------------------------------------------
cd /d "%~dp0"

echo Parando o watchdog...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='bash.exe'\" | Where-Object { $_.CommandLine -like '*supervisor.sh*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

echo Parando os processos...
for %%P in (vigilancia.ts custodia.ts spread-live.ts server.ts coletor.ts momentum-live.ts pares-live.ts preenchimento-live.ts) do (
  powershell -NoProfile -Command "$procs = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*%%P*' }; if ($procs) { $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Write-Host '  parado: %%P' } else { Write-Host '  ja estava parado: %%P' }"
)

echo.
echo Verificando se sobrou algo vivo...
powershell -NoProfile -Command "$sobrou = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'vigilancia\.ts|custodia\.ts|spread-live\.ts|server\.ts|coletor\.ts|momentum-live\.ts|pares-live\.ts|preenchimento-live\.ts' }; if ($sobrou) { Write-Host 'AINDA VIVO:'; $sobrou | Select-Object ProcessId, CommandLine | Format-Table -AutoSize } else { Write-Host 'Tudo parado.' }"

echo.
echo Estado de cada motor ficou salvo em disco (spread\, momentum\, pares\,
echo preenchimento\, vigilancia\). Rode iniciar.cmd quando quiser voltar --
echo cada processo retoma sozinho de onde parou, sem precisar de nada manual.
echo.
pause
