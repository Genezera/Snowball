#!/usr/bin/env bash
# MEDIÇÃO DE COLD-START DA API V2 (item 5) — ISOLADA na porta 5199, com
# diretório de runtime próprio (API_V2_LOG_DIR), nunca toca produção (:5184).
#
# Mede, por inicialização: processSpawnedAt, portListeningAt, firstHeartbeatAt,
# firstHttp200At, startupDuration (spawn→http200), CPU e memória do processo.
# Repete N vezes por nível de carga (0/1/2/4 geradores) e calcula
# min/mediana/p95/max. A janela de graça do supervisor será baseada NISSO.
set -u
cd "$(dirname "$0")/../.."

ISO_PORT="${ISO_PORT:-5199}"
N="${N:-10}"
NIVEIS="${NIVEIS:-0 1 2 4}"
TESTDIR="$(mktemp -d -t api-coldstart-XXXXXX)"
OUT_JSON="${OUT_JSON:-$(mktemp -t coldstart-XXXXXX).json}"
CMD="node --experimental-strip-types dashboard-v2/api/server.ts"

now_ms() { date +%s%3N; }
pid_na_porta() { netstat -ano 2>/dev/null | grep -E ":$ISO_PORT[^0-9]" | grep -i LISTENING | awk '{print $NF}' | sort -u | grep -E '^[0-9]+$' | head -1; }
http200() { [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$ISO_PORT/api/v2/health" 2>/dev/null)" = "200" ]; }
matar_porta() { for p in $(netstat -ano 2>/dev/null | grep -E ":$ISO_PORT[^0-9]" | grep -i LISTENING | awk '{print $NF}' | sort -u | grep -E '^[0-9]+$'); do taskkill //PID "$p" //F >/dev/null 2>&1; done; }

CARGA_PIDS=()
subir_carga() { local n="$1"; for ((i=0;i<n;i++)); do bash -c 'while :; do :; done' & CARGA_PIDS+=($!); done; }
parar_carga() { for p in "${CARGA_PIDS[@]:-}"; do kill "$p" 2>/dev/null; done; CARGA_PIDS=(); }

trap 'parar_carga; matar_porta; rm -rf "$TESTDIR"' EXIT

echo "[" > "$OUT_JSON"
primeiro=1
matar_porta; sleep 1

for nivel in $NIVEIS; do
  subir_carga "$nivel"
  echo ">>> nível de carga $nivel ($N inicializações)"
  for ((k=1;k<=N;k++)); do
    rm -f "$TESTDIR/heartbeat.json"
    matar_porta
    # espera a porta liberar antes de medir o próximo cold-start
    for _ in 1 2 3 4 5 6 7 8 9 10; do [ -z "$(pid_na_porta)" ] && break; sleep 0.3; done

    t_spawn=$(now_ms)
    API_V2_LOG_DIR="$TESTDIR" PORTA_V2_API="$ISO_PORT" nohup $CMD >> "$TESTDIR/api.log" 2>&1 &
    disown

    t_port=0; t_hb=0; t_http=0
    fim=$(( $(now_ms) + 60000 ))
    while [ "$(now_ms)" -lt "$fim" ]; do
      [ "$t_port" -eq 0 ] && [ -n "$(pid_na_porta)" ] && t_port=$(now_ms)
      [ "$t_hb" -eq 0 ] && [ -s "$TESTDIR/heartbeat.json" ] && t_hb=$(now_ms)
      if [ "$t_http" -eq 0 ] && http200; then t_http=$(now_ms); break; fi
      sleep 0.15
    done

    # CPU/mem best-effort do PID na porta
    cpu="null"; mem="null"
    pid=$(pid_na_porta)
    if [ -n "$pid" ]; then
      linha=$(timeout 5 powershell -NoProfile -Command "\$p=Get-Process -Id $pid -ErrorAction SilentlyContinue; if(\$p){ '{0};{1}' -f [math]::Round(\$p.WorkingSet64/1MB), [math]::Round(\$p.CPU,2) }" 2>/dev/null | tr -d '\r')
      if [ -n "$linha" ]; then mem="${linha%%;*}"; cpu="${linha##*;}"; cpu="${cpu/,/.}"; mem="${mem/,/.}"; fi
    fi

    startup=$(( t_http>0 ? t_http - t_spawn : -1 ))
    port_ms=$(( t_port>0 ? t_port - t_spawn : -1 ))
    hb_ms=$(( t_hb>0 ? t_hb - t_spawn : -1 ))
    [ "$primeiro" -eq 1 ] && primeiro=0 || echo "," >> "$OUT_JSON"
    printf '{"nivel":%s,"iter":%s,"portListeningMs":%s,"firstHeartbeatMs":%s,"firstHttp200Ms":%s,"startupMs":%s,"memMB":%s,"cpu":%s}' \
      "$nivel" "$k" "$port_ms" "$hb_ms" "$startup" "$startup" "${mem:-null}" "${cpu:-null}" >> "$OUT_JSON"
    echo "  [$nivel/$k] startup=${startup}ms port=${port_ms}ms hb=${hb_ms}ms mem=${mem}MB"
  done
  parar_carga
  matar_porta
  sleep 1
done
echo "]" >> "$OUT_JSON"
matar_porta

echo
echo "=== ESTATÍSTICAS (startupMs por nível) ==="
node -e '
const dados=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).filter(d=>d.startupMs>0);
const niveis=[...new Set(dados.map(d=>d.nivel))].sort((a,b)=>a-b);
const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);const i=Math.min(s.length-1,Math.ceil(p/100*s.length)-1);return s[Math.max(0,i)];};
const stats={};
for(const n of niveis){const a=dados.filter(d=>d.nivel===n).map(d=>d.startupMs);
  stats[n]={n:a.length,min:Math.min(...a),mediana:pct(a,50),p95:pct(a,95),max:Math.max(...a)};
  console.log(`nível ${n}: n=${a.length} min=${stats[n].min} mediana=${stats[n].mediana} p95=${stats[n].p95} max=${stats[n].max} (ms)`);}
const p95Global=pct(dados.map(d=>d.startupMs),95), maxGlobal=Math.max(...dados.map(d=>d.startupMs));
console.log(`GLOBAL: p95=${p95Global}ms max=${maxGlobal}ms → sugestão startupGrace ≥ ${Math.ceil(maxGlobal/1000)*3}s (3× o pior cold-start)`);
require("fs").writeFileSync(process.argv[2], JSON.stringify({porNivel:stats,p95Global,maxGlobal,sugestaoGraceS:Math.ceil(maxGlobal/1000)*3,amostras:dados.length},null,2));
' "$OUT_JSON" "${OUT_STATS:-$OUT_JSON.stats.json}"
echo "raw: $OUT_JSON"
echo "stats: ${OUT_STATS:-$OUT_JSON.stats.json}"
