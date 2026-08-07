# Bug upstream — `sequenceNumber` reinicia após restart do orquestrador

**Status:** aberto, não corrigido nesta etapa (fora do escopo do Dashboard 2.0
Quality Gate — nenhuma alteração foi feita em motor, estratégia ou lógica
econômica). Mitigado defensivamente na API V2 (ver seção "Mitigação atual").

**Achado em:** Fechamento do Quality Gate de Interface (Dashboard 2.0), a
partir de um teste de "eventos com mesmo timestamp nunca colapsam" que
revelou o inverso — dois `eventId` iguais na mesma leitura.

## Descrição

`inteligencia/virtual-portfolio.ts` mantém um contador `sequenceNumber` por
challenger, incrementado a cada evento registrado no diário
(`diario.jsonl`). Esse contador vive em memória do processo orquestrador —
ele não é persistido nem recuperado a partir do próprio diário no restart.
Quando o orquestrador reinicia (crash, deploy, restart manual), o contador
volta a `1`, mas o arquivo `diario.jsonl` do challenger **continua sendo
usado por append** — não é truncado nem recriado. O resultado: o mesmo
`diario.jsonl` passa a ter duas linhas com `sequenceNumber: 1` (e `2`, `3`,
...), cada uma pertencente a um `cycleId` diferente.

## Evidência real (produção, lida diretamente do disco)

Varredura em `inteligencia/challengers/*/diario.jsonl` (51 challengers)
encontrou **4 challengers afetados**, todos com o mesmo padrão de dois
`cycleId` consecutivos:

| challenger | sequenceNumber duplicado | cycleId (1ª ocorrência) | cycleId (2ª ocorrência) | eventId (idêntico nas duas linhas) |
|---|---|---|---|---|
| `challenger-batch-alta-retencao` | 1, 2, 3 | `orch-1786099074873` | `orch-1786099902867` | `challenger-batch-alta-retencao-1`, `-2`, `-3` |
| `challenger-batch-baixa-retencao` | 1, 2, 3 | `orch-1786099074873` | `orch-1786099902867` | `challenger-batch-baixa-retencao-1`, `-2`, `-3` |
| `challenger-batch-media-retencao` | 1, 2, 3 | `orch-1786099074873` | `orch-1786099902867` | `challenger-batch-media-retencao-1`, `-2`, `-3` |
| `challenger-concentration-aware-ranking` | 1, 2, 3 | `orch-1786099074873` | `orch-1786099902867` | `challenger-concentration-aware-ranking-1`, `-2`, `-3` |

O `eventId` é derivado de `${challengerId}-${sequenceNumber}` — como o
contador reinicia, o `eventId` também colide, não só o `sequenceNumber`.
Os quatro challengers reiniciaram juntos no mesmo instante (mesmo par de
`cycleId`), consistente com um único restart do processo orquestrador que
os afetou simultaneamente.

## Impacto

- **Sobre o cursor incremental (API V2):** o cursor por fonte usava
  `sequenceNumber` como posição persistida para challengers "modernos". Um
  cursor já avançado até `sequenceNumber: 900` via essa lógica descartava
  silenciosamente os eventos novos `1`, `2`, `3` pós-restart
  (`1 <= 900`) — **perda de evento real**, não apenas duplicação. Corrigido
  na API V2 nesta etapa (ver "Mitigação atual").
- **Sobre o `eventId`:** duas linhas do diário com `eventId` idêntico e
  `cycleId` diferente representam dois eventos **economicamente distintos**
  (ciclos de decisão diferentes) que só compartilham um identificador por
  acidente do contador reiniciado. Tratar isso como duplicata e descartar
  um dos dois seria perda de dado real disfarçada de deduplicação.
- **Sobre auditoria:** sem correção, é impossível diferenciar — só olhando
  o `eventId` — dois eventos que aconteceram em ciclos de vida completamente
  diferentes do challenger.

## Mitigação atual na API V2 (`dashboard-v2/api/services/eventos.ts`)

Duas mudanças, ambas só na camada de LEITURA (a API V2 nunca escreve nos
diários — ver isolamento read-only comprovado no Gate anterior):

1. **Cursor não usa mais `sequenceNumber` como posição.** A posição
   persistida agora é sempre o `byteOffset` da linha dentro do arquivo —
   monotônico dentro de uma geração de arquivo, independente de qualquer
   reinício do orquestrador. Rotação de arquivo (truncamento/recriação)
   continua detectada à parte via `fileIdentity` + `generation`.
   `sequenceNumber` e `cycleId` continuam existindo, mas só como
   **metadados do evento** (auditoria, decisão de colisão de `eventId`),
   nunca como posição do cursor.
2. **Colisão de `eventId` não apaga o evento.** Quando duas linhas na mesma
   leitura produzem o mesmo `eventId`, a segunda ocorrência recebe um
   `eventId` sintético estável (`fonte:g<generation>:b<byteOffset>` — único
   por construção, já que `byteOffset` nunca se repete dentro de uma
   geração) e o `eventId` original da fonte é preservado no campo
   `eventIdOriginal`, exposto no contrato da API para auditoria.

Testes de regressão cobrindo os dois pontos:
`dashboard-v2/api/tests/eventos.test.ts` (ver os testes prefixados com
`CRÍTICO:` e `duplicata:`).

## Correção definitiva recomendada (para o Lab, fora deste escopo)

`sequenceNumber` precisa sobreviver a um restart do orquestrador. Duas
abordagens possíveis, a decidir pelo time responsável por
`virtual-portfolio.ts`:

1. **Persistir o contador** (ex.: um pequeno arquivo de estado por
   challenger, ou recuperá-lo lendo a última linha do próprio
   `diario.jsonl` no boot, `max(sequenceNumber) + 1`).
2. **Trocar a semântica do `sequenceNumber`** de "contador por challenger"
   para algo que já incorpore a identidade do ciclo/processo (ex.:
   `cycleId` + contador local ao ciclo, nunca reaproveitado entre
   reinícios), deixando de existir a noção de um contador global que possa
   colidir.

Qualquer que seja a escolha, o `eventId` gerado a partir daí deveria ser
único por construção (não depender de `sequenceNumber` sozinho) — hoje ele
é `${challengerId}-${sequenceNumber}`, que herda o mesmo problema.
