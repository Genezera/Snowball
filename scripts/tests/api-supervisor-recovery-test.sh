#!/usr/bin/env bash
# TESTE OPERACIONAL ISOLADO DO SUPERVISOR DA API (item 14 da unificação).
#
# ISOLADO da produção: sobe uma cópia da API V2 numa porta DESCARTÁVEL (5199,
# via PORTA_V2_API) e exercita a MESMA lógica do supervisor (checar → matar →
# respawnar → contar → degradar) num mini-watchdog embutido. NÃO toca a API de
# produção (:5184), NÃO toca o supervisor real, NÃO toca motor/estratégia.
#
# Durações são COMPRIMIDAS para o teste rodar em minutos (check 2s, heartbeat
# 6s, janela 30s, teto 5) — proxies fiéis dos valores reais do supervisor
# (15s / 30s / 15min / 5). A LÓGICA testada é idêntica.
#
# Não modifica silenciosamente nenhum limite do supervisor real: este é um
# harness à parte. Diagnóstico + proposta ficam em
# docs/incidents/api-supervisor-restart-storm.md.
set -u
cd "$(dirname "$0")/../.."

ISO_PORT="${ISO_PORT:-5199}"
CHECK_S=2
HB_MAX_S=6
JANELA_S=30
TETO_RESTARTS=5
CARGA_NIVEIS="${CARGA_NIVEIS:-0 1 2}"
LOG="$(mktemp -t iso-api-XXXXXX).log"
RESULTADO="docs/incidents/api-supervisor-test-resultado.md"

now_ms() { date +%s%3N; }
api_healthy() { [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$ISO_PORT/api/v2/champion" 2>/dev/null)" = "200" ]; }
pids_na_porta() { netstat -ano 2>/dev/null | grep -E ":$ISO_PORT[^0-9]" | grep -i LISTENING | awk '{print $NF}' | sort -u | grep -E '^[0-9]+$'; }
n_instancias() { pids_na_porta | grep -c . ; }
matar_porta() { for p in $(pids_na_porta); do taskkill //PID "$p" //F >/dev/null 2>&1; done; }
subir_api() { PORTA_V2_API="$ISO_PORT" nohup node --experimental-strip-types dashboard-v2/api/server.ts >> "$LOG" 2>&1 & disown; }

esperar_saudavel() {
  local teto_s="$1" t0 el
  t0=$(now_ms)
  while true; do
    if api_healthy; then echo $(( ($(now_ms) - t0) )); return 0; fi
    el=$(( ($(now_ms) - t0) / 1000 ))
    [ "$el" -ge "$teto_s" ] && { echo "-1"; return 1; }
    sleep 1
  done
}

# gerador de carga controlada (busy loops em background) — nível N sobe N loops
CARGA_PIDS=()
subir_carga() {
  local nivel="$1"
  for ((i=0;i<nivel;i++)); do bash -c 'while :; do :; done' & CARGA_PIDS+=($!); done
}
parar_carga() { for p in "${CARGA_PIDS[@]:-}"; do kill "$p" 2>/dev/null; done; CARGA_PIDS=(); }

echo "== teste isolado do supervisor da API (porta $ISO_PORT) ==" | tee "$LOG.res"
matar_porta; sleep 1

# limpeza garantida no fim
trap 'parar_carga; matar_porta' EXIT

# ── T0: sobe e fica saudável ────────────────────────────────────────────────
subir_api
t_subida=$(esperar_saudavel 30)
echo "T0 cold-start (sem carga): ${t_subida}ms · instancias=$(n_instancias)" | tee -a "$LOG.res"

# ── T1: recuperação após 1 kill, em cada nível de carga ─────────────────────
declare -A REC
for nivel in $CARGA_NIVEIS; do
  subir_carga "$nivel"
  sleep 1
  matar_porta
  # mini-watchdog: detecta queda e respawna (mesma lógica do supervisor)
  t0=$(now_ms)
  while api_healthy; do :; done   # confirma que caiu
  # loop de supervisão comprimido
  recuperou=-1
  fim=$(( $(now_ms) + 30000 ))
  while [ "$(now_ms)" -lt "$fim" ]; do
    if [ "$(n_instancias)" -lt 1 ]; then subir_api; fi
    r=$(esperar_saudavel 8) && { recuperou=$(( $(now_ms) - t0 )); break; }
    sleep "$CHECK_S"
  done
  REC[$nivel]=$recuperou
  echo "T1 carga=$nivel: recuperou em ${recuperou}ms · instancias=$(n_instancias)" | tee -a "$LOG.res"
  parar_carga
  # garante 1 instância saudável antes do próximo nível
  esperar_saudavel 15 >/dev/null
done

# ── T2: nunca 2 instâncias simultâneas (EADDRINUSE tratado pelo servidor) ────
subir_api          # tenta subir uma SEGUNDA na mesma porta
sleep 4
inst=$(n_instancias)
echo "T2 tentativa de 2a instancia na porta $ISO_PORT: instancias=$inst (esperado 1 — servidor trata EADDRINUSE)" | tee -a "$LOG.res"

# ── T3: kills rápidos → circuit breaker (degradado após teto) ───────────────
restarts=0; degradado="nao"; janela_ini=$(now_ms)
for k in $(seq 1 8); do
  matar_porta
  while api_healthy; do :; done
  # janela deslizante
  if [ $(( ($(now_ms) - janela_ini)/1000 )) -gt "$JANELA_S" ]; then restarts=0; janela_ini=$(now_ms); fi
  if [ "$restarts" -ge "$TETO_RESTARTS" ]; then
    degradado="sim"
    echo "T3 kill#$k: TETO ($TETO_RESTARTS) atingido na janela → DEGRADADO, watchdog PARA de respawnar (circuit breaker)" | tee -a "$LOG.res"
    break
  fi
  subir_api; restarts=$((restarts+1))
  esperar_saudavel 10 >/dev/null
  echo "T3 kill#$k: respawn #$restarts na janela · instancias=$(n_instancias)" | tee -a "$LOG.res"
done
echo "T3 resultado: degradado_atingido=$degradado (sem auto-heal — comportamento atual, ver proposta no incidente)" | tee -a "$LOG.res"

# ── recuperação manual do degradado (equivale ao reset do incidente) ────────
matar_porta; sleep 1; subir_api
mrec=$(esperar_saudavel 20)
echo "PÓS-DEGRADADO: reset manual + subir → saudável em ${mrec}ms · instancias=$(n_instancias)" | tee -a "$LOG.res"

matar_porta
echo "== fim do teste isolado ==" | tee -a "$LOG.res"
echo
echo "Resumo salvo em $LOG.res"
