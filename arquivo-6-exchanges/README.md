# Arquivo — bloco "6 exchanges" (Champion + Paper Profit Lab + challengers-timing)

Isolado a pedido, em 2026-08-09. **Nada aqui roda no projeto atual.** Nenhum processo
supervisionado inicia nada desta pasta; para reativar (ver seção "Como reativar"
no fim), é preciso religar manualmente, com cuidado, e restaurar as dependências
compartilhadas que foram removidas deste bloco (nenhuma foi apagada — todas
seguem no repositório, só em outro lugar).

> **Correção (mesma sessão, achada verificando trades ao vivo):** a primeira
> versão deste arquivamento também moveu `src/cli/vigilancia.ts` e
> `src/cli/custodia.ts` (+ os módulos `funding/vigilancia.ts`,
> `vigilancia-basis.ts`, `ponte-captura.ts`, `universo.ts`, `funding/custodia.ts`,
> `funding/spread.ts`, `funding/liquidacao.ts`) pra dentro do arquivo, por
> engano — achando que eram exclusivos do Champion. **Não são.** `vigilancia.ts`
> é quem faz a varredura REAL via ccxt e escreve `vigilancia/historico.jsonl`;
> `src/cli/coletor.ts` (o scanner "compartilhado") só LÊ esse arquivo e arquiva
> o que é novo em `arquivo-observacoes.jsonl` — nunca consulta exchange nenhuma
> sozinho. Sem `vigilancia.ts` rodando, o coletor ficava vivo mas sem nada novo
> pra ler, e o motor real (`snowball-2ex`) ficava cego pro mercado sem nenhum
> erro aparente (achado só ao comparar o funding congelado das posições
> abertas com dado real da exchange). `vigilancia.ts`/`custodia.ts` e seus
> módulos foram RESTAURADOS pra `src/` — só `spread-live.ts` (o motor Champion
> em si) continua arquivado de verdade.

## O que é isto

Três camadas do "Champion" (motor de referência em 6 exchanges) e da pesquisa
construída em torno dele, todas paradas desde este arquivamento:

| Camada | O que fazia | Onde ficou |
|---|---|---|
| **Champion (motor em si)** | Motor real 6-ex (binanceusdm, bybit, okx, gate, bitget, bingx), referência/benchmark do funding-arb | `src/cli/spread-live.ts` + módulos exclusivos dele em `src/funding/` (spread-live, protecao, valor, compound, marcacao, liquidacao — ver nota acima, telegram, custos-reais, tesouraria, ponte) |
| **Paper Profit Lab** | ~12 "challengers" virtuais (variantes de config do Champion: ranking, batch-rebalancing, alocação de capital, etc.) testados em paralelo, capital isolado | `src/inteligencia/` (challengers.ts, virtual-portfolio.ts, registro-oportunidades.ts) — o worker `paper-profit-lab.ts` já não existia antes deste arquivamento |
| **challengers-timing** | Experimento de 5 janelas de timing de settlement (5/10/20/30/60min antes do funding) | `scripts/challengers-timing/` — o worker `challenger-timing-live.cjs` também já não existia |

**`vigilancia.ts`/`custodia.ts` NÃO estão aqui** — são compartilhados (ver correção acima), continuam em `src/cli/`, supervisionados por `scripts/supervisor.sh`.

Dashboard: as páginas `/champion`, `/opportunities`, `/costs`, `/risk`,
`/capture`, `/historico` e `/system` (a versão antiga, só sobre esta stack)
foram removidas do menu e do roteador — código em `dashboard-v2-src/` e
`dashboard-v2-api/`, mesma estrutura de `dashboard-v2/src|api`.

## Por que foi isolado, não apagado

O Champion serviu seu propósito: foi a régua que validou a estratégia de
funding-arb e mediu os levers de lucro (maker, filtro de persistência,
concentração em 2 exchanges) que o motor real (`snowball-2ex`) usa hoje. A
decisão de qual par de exchanges vira dinheiro real (`bybit+bitget`) já foi
tomada com base nesses dados. Não há mais trabalho ativo nesta frente — mas o
código e o raciocínio continuam válidos como histórico e não foram descartados.

## O que NÃO foi movido (fica ativo, é compartilhado)

- `src/cli/vigilancia.ts` (+ `funding/vigilancia.ts`, `vigilancia-basis.ts`,
  `ponte-captura.ts`, `funding/universo.ts`, `funding/spread.ts`) — a
  varredura REAL via ccxt. Escreve `vigilancia/historico.jsonl`, `ciclos.json`,
  `ciclos-basis.json`, `historico-basis.jsonl`, `captura.json`. Supervisionado.
- `src/cli/custodia.ts` (+ `funding/custodia.ts`) — saúde das exchanges,
  escreve `vigilancia/custodia.json`. Supervisionado.
- `src/cli/coletor.ts` (+ `src/funding/coleta.ts`, `src/ml/prontidao-vigilancia.ts`) —
  lê `historico.jsonl`/`ciclos.json`/`custodia.json` (escritos pelos dois acima)
  e arquiva permanentemente em `arquivo-observacoes.jsonl`/`arquivo-ciclos.jsonl`/
  `arquivo-custodia.jsonl` — nunca consulta exchange, só lê arquivo local.
  É este arquivo que o `snowball-2ex` lê. Continua rodando.
- `funding/liquidacao.ts` — usado por `ponte-captura.ts` acima (restaurado
  junto, mesma cadeia).

## Lacuna honesta deixada por este arquivamento

`dashboard-v2/api/tests/readonly.test.ts` (movido para
`dashboard-v2-api/tests/`) provava, instrumentando `node:fs`, que os serviços
do Champion/Lab nunca escreviam fora de `api/logs/`. Essa prova não tem mais
alvo (os serviços arquivados não rodam). **Não existe hoje um teste
equivalente pros endpoints atuais** (`/api/v2/competidores`,
`/api/v2/spotperp`, `/api/v2/profit-maximization`, `/api/v2/health`) — seria
um teste novo, não uma migração, então não foi criado neste arquivamento.

## Como reativar (se um dia fizer sentido)

1. `git mv` de volta cada arquivo de `arquivo-6-exchanges/src/` pro caminho
   original em `src/` (o histórico do git preserva a origem). Note que
   `vigilancia.ts`/`custodia.ts` e seus módulos JÁ estão em `src/` — não
   precisam ser trazidos de volta, só `spread-live.ts` + o resto do Champion.
2. Devolver a entrada `motor` em `scripts/supervisor.sh` (CMD e LOG) e
   `scripts/process-manifest.json` (`vigilancia`/`custodia` já estão lá).
3. Devolver as 7 páginas em `dashboard-v2/src/app/router.tsx` e
   `Sidebar.tsx`, e as rotas/serviços correspondentes em
   `dashboard-v2/api/server.ts` (hoje stubadas como `{arquivado:true}`).
4. Mover `arquivo-6-exchanges/estado/spread` de volta pra `spread/` (o resto
   do estado de vigilância/custódia já foi restaurado).
5. Rodar `npm test` antes de religar qualquer processo.
