#!/usr/bin/env bash
# SUÍTE DE TESTES ISOLADOS DO SUPERVISOR DA API V2 (item 12).
#
# Roda o SCRIPT REAL (scripts/supervisor-dashboard-v2-api) com env de teste —
# porta 5199, runtime próprio, limiares COMPRIMIDOS (mesma lógica, mais rápido).
# NUNCA toca a API de produção (:5184). Não é reprodução simplificada.
set -u
cd "$(dirname "$0")/../.."
SUP="scripts/supervisor-dashboard-v2-api"
PORT=5199
PASS=0; FAIL=0
ok()   { echo "  [OK]   $1"; PASS=$((PASS+1)); }
bad()  { echo "  [FALHA] $1"; FAIL=$((FAIL+1)); }
now_ms() { date +%s%3N; }

# env de teste comum (comprimido) — exportado antes de subir o supervisor
base_env() {
  export SV_API_PORT=$PORT
  export SV_RUNTIME_DIR="$1"
  export SV_CHECK_S=1
  export SV_STARTUP_GRACE_S=6
  # > 10s: a API grava heartbeat.json num setInterval de 10s (server.ts:204);
  # um limiar menor que o intervalo de escrita marcaria a API saudável como
  # "stale" entre gravações e a faria oscilar. Produção usa 30s (> 10s), seguro.
  export SV_HEARTBEAT_MAX_S=14
  export SV_BACKOFF_BASE_S=1
  export SV_BACKOFF_MAX_S=6
  export SV_BACKOFF_JITTER_PCT=0
  export SV_HEALTHY_RESET_S=5
  export SV_MAX_RESTARTS_15MIN=5
  export SV_MAX_RESTARTS_24H=10
  export SV_DEGRADED_COOLDOWN_S=5
  export SV_PROBE_INTERVAL_S=2
  export SV_SUCCESS_PROBES_REQUIRED=2
  unset SV_CMD
}
limpar_env() { unset SV_API_PORT SV_RUNTIME_DIR SV_CHECK_S SV_STARTUP_GRACE_S SV_HEARTBEAT_MAX_S SV_BACKOFF_BASE_S SV_BACKOFF_MAX_S SV_BACKOFF_JITTER_PCT SV_HEALTHY_RESET_S SV_MAX_RESTARTS_15MIN SV_MAX_RESTARTS_24H SV_DEGRADED_COOLDOWN_S SV_PROBE_INTERVAL_S SV_SUCCESS_PROBES_REQUIRED SV_CMD; }

pids_porta() { netstat -ano 2>/dev/null | grep -E ":$PORT[^0-9]" | grep -i LISTENING | awk '{print $NF}' | sort -u | grep -E '^[0-9]+$'; }
n_listen() { pids_porta | grep -c .; }
matar_porta() { for p in $(pids_porta); do taskkill //PID "$p" //F >/dev/null 2>&1; done; }
api200() { [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$PORT/api/v2/health" 2>/dev/null)" = "200" ]; }
sfield() { node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1]))[process.argv[2]])}catch(e){console.log("")}' "$1/supervisor-status.json" "$2" 2>/dev/null; }
wait_estado() { local td="$1" alvo="$2" teto="$3" t0=$(date +%s); while [ $(( $(date +%s)-t0 )) -lt "$teto" ]; do [ "$(sfield "$td" estado)" = "$alvo" ] && return 0; sleep 1; done; return 1; }
wait_api() { local teto="$1" t0=$(date +%s); while [ $(( $(date +%s)-t0 )) -lt "$teto" ]; do api200 && return 0; sleep 1; done; return 1; }

SUPPID=""
subir_sup() { bash "$SUP" >/dev/null 2>&1 & SUPPID=$!; }
parar_sup() { [ -n "$SUPPID" ] && kill "$SUPPID" 2>/dev/null; sleep 1; matar_porta; SUPPID=""; }

echo "==================== SUÍTE DE RESILIÊNCIA DO SUPERVISOR DA API ===================="
matar_porta; sleep 1

# ── T1: recuperação simples ─────────────────────────────────────────────────
echo "T1 · recuperação simples (matar 1x → 1 substituição, HTTP 200, heartbeat)"
TD=$(mktemp -d); base_env "$TD"; subir_sup
if wait_api 25; then ok "API subiu (HTTP 200)"; else bad "API não subiu"; fi
[ "$(n_listen)" = "1" ] && ok "exatamente 1 instância" || bad "instâncias=$(n_listen)"
matar_porta                                  # UMA falha
t0=$(now_ms)
if wait_api 25; then rec=$(( $(now_ms)-t0 )); ok "recuperou em ${rec}ms"; else bad "não recuperou"; fi
[ "$(n_listen)" = "1" ] && ok "1 instância após recuperação" || bad "instâncias=$(n_listen)"
[ -s "$TD/heartbeat.json" ] && ok "heartbeat presente" || bad "sem heartbeat"
r15=$(sfield "$TD" restarts15m); [ "${r15:-0}" -ge 1 ] && ok "restart contabilizado (restarts15m=$r15)" || bad "restart não contado ($r15)"
parar_sup; rm -rf "$TD"; limpar_env

# ── T2: falha durante startup — a graça impede kill prematuro ────────────────
echo "T2 · startup lento (graça impede kill prematuro)"
TD=$(mktemp -d); base_env "$TD"
printf 'sleep 4\nexec node --experimental-strip-types dashboard-v2/api/server.ts\n' > "$TD/slow.sh"
export SV_CMD="bash $TD/slow.sh"   # 4s de boot, < graça 6s
subir_sup
if wait_api 25; then ok "API lenta subiu dentro da graça"; else bad "API lenta não subiu"; fi
r15=$(sfield "$TD" restarts15m)
[ "${r15:-9}" = "0" ] && ok "nenhum restart prematuro durante o boot lento (restarts15m=0)" || bad "houve restart prematuro (restarts15m=$r15)"
parar_sup; rm -rf "$TD"; limpar_env

# ── T3: porta ocupada por DESCONHECIDO — sem storm, não mata ─────────────────
echo "T3 · porta ocupada por processo desconhecido"
TD=$(mktemp -d); base_env "$TD"
# listener desconhecido (node -e, sem o entrypoint da API) na porta
node -e 'require("http").createServer((q,s)=>s.end("nao-sou-a-api")).listen('$PORT')' >/dev/null 2>&1 &
DESC=$!; sleep 2
[ "$(n_listen)" = "1" ] && ok "listener desconhecido ocupou a porta" || bad "listener não subiu"
subir_sup; sleep 8
[ "$(sfield "$TD" classificacaoUltimaFalha)" = "port_in_use" ] && ok "classificado como port_in_use" || bad "classif=$(sfield "$TD" classificacaoUltimaFalha)"
r15=$(sfield "$TD" restarts15m); [ "${r15:-9}" = "0" ] && ok "sem restart storm (restarts15m=0)" || bad "houve storm (restarts15m=$r15)"
kill -0 "$DESC" 2>/dev/null && ok "processo desconhecido NÃO foi morto" || bad "matou o processo desconhecido"
parar_sup; kill "$DESC" 2>/dev/null; matar_porta; rm -rf "$TD"; limpar_env

# ── T4: lock stale (PID inexistente) — recuperação segura ────────────────────
echo "T4 · lock stale (PID inexistente)"
TD=$(mktemp -d); base_env "$TD"
mkdir -p "$TD"
printf '{"pid":999999,"pidMsys":999999,"pidWindows":null,"pidNamespace":"msys","startedAt":1,"hostname":"x","workingDirectory":"x","scriptHash":"x","heartbeat":1}\n' > "$TD/supervisor-api.lock"
subir_sup
if wait_api 25; then ok "assumiu o lock stale e subiu a API"; else bad "não recuperou do lock stale"; fi
parar_sup; rm -rf "$TD"; limpar_env

# ── T5: falhas consecutivas → backoff crescente + degradado (circuit breaker) ─
echo "T5 · falhas consecutivas → backoff + degradado"
TD=$(mktemp -d); base_env "$TD"
printf 'exit 1\n' > "$TD/fail.sh"
export SV_CMD="bash $TD/fail.sh"   # a 'API' morre imediatamente a cada tentativa
subir_sup
if wait_estado "$TD" degraded 60; then ok "entrou em DEGRADADO após o teto"; else bad "não degradou (estado=$(sfield "$TD" estado))"; fi
r15=$(sfield "$TD" restarts15m)
[ "${r15:-0}" -ge "$SV_MAX_RESTARTS_15MIN" ] && [ "${r15:-0}" -le $((SV_MAX_RESTARTS_15MIN+1)) ] && ok "restarts atingiram o teto sem estourar (restarts15m=$r15, teto=$SV_MAX_RESTARTS_15MIN)" || bad "restarts fora do esperado ($r15)"
# backoff cresceu ao longo das tentativas?
bmax=$(grep '"tipo":"restart"' "$TD/supervisor-log.jsonl" | grep -o '"backoffS":[0-9]*' | grep -o '[0-9]*' | sort -n | tail -1)
[ "${bmax:-0}" -gt "$SV_BACKOFF_BASE_S" ] && ok "backoff cresceu (máx registrado ${bmax}s > base ${SV_BACKOFF_BASE_S}s)" || bad "backoff não cresceu (máx=$bmax)"
# confirmou que PAROU de bombardear (após degradado, sem novos restarts explodindo)
sleep 6; r15b=$(sfield "$TD" restarts15m)
[ "${r15b:-0}" -le $((r15+1)) ] && ok "degradado conteve o storm (restarts estáveis: $r15 → $r15b)" || bad "continuou bombardeando ($r15 → $r15b)"
[ "$(sfield "$TD" lastFailureReason)" != "" ] && ok "causa registrada: $(sfield "$TD" classificacaoUltimaFalha)" || bad "causa não registrada"
parar_sup; rm -rf "$TD"; limpar_env

# ── T6: AUTO-HEAL — remover a causa → cooldown → tentativa → healthy ─────────
echo "T6 · auto-heal (remove a causa, sem intervenção manual no supervisor)"
TD=$(mktemp -d); base_env "$TD"
touch "$TD/fail"   # enquanto existir, a 'API' falha
printf 'if [ -f "%s/fail" ]; then exit 1; else exec node --experimental-strip-types dashboard-v2/api/server.ts; fi\n' "$TD" > "$TD/maybe.sh"
export SV_CMD="bash $TD/maybe.sh"
subir_sup
if wait_estado "$TD" degraded 60; then ok "degradou com a causa presente"; else bad "não degradou"; fi
rm -f "$TD/fail"   # REMOVE a causa — nada de reiniciar o supervisor à mão
if wait_estado "$TD" healthy 60; then ok "auto-heal: voltou a HEALTHY após cooldown, sem intervenção" ; else bad "não auto-curou (estado=$(sfield "$TD" estado))"; fi
# degradedSince só limpa após SV_SUCCESS_PROBES_REQUIRED probes saudáveis
# consecutivas (estado já mostra healthy na 1ª); espera a confirmação.
dsok=false; for _ in 1 2 3 4 5 6 7 8 9 10; do [ "$(sfield "$TD" degradedSince)" = "null" ] && { dsok=true; break; }; sleep 1; done
[ "$dsok" = true ] && ok "saiu de degradado (degradedSince=null após confirmação de probes)" || bad "degradedSince não limpou"
api200 && ok "API respondendo 200 após auto-heal" || bad "API não responde após auto-heal"
grep -q '"tipo":"probe"' "$TD/supervisor-log.jsonl" && ok "probe de recuperação registrado" || bad "sem probe registrado"
parar_sup; rm -rf "$TD"; limpar_env

# ── T7: concorrência — 2 supervisores, só 1 permanece ───────────────────────
echo "T7 · concorrência (2 supervisores → 1 ativo)"
TD=$(mktemp -d); base_env "$TD"
bash "$SUP" >/dev/null 2>&1 & S1=$!
bash "$SUP" >/dev/null 2>&1 & S2=$!
sleep 8
recusas=$(grep -c "NÃO iniciado" "$TD/supervisor-watchdog.log" 2>/dev/null || echo 0)
[ "${recusas:-0}" -ge 1 ] && ok "a 2ª instância foi recusada pelo lock (recusas=$recusas)" || bad "nenhuma recusa registrada"
[ "$(n_listen)" -le 1 ] && ok "no máximo 1 API simultânea (instâncias=$(n_listen))" || bad "múltiplas APIs ($(n_listen))"
kill "$S1" "$S2" 2>/dev/null; sleep 1; matar_porta; rm -rf "$TD"; limpar_env

# ── T8: carga — recuperação com 0/1/2/4 geradores ───────────────────────────
echo "T8 · recuperação sob carga (0/1/2/4 geradores)"
for nivel in 0 1 2 4; do
  TD=$(mktemp -d); base_env "$TD"
  CPIDS=(); for ((i=0;i<nivel;i++)); do bash -c 'while :; do :; done' & CPIDS+=($!); done
  subir_sup; wait_api 25 >/dev/null
  matar_porta; t0=$(now_ms)
  if wait_api 30; then rec=$(( $(now_ms)-t0 )); ok "carga $nivel: recuperou em ${rec}ms · instâncias=$(n_listen)"; else bad "carga $nivel: não recuperou"; fi
  [ "$(n_listen)" -le 1 ] && ok "carga $nivel: nunca >1 API" || bad "carga $nivel: >1 API"
  parar_sup; for p in "${CPIDS[@]:-}"; do kill "$p" 2>/dev/null; done; rm -rf "$TD"; limpar_env
done

matar_porta
echo "=================================================================================="
echo "RESULTADO: $PASS passaram, $FAIL falharam"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
