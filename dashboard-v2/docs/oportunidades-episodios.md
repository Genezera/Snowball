# Oportunidades — o episódio e o gap de 30 minutos

Item 5 do fechamento das cinco páginas centrais. Regras do serviço
read-only `api/services/oportunidades.ts`, que **só lê e agrega** a fonte
persistente escrita pelo motor (`inteligencia/oportunidades/YYYY-MM-DD.jsonl`,
via `registrarCiclo`).

## Duas identidades distintas

| campo | significado | estabilidade |
|---|---|---|
| `opportunityKey` | `symbol\|exchangeLong\|exchangeShort` — a combinação de mercado, **eterna** | nunca muda |
| `episodeId` | `${opportunityKey}#${episodeStartedAt}` — **uma aparição contínua** | muda a cada nova aparição após um gap |

## Gap máximo: 30 minutos

```
GAP_EPISODIO_MS = 30 * 60_000   // 30 min
```

Se a mesma `opportunityKey` fica **sem nenhuma observação por mais de 30
minutos**, o episódio corrente é encerrado; a próxima observação inicia um
**novo** episódio (novo `episodeStartedAt` → novo `episodeId`), preservando
a mesma `opportunityKey`.

### Por que 30 minutos

A cadência de escrita de ciclos de **oportunidade** é mais lenta e irregular
que a de eventos do champion: o motor só grava um ciclo quando **reavalia o
conjunto** de candidatas. 30 min é folgado o suficiente para que uma lacuna
normal de cadência **não** fatie falsamente um episódio, mas curto o
suficiente para que um sumiço-e-retorno genuíno (a oportunidade saiu do
ranking e voltou depois) seja corretamente contado como aparição nova.

### É configurável?

**Não em runtime.** É uma constante de módulo (`GAP_EPISODIO_MS`), alterável
apenas editando o código-fonte. Não há env var nem parâmetro de query hoje —
documentado assim por honestidade, não se finge configurabilidade que não
existe.

## `settlementAt`

**Não instrumentado.** A fonte (`registrarCiclo`) não grava o horário de
settlement, então o campo sai como `{ valor: null, tracked: false }` —
nunca zero. É um placeholder para quando o motor passar a registrar o
instante de liquidação; enquanto não registrar, a tela o marca como não
instrumentado.

## Ciclo de vida de uma oportunidade

- **Aparece**: primeira observação da chave na janela define `firstSeenAt`
  e inicia o primeiro episódio (`episodeStartedAt = firstSeenAt`).
- **Persiste**: observações sucessivas com gap ≤ 30 min incrementam
  `observationCount` (total da chave) e `persistenceCycles` (só do episódio
  atual); `lastSeenAt` avança.
- **Desaparece**: sem observação por > 30 min, `active` vira `false`,
  `episodeEndedAt = lastSeenAt`. A chave continua listada (histórico), mas o
  episódio está encerrado.
- **Reaparece**: uma nova observação após o gap inicia um episódio novo —
  mesma `opportunityKey`, novo `episodeId`, `persistenceCycles` reinicia em
  1, `observationCount` continua acumulando o total da chave.

## Como os arquivos diários são atravessados

`lerCiclosRecentes` lê **dois** arquivos — o de **ontem** e o de **hoje**
(`arquivoDoDia(ontem)` + `arquivoDoDia(agora)`, nomes `YYYY-MM-DD.jsonl` em
UTC), concatena as linhas e ordena por `ts`. A fronteira de arquivo **não**
é fronteira de episódio: um episódio que atravessa a meia-noite continua
sendo **um** episódio, porque o corte é feito por diferença de `ts` (o gap),
não por qual arquivo a linha veio. Um episódio só quebra na meia-noite se o
próprio gap ali passar de 30 min.

## `episodeId` é estável após restart da API?

**Sim.** `episodeId = ${opportunityKey}#${episodeStartedAt}` é 100% derivado
do dado persistido — reiniciar a API relê os mesmos arquivos e recomputa o
mesmo `episodeStartedAt`, logo o mesmo `episodeId`. Não há estado em memória.

Ressalva honesta: `episodeStartedAt` do episódio atual permanece fixo
enquanto o episódio não quebrar; se a janela de leitura (ontem+hoje, até
`maxCiclos`) eventualmente deslizar e descartar as observações mais antigas
do episódio, o `episodeStartedAt` recomputado passa a ser a observação mais
antiga ainda visível. Isso é uma consequência da retenção da janela, não de
instabilidade do identificador.

## Testes

`api/tests/oportunidades.test.ts` cobre: agregação/dedup por chave;
episódios (some+reaparece após gap → novo episódio; inativo com
`episodeEndedAt`); **cruzamento de meia-noite/troca de arquivo diário**
(gap < 30 min mantém um episódio costurando os dois arquivos; gap > 30 min
inicia episódio novo depois da meia-noite); e `episodeId` idêntico após
"restart da API" mesmo atravessando arquivo diário.
