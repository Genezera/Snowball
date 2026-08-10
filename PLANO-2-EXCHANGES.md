# 🎯 PLANO — 2 Exchanges (foco, plano e análise de erros)

> Documento de referência. Define **o foco**, **o plano para as 2 exchanges**, **o que tinha que ser feito**, e **a análise do que a IA anterior errou**. Leia isto antes de mexer no motor. Complementa o [`CONTEXTO.md`](CONTEXTO.md) (handoff operacional: como iniciar/parar).

---

## 1. O FOCO (uma frase)
**Um único motor, delta-neutro, em 2 exchanges (bybit + bitget), US$ 100 em cada, capturando funding de duas formas — cross-exchange e spot-perp — no MESMO livro-caixa reconciliado ao centavo. Paper primeiro; nada de ordem real; nada de número falso.**

Tudo o mais é meio para esse fim. Se algo não serve às 2 exchanges, ou vira referência arquivada, ou é obsoleto.

---

## 2. O PLANO para as 2 exchanges

### 2.1 A estratégia (o que gera lucro)
- **Cross-exchange funding:** long perp numa exchange + short perp na outra (mesmo ativo). Captura o **diferencial** de funding. Exposição a preço ≈ 0.
- **Spot-perp (cash-and-carry):** compra spot + short perp **na mesma exchange**. Captura o funding **absoluto** — acessa oportunidades que o cross-exchange perde (funding alto e igual nas duas). Também neutro.
- As duas rodam no **mesmo motor** (`snowball-2ex`), disputando **um contador de capital só**. Nunca "atropela" capital: o ledger bloqueia quando não há saldo livre.

### 2.2 Os levers de maximização (todos embutidos, todos com base em dado real)
| Lever | Efeito | Flag |
|---|---|---|
| Ordens **maker** | custo cai a ~36% do taker | `--cost-model maker` |
| **Persistência 30min** | corta entradas prematuras (vazamento nº1) | `--persist-min 30` |
| **Utilização de capital** | usa os ~40% ociosos (5 posições, reserva 20%) | `--maxpos 5 --reserva 0.20` |
| **Rendimento da reserva** | reserva ociosa rende ~6%/ano, neutro | `--stable-yield 0.06` |
| **Spot-perp** | 2ª superfície de captura nas mesmas 2 ex | `--spotperp --spotperp-minvol 5000000` |
| **Compounding** | reinveste o lucro; bola de neve | (no motor) |

### 2.3 O que é sagrado (invariantes — NÃO violar)
1. **Paper trading.** Nenhuma ordem real, nunca.
2. **Reconciliação ao centavo.** `capital = inicial + funding + rendimento − custos`. E `saldos + comprometido == capitalInicial`. A função `reconciliar()` loga `RECONCILIATION_BREAK` e é a garantia anti-número-falso.
3. **Segredos só no `.env`.** Token do Telegram nunca commitado.
4. **O scanner é infraestrutura COMPARTILHADA, não o Champion.** (ver §4 — foi aqui que a IA anterior tropeçou.)
5. **Nenhuma exchange no negativo.** bybit e bitget têm de dar lucro CADA UMA, não só o agregado — funding
   settla por exchange, então o par pode "esconder" uma perna sangrando atrás do net combinado. Medido via
   `fundingPorExchange`/`custosPorExchange`/`yieldPorExchange` no `estado.json` (decomposição exata dos
   agregados, aditivo, não mexe em `saldosPorExchange`/`reconciliar()`; ver commit `e57371a`, 2026-08-10) e
   exibido no dashboard em `/saude` → "Lucro por exchange". Se uma exchange ficar negativa persistentemente,
   é sinal pra investigar (não necessariamente pra agir sozinho — é uma decisão de Fase 2, um lever por vez).

### 2.4 A meta e como se chega nela
- **US$ 2/dia não é um truque diário — é uma meta de CAPITAL.** `Lucro/dia = Capital × Taxa/dia`. Com aporte de US$ 200/mês + reinvestimento, o capital chega no nível de US$ 2/dia em **meses**, não com alavancagem arriscada.
- O ganho real vem de: **taxa** (os levers acima, medidos em paper) × **capital** (aporte + compounding) × **tempo**.

---

## 3. O QUE TINHA QUE SER FEITO (sequência correta)
1. ✅ Consolidar em **um motor** (bybit+bitget venceu o head-to-head; gate+okx ficou faminto).
2. ✅ Embutir os levers (maker, persistência, utilização, rendimento).
3. ✅ **Coletor spot-perp** (dado real via ccxt, taxas do spot, liquidez real **nos dois lados**).
4. ✅ **Engine spot-perp** no motor, reconciliada ao centavo (teste `--once`: erro 0.000000).
5. ✅ **Command Center** refeito: motor real + radar spot-perp.
6. ✅ **Arquivar o Champion (6-ex)** — vira referência, não roda mais.
7. 🔜 Deixar rodar em paper e **medir a taxa real** (cross + spot-perp).
8. 🔜 Quando a taxa estiver provada, **reconfigurar pro dinheiro real** (2 ex, US$ 100 cada).

---

## 4. ANÁLISE — o que a IA anterior errou

Contexto: depois do handoff (commit `41609c2`), a continuação fez `53be62f` (arquiva Champion) e `f421183` (fix crítico).

### 4.1 🔴 ERRO CRÍTICO (ela mesma pegou e reverteu)
**Arquivou o SCANNER (vigilancia + custodia + universo + spread + liquidacao + ponte-captura) junto com o Champion.**
- **Por que é erro:** o scanner (`src/cli/vigilancia.ts`) varre o funding de TODAS as 6 exchanges e escreve `vigilancia/historico.jsonl` → `coletor.ts` arquiva em `arquivo-observacoes.jsonl` → **é este arquivo que o motor 2-ex lê**. Sem o scanner, o motor fica **sem feed** e não abre nada. O spot-perp também depende do funding real das exchanges.
- **A raiz do erro:** confundir **"scanner de 6 exchanges"** com **"Champion de 6 exchanges"**. São coisas diferentes: o scanner é **infraestrutura compartilhada** (varre 6 pra achar as melhores oportunidades no par bybit+bitget); o Champion era um **motor** que operava as 6. Arquivar o motor: certo. Arquivar o scanner: mata o projeto.
- **Status:** revertido em `f421183`. Hoje o scanner está de volta em `src/cli/` e supervisionado. ✅
- **Lição:** o "6" do scanner ≠ o "6" do Champion. **Nunca arquivar vigilancia/custodia/universo** — o motor 2-ex depende deles.

### 4.2 🟡 Pendências menores ainda presentes (stale)
- **`README.md` (bloco de estrutura, ~linha 87)** ainda lista `spread-live` em `src/cli/` — mas ele foi movido pra `arquivo-6-exchanges/`. Referência morta no doc.
- **`scripts/blindagem.ps1` (comentário, linha 11)** ainda cita "Champion spread-live + momentum + preenchimento + pares" — processos que não existem mais.
- Correção: são só textos/comentários (não quebram build), mas devem ser atualizados pra não confundir.

### 4.3 🟡 Escolha a revisar (não é erro, mas reduz o upside)
- **`--spotperp-notional` caiu de 50 → 15.** Conservador demais: no TUT (1,8%/dia) isso rende ~US$ 0,27/dia por posição em vez de ~US$ 0,90. Reduz a contribuição do spot-perp em ~3×. Pode ser intencional (deixar capital pro cross-exchange), mas **contradiz** a descoberta de que o spot-perp é o maior lever de lucro diário. Revisar quando medir a taxa real.

### 4.4 🟢 O que ela fez CERTO
- Arquivou o Champion de forma limpa (sem imports ativos apontando pro arquivo).
- **Melhorou o coletor spot-perp**: passou a exigir liquidez real **também no lado spot** (`volSpot`) — era um item que eu tinha deixado pendente no `CONTEXTO.md`. ✅
- Reconciliação e spot-perp seguem intactos; dashboard typecheck 0 erros.

---

## 5. Regra de ouro para quem continuar
> **Antes de arquivar/apagar qualquer coisa, pergunte: "o motor 2-ex depende disso?"** O motor precisa de: o scanner (vigilancia/custodia/coletor/universo), o próprio `forward-lab.cjs`, o `coletor-spotperp.cjs`, o `.env`, e o dashboard. Tudo isso é **vivo**. O Champion (spread-live e amigos) é **referência arquivada**. Na dúvida, rode o fecho de dependências a partir do que o supervisor lança — não arquive por nome.
