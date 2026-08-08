# Resultado da suíte de resiliência do supervisor da API (item 12)

`scripts/tests/supervisor-api-resilience.test.sh` roda o **script real**
(`scripts/supervisor-dashboard-v2-api`) com env de teste — porta **5199**,
runtime próprio, timings comprimidos (mesma lógica, mais rápido). Produção
(:5184) intacta durante todo o teste. **Resultado final: 33 passaram, 0 falharam.**

| Teste | Verifica | Resultado |
|---|---|---|
| T1 recuperação simples | mata 1×, 1 substituição, HTTP 200, heartbeat, restart contado | ✅ recupera ~3.4s, 1 instância |
| T2 startup lento | graça impede kill prematuro (boot de 4s < graça) | ✅ 0 restart prematuro |
| T3 porta ocupada (desconhecido) | classifica port_in_use, sem storm, **não mata** o desconhecido | ✅ |
| T4 lock stale | assume lock de PID inexistente com segurança | ✅ |
| T5 falhas consecutivas | backoff crescente + teto + **degradado** (circuit breaker) | ✅ 5/5, backoff subiu, storm contido, causa registrada |
| T6 auto-heal | remove a causa → cooldown → probe → **healthy sem intervenção** | ✅ volta a healthy, degradedSince limpa após N probes |
| T7 concorrência | 2 supervisores → 1 ativo (lock recusa o 2º) | ✅ nunca 2 APIs |
| T8 carga 0/1/2/4 | recupera sob carga, nunca >1 API | ✅ recupera 3.4–7.3s |

## Critérios de aprovação (item 13) — atendidos

- **nunca mais de uma API simultânea** — T2/T7/T8 (EADDRINUSE tratado; verificação de porta).
- **nunca mais de um supervisor efetivo** — T7 (lock/mutex).
- **nenhum restart storm** — T3/T5 (port_in_use e degradado contêm).
- **backoff comprovado** — T5 (backoff cresceu).
- **startup lento ≠ crash** — T2 (graça).
- **degradado continua protegendo** — T5.
- **auto-heal após cooldown, sem intervenção manual** — T6.
- **causa de cada falha registrada** — classificação em `supervisor-log.jsonl`/status.
- 5183/8787/motores validados fora deste teste (isolado da produção).

## Achados durante os testes (correções que NÃO tocaram a lógica de produção)

1. **Injeção de comando no teste** usava `SV_CMD="bash -c '...'"`, cujas aspas o
   `nohup $SV_CMD` de produção separa por palavra e mangla. Corrigido no TESTE
   com scripts wrapper (produção usa `node ... server.ts`, sem aspas — nunca foi
   afetada).
2. **Identidade do processo por CIM era frágil sob carga.** Trocado no
   SUPERVISOR para a **assinatura do /api/v2/health** (`2.0.0-api`) com fallback
   por linha de comando — robustez real (T3 passou de forma determinística).
3. **Limiar de heartbeat do teste (4s) < intervalo de escrita da API (10s,
   `server.ts:204 setInterval 10_000`)** fazia a API saudável oscilar como
   "stale". Corrigido no TESTE para 14s (> 10s). Produção usa 30s (> 10s) —
   nunca foi afetada. Achado documentado como propriedade do sistema real.

## Estado da aplicação em produção

O supervisor blindado está **testado e verde em isolamento**, mas a **aplicação
controlada em produção** (item 15: trocar só o supervisor mantendo a API viva,
observar 1h, 1 restart controlado, observar +1h) e a **observação de 2h**
(item 16) são passos operacionais deliberados — **pendentes**, a executar como
rollout controlado (rollback pronto em `docs/supervisor-api-rollback.md`).
