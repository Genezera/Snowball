# Snowball — Plataforma de Progressão e Maximização de Capital (v1)

Camada **read-only / shadow / append-only / reversível** que responde
continuamente *onde o Snowball está, quanto cresceu, quanto falta para o próximo
nível e onde o próximo dólar de lucro renderia mais* — **sem** enviar ordem,
mover saldo, alterar Champion/motores/risco/execução ou criar uma terceira
interface. Branch isolada: `feature/snowball-progression-lab` (a partir de
`snowball-challengers-hardening-1786189433850`).

> **Nenhuma alteração real ocorre nesta fase.** Todos os números vêm de dados
> observados do Champion e dos datasets shadow; cada artefato é reprodutível por
> `node scripts/progression/build-all.cjs` e reconcilia com `spread/estado.json`.

## As 10 perguntas — respostas de hoje (dados reais)

| # | Pergunta | Resposta (asOf último ciclo do Champion) |
|---|---|---|
| 1 | Quanto capital o sistema possui? | **US$ 609,98** realizado (equity marcada 609,49; executável 608,36) |
| 2 | Quanto está disponível? | **US$ 239,22** livre (acima de reserva + margem comprometida) |
| 3 | Quanto em reserva? | **US$ 182,99** (30% — pertence ao Snowball, é capacidade) |
| 4 | Estratégias desbloqueadas? | Só o **funding delta-neutro** (Champion, LIVE) |
| 5 | Estratégias comprovadas? | **1** — champion-funding. As demais: amostra insuficiente |
| 6 | Melhor retorno líquido agora? | O próprio funding; landscape shadow tem **13** oportunidades EV+ na janela |
| 7 | Oportunidade que exige capital que não temos? | Nível 4+ (eventos/listagens): ~US$ 190 a mais de capital **e** infraestrutura |
| 8 | Próximo nível de capital? | **N4 (US$ 800)** por capital; **N2** por evidência |
| 9 | O que desbloqueia? | N2: 2ª posição simultânea + timing + exchange selector |
| 10 | Onde vai o próximo dólar de lucro? | Provar um **2º motor** (captura/cross-sectional) — não expor mais o mesmo motor |

**Manchete honesta:** o capital já suporta o **nível 3** (roda 3 posições
concorrentes em 6 exchanges = US$ 600), mas por **evidência** o Snowball está no
**nível 1**. O que trava a progressão é **prova (amostra/gate), não dinheiro.**

## Entregas (Parte 16)

| # | Item | Artefato | Estado |
|---|---|---|---|
| 1 | Ledger de capital | `auditoria/progression/capital-ledger.json` + `.jsonl` | ✅ reconcilia exato |
| 2 | Sistema de níveis | `levels.json` + [SNOWBALL-PROGRESSION-LEVELS.md](SNOWBALL-PROGRESSION-LEVELS.md) | ✅ |
| 3 | Chefes e critérios | `bosses.json` | ✅ 3 derrotados / 2 ativos |
| 4 | Engine Registry | `engine-registry.json` | ✅ 9 motores |
| 5 | Exchange Selector shadow | `exchange-selector.json` + `exchange-pair-ranking.jsonl` | ✅ replay 15 combos |
| 6 | Capital Opportunity Router | `capital-router.json` + `capital-router-decisions.jsonl` | ✅ shadow |
| 7 | Políticas de reinvestimento | `reinvestment-policies.json` | ✅ invariante provado |
| 8 | Simulação de crescimento | `growth-scenarios.json` + [SNOWBALL-COMPOUNDING-ANALYSIS.md](SNOWBALL-COMPOUNDING-ANALYSIS.md) | ✅ com aviso de amostra |
| 9 | Radar de notícias — arquitetura | [NEWS-EVENT-RADAR-ARCHITECTURE.md](NEWS-EVENT-RADAR-ARCHITECTURE.md) + `auditoria/events/event-schema.json` | ✅ arquitetura-only |
| 10 | Reinvestimento (políticas) | `reinvestment-policies.json` | ✅ |
| 11 | Simulação de crescimento | `growth-scenarios.json` | ✅ |
| 12 | Radar — arquitetura | ver item 9 | ✅ |
| 13 | Listing Lab | [LISTING-OPPORTUNITY-LAB.md](LISTING-OPPORTUNITY-LAB.md) + `auditoria/listings/listing-schema.json` + `scripts/listings/collector-placeholder.cjs` | ✅ arquitetura + coleta |
| 14 | Diagnóstico dos motores | `engine-diagnostics.json` | ✅ |
| 15 | Arquitetura futura p/ ações | [FUTURE-MULTI-MARKET-ARCHITECTURE.md](FUTURE-MULTI-MARKET-ARCHITECTURE.md) | ✅ arquitetura-only |
| 16 | Progression status | `progression-status.json` | ✅ |
| 17 | Matriz de prioridades | este doc, §Matriz | ✅ |
| 18 | Lacunas de dados | este doc, §Lacunas | ✅ |
| 19 | Próxima implementação | este doc, §Próximo | ✅ |

## Parte 1 — Ledger (reconciliado)

`capital = capitalInicial + funding − custos` → **609,9825 = 600 + 18,6432 −
8,6606** (`reconcilia: true`). O ledger separa: capital inicial (US$ 200 do
epoch-0, 2 exchanges) + **1 aporte de US$ 400** (4 novas exchanges — **injeção,
NÃO lucro**) = base 600; lucro líquido **+9,98**; reserva 182,99; comprometido
187,77; livre 239,22; maxDD observado **0,43%**. Histórico append-only com 56
entradas (`eventId/origem/tipo/valor/saldoAnterior/saldoPosterior/configEpochId/
source/confidence`). Reinvestir 100% ≠ expor 100%: reserva e margem livre são
capacidade, não folga para gastar.

## Parte 2 — Níveis (capital derivado, desbloqueio por evidência)

Capital mínimo = **slots de exchange × US$ 100** (a reserva mora dentro do saldo
de cada exchange). N0=0, N1=200, N2=400, N3=600, N4=800\*, N5=1200\*, N6=2000\*
(\*estimativa). Desbloqueio exige **capital + evidência**:

| Nível | Capital | Evidência | Status |
|---|---|---|---|
| 0 Fundação | ✅ | reconciliação + integridade OK | **UNLOCKED** |
| 1 Motor principal | ✅ | Champion LIVE + Custos/Sobrevivência derrotados + net>0 | **UNLOCKED** |
| 2 Eficiência | ✅ | gate dos challengers de timing LIBERADO + Concentração | **BLOCKED** (gate 0/30) |
| 3 Segunda fonte | ✅ | Chefe Diversificação (≥2 fontes independentes) | **BLOCKED** (só 1 fonte) |
| 4 Eventos | ✗ (−190) | Capacidade + dados de evento | **LOCKED** |
| 5 Portfólio | ✗ | ≥2 motores ELIGIBLE + router fiel | **LOCKED** |
| 6 Novos mercados | ✗ | arquitetura multi-mercado separada | **LOCKED** |

## Parte 3 — Chefes

| Chefe | Status | Evidência real |
|---|---|---|
| Custos | **DERROTADO** | fee-to-gross 46,4%; lucro com custos 2× = **+1,32** (folga PEQUENA) |
| Sobrevivência | **DERROTADO** | maxDD 0,43%; dist. liquidação mín **0,182** (>0,06); piso respeitado (1 fecho de emergência no histórico) |
| Concentração | **DERROTADO** | top-1 símbolo **24,2%**; Herfindahl 0,153 |
| Capacidade | **ATIVO** | **6.422** oportunidades rejeitadas por saldo → constrangido por capital, sem 2º motor p/ absorver |
| Diversificação | **ATIVO** | só o funding tem amostra+lucro; captura +0,82 mas amostra pequena |

## Parte 4 — Engine Registry (9 motores)

LIVE 1 · DATA_COLLECTION 4 · SHADOW 1 · LOCKED 2 · ARCHITECTURE_ONLY 1. Nenhum
promovido automaticamente. champion-funding LIVE (net +9,98, conf alta);
settlement-capture SHADOW (+0,82, amostra 4); close-timing-challengers, funding
cross-sectional, pares, momentum em DATA_COLLECTION (0 aprovados / PnL ≤ 0 /
amostra mínima); news-radar e listing-lab LOCKED; ações ARCHITECTURE_ONLY.

## Parte 5 — Exchange Selector (replay das 15 combinações)

Replay cronológico verdadeiro, common-window por construção (scans varrem todas
as exchanges no mesmo ciclo), sem seleção retrospectiva de vencedores.

- Melhor par **realizado**: **bitget+bybit (+6,04)**; depois gate+okx (+2,94), bingx+bybit (+1,51).
- **Lucro perdido ao restringir a 2 exchanges: ~US$ 4,42** (~42% do PnL atribuído a pares veio de espalhar pelas 6).
- **Veredito: INSUFICIENTE para escolher 2** — só **13** oportunidades de EV positivo numa janela de **~26h**. A regra do Snowball proíbe escolher 2 exchanges por uma única janela. O ranking é **direcional**, não decisão.

## Parte 6 — Capital Router (shadow)

2.077 episódios normalizados ao formato comum. Shadow alocaria **6**, Champion
escolheu **11**, **ambos rejeitam 2.064**, divergem 9 → concordância 99,6%. A
concordância alta reflete que **quase nada passa no custo/payback**, não
"acerto" do router. Observador puro: a decisão real continua do Champion.

## Parte 7 — Reinvestimento (invariante)

Com **100% do lucro retido**, políticas A (contínuo) / B (degraus) / C (fundo de
desbloqueio) atingem o **mesmo capital no mesmo tempo**. O que muda é
**exposição / capital ocioso / risco** (utilização ~57% nas três; ocioso médio
A 0 · B 3,78 · C 1,89). **Reinvestimento não acelera o lucro — só muda a
exposição.** O crescimento é limitado pela **oferta escassa de oportunidades EV+**.

## Parte 8 — Crescimento (com aviso honesto)

Retorno diário observado do epoch-1 = **0,666%/dia**, sobre **apenas 2,72 dias** →
**amostra frágil**: toda projeção é hipótese, não lucro garantido. Sensibilidade:
custos 2× → 0,088%/dia; funding −50% → 0,044%/dia; saturação → 0%/dia. 100% do
lucro vem do funding.

## Parte 11 — Diagnóstico dos motores

- **Momentum** (live-paper): PnL **−0,99**, 1 fechado / 0 vitórias / 44 abertos → inconclusivo. Não afrouxar entradas/saídas; acumular fechados.
- **Pares**: 0 sinais (nenhum par passou p-value/half-life). Continuar em barras diárias; **não** afrouxar filtros.
- **Captura**: +0,82 líquido, 4 concluídas, 2 inversões — positivo mas amostra pequena.
- **Cross-sectional**: 20 ranqueados, **0 aprovados** (sem edge na janela).

## Parte 14 — Sequência de implementação (não pular fases)

| Fase | Conteúdo | Estado |
|---|---|---|
| **A** Inventário e arquitetura | ledger, registry, levels, bosses, schemas, mapa de dados | ✅ concluída |
| **B** Exchange Selector shadow | replay das combinações, common-window, ranking US$100/perna | ✅ concluída (direcional) |
| **C** Capital Router shadow | normalização, decisões virtuais, outcomes, zero execução | ✅ concluída |
| **D** Reinvestment Simulator | progressão, políticas, stress, tempo p/ desbloqueios | ✅ concluída |
| **E** Event/Listing Data Foundation | schemas, collectors isolados, provenance, dedup, append-only | 🟡 schema + placeholder; **coleta WS pendente** |
| **F** Paper Labs | listing momentum/exhaustion, news studies, lead/lag | ⛔ só após coleta (E) |

## Parte 15 — Gates de desbloqueio

Nenhum módulo recebe capital real só porque o saldo subiu. Um desbloqueio exige
**combinação**: capital mínimo · amostra mínima · **2 janelas** · **2 regimes** ·
PnL líquido positivo · custos estressados · drawdown aceitável · risco controlado
· concentração aceitável · estabilidade operacional · dados íntegros · rollback ·
**aprovação humana**. *Um lucro isolado ou uma moeda que subiu muito não
desbloqueia um motor.*

## Matriz de prioridades (Parte 17)

| Prioridade | Ação | Por quê | Bloqueio |
|---|---|---|---|
| **P1** | Acumular amostra dos **challengers de timing** até o gate (≥30 realExtensions) | Desbloqueia N2; já rodando | tempo/dados |
| **P2** | Coletar landscape do **Exchange Selector** em ≥2 janelas/regimes | Decidir 2 exchanges com honestidade | 1 janela só |
| **P3** | Amadurecer **settlement-capture** (≥30 concluídas) | Candidato a 2ª fonte (N3) | amostra |
| **P4** | **Diagnóstico do momentum** sobre fechados reais | Decidir se vira shadow | poucos fechados |
| **P5** | **Fundação de dados** de eventos/listagens (coleta WS isolada) | Pré-requisito de N4 | infra WS |
| **P6** | Arquitetura de **ações** (sem execução) | Mapa de N6 | — |

## Lacunas de dados (Parte 18)

- **Uma janela só** (~26h) de candidate-observations → insuficiente p/ 2 exchanges/2 regimes.
- **13 oportunidades EV+** apenas → landscape de baixa densidade; precisa acumular.
- `capitalNecessario`/`saldoDisponivel` dos candidatos refletem a config viva (US$600/6ex), **não** um cenário US$200/2ex — coluna "fundável 100/perna" é aproximação.
- **Realizado por par** enviesado (o Champion só abre o melhor); custo de fechamento das posições abertas ainda não realizado.
- **Sem coleta por WebSocket** → primeiros segundos de listagem não observáveis.
- **Sem modelo de capacidade por oportunidade** → não se afirma que mais capital = mais lucro.
- **Amostras pequenas** em captura/cross-sectional/pares/momentum; **2,7 dias** de epoch-1 p/ crescimento.

## Próxima implementação recomendada (Parte 19)

**Fase E — Fundação de dados de eventos/listagens** (coleta isolada, append-only,
com provenance/dedup), em paralelo à continuação da coleta que já roda (P1–P2).
Só depois disso os **Paper Labs** (Fase F). Nada recebe capital real sem passar
por todos os gates da Parte 15.

## Honestidade (regras desta camada)

Não declaramos lucro futuro garantido; não transformamos projeção em resultado;
não chamamos evento de oportunidade lucrativa sem outcome; não escolhemos 2
exchanges por uma janela; não promovemos motor com amostra pequena; não
consideramos lucro bruto sem custos; não misturamos capital real/paper/
contrafactual; não afirmamos que reinvestir aumenta lucro se só aumenta
exposição. Distinguimos sempre **observed / replayed / simulated / shadow /
hypothetical / live-paper / real**.

## Integridade (Partes 16.22–24)

- **Champion intacto** — nenhuma escrita em `spread/`, motores, risco ou execução; a plataforma só LÊ.
- **Validação dos challengers NÃO interrompida** — a frente de validação prolongada (supervisor + 4 challengers + monitor 24h) segue rodando, isolada, sem toque desta fase.
- **Working tree** — todo novo código em `scripts/progression/` + `scripts/listings/`; artefatos em `auditoria/progression/` + `docs/`; branch `feature/snowball-progression-lab`. Reversível.
