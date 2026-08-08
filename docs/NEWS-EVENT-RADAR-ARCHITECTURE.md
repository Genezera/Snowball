# Radar de Notícias/Eventos — Arquitetura (Parte 9)

**Fase:** plataforma de progressão. Este documento descreve **só arquitetura +
coleta read-only**. Nada aqui envia ordem, define sizing, promove estratégia ou
entra na tomada de decisão. É um observador append-only.

**Estado de maturidade honesto:** `hypothetical` / `shadow`. O radar **ainda não
existe em execução**; este é o desenho e o contrato de dados. Quando coletar,
produzirá apenas eventos `observed` (o que uma fonte oficial publicou) — nunca
`predicted` como verdade.

---

## 1. Objetivo

Construir um **radar que OBSERVA eventos** relevantes ao universo de perpétuos
cripto onde o laboratório opera em PAPER, e os registra de forma verificável,
deduplicada e rastreável. O radar responde a uma pergunta estreita:

> "O que foi **publicado oficialmente** que pode ter tocado um ativo que
> observamos, quando, e com que confiabilidade de fonte?"

O radar **não** responde "o que vai acontecer com o preço", "o que devemos
fazer" ou "quanto alocar". Ele é uma camada de **percepção**, não de decisão.

### Tipos de evento observados

Enum canônico (espelhado no schema `auditoria/events/event-schema.json`):

| `eventType` | Descrição | Fonte típica |
|---|---|---|
| `new_listing` | Nova listagem de ativo/par | anúncio oficial da exchange |
| `delisting` | Deslistagem / remoção de par | anúncio oficial da exchange |
| `token_unlock` | Liberação de tokens (cliff/vesting) | página oficial do projeto / cronograma verificável |
| `hack_exploit` | Hack, exploit, drain de contrato | comunicado oficial do projeto / post-mortem |
| `chain_halt` | Interrupção/parada de blockchain | status oficial da rede |
| `partnership` | Parceria oficial anunciada | comunicado oficial (blog/press) |
| `protocol_upgrade` | Upgrade de protocolo / hard fork | anúncio oficial do projeto |
| `governance` | Proposta/decisão de governança | fórum/portal oficial de governança |
| `funding_change` | Alteração de regra/parâmetro de funding | anúncio oficial da exchange |
| `exchange_issue` | Problema em exchange (retirada suspensa, degradação) | status/anúncio oficial da exchange |
| `regulation` | Ação/comunicado regulatório | comunicado do órgão oficial |
| `macro_event` | Evento macro (CPI, FOMC, etc.) | calendário/fonte oficial verificável |
| `abnormal_volume` | Volume anormal detectado | métrica interna sobre dado de mercado observado |
| `other` | Não classificável nos anteriores | — |

`abnormal_volume` é o único tipo derivado de **medição interna** e não de um
anúncio; mesmo assim é tratado como `observed` (um fato sobre dado de mercado que
já temos), nunca como sinal de ação.

---

## 2. O que a LLM PODE e NÃO PODE

A LLM entra **só como camada de linguagem** sobre conteúdo já coletado. Ela nunca
toca coleta, storage ou decisão.

### PODE (transformações sobre texto já observado)

- **Resumir** o comunicado oficial em `summary` (curto, factual, sem opinião).
- **Classificar** o `eventType` a partir do conteúdo (sugestão; a fonte manda).
- **Agrupar duplicatas** — propor `duplicateGroup` quando várias fontes cobrem o
  mesmo fato (ver §4).
- **Relacionar ativos** — preencher `affectedAssets` a partir do texto (ex.:
  "unlock de ARB" → `["ARB"]`).
- **Explicar contexto** — nota neutra de background ("token unlock = liberação
  programada de oferta"), sem afirmar efeito de preço.

### NÃO PODE (fronteiras absolutas)

- **Prever preço como verdade.** Nenhum campo do evento afirma direção futura.
  `priceAfter`/`volumeAfter` são **observações posteriores**, não previsões.
- **Enviar ordem.** O radar não tem caminho para execução. Ponto.
- **Definir sizing / alocação.** Nenhuma saída do radar dimensiona posição.
- **Promover estratégia.** Não recomenda entrar, sair, montar ou desmontar nada.

Regra de ouro: **a LLM anota o que a fonte disse; não decide o que fazer.** Toda
saída de LLM carrega proveniência de que foi gerada por modelo (`reliability`
não sobe por confiança da LLM — sobe pela fonte).

---

## 3. Pipeline de coleta (read-only, append-only)

```
  fetch  →  normalize  →  hash (rawContentHash)  →  dedup (duplicateGroup)
                                                          │
                                                          ▼
                                     provenance  →  append-only storage
```

### 3.1 fetch (read-only)

- Somente **GET** a fontes verificáveis: anúncios oficiais das exchanges, páginas
  oficiais dos projetos, comunicados oficiais, APIs/feeds públicos.
- Sem autenticação privilegiada, sem credenciais, sem escrita remota.
- Cada fetch registra `sourceUrl`, `sourceType` e `observedAt` (quando nós vimos)
  além do `publishedAt` declarado pela fonte.
- Falha de fetch é registrada como falha — **nunca** inventa conteúdo.

### 3.2 normalize

- Extrai texto/campos brutos; remove ruído de template (nav, footer) de forma
  determinística para o hash ser estável.
- Não reescreve o conteúdo factual; normalização é só de forma.

### 3.3 hash — `rawContentHash`

- SHA-256 do **conteúdo bruto normalizado** (não da URL).
- É a **chave de idempotência**: reprocessar a mesma publicação produz o mesmo
  hash e **não** gera evento novo.
- Muda no conteúdo → hash novo → novo registro (histórico preservado, nada é
  sobrescrito).

### 3.4 dedup — `duplicateGroup` (ver §4)

### 3.5 provenance (ver §5)

### 3.6 append-only storage

- Um arquivo JSONL por dia em `auditoria/events/` (ex.:
  `auditoria/events/2026-08-08.jsonl`), **um evento por linha**.
- **Somente append.** Nunca update in-place, nunca delete. Correção = novo
  registro que referencia o `eventId` anterior (mesma disciplina do resto de
  `auditoria/`).
- Cada linha valida contra `auditoria/events/event-schema.json` (draft-07).

---

## 4. Deduplicação — `duplicateGroup`

Duas camadas complementares:

1. **Idempotência exata (`rawContentHash`).** Mesmo conteúdo bruto → mesmo hash →
   não duplica. Resolve reprocessamento e re-fetch.

2. **Agrupamento semântico (`duplicateGroup`).** Fontes diferentes (`sourceUrl`
   distintas, `rawContentHash` distintos) descrevendo **o mesmo fato do mundo**
   recebem o mesmo `duplicateGroup` — um identificador de cluster estável.
   - Exemplo: a exchange anuncia deslistagem no blog **e** no status page. Dois
     eventos, dois hashes, **um** `duplicateGroup`.
   - O agrupamento pode ser proposto pela LLM (§2) e é **reversível**: mudar o
     grupo é um novo registro, o original permanece.
   - `duplicateGroup` **não** apaga membros — todos os eventos-fonte continuam no
     storage; o grupo só declara "estes falam do mesmo fato".

Assim contamos **fatos**, não **manchetes**: N publicações do mesmo evento = 1
`duplicateGroup` com N membros observados.

---

## 5. Provenance

Todo evento é **rastreável à fonte**. Campos que compõem a proveniência:

| Campo | Papel na proveniência |
|---|---|
| `sourceUrl` | URL exata de onde o conteúdo veio |
| `sourceType` | natureza da fonte (`exchange_official`, `project_official`, `press_official`, `api_feed`, `internal_metric`) |
| `publishedAt` | quando a **fonte** diz que publicou |
| `observedAt` | quando **nós** coletamos (pode diferir muito de `publishedAt`) |
| `rawContentHash` | prova de integridade do conteúdo coletado |
| `reliability` | confiabilidade da fonte (`official` > `verified_feed` > `secondary` > `unverified`) |

Regra: `reliability` reflete **a fonte**, não a confiança da LLM. Um resumo bem
escrito de um tweet anônimo continua `unverified`. Sem `sourceUrl` verificável,
o evento não é promovido acima de `unverified`.

---

## 6. Integração FUTURA (NÃO agora) — Engine Registry / Capital Router

Deixado explícito para evitar ambiguidade: **nesta fase o radar não se conecta a
nada de decisão.**

- O radar **não** notifica, alimenta, pontua nem prioriza o Engine Registry ou o
  Capital Router. Não há caminho de dados do radar para execução, sizing ou
  seleção de engine.
- Uma integração futura seria, **no máximo**, uma camada de **contexto/anotação**
  read-only: por exemplo, marcar num relatório que "no dia X houve um
  `token_unlock` em ARB", como metadado histórico ao lado de resultados já
  medidos. Sempre `shadow`, sempre append-only, sempre reversível.
- Qualquer uso do radar em decisão exigiria: (a) proposta explícita e revisada,
  (b) validação de que a fonte é `official`/`verified_feed`, (c) porta de risco
  separada. **Nada disso está em escopo agora.**

**Declaração final:** nesta fase, nenhum evento do radar entra na tomada de
decisão. O radar observa, registra e explica — e para por aí.

---

## 7. Nomenclatura de estados (disciplina do projeto)

Cada saída do radar carrega seu estado epistêmico:

- `observed` — fato publicado por fonte, coletado read-only. **É o único que o
  radar produz nesta fase.**
- `replayed` — reprocessamento de conteúdo já coletado (mesmo `rawContentHash`).
- `simulated` / `shadow` / `hypothetical` — reservados para camadas futuras que
  **não existem** aqui.
- `live-paper` / `real` — **não se aplicam ao radar**; ele nunca opera capital.
