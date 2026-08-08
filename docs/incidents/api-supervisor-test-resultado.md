# Resultado do teste operacional isolado do supervisor da API (item 14)

Harness: `scripts/tests/api-supervisor-recovery-test.sh` — cópia da API V2 numa
porta **descartável (5199)** com mini-watchdog de LÓGICA idêntica ao supervisor
real (checar → matar → respawnar → contar → degradar). Durações **comprimidas**
(check 2s, heartbeat 6s, janela 30s, teto 5 restarts) como proxies fiéis dos
valores reais (15s / 30s / 15min / 5). **Produção (:5184) intacta** — respondeu
200 durante todo o teste.

## Resultados

| Passo | Medição | Veredito |
|---|---|---|
| T0 cold-start (sem carga) | 1897 ms · 1 instância | ok |
| T1 recuperação, carga 0 | 3717 ms · 1 instância | recupera rápido |
| T1 recuperação, carga 1 | 4289 ms · 1 instância | recupera rápido |
| T1 recuperação, carga 2 | 4248 ms · 1 instância | recupera rápido |
| T2 tentar 2ª instância na mesma porta | 1 instância (EADDRINUSE tratado) | **nunca mantém 2 APIs simultâneas** |
| T3 kills rápidos (backoff) | respawns 1..5, depois **degradado** no #6 | **circuit breaker reproduzido** |
| T3 auto-heal | não há (para de respawnar até intervenção) | comportamento atual confirmado |
| Pós-degradado | reset manual + subir → 1739 ms | recupera com intervenção |

## Interpretação

- **Recuperação (T1):** com watchdog saudável e carga leve, um único kill
  recupera em ~4s — coerente com a sessão de 30 min re-executada (~13s sob a
  carga real do dashboard). O caso feliz funciona.
- **Instância única (T2):** o servidor trata `EADDRINUSE` (loga e sai), então
  **nunca** há duas APIs na mesma porta — descarta a hipótese de instâncias
  duplicadas simultâneas.
- **Circuit breaker (T3):** o watchdog **entra em degradado** ao passar o teto
  de restarts na janela e **para de respawnar** — exatamente o que derrubou o
  dashboard no incidente. **Sem auto-heal**: fica caído até reset manual.

## Diagnóstico e postura (item 14)

O problema (degradado + parada de respawn) **foi reproduzido**. Conforme o
pedido — **não** alterei silenciosamente nenhum limite do supervisor real. O
diagnóstico e a **proposta de blindagem** estão em
`docs/incidents/api-supervisor-restart-storm.md` (heartbeat tolerante a
cold-start, backoff exponencial, espera de liberação de porta, auto-heal do
degradado, cache do type-stripping). Nenhuma dessas foi aplicada nesta etapa —
o gate anterior exige diagnóstico + aprovação antes de mudar essa camada.

O que **este teste não cobre** (limitações): não induz deterministicamente um
cold-start > heartbeat sob carga real (a causa raiz inferida do incidente); ele
prova a LÓGICA de degradação e a garantia de instância única, não o gatilho
exato de produção.
