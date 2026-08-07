#!/usr/bin/env bash
# Testes da lib de lock — bash puro, sem framework (consistente com o resto
# do projeto, que não usa nenhum runner de teste bash). Sobrescreve as
# funções que tocam o SO real (lock_pid_existe/lock_comando_do_pid) pra
# simular cada cenário sem depender de processos reais vivos/mortos.
set -u
cd "$(dirname "$0")/../.."
DIR_TESTE=$(mktemp -d)
export LOCK_FILE="$DIR_TESTE/supervisor.lock"
export LOCK_STALE_S=90
source scripts/lib/supervisor-lock.sh

falhas=0
total=0
afirmar() {
  local descricao="$1" esperado="$2" obtido="$3"
  total=$((total + 1))
  if [ "$esperado" = "$obtido" ]; then
    echo "  ✔ $descricao"
  else
    echo "  ✖ $descricao — esperado '$esperado', obtido '$obtido'"
    falhas=$((falhas + 1))
  fi
}
prefixo_afirmar() {
  local descricao="$1" prefixo="$2" obtido="$3"
  total=$((total + 1))
  case "$obtido" in
    "$prefixo"*) echo "  ✔ $descricao" ;;
    *) echo "  ✖ $descricao — esperado prefixo '$prefixo', obtido '$obtido'"; falhas=$((falhas + 1)) ;;
  esac
}

echo "== sem lock: ok:sem_lock =="
rm -f "$LOCK_FILE"
afirmar "nenhum lock → ok:sem_lock" "ok:sem_lock" "$(lock_avaliar)"

echo "== segunda instância: lock saudável e legítimo → recusar =="
lock_pid_existe() { return 0; }              # PID "existe"
lock_comando_do_pid() { echo "bash scripts/supervisor.sh"; }  # comando bate
lock_escrever 99999 "$(lock_agora_ms)" "$(lock_agora_ms)" "scripts/supervisor.sh"
prefixo_afirmar "instância saudável → recusar" "recusar:" "$(lock_avaliar)"

echo "== lock stale (heartbeat velho) → recuperar =="
lock_escrever 99999 "$(( $(lock_agora_ms) - 999999 ))" "$(( $(lock_agora_ms) - 999999 ))" "scripts/supervisor.sh"
prefixo_afirmar "heartbeat muito antigo → recuperar" "recuperar:heartbeat_stale" "$(lock_avaliar)"

echo "== PID do lock não existe mais (crash sem limpar lock) → recuperar =="
lock_pid_existe() { return 1; }              # PID NÃO existe
lock_escrever 12345 "$(lock_agora_ms)" "$(lock_agora_ms)" "scripts/supervisor.sh"
prefixo_afirmar "PID morto → recuperar" "recuperar:pid_12345_nao_existe" "$(lock_avaliar)"

echo "== PID reutilizado pelo SO por outro processo qualquer → recuperar =="
lock_pid_existe() { return 0; }
lock_comando_do_pid() { echo "notepad.exe algum-arquivo.txt"; }  # comando NÃO é do supervisor
lock_escrever 54321 "$(lock_agora_ms)" "$(lock_agora_ms)" "scripts/supervisor.sh"
prefixo_afirmar "PID reciclado por outro processo → recuperar" "recuperar:pid_54321_reutilizado_por_outro_processo" "$(lock_avaliar)"

echo "== lock ilegível/vazio → recuperar (nunca lança, nunca trava) =="
echo "isto não é json válido {{{" > "$LOCK_FILE"
prefixo_afirmar "lock corrompido → recuperar" "recuperar:lock_ilegivel_ou_vazio" "$(lock_avaliar)"

echo "== encerramento limpo: lock_liberar remove o arquivo =="
lock_pid_existe() { return 0; }
lock_comando_do_pid() { echo "bash scripts/supervisor.sh"; }
lock_escrever $$ "$(lock_agora_ms)" "$(lock_agora_ms)" "scripts/supervisor.sh"
[ -f "$LOCK_FILE" ] || { echo "  ✖ setup falhou — lock deveria existir antes do teste"; falhas=$((falhas+1)); }
lock_liberar
if [ -f "$LOCK_FILE" ]; then echo "  ✖ lock_liberar deveria ter apagado o arquivo"; falhas=$((falhas+1)); total=$((total+1));
else echo "  ✔ lock_liberar remove o arquivo (shutdown limpo libera a instância)"; total=$((total+1)); fi

echo "== crash (heartbeat parou de avançar, mas ainda dentro da janela): NÃO deveria recuperar ainda =="
lock_pid_existe() { return 0; }
lock_comando_do_pid() { echo "bash scripts/supervisor.sh"; }
lock_escrever 77777 "$(lock_agora_ms)" "$(( $(lock_agora_ms) - 10000 ))" "scripts/supervisor.sh"  # heartbeat de 10s atrás, dentro dos 90s
prefixo_afirmar "heartbeat recente mesmo que não seja 'agora' → ainda recusar (evita false-positive de crash)" "recusar:" "$(lock_avaliar)"

echo "== atualização de heartbeat preserva os outros campos =="
lock_escrever 4242 1000 1000 "scripts/supervisor.sh"
sleep 0.05
lock_atualizar_heartbeat
pid_depois=$(lock_ler_campo "$LOCK_FILE" pid)
started_depois=$(lock_ler_campo "$LOCK_FILE" startedAt)
hb_depois=$(lock_ler_campo "$LOCK_FILE" heartbeat)
afirmar "pid preservado" "4242" "$pid_depois"
afirmar "startedAt preservado" "1000" "$started_depois"
total=$((total + 1))
if [ "$hb_depois" != "1000" ] && [ -n "$hb_depois" ]; then echo "  ✔ heartbeat avançou"; else echo "  ✖ heartbeat deveria ter avançado além de 1000"; falhas=$((falhas+1)); fi

rm -rf "$DIR_TESTE"

echo ""
echo "== resultado: $((total - falhas))/$total passaram =="
[ "$falhas" -eq 0 ] || exit 1
