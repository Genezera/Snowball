# Auditoria financeira do Portfolio (item 1)

Semântica REAL de cada campo, verificada na fonte (`src/funding/spread-live.ts`,
`spread/estado.json`, `spread/marcacao.json`). O Portfolio só usa fórmulas
comprovadas; o que não é instrumentado sai como `{valor:null, tracked:false}`.

| campo | definição | unidade | fonte | obs/calc | inclui margem? | inclui PnL aberto? | inclui custos? | atualização |
|---|---|---|---|---|---|---|---|---|
| `estado.capital` | capital realizado total do Champion (soma dos saldos por exchange) | USD | estado.json | observado | n/a | não (só realizado) | já líquido | por ciclo |
| `estado.capitalInicial` | capital inicial declarado (US$ 600 = 6×100) | USD | estado.json | observado | — | — | — | fixo |
| `estado.saldos[ex]` | **wallet balance** por exchange; cresce com funding realizado. Usado como `saldos[ex]−saldosIniciais[ex]` p/ PnL por exchange | USD | estado.json | observado | **não separa livre/usado** | não | já líquido | por ciclo |
| `estado.caixaOcioso` | funding recebido ainda não reinvestido (aguardando valer a pena) | USD | estado.json | observado | não | não | — | por ciclo |
| `margemShort`/`margemLong` | margem comprometida em cada perna da posição | USD | estado.posicoes | observado | **é a margem** | não | não | por posição |
| `notionalPorPerna` | notional nominal por perna (na entrada) | USD | estado.posicoes | observado | não | não | não | por posição |
| `marcacao.posicoes[].notionalShort/Long` | notional REAL por perna a preço de mark (diverge quando os preços divergem) | USD | marcacao.json | **calculado a mark** | não | reflete mark | não | por marcação |
| `marcacao.pnlNaoRealizadoShort/Long` | PnL aberto por perna a mark | USD | marcacao.json | calculado | não | **é o PnL aberto** | não | por marcação |
| `equityMark` | capital realizado + PnL não-realizado marcado | USD | marcacao.json | calculado | não | sim | — | por marcação |
| `equityLiquidacao` | equity se fechasse tudo agora (preço executável) | USD | marcacao.json | calculado | não | sim (executável) | reflete saída | por marcação |
| `pnlNaoRealizadoMark` | PnL aberto total a mark | USD | marcacao.json | calculado | não | sim | não | por marcação |
| `fundingTotal` | funding bruto realizado acumulado (vitalício) | USD | estado.json | observado | não | não | não | por settlement |
| `custosTotal` | custos realizados acumulados (vitalício) | USD | estado.json | observado | não | não | é o custo | por ciclo |
| `custoEstimadoFechamentoTotal` | estimativa de custo para fechar as posições abertas | USD | marcacao.json | **estimado** | não | não | estimativa | por marcação |

## Conclusões que corrigem as suposições anteriores

1. **Caixa disponível (livre) NÃO é instrumentado.** `saldos` é wallet
   balance total por exchange; não há campo de "available/free collateral".
   A versão anterior calculava `caixa = saldo − margem` — uma suposição não
   comprovada. Corrigido para `{valor:null, tracked:false, motivo:"saldo
   livre por exchange não instrumentado"}`.
2. **Exposição por perna vem de `marcacao.posicoes[].notionalShort/Long`
   (real, a mark)** — nunca mais `short = long` copiado nem
   `notionalLiquido = 0`. O desbalanceamento é `ΣnotionalLong − ΣnotionalShort`.
3. **PnL reconciliável:** `fundingTotal − custosTotal` deve bater com
   `capital − capitalInicial` dentro de tolerância. O Portfolio mostra a
   diferença e o status de reconciliação — nunca dois números com o mesmo
   rótulo.
4. **Nomenclatura:** "Capital do Champion — PAPER" e "Capital experimental
   agregado — PAPER LAB". Nada é rotulado como dinheiro real.
