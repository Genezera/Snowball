# 🚀 ROADMAP — Maximização de Lucros (2 Exchanges)

> Roadmap detalhado e **faseado** para maximizar o lucro do motor `snowball-2ex`, com **ações concretas**, **impacto esperado**, **métricas** e **portões de decisão**. Ancorado no que já existe. Honesto: sem promessa de retorno diário impossível.
> Companheiro de [`PLANO-2-EXCHANGES.md`](PLANO-2-EXCHANGES.md) (foco/plano) e [`CONTEXTO.md`](CONTEXTO.md) (como iniciar/parar).

---

## 0. O modelo mental (a equação do lucro)

```
Lucro/dia  =  Capital  ×  Taxa/dia
Taxa/dia   =  funding capturado − custos − (bloqueios/ociosidade)
Capital    =  aporte acumulado  +  lucro reinvestido (compounding)
```

**Três alavancas, em ordem de impacto:**
1. **CAPITAL** (a maior) — cresce por aporte + compounding + tempo. Pesa ~10× mais que a taxa no US$/dia.
2. **TAXA** (os levers) — maker, utilização, spot-perp. Melhora a eficiência, mas é % de um número.
3. **TEMPO** — o composto só "assume o volante" no longo prazo.

> ⚠️ **A verdade que guia tudo:** funding-arb sustentável rende **~8–20% ao ANO**. Não existe truque diário seguro. "US$ 2/dia" é uma **meta de capital** (`Capital = 2 ÷ taxa/dia`), alcançada em **meses** com disciplina — não com alavancagem arriscada.

---

## FASE 0 — Baseline (onde estamos)
**Objetivo:** ter o motor certo, medido, reconciliado.
- ✅ Motor único `snowball-2ex` (bybit+bitget), cross-exchange + spot-perp, um livro-caixa.
- ✅ Levers embutidos: maker, persistência 30min, utilização (5 pos / reserva 20%), rendimento reserva, spot-perp.
- ✅ Reconciliação ao centavo (`reconciliar()` / `RECONCILIATION_BREAK`).
- ✅ Champion (6-ex) arquivado como referência.
- **Estado:** pausado a pedido; sobe com `blindagem.ps1` (auto-start desabilitado).

**Portão para Fase 1:** motor sobe, scanner alimenta o feed, dashboard mostra posições cross + spot-perp, reconciliação = 0.

---

## FASE 1 — MEDIR a taxa real (paper) 📊
**Objetivo:** parar de estimar e ter o número REAL da taxa/dia. Sem isto, tudo é chute.
**Duração:** 3–7 dias de operação contínua em paper.

**Ações:**
1. Subir o motor e deixar rodar (não mexer).
2. Coletar, por dia, do dashboard/estado:
   - `taxa/dia` (%) do capital, separada por **cross-exchange** e **spot-perp**.
   - nº de posições abertas / bloqueadas (utilização real).
   - custos vs funding (o custo está comendo quanto do funding?).
   - `RECONCILIATION_BREAK` (tem de ser sempre 0).

**Métricas-alvo (o que é "bom"):**
| Métrica | Bom | Alerta |
|---|---|---|
| taxa/dia líquida | > 0,05%/dia (~18%/ano) | < 0,02%/dia |
| custo / funding | < 25% | > 40% (persistência/maker mal usados) |
| utilização de capital | > 70% | < 50% (capital ocioso — subir maxpos ou spot-perp) |
| RECONCILIATION_BREAK | 0 | qualquer > 0 = bug, PARAR |

**Portão para Fase 2:** ≥ 5 dias de dado limpo, reconciliação 0, taxa/dia medida com separação cross vs spot-perp.

---

## FASE 2 — TUNAR os levers (com base no que a Fase 1 mostrou) 🔧
**Objetivo:** espremer a taxa/dia sem adicionar risco. **+15% a +40% na taxa** (estimado; medir).

**Ações (ordenadas por impacto/segurança):**
1. **Spot-perp notional** — hoje está em **15** (conservador). Se a utilização estiver < 70% e o spot-perp estiver rendendo, subir para **30–50** captura muito mais (no TUT a 1,8%/dia: US$ 15 → ~US$ 0,27/dia vs US$ 50 → ~US$ 0,90/dia). Testar `--spotperp-notional 30`, medir, subir se reconciliar.
2. **Perfil de agressividade do spot-perp** — hoje B (vol > US$ 5M). Se os símbolos estiverem líquidos nos 2 lados e sem prejuízo, testar aproximar de C (vol > US$ 1M) para pegar mais oportunidades. Só se o custo real de saída não estourar.
3. **Utilização** — se muitas posições forem bloqueadas por `maxPositionsBlocked` com capital sobrando, subir `--maxpos` (3→5→6) e/ou baixar reserva (0.20→0.15). Cuidado: reserva é colchão de liquidação.
4. **Custo (maker)** — confirmar que quase 100% das entradas são maker. Se a corretora oferecer **rebate maker** por tier, o custo cai mais (ou inverte).

**Regra:** mexer em **um lever por vez**, medir 1–2 dias, comparar. Se a taxa/dia não melhorar OU a reconciliação quebrar, reverter.

**Portão para Fase 3:** taxa/dia estabilizada e medida no seu melhor ponto seguro.

---

## FASE 3 — Motor de CAPITAL (compounding + aporte) 💰
**Objetivo:** ligar a bola de neve. Aqui é onde o US$/dia realmente cresce.

**Ações:**
1. **Compounding** — garantir que 100% do lucro vira notional maior (reinveste). Já é o desenho do motor; validar que o capital sobe e as posições escalam junto.
2. **Aporte** — plano de **US$ 200/mês** (US$ 100 em cada exchange), depositado no início do mês, **sempre deployado** (não ficar ocioso).
3. **Rastrear o "Caminho até US$ 2/dia":** `Capital-alvo = 2 ÷ (taxa/dia medida)`. Ex.: taxa 0,23%/dia → alvo ~US$ 870 → alcançado em ~mês 4 só de aporte.

**Projeção (taxa realista 1,5%/mês, aporte US$ 200/mês):**
| Tempo | Aportado | Valor da conta | Lucro gerado |
|---|---|---|---|
| 1 ano | US$ 2.400 | ~US$ 2.650 | +US$ 250 |
| 3 anos | US$ 7.200 | ~US$ 9.600 | +US$ 2.400 |
| 5 anos | US$ 12.000 | ~US$ 19.500 | +US$ 7.500 |
| 10 anos | US$ 24.000 | ~US$ 67.000 | +US$ 43.000 |

**Portão para Fase 4:** taxa provada + curva de capital subindo de forma consistente por ≥ 2–4 semanas.

---

## FASE 4 — Virar o DINHEIRO REAL 🎬
**Objetivo:** migrar do paper para real, com o mínimo de risco.
**Pré-requisitos (gates de segurança, TODOS obrigatórios):**
- [ ] Taxa/dia positiva e estável medida em paper por ≥ 3–4 semanas.
- [ ] Reconciliação 0 o tempo todo.
- [ ] Custos < 25% do funding.
- [ ] Guardião de liquidação testado.
- [ ] Você entende que **funding pode inverter** e gerar prejuízo — risco real, não "dinheiro grátis".

**Ações:**
1. Começar **pequeno** (os US$ 100 + US$ 100), maker, mesmos parâmetros do paper vencedor.
2. Rodar real e paper **em paralelo** por 1–2 semanas — comparar; se divergirem muito, investigar antes de escalar.
3. Só depois de bater, ligar o aporte mensal real.

> ⚠️ Emitir ordem real é fora do escopo do robô atual (paper only). A virada exige integração de execução com chaves de API — passo separado, com aprovação explícita sua.

---

## FASE 5 — ESCALAR (escada de capital) 📈
**Objetivo:** quando o capital cresce, o teto de 2 exchanges aperta. Aqui se decide relaxar a regra.

**Escada (cada degrau é NEUTRO, empilha sem risco direcional):**
| Capital | O que "liga" | Ganho |
|---|---|---|
| US$ 200–800 | motor atual (cross + spot-perp) + rendimento reserva | base |
| US$ 800–2.000 | subir spot-perp notional + tier maker melhor (rebate) | +taxa |
| US$ 2.000–5.000 | **3ª exchange** → 3 pares (o maior salto estrutural) | +oportunidades |
| US$ 5.000+ | 4–6 exchanges (6–15 pares) + cash-and-carry trimestral | teto alto |

> **Decisão sua:** ir além de 2 exchanges quebra a regra atual. É o maior multiplicador de oportunidade (mais pares = mais funding gordo disponível), mas adiciona operação. Fazer só quando o capital justificar.

**O que NÃO fazer (mata o snowball):**
- ❌ Estratégia direcional (scalping/swing/trend) — variância mata o composto (arrasto de volatilidade). Já provado perdedor neste projeto.
- ❌ Alavancagem alta — você já está em 5× (mais que os 2–3× dos profissionais). Segurança vem do guardião, não de subir alavancagem.
- ❌ Perseguir "US$ X/dia" forçado — é assim que se explode conta.

---

## Métricas permanentes (o painel que importa)
Acompanhar sempre, no dashboard/estado:
1. **taxa/dia líquida** (cross vs spot-perp separados).
2. **capital** (curva) e **US$/dia** absoluto.
3. **custo / funding** (%).
4. **utilização de capital** (% do capital trabalhando).
5. **RECONCILIATION_BREAK** (tem de ser 0 — se não for, PARAR e investigar).
6. **% da meta US$ 2/dia** = `capital_atual ÷ (2 ÷ taxa_dia)`.

---

## Resumo executivo (a régua)
1. **Medir** a taxa real (Fase 1) — sem isso, nada de decisão.
2. **Tunar** os levers, um por vez (Fase 2) — +15–40% na taxa.
3. **Capital** manda: aporte + compounding + tempo (Fase 3) — é onde o US$/dia cresce.
4. **Real** só com gates de segurança batidos (Fase 4).
5. **Escalar** com mais pares quando o capital justificar (Fase 5).
6. **Sagrado:** paper→real com cuidado, reconciliação 0, nada de direcional, nada de número falso.
