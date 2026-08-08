# Resiliência do supervisor da API V2 — desenho e políticas

Corrige a fragilidade comprovada (`docs/incidents/api-supervisor-restart-storm.md`):
o supervisor original entrava em **degradado terminal** — parava de respawnar e
só voltava com intervenção manual. Não se resolve isso "aumentando o limite":
o circuit breaker é preservado; o que muda é como o supervisor **observa,
espera e se recupera**.

## 1. Diagnóstico atualizado

- Cold-start real (medido): **~1–2,2 s** até 4 geradores de carga
  (`docs/incidents/api-supervisor-coldstart.md`). O limiar único de heartbeat de
  30 s do supervisor antigo só era ultrapassado sob carga **patológica**
  (2 suítes + sessão + 8 processos), matando uma API ainda subindo.
- Sem backoff → restarts a cada 15 s acumulavam até o teto → degradado.
- Degradado era **terminal** (sem auto-heal) → API caída até reset manual.
- Identificação por substring (`server.ts`) confundia a própria API V2 e não
  distinguia a porta 5184 de uma instância de teste.

## 2. Configurações comparadas (antigo → blindado)

| Parâmetro | Antigo | Blindado (default prod) | Por quê |
|---|---|---|---|
| Janela de graça de startup | **não existia** | `SV_STARTUP_GRACE_S=90` | separa "subindo" de "morto" (medição + 3× o pior caso do incidente) |
| Limiar de heartbeat | 30 s (uniforme) | `SV_HEARTBEAT_MAX_S=30` (só fora da graça) | não mata boot lento |
| Backoff | **nenhum** (15 s fixo) | exp+jitter `2→60 s` (`SV_BACKOFF_*`) | não bombardeia |
| Reset do backoff | a cada checagem saudável | só após **saúde contínua** `SV_HEALTHY_RESET_S=120 s` | não zera por porta aberta 2 s |
| Circuit breaker | 5/15min, 10/24h (terminal) | **mesmos limites**, porém com auto-heal | preserva a proteção |
| Auto-heal | **não existia** | cooldown `300 s` + probe `30 s` + `3` sucessos | volta sem intervenção |
| Identificação do processo | substring `server.ts` | **porta (netstat)** + verificação de entrypoint | nunca confunde/mata desconhecido |
| Classificação de falha | genérica ("crash provável") | **9 tipos** | conta cada situação certo |
| Contagem de restart | todo relançamento | **só falhas reais** (start/probe não contam) | teto justo |
| Observabilidade | status mínimo | `restarts15m/24h, consecutiveFailures, currentBackoff, nextProbeAt, degradedSince, lastHealthyAt, lastFailureReason, probesOk` | diagnosticável |

Todos os limiares são **env-parametrizáveis** com o valor de produção como
default — o teste isolado (5199) roda a MESMA lógica com timings comprimidos.

## 3. Política de janela de graça (startup)

`starting` é um estado próprio. Enquanto `now - launchedAt < SV_STARTUP_GRACE_S`:
- processo **vivo** (porta escutando OU PID lançado de pé) e ainda não servindo
  → tolerado (`starting`), **nunca** reiniciado;
- processo **morto** (porta não escuta E PID lançado caiu) → `startup_timeout`,
  reinicia — a graça **não** mascara um crash.

Valor: 90 s (justificado em `api-supervisor-coldstart.md`).

## 4. Política de backoff

Exponencial com jitter: `base·2^(falhas-1)`, teto `SV_BACKOFF_MAX_S`, ±`JITTER%`.
Sequência típica (base 2, teto 60): 2, 4, 8, 16, 32, 60, 60… O contador de
falhas/backoff só zera após **saúde contínua** comprovada por
`SV_HEALTHY_RESET_S` — nunca porque "a porta abriu por alguns segundos".

## 5. Política de auto-heal do degradado

Ao bater o circuit breaker: registra a causa, marca `degradedSince`, agenda
`nextProbeAt = now + SV_DEGRADED_COOLDOWN_S`. **Não** respawna em rajada. Depois
do cooldown, uma **tentativa controlada** (`recovering`); se a API ficar
saudável por `SV_SUCCESS_PROBES_REQUIRED` checagens seguidas → volta a `healthy`
e zera tudo. Se a tentativa falhar → volta a `degraded` com **novo cooldown**
(sem loop infinito de auto-heal). O circuit breaker continua protegendo; a
diferença é que **existe saída sem intervenção manual**.

## 6. Classificação de falhas (item 11)

`process_crash` · `heartbeat_stale` · `startup_timeout` · `port_in_use` ·
`lock_conflict` · `http_unhealthy` · `spawn_failure` · `manual_stop` · `unknown`.

Só as de **crash real** contam pro circuit breaker. `manual_stop` (SIGINT/TERM
de teste) e `port_in_use` (porta tomada por desconhecido — **nunca** matamos o
desconhecido) **não** contam como crash e não disparam storm.

## 7. Verificação de porta e instância única (itens 7, 8)

Antes de lançar: se a porta escuta e é a **nossa** API saudável → não duplica
(single instance); se é a nossa API **insalubre** → mata **só ela** (verificada
por entrypoint) e aguarda liberar; se é **desconhecida** → `port_in_use`, não
mata, não lança. O lock/mutex da lib (`scripts/lib/supervisor-lock.sh`) garante
um único supervisor (stale/PID-reuso/lock-sem-PID/duas subidas simultâneas).

## 8. Testes

`scripts/tests/supervisor-api-resilience.test.sh` roda o **script real** com env
de teste (porta 5199, timings comprimidos): recuperação simples, startup lento
(graça), porta ocupada por desconhecido, lock stale, falhas consecutivas
(backoff+degradado), **auto-heal**, concorrência, e carga 0/1/2/4. Resultados em
`docs/incidents/api-supervisor-resilience-resultado.md`.
