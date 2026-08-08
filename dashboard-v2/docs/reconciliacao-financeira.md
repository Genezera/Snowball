# Reconciliação financeira do Portfolio — tolerância documentada

Item 6 do fechamento das cinco páginas centrais. A reconciliação vive em
`src/lib/reconciliacao.ts` (helper puro e testável) e é exibida na zona
"Reconciliação do PnL" do Portfolio.

## Identidade contábil

Todo o PnL **realizado** do champion tem que ser explicado por funding
recebido menos custos pagos:

```
capital − capitalInicial  ==  fundingTotal − custosTotal
```

O resíduo `dif = (capital − capitalInicial) − (fundingTotal − custosTotal)`
é o que a reconciliação mede. Fonte dos quatro números: `spread/estado.json`.

## Tolerância

Aplicam-se **as duas**, vence a **maior** (piso proporcional para PnLs
grandes, piso absoluto para PnLs pequenos):

| tolerância | valor | motivo |
|---|---|---|
| absoluta | US$ 0,05 | ruído de arredondamento centavo-a-centavo |
| percentual | 0,5% de \|capital − capitalInicial\| | erro proporcional aceitável em PnLs grandes |

```
tolEfetiva = max(0.05, 0.005 · |capital − capitalInicial|)
reconciliado  ⇔  |dif| ≤ tolEfetiva
```

## Números reais (snapshot em 2026-08-08, estado.json ao vivo)

```
fundingTotal       18.176654907369976
custosTotal         8.611231042208779
capital           609.565423865161
capitalInicial    600
funding − custos    9.565424
capital − inicial   9.565424
diferença          -1.457e-13   (≈ 0, ruído de ponto flutuante)
tolerância abs      0.05
tolerância %·|cmi|  0.047827
tolerância efetiva  0.05
resultado          reconciliado
```

## Três resultados honestos

| condição | status | exibição |
|---|---|---|
| `|dif| ≤ tolEfetiva` | `reconciliado` | badge verde + diferença aplicada |
| `|dif| > tolEfetiva` | `divergente` | badge âmbar + diferença vs tolerância |
| qualquer um dos 4 campos ausente / NaN | `nao_instrumentado` | nunca "reconciliado por omissão" — sem os quatro números não há o que reconciliar |

Nunca se declara "reconciliado" sem mostrar a tolerância aplicada: a tela
exibe `máx(abs 0,05; 0,5%·|capital−inicial|) = tolEfetiva` e a `dif` real.

## Testes

`src/tests/reconciliacao.test.ts` cobre: dentro da tolerância →
reconciliado; centavo dentro do piso absoluto; fora → divergente; piso
percentual em PnL grande; campo ausente → não instrumentado; valor NaN →
não instrumentado.
