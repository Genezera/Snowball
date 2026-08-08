# Snowball — Análise de Crescimento Composto (Compounding)

> **Fase:** Plataforma de Progressão — read-only / shadow / append-only / reversível.
> **Natureza deste documento:** análise honesta. Não promete lucro, não promete datas.
> **Fontes (somente números reais):**
> `auditoria/progression/capital-ledger.json`,
> `auditoria/progression/growth-scenarios.json`,
> `auditoria/progression/reinvestment-policies.json`.
> **Corte temporal:** `asOfMs = 1786197548002` (2026-08-08).

## Legenda de rótulos epistêmicos

Cada afirmação abaixo carrega um rótulo. Eles NÃO são intercambiáveis.

| Rótulo | Significado |
|---|---|
| **observed** | fato medido pelo Champion (Champion não é tocado; só lido). |
| **replay** | reexecução determinística sobre dados observados. |
| **simulated** | ajuste de um parâmetro (ex.: custos ×1,5) sobre o observado. |
| **hypothetical** | suposição estrutural (ex.: perder uma exchange). |
| **projection** | extrapolação temporal do retorno diário observado — **não garantida**. |

Distinção que atravessa o doc inteiro: **observed / simulated / hypothetical / projection**.
Nada aqui é `live-paper` de lucro futuro nem `real`.

---

## (a) Base observada — o que é lucro e o que NÃO é

### Reconciliação do capital `[observed]`

O capital reconcilia pela identidade contábil declarada no ledger:

```
capital = capitalInicial + funding − custos
609,9825 = 600,0000 + 18,6432 − 8,6606
```

- `calculado = reportado = 609,9825` → **diferença 0**, `reconcilia = true` `[observed]`.
- `capitalRealizado = 609,9825` (source: champion_observed, confidence 1) `[observed]`.
- `fundingAcumulado = 18,6432` `[observed]`.
- `custosAcumulados = 8,6606` `[observed]`.
- `lucroAcumulado = net = funding − custos = 9,9825` (source: derived, confidence 0,7) `[observed→derived]`.

Marcações a mercado (mesmo instante, confidence 1) `[observed]`:
- `equityMarcada = 609,8270`
- `equityExecutavel = 608,6736`

A pequena diferença entre `capitalRealizado` (609,98), `equityMarcada` (609,83) e `equityExecutavel` (608,67) é honestidade de marcação: realizado ≠ marcado ≠ liquidável ao spread atual.

### O aporte de +400 NÃO é lucro `[observed]`

A base inicial é composta de dois eventos de **capital externo**, não de resultado:

| Evento | Valor | Origem |
|---|---|---|
| `epoch0` | 200 | capital inicial |
| aporte `epoch-1` (ts 1785967765080) | +400 | injeção das 4 novas exchanges |
| **Total inicial** | **600** | `champion_observed`, confidence 1 |

O salto de 200 → 600 é **injeção de capital**, não crescimento. As 6 exchanges hoje seguram saldos próximos entre si `[observed]`:

```
binanceusdm 99,66  bybit 103,55  okx 101,33
gate 101,68        bitget 102,98 bingx 100,78
```

**O único lucro medido é 9,9825** (funding 18,6432 − custos 8,6606). Tudo acima de 600 é resultado; os 600 são base. Confundir os +400 com lucro inflaria o retorno em ordens de magnitude.

### Contribuição por motor `[observed]`

```
champion-funding  →  9,9825   (100% do lucro)
outros            →  0        (nenhum 2º motor comprovado)
```

100% do resultado vem do funding do Champion. Nenhum segundo motor contribuiu.

---

## (b) Retorno diário observado do epoch-1 — e o aviso de amostra

### O número `[observed]`

| Métrica do epoch-1 | Valor |
|---|---|
| capitalInicial (janela epoch-1) | 599,1425 |
| capitalFinal | 609,9825 |
| dias medidos | **2,72** |
| **retorno diário observado** | **0,6652% / dia** |
| maxDrawdown observado | 0,43% |

### O AVISO — amostra insuficiente `[projection warning]`

Citação literal do dataset:

> "AMOSTRA INSUFICIENTE: só 2.72 dias de epoch-1. TODA projeção abaixo é HIPÓTESE frágil — não é lucro futuro garantido. Não extrapolar dias como meses."

**~2,7 dias não são um regime.** Um retorno diário medido em menos de 3 dias:
- não separa sinal de ruído de funding;
- não viu um ciclo de reversão de funding, um evento de liquidez, nem um fim de semana completo;
- não pode ser elevado a semanas/meses sem virar ficção.

Toda projeção de "tempo-para-nível" existe **apenas para ordenar cenários entre si**, nunca para prometer uma data. O próprio arquivo encerra com:

> "Projeções de tempo-para-nível são extrapolações mecânicas do retorno diário observado (amostra de poucos dias) e servem só para ordenar cenários, não para prometer datas."

---

## (c) Cenários — o que cada um faz ao retorno `[simulated / hypothetical / projection]`

Base observada: **0,6652% / dia**, net **9,9825**. Níveis de capital: N4 = 800, N5 = 1200, N6 = 2000. Os "dias" são **projeções mecânicas**, não datas.

| Cenário | Tipo | Ret. diário | Net | N4 (800) | N5 (1200) | N6 (2000) |
|---|---|---|---|---|---|---|
| observado | observed | 0,6652% | 9,9825 | 41 | 102 | 179 |
| custos 1,5× | simulated | 0,3767% | 5,6522 | 72 | 180 | 316 |
| custos 2× | simulated | 0,0881% | 1,3219 | 308 | 768 | 1349 |
| funding −25% | simulated | 0,3546% | 5,3217 | 77 | 191 | 335 |
| funding −50% | simulated | 0,0440% | 0,6609 | 616 | 1537 | 2697 |
| −50% oportunidades | hypothetical | 0,3326% | 4,9913 | 82 | 204 | 358 |
| drawdown aplicado | simulated | 0,6624% | 9,9396 | 41 | 102 | 180 |
| perde 1 exchange | hypothetical | 0,5544% | 8,3188 | 49 | 122 | 215 |
| saturação do motor | hypothetical | 0,0000% | 0 | — | — | — |
| 2º motor desbloqueado | hypothetical | 0,6652% | 9,9825 | 41 | 102 | 179 |

**Leitura dos cenários (o que cada choque faz ao retorno):**

- **Custos** são o vetor mais brutal. A **1,5×**, o net cai ~43% (9,98 → 5,65). A **2×**, o net quase evapora (→ 1,32; retorno diário 0,088%). Ordens mínimas e taxas dobradas quebram o compounding antes de qualquer coisa `[simulated]`.
- **Funding menor** é linear e igualmente fatal: **−25%** ≈ metade do net; **−50%** derruba o retorno a 0,044%/dia (net 0,66) `[simulated]`. Como 100% do lucro é funding, o motor é tão forte quanto a taxa que o mercado paga.
- **Menos oportunidades (−50%)**: escala aproximadamente linear (net 4,99), sob hipótese explícita de proporcionalidade `[hypothetical]`.
- **Drawdown observado aplicado**: impacto marginal (9,98 → 9,94). O maxDD observado (0,43%) é pequeno — mas amostra curta `[simulated]`.
- **Perder uma exchange (6→5)**: capacidade tratada como ∝ nº de exchanges → net 8,32 `[hypothetical]`.
- **Saturação do motor**: o cenário mais importante de encarar. Se o motor **não absorve capital novo**, o retorno incremental → **0** e o tempo-para-nível é `null` (inatingível por esse caminho) `[hypothetical]`. Causa declarada: "poucas oportunidades EV+".
- **2º motor desbloqueado**: replica o retorno observado — mas exige um motor `ELIGIBLE` que **não existe hoje**. É projeção **condicional**, não garantida `[hypothetical]`.

Concentração: a dependência das melhores operações (top-1 ~24%) está em `bosses.json` — o resultado não é difuso, apoia-se em poucas pernas.

---

## (d) As 3 políticas de reinvestimento — e o INVARIANTE central

Todas assumem a regra de composição do ledger `[observed]`:

> `capitalSeguinte = capitalAtual + lucroLiquido`; **100% do lucro permanece no Snowball.**
> reservaPct 0,30 · alavancagem 5 · maxPosicoes 3 · margemPayback 1,5.
> "Reinvestir 100% ≠ expor 100%." Reserva e margem livre **são capacidade operacional**, não ociosidade a ser cortada.

| Política | Nome | Utilização média | % util | Ocioso médio | Exposição máx |
|---|---|---|---|---|---|
| **A** | Reinvestimento contínuo | 350,58 | 57,47% | 0,00 | 426,99 |
| **B** | Reinvestimento por degraus | 346,81 | 56,86% | 3,78 | 419,97 |
| **C** | Fundo de desbloqueio | 348,70 | 57,16% | 1,89 | 422,00 |

- **A** — todo lucro líquido eleva a base operacional já, respeitando reserva/limites/ordem mínima.
- **B** — a base só sobe ao atingir um **degrau economicamente útil** (min notional, 2ª posição, novo motor, nova exchange).
- **C** — parte do lucro fica em reserva interna até o capital mínimo de um novo módulo. **Todo o dinheiro permanece no Snowball.**

### O INVARIANTE `[derived, structural]`

> **Com 100% do lucro retido, A/B/C atingem o mesmo capital no mesmo tempo.**
> `capitalFinal = 609,9825` para as três; `tempoParaNivelIdenticoEntrePoliticas = true`.

A política **não acelera o crescimento**. O que muda entre A/B/C:

- **Exposição / utilização**: 57,47% vs 56,86% vs 57,16% — praticamente empatadas.
- **Capital ocioso**: A = 0 · B = 3,78 · C = 1,89.
- **Risco / buffer**: A = maior exposição · B = exposição em degraus · C = menor exposição, mais buffer.
- **Sobrevivência (piso de segurança)**: **C > B > A** (mais capital ocioso = mais buffer).
- **Custo de ordem mínima**: penaliza capital pequeno **igualmente** nas três; B/C podem **evitar ordens sub-mínimas** ao esperar um degrau.
- **Velocidade de crescimento**: **idêntica**. Não é variável de decisão.

Ou seja: escolhe-se política por **risco e utilização**, jamais por promessa de lucro maior. `capitalParado` não é desperdício — é buffer de sobrevivência.

---

## (e) O limite real: OFERTA de oportunidades EV+, não a política

O gargalo do crescimento não é como se reinveste, e sim **quantas oportunidades de EV positivo existem** `[observed / structural]`:

> "O landscape mostra oportunidades de EV positivo **ESCASSAS (13 na janela)** — o crescimento é limitado pela **OFERTA** de oportunidades, não pela política de reinvestimento."

Consequências honestas:
- Sem um **modelo de capacidade por oportunidade**, **não** se afirma que qualquer política aumente o lucro.
- O cenário de **saturação do motor** (retorno incremental → 0) é a materialização direta desse limite: capital novo sobre poucas oportunidades EV+ não gera retorno adicional.
- Mais capital só compõe se houver **onde alocá-lo com EV+**. Hoje há 3 posições abertas (CXMT, BICO, LA) e `maxPosicoes = 3` — a capacidade instalada já está próxima do teto operacional atual.

Estado atual de capital para o próximo degrau `[observed/derived]`:
- nível por capital: **3** → próximo: **4** (capitalMinimo 800).
- faltam `capitalNecessarioProximoNivel = 190,02`; `capitalDeployable = 426,99`.
- reserva operacional 182,99 · capital livre 239,22 · comprometido 187,77 · notional exposto 429,70.

---

## Conclusão honesta

1. **Lucro real observado: 9,9825** (funding 18,64 − custos 8,66). Os +400 do aporte são base, não resultado.
2. **Retorno diário observado: 0,6652%/dia**, medido em **2,72 dias** — amostra insuficiente. Projeções são hipóteses frágeis para **ordenar cenários**, nunca datas.
3. **Custos e queda de funding** são os choques que mais destroem o compounding; **saturação do motor** pode zerá-lo.
4. **A política de reinvestimento não muda a velocidade** (invariante A=B=C com 100% retido) — muda exposição, ocioso e risco. Escolha por **risco/utilização**; `C > B > A` em sobrevivência.
5. **O crescimento é limitado pela oferta de oportunidades EV+ (13 na janela), não pela política.**

**Nenhum lucro futuro é garantido. Nenhuma data é prometida. Nenhuma política é declarada vencedora** sem replay cronológico + stress em ≥2 janelas/regimes (Parte 15).

---
*Documento de análise. Read-only sobre os JSONs de progressão. Não altera Champion, motores, risco ou execução. Não envia ordem.*
