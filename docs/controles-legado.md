# Controles de escrita do legado — auditoria e arquitetura segura

O Snowball Dashboard (V2) é **read-only por design**. O dashboard legado tinha
**um** ponto de escrita: `POST /api/profit-lab/controle` (src/dashboard/server.ts).
Nada mais no legado escreve estado.

Princípio (pedido explícito da unificação): **não transportar controles de
escrita para a API V2 só para obter paridade visual.** Um controle só é migrado
com uma arquitetura segura documentada; até lá, fica acessível apenas pelo
rollback de emergência do legado.

## Auditoria dos controles

Todos operam sobre **challengers do Paper Profit Lab** — experimentos em capital
**100% virtual (paper)**. Nenhum toca capital real, o motor delta-neutro, as
posições do champion, nem qualquer estratégia em produção.

| Controle | Efeito | Ainda necessário? | Seguro? | Equivalente read-only no V2 | Ação futura |
|---|---|---|---|---|---|
| `pausar` | pausa um challenger (experimento paper) | opcional (gestão de experimentos) | escrita em estado de experimento paper; não afeta trading real | visão completa em Challenger Arena / Strategy Universe | endpoint dedicado com confirmação + auditoria, se pedido |
| `retomar` | retoma um challenger pausado | opcional | idem | idem | idem |
| `observacao` | anexa nota de texto a um challenger | opcional | escrita de texto; risco baixo | notas visíveis no V2 | idem |
| `status-experimento` | marca status do experimento (ex.: promovido/descartado) | opcional | escrita de rótulo; não move capital | status visível no V2 | idem |
| `duplicar` | duplica um challenger como nova versão | opcional | cria novo experimento paper | histórico de versões visível no V2 | idem |

## Por que não foi migrado agora

- **Nenhum é necessário para operar.** O motor e o champion rodam de forma
  autônoma; esses controles gerenciam **experimentos paper**, não o trading.
- **V2 é read-only por contrato.** Adicionar escrita à API V2 só para paridade
  visual violaria o isolamento que o gate anterior estabeleceu (a API V2 nunca
  escreve estado do Snowball — ver docstring de `dashboard-v2/api/server.ts` e
  `api/tests/readonly.test.ts`).
- **Não se perde a função.** Continua acessível via rollback do legado
  (`docs/dashboard-legacy-rollback.md`) em emergência.

## Arquitetura segura proposta (se/quando for necessário migrar)

Não implementada nesta etapa — registrada como proposta:

1. **Serviço de escrita separado** da API de leitura (processo/porta distintos),
   nunca dentro de `dashboard-v2/api/server.ts` (que permanece read-only).
2. **Autenticação** por token local + **confirmação explícita** por ação
   (nada de POST direto sem duplo-passo).
3. **Escopo restrito a paper**: o serviço só aceita ações sobre challengers do
   Paper Profit Lab; qualquer ação que tocasse capital real, motor ou estratégia
   de produção é **fora de escopo** e permanece proibida.
4. **Trilha de auditoria** append-only (quem/quando/o quê), como o legado já faz.
5. **Read-model inalterado**: o frontend continua lendo pelo caminho read-only;
   a escrita é um canal à parte, opt-in.

Enquanto essa arquitetura não for pedida e implementada, o padrão é: **sem
escrita no produto normal**; controles via rollback de emergência apenas.
