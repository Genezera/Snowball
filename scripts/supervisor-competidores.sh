#!/usr/bin/env bash
# Watchdog dos 2 competidores 2-exchange (bybit+bitget, gate+okx). Religa qualquer um
# que tenha caído — detecção por HEARTBEAT (ultimoCiclo do forward-lab), não por command-line
# (os dois rodam o mesmo forward-lab.cjs; só o --label os distingue). Windowless via nohup.
# Single-instance por lock. NÃO toca no Champion nem no supervisor.sh principal.
set -u
cd "$(dirname "$0")/.."
export FORWARD_ROOT="auditoria/progression/compete"
BASE="auditoria/progression/compete"
LOCK="$BASE/supervisor-competidores.lock"
LOG="$BASE/supervisor-competidores.log"
STALE_MS=660000   # > 11min sem heartbeat = caiu (ciclo é 5min)
mkdir -p "$BASE"

# BOT ÚNICO — a configuração do DINHEIRO REAL (2 exchanges, foco total). Sem várias frentes.
# bybit+bitget (par vencedor do head-to-head; gate+okx ficou faminto, 0 posições) + todos os
# levers seguros embutidos: maker + persistência 30min + utilização máxima (6 pos · reserva 20%)
# + rendimento na reserva ociosa (6%/ano, neutro). É isto que vai virar dinheiro real.
# maxpos 5→6 (2026-08-10, achado medindo Fase 1): BICO e TUT (cross-exchange, 100% de
# consistência, US$39M/US$206M de volume, 7h+ vivos) foram bloqueados 74x e 72x por
# maxPositionsBlocked com capital sobrando na reserva (saldos ficavam em 42/42, bem acima do
# piso de 20) — degrau seguinte do próprio roadmap (3→5→6). Reserva (colchão de liquidação)
# NÃO foi tocada — só o número de posições simultâneas que o capital já suportava.
# --settle-interval-h 24 (2026-08-10, MAIOR achado da Fase 1): até aqui o lucro NUNCA virava
# capital de verdade — fundingAcum/custosAcum/yieldAcum só existiam pra reportar "capitalAtual"
# na tela; saldosPorExchange (o que o motor pode de fato comprometer em margem) só se movia em
# margem, nunca em P&L. O "bola de neve" nunca girava. Liquidação a cada 24h dobra o lucro
# acumulado pro capitalInicial/saldos — libera mais capital pro maxpos existente abrir MAIS
# posições conforme o lucro cresce. Não muda o tamanho de cada aposta (NOTIONAL continua $100).
# --funding-settlement-h 8 (2026-08-10): comparando com o Champion arquivado (bybit+bitget deu
# +US$6,15 em 7 posições lá, 100% de acerto — igual ou melhor era o esperado, mas o motor atual
# vinha perdendo) achei a causa: o motor suavizava funding continuamente a cada ciclo de 5min,
# como se qualquer fração de tempo já "contasse" — o Champion creditava só em horário REAL de
# liquidação (medido: KMNO recebeu 3 pagamentos, ~8h um do outro). Posições que fecham antes de
# cruzar um horário real de liquidação agora recebem US$0 de funding, não uma fração suavizada —
# igual à vida real.
# --settlement-capture (2026-08-10): terceira superfície de captura — o Champion tinha uma
# estratégia à parte (strategyId 'settlement_capture' no diário dele) que montava a posição
# minutos antes do horário real de liquidação e desmontava minutos depois (holds de 10-15min
# medidos). Reusa o mesmo livro-caixa/margem do cross sustentado; maxpos próprio (2), piso de
# entrada mais alto (1,5x — só um período pra pagar o custo fixo, sem diluir por várias liquidações).
declare -A CMD=(
  [snowball-2ex]="node scripts/progression/forward-lab.cjs --mode control --exchanges bybit,bitget --label snowball-2ex --close-policy economic_inversion --persist-min 30 --cost-model maker --maxpos 6 --reserva 0.20 --stable-yield 0.06 --settle-interval-h 24 --funding-settlement-h 8 --settlement-capture --settlement-capture-window-min 20 --settlement-capture-maxpos 2 --spotperp --spotperp-minvol 5000000 --spotperp-notional 15 --intervalo 300"
)

campo() { node -e "try{console.log(JSON.parse(require('fs').readFileSync(process.argv[1]))[process.argv[2]]||0)}catch(e){console.log(0)}" "$1" "$2" 2>/dev/null; }

# single-instance
now_ms=$(date +%s%3N)
if [ -f "$LOCK" ]; then
  last=$(campo "$LOCK" hb)
  if [ -n "$last" ] && [ "$last" -gt 0 ] 2>/dev/null && [ $(( now_ms - last )) -lt 90000 ]; then
    echo "[$(date '+%H:%M:%S')] outro supervisor-competidores vivo — saindo" >> "$LOG"; exit 0
  fi
fi
echo "{\"pid\":$$,\"hb\":$now_ms}" > "$LOCK"
trap 'rm -f "$LOCK"; exit 0' INT TERM
echo "[$(date '+%H:%M:%S')] supervisor-competidores iniciado (2 competidores, cada 60s)" >> "$LOG"

while true; do
  echo "{\"pid\":$$,\"hb\":$(date +%s%3N)}" > "$LOCK"
  for nome in "${!CMD[@]}"; do
    hbf="$BASE/$nome/heartbeat.json"
    fresco=0
    if [ -f "$hbf" ]; then
      u=$(campo "$hbf" ultimoCiclo)
      [ -n "$u" ] && [ "$u" -gt 0 ] 2>/dev/null && [ $(( $(date +%s%3N) - u )) -lt "$STALE_MS" ] && fresco=1
    fi
    if [ "$fresco" != 1 ]; then
      echo "[$(date '+%H:%M:%S')] $nome sem heartbeat fresco — religando (windowless)" >> "$LOG"
      nohup ${CMD[$nome]} >> "$BASE/$nome.live.log" 2>&1 &
      disown
    fi
  done
  sleep 60
done
