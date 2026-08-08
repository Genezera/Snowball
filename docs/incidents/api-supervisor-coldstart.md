# Medição de cold-start da API V2 (item 5) — base empírica da janela de graça

Harness: `scripts/tests/api-coldstart-measure.sh` — ISOLADO na porta 5199 com
runtime próprio (`API_V2_LOG_DIR`), nunca toca produção (:5184). 10 inicializações
por nível de carga (0/1/2/4 geradores de CPU busy-loop). `startupDuration` =
spawn → primeiro HTTP 200 em `/api/v2/health`.

## Resultados (40 amostras)

| Carga | n | mín (ms) | mediana (ms) | p95 (ms) | máx (ms) |
|---|---|---|---|---|---|
| 0 geradores | 10 | 1053 | 1119 | 1702 | 1702 |
| 1 gerador | 10 | 1103 | 1325 | 2192 | 2192 |
| 2 geradores | 10 | 1178 | 1312 | 1931 | 1931 |
| 4 geradores | 10 | 1231 | 1646 | 2021 | 2021 |
| **global** | 40 | 1053 | ~1300 | **2003** | **2192** |

Memória do processo no startup: ~145 MB. CPU acumulada baixa.

## Interpretação e escolha da janela de graça

- O cold-start **normal** (até carga 4) é **~1–2,2 s** — muito abaixo do limiar
  de heartbeat de 30 s. Sob carga controlada, o supervisor **nunca** deveria
  matar uma API subindo.
- O incidente original (`api-supervisor-restart-storm.md`) teve cold-start
  inferido **> 30 s** sob carga MUITO mais extrema (2 suítes Playwright + sessão
  de 30 min + 8 processos + WMI concorrente) do que 4 busy-loops. Não reproduzi
  esse cold-start patológico aqui (limitação honesta), mas ele é plausível.
- **`startupGrace = 90 s` (default)**: ~45× o p95 medido e **3× o pior
  cold-start patológico do incidente (~30 s)**. A graça só protege um processo
  **vivo mas ainda não servindo**; um processo **morto** é detectado na hora
  como `process_crash` (a graça nunca mascara um crash). Logo 90 s é
  conservador e seguro — não atrasa a detecção de queda real, só evita matar um
  boot lento em progresso.

A graça é **parametrizável** (`SV_STARTUP_GRACE_S`); este valor é justificado
pela medição + pela margem sobre o pior caso do incidente, não escolhido
arbitrariamente.

Dados brutos e estatísticas: `docs/incidents/coldstart-raw.json`,
`docs/incidents/coldstart-stats.json`.
