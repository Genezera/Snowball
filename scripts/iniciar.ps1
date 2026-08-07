# Sobe o watchdog (scripts/supervisor.sh), que sobe e supervisiona os 8
# processos do sistema sozinho, cada um lendo o proprio estado salvo em
# disco (nao ha "resetar" ao reiniciar -- cada motor retoma de onde parou).
#
# Um arquivo .ps1 de verdade em vez de PowerShell embutido dentro de um
# .cmd: a versao embutida (aspas simples dentro de aspas duplas dentro de
# 'for /f' do cmd.exe) e fragil o bastante pra falhar de formas diferentes
# dependendo de como o .cmd e chamado -- achado rodando de verdade, nao em
# teoria, testando este exato script duas vezes.
#
# NENHUMA ORDEM E ENVIADA EM NENHUM MODO. As exchanges sao apenas lidas.

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

$jaRodando = @(Get-CimInstance Win32_Process -Filter "Name='bash.exe'" |
  Where-Object { $_.CommandLine -like '*supervisor.sh*' }).Count

if ($jaRodando -gt 0) {
  Write-Host "O watchdog ja esta rodando ($jaRodando processo(s) bash encontrados)."
  Write-Host "Nao subi uma segunda instancia -- isso faria dois processos escreverem"
  Write-Host "no mesmo estado.json ao mesmo tempo. Se quer reiniciar de verdade,"
  Write-Host "rode parar.cmd primeiro."
  Write-Host ""
  Write-Host "Dashboard: http://localhost:8787"
  exit 0
}

# CUIDADO: o Windows tambem tem um `bash.exe` em C:\WINDOWS\system32 -- o
# shim do WSL, nao o Git Bash. `Get-Command bash` costuma achar ESSE
# primeiro (System32 vem cedo no PATH), e supervisor.sh nao roda no
# ambiente do WSL do mesmo jeito (caminho relativo, working directory,
# tudo diferente). Achado rodando de verdade: o processo "subia" sem erro
# nenhum e nunca fazia nada. Por isso o caminho conhecido do Git Bash vem
# PRIMEIRO aqui, e so cai pro PATH se ele especificamente nao existir.
$candidatosGitBash = @(
  "C:\Program Files\Git\bin\bash.exe",
  "C:\Program Files (x86)\Git\bin\bash.exe"
)
$bashExe = $candidatosGitBash | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $bashExe) {
  $doPath = (Get-Command bash -ErrorAction SilentlyContinue).Source
  if ($doPath -and $doPath -notlike '*system32*') { $bashExe = $doPath }
}

if (-not $bashExe) {
  Write-Host "Nao encontrei o bash do Git for Windows (nem no local padrao, nem no"
  Write-Host "PATH -- e o bash.exe do WSL em System32, se existir, nao serve pra isto)."
  Write-Host "Instale o Git for Windows (https://git-scm.com/download/win) ou rode"
  Write-Host "manualmente: bash scripts/supervisor.sh"
  exit 1
}

# CUIDADO 2: `Start-Process` sozinho NAO desanexa de verdade quando quem
# chama e um terminal como Windows Terminal ou VS Code -- esses terminais
# colocam todo processo filho (mesmo com janela propria/minimizada) no MESMO
# "job object" da janela, com a flag "matar tudo ao fechar o job". Fechar a
# janela do terminal (o X, nao so o .cmd) mata o watchdog e os 8 processos
# junto, mesmo eles tendo sobrevivido normalmente a um `exit`. Achado ao
# vivo: fechar a janela do cmd derrubou o sistema inteiro sem nenhum erro.
#
# Tentativa 1 (descartada): Agendador de Tarefas (`schtasks`) -- roda fora
# de qualquer job object de terminal, mas `/create` deu "Acesso negado"
# nesta maquina sem elevacao, mesmo sem `/rl highest`. Nao dava pra exigir
# admin so pra ligar o sistema.
#
# Tentativa 2 (esta): criar o processo via WMI (`Win32_Process.Create`).
# Quem de fato chama `CreateProcess` e o servico WMI (`WmiPrvSE.exe`), nao
# o processo atual -- entao o filho nunca entra no job object do terminal
# que chamou este script, e sobrevive a janela ser fechada. Nao exige
# admin pra criar processo na propria sessao do usuario. Validado ao vivo:
# matei a forca o cmd.exe pai (simulando fechar a janela) e o watchdog +
# os 8 processos continuaram rodando.
$comando = "`"$bashExe`" `"$raiz\scripts\supervisor.sh`""
$resultado = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $comando; CurrentDirectory = $raiz }
if ($resultado.ReturnValue -ne 0) {
  Write-Host "Falha ao criar o processo via WMI (codigo $($resultado.ReturnValue))."
  exit 1
}

Write-Host "Watchdog iniciado. Ele sobe os 8 processos na ordem certa e religa"
Write-Host "sozinho qualquer um que cair."
Write-Host ""
Write-Host "Aguardando o dashboard responder..."

$pronto = $false
for ($tentativa = 0; $tentativa -lt 30; $tentativa++) {
  Start-Sleep -Seconds 2
  try {
    $resp = Invoke-WebRequest -Uri 'http://localhost:8787/api/dados' -UseBasicParsing -TimeoutSec 2
    if ($resp.StatusCode -eq 200) { $pronto = $true; break }
  } catch { }
}

Write-Host ""
if ($pronto) {
  Write-Host "Tudo no ar. Dashboard: http://localhost:8787"
} else {
  Write-Host "Ainda subindo depois de 60s -- normal se for a primeira vez (a"
  Write-Host "vigilancia varre o mercado inteiro antes do motor comecar). Confira"
  Write-Host "vigilancia\supervisor-watchdog.log se demorar muito mais que isso."
}
