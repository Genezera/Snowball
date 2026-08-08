# Snowball — Progression Platform v1.1: validação econômica

Continuação de `snowball-progression-platform-v1`. **Read-only / shadow /
append-only / reversível.** Não altera Champion, challengers, motores, capital,
risco, alavancagem, execução ou limites. A coleta prolongada dos challengers
seguiu **independente e não interrompida**. Reprodutível por
`node scripts/progression/build-all.cjs`.

Esta etapa **corrige e valida economicamente** os três pontos que a v1 não havia
comprovado — e a correção mudou conclusões da v1.

## Manchete: onde a v1 exagerou, a v1.1 corrige

| Tema | v1.0 (afirmava) | v1.1 (corrigido, com dado) |
|---|---|---|
| Capacidade | "6.422 rejeições por saldo ⇒ constrangido por capital, há headroom" | **Capacidade produtiva NÃO comprovada** — 0 oportunidades EV+ bloqueadas por capital |
| Chefes | DERROTADO / ATIVO | Máquina de 5 estados; **nada DEFEATED** (exige ≥2 janelas) |
| Growth | 0,67%/dia projetando níveis | **Sem taxa-base, sem datas**; só trajetória + stress + intervalo |
| 2 exchanges | ranking realizado (enviesado) | **replay US$200 reconciliado exato** das 15 combinações |

## 1–7. Capacidade e capital marginal (`capacity-analysis.json`)

**Correção do Chefe da Capacidade.** Classificação de TODAS as rejeições:

| Categoria | Qtde | Leitura |
|---|---|---|
| payback insuficiente | 14.741 | **todas EV<0** — recusadas certo, capital irrelevante |
| saldo insuficiente | 6.422 | **0 com economia avaliada** — rejeitadas ANTES do EV ⇒ EV desconhecido |
| aprovadas (EV+) | 12 | financiadas |
| cobertura insuficiente | 20 | — |

- **Oportunidades EV+ bloqueadas só por capital: 0.** Toda oportunidade avaliada como positiva foi financiada.
- **Veredito: CAPACIDADE PRODUTIVA NÃO COMPROVADA.** O número bruto de rejeições por saldo **não** prova capacidade (elas ocorrem antes da avaliação econômica). O gargalo é **oferta de oportunidade** (EV≤0 ou não avaliado), não capital.

**Curva capital × PnL (modelo de concorrência sobre posições reais, PnL observado):**

| Capital | PnL líq. | Retorno % | marginal/US$ |
|---|---|---|---|
| US$200 | 10,10 | **5,05%** | — |
| US$300 | 10,15 | 3,38% | 0,0005 |
| US$400 | 10,46 | 2,62% | 0,0031 |
| US$600 | 10,46 | 1,74% | **0** |
| US$800 | 10,46 | 1,31% | 0 |
| US$1000 | 10,46 | 1,05% | 0 |

**Saturação em ~US$400.** Pico de margem comprometida = **US$232,83** (o Champion
nunca usou mais que isso, apesar de ter US$600). Acima da saturação o capital fica
ocioso e **derruba o retorno %** (5,05%→1,05%). **Dobrar capital NÃO dobra lucro** —
o teto é a oferta de oportunidades EV+. Cresce quem adiciona um **2º motor**, não
mais capital no motor saturado.

## 2–4. Replay verdadeiro das 15 combinações (`exchange-replay.json`)

Sandbox de **US$200** (US$100/exchange) por combinação: reserva 30%, 5×, ordem
mínima, mesmos custos, mesma janela, mesmo máximo de posições. Reconstrói saldos/
funding/custos/posições/capital bloqueado/perdidas/equity/drawdown sobre TODAS as
posições reais do par (funding/custo observados), aplicando o orçamento — **sem
cereja de vencedores**.

- **As 15 combinações reconciliam EXATO** (`capitalFinal = capitalInicial + funding − custos + residual`). `todasReconciliam: true`.
- **Melhor par fixo: bitget+bybit → capitalFinal US$206,04 (+6,04 / +3,02%)**, 0 posições perdidas por margem (US$200 já bastou por par).
- **6 exchanges financiadas rendem +10,46 vs +6,04 do melhor par de 2**: a diferença de **US$4,42 (~42%)** vem de **largura de exchanges (mais pares = mais oferta)**, não de mais capital por par.

**Dinâmico vs fixo:** troca semanal/por janela **não comprovável** (1 janela); o
custo/tempo de migração (~0,1% + settlement) desencoraja troca frequente. Monitorar
6 e financiar as 2 melhores continua **shadow** — sem mover saldo.

> Limitação honesta: só há outcome realizado para posições que o Champion abriu;
> oportunidades nunca abertas não têm outcome e não são creditadas.

## 6. Reinvestimento contrafactual real (`reinvestment-counterfactual.json`)

A/B/C **não** recebem a mesma sequência fixa: cada política financia só o que seu
capital permite no instante. Rodado a US$200 e US$600:

- Em **ambas** as bases, A/B/C geram o **mesmo PnL de motor** — o lucro compõe devagar demais na janela (~6 dias) para relaxar qualquer restrição.
- **A única diferença econômica real:** a Política C acumula um **fundo de 2º motor de US$6,14** (a US$600) a **custo ZERO de PnL medido** (o excedente estava ocioso — motor saturado).
- **Conclusão: a Política C domina no estado atual** — reinvestir mais no motor saturado é ocioso; desviar o excedente para diversificação constrói caminho para o nível 3 sem sacrificar lucro. (Ganho é diversificação futura, não lucro garantido; exige ≥2 janelas/regimes.)

## 9. Níveis corrigidos (`levels.json`)

Três níveis distintos (item 7): **capitalLevel = 3 · evidenceLevel = 1 ·
operationalLevel = 1**. Capital suporta o nível 3; a prova (provisória, 1 janela)
confirma o nível 1; opera-se em min(capital, evidência) = 1. **Não se chama nível
de desbloqueado só porque o saldo atingiu o mínimo.** Unlocks são **provisórios**
até DEFEATED (≥2 janelas/regimes).

## 10. Chefes reclassificados — 5 estados (`bosses.json`)

`UNTESTED · ACTIVE · PASSED_CURRENT_WINDOW · PROVISIONALLY_DEFEATED · DEFEATED`.
**DEFEATED exige ≥2 janelas E ≥2 regimes → inatingível com 1 janela.**

| Chefe | Estado v1.1 | Razão |
|---|---|---|
| Custos | **PASSED_CURRENT_WINDOW** | passa, mas custos 2× deixa só +1,32 (margem fina) |
| Sobrevivência | **PASSED_CURRENT_WINDOW** | maxDD 0,43%, dist.liq 0,18 — porém 1 fecho de emergência |
| Concentração | **PROVISIONALLY_DEFEATED** | top-1 24%, HHI 0,15 (1 janela) |
| Capacidade | **ACTIVE** | corrigido: 0 EV+ bloqueado por capital; satura US$400 |
| Diversificação | **ACTIVE** | só 1 fonte comprovada |

## 11. Growth corrigido (`growth-scenarios.json`)

**Removida** a taxa 0,67%/dia como base e **toda projeção de data** para níveis.
Amostra (≈20 operações, 1 janela) **insuficiente para bootstrap** (exige ≥30 ops E
≥2 janelas/regimes). Produz só: **trajetória observada** + **stress mecânico**
(custos 1,5×/2×, funding −25/−50%, combinado) + **intervalo de cenários**
(net de −3,34 a +9,98). Nenhuma data prometida, nenhum lucro futuro garantido.

## 12. Notícias e listagens (item 11)

Mantidos **só** schemas + docs + collector **desativado** (guard exige
`LISTING_COLLECTOR_ENABLE=1` + `LISTING_COLLECTOR_ISOLATED=1` + sem credenciais;
senão sai 0). **Nenhuma decisão, nenhuma ordem.** A Fase E (coleta) só começa após
1–9 reconciliados ou em branch separada.

## Validação operacional paralela (itens 10, 13)

**NÃO declarada encerrada.** Requisitos pendentes: 24h completas + monitor
finalizado.

- **Monitor 24h: 69/1440 minutos** decorridos (~1h8m). Supervisor + 4 challengers vivos, Control fidelity **OK**, **0 restarts**, integridade **SEM PERDA/DUPLICAÇÃO**. Segue rodando.
- **Reteste stale-lock (isolado, Windows PID): 6/6** — `scripts/challengers-timing/tests/supervisor-stalelock.test.sh`:
  - T1 lock stale → **auto-heal/takeover** (pid trocado, heartbeat renovado, mutex liberado);
  - T2 lock fresco → **single-instance recusa** (lock do dono preservado);
  - T3 **kill por Windows PID** mata o processo (0 remanescente) — fecha o gap 27/28 da v1.0 (onde `$$` do MSYS não era matável).
- **Champion intacto**; a validação **não foi interrompida** (4 challengers + monitor confirmados vivos após cada teste).

## Integridade

- Zero escrita em `spread/`, motores, risco ou execução; a plataforma só LÊ.
- Novo código em `scripts/progression/` + `scripts/challengers-timing/tests/`; artefatos em `auditoria/progression/`.
- **Champion intacto; validação prolongada independente e não interrompida.** Reversível.

## Distinções mantidas

observed (rejeições, outcomes, trajetória) · replayed (sandbox reconciliado) ·
simulated (curva de capacidade, stress) · shadow (selector, router) ·
hypothetical (cenários) · live-paper (challengers) · real (nada — nenhuma
alteração real nesta fase).
