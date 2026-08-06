# Para os 8 processos e o watchdog, com seguranca:
#
#   1. Mata o WATCHDOG primeiro -- se matasse os processos antes, ele
#      religaria por cima no meio da parada (a mesma cascata ja documentada
#      neste projeto quando duas camadas de supervisao coexistiam).
#   2. So depois mata os 8 processos, um por um, por nome do arquivo (o
#      mesmo jeito que o watchdog usa pra achar cada um).
#
# Nao apaga nenhum estado, diario ou log -- cada motor grava o proprio
# estado.json a cada ciclo, entao nao ha "perda" ao matar o processo: ao
# rodar iniciar.cmd de novo, cada um retoma exatamente de onde parou.

$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

Write-Host "Parando o watchdog..."
Get-CimInstance Win32_Process -Filter "Name='bash.exe'" |
  Where-Object { $_.CommandLine -like '*supervisor.sh*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "Parando os processos..."
$padroes = @('vigilancia.ts', 'custodia.ts', 'spread-live.ts', 'server.ts', 'coletor.ts', 'momentum-live.ts', 'pares-live.ts', 'preenchimento-live.ts')
foreach ($p in $padroes) {
  $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$p*" }
  if ($procs) {
    $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Write-Host "  parado: $p"
  } else {
    Write-Host "  ja estava parado: $p"
  }
}

Write-Host ""
Write-Host "Verificando se sobrou algo vivo..."
Start-Sleep -Seconds 1
$sobrou = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'vigilancia\.ts|custodia\.ts|spread-live\.ts|server\.ts|coletor\.ts|momentum-live\.ts|pares-live\.ts|preenchimento-live\.ts' }
if ($sobrou) {
  Write-Host "AINDA VIVO:"
  $sobrou | Select-Object ProcessId, CommandLine | Format-Table -AutoSize
} else {
  Write-Host "Tudo parado."
}

Write-Host ""
Write-Host "Estado de cada motor ficou salvo em disco (spread\, momentum\, pares\,"
Write-Host "preenchimento\, vigilancia\). Rode iniciar.cmd quando quiser voltar --"
Write-Host "cada processo retoma sozinho de onde parou, sem precisar de nada manual."
