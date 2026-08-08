# Fase econômica shadow — Fase 2 (snapshot 1786189433850)

Continuação de `snowball-fase-shadow-1786189433850`. **Read-only/shadow.** Nada
altera Champion, risco, capital, alavancagem, execução ou limites; nada fecha,
abre, promove ou envia ordem. Scripts em `scripts/auditoria/`, artefatos em
`auditoria/shadow/`.

## 1. Gate corrigido (item 1) — `auditoria/shadow/gate-v2.json`

Substituí "≥2 config epochs" por critérios que **não exigem mudar configuração**:

| critério | valor | mínimo | atende |
|---|---|---|---|
| episódios completos (limpos de ambiguidade) | **18** | 50 | ❌ |
| janelas cronológicas independentes (metades do epoch-1) | 4 / 25 | 2 | ✅ |
| regimes de mercado detectáveis (apr médio, buckets 6h, split mediana) | **2** (funding-alto 11 / funding-baixo 11) | 2 | ✅ |
| mesma config na comparação principal (epoch-1) | sim | — | ✅ |

**Veredito: BLOQUEADO** — só por amostra (18/50). Regimes e janelas **já
existem** dentro da mesma config. **Não se provoca mudança de config** para abrir
o gate; acumula-se mais aberturas. (18 < 29 da fase 1 porque agora exijo join
limpo — ver item 2.)

## 2. Auditoria de joins episódio↔posição (item 2) — `auditoria/shadow/join-audit.jsonl`

18 joins, **0 ambíguos** (nMatches=1 em todos), matchReason = "symbol + abertura
em [firstSeen−30min, lastSeen+6h]", distância temporal e confiança registradas.
Nenhum match ambíguo a excluir — o join é limpo. Só os com confiança
alta/média e distância ≤6h entram no treino.

## 3. Switch Value in-cycle (item 3) — `auditoria/shadow/switch-value-incycle.jsonl`

**Agora instrumentado** (antes era gap). Usa `marcacao.json` (posições abertas,
`custoEstimadoFechamento`, notional liberável) + `valorPorHora` do último ciclo:

`switchValue = EV(candidata)·H − EV(manter fraca)·H − custoFechar − custoAbrir`, H=6.8h.

Resultado no snapshot: 29 candidatas bloqueadas por saldo, posição mais fraca
**LA/USDT**, **0 trocas positivas** — o custo de fechar+abrir supera o ganho de
EV. **Nunca executa.** Conclusão honesta: **neste instante não há troca que
compense** — o observer é o mecanismo certo para pegar os momentos em que
compensaria (rodando dentro do ciclo, aditivo).

## 4. Replay de fechamento (item 4) — `auditoria/shadow/close-replay.json`

Contrafactual de **manter** além do fechamento real, funding estimado do `apr`
no `historico` (não realizado — a posição foi fechada). Janelas +1/+2/+3 ciclos,
+1h, +8h. **6 de 14 fechamentos** tinham contrafactual +8h positivo (>US$ 0.05)
→ ~**43% dos fechamentos podem ter sido precoces**, deixando funding na mesa.
Estimativa (não PnL realizado), mas um sinal forte de que a **regra de
fechamento é o alvo**, não a seleção.

## 5. Capture Survival Shadow (item 5) — `auditoria/shadow/capture-survival-shadow.json`

6 capturas reais, 2 inversões. Regras determinísticas (cobertura≥1.25/1.50,
perto do settlement, escorregamento baixo) testadas: **nenhuma separou
limpamente as 2 inversões das 4 boas** — as inversões também tinham
cobertura≥1.25. Amostra pequena demais para uma regra de sobrevivência de
captura; precisa acumular. **Não altera o Champion.**

## 6. Curvas de sobrevivência (item 6) — `auditoria/shadow/survival-curves.json`

KM com censura (posições abertas censuradas no snapshot). Medianas:

| evento | mediana | leitura |
|---|---|---|
| tempo até 1º settlement | **~0.09h (~5 min)** | funding chega rápido após abrir |
| tempo até payback | **~0.09h (~5.5 min)** | o custo é pago quase imediatamente |
| tempo até inversão | **null (>50% NÃO invertem)** | inversão é minoria (bom) |
| tempo até fechamento | **~6.8h** | posição segurada ~7h |

**Achado:** a posição paga o próprio custo em ~5 min via o primeiro funding, mas
é fechada em ~6.8h. Combinado com o item 4 (43% de fechamentos precoces), reforça
que **o timing de fechamento é onde há edge a capturar** — não a seleção.

## 7. Ranking cross-sectional contínuo (item 7) — `auditoria/shadow/cross-sectional-continuo.jsonl`

Por ciclo: escolha real vs top-1 shadow determinístico (valorPorHora×folga×
persistência) + top-3. Em **11/11 ciclos com escolha, o top-1 shadow coincidiu
com a escolha real (100%)**. → **O motor já escolhe o candidato de maior score.**
Um modelo de ranking **não** deve adicionar valor na seleção. (Não promover nada
com base nisto — é justamente evidência de que a seleção NÃO é o gargalo.)

## 8. PnL contrafactual (síntese)

- Seleção: já ótima na métrica de score (100% coincidência) → ganho contrafactual
  de um ranking model ≈ 0.
- Fechamento: ~43% dos fechamentos com contrafactual +8h positivo → **aqui está
  o PnL não capturado** (estimado, a confirmar com mais dados).
- Troca de capital: 0 trocas positivas neste snapshot → não é a alavanca imediata.

## 9. Recomendação de primeiro challenger

**Um challenger DETERMINÍSTICO de timing de fechamento**, em paper isolado
(capital virtual próprio, sem tocar o Champion):

- **Hipótese:** a regra atual fecha cedo demais (~43% dos fechamentos deixaram
  funding). Half-life/settlement sugerem segurar até o próximo settlement salvo
  inversão de spread confirmada.
- **Por quê primeiro:** (a) o gargalo NÃO é seleção (100% coincidência), é
  fechamento; (b) é **determinístico** (permitido sem o gate de ML); (c)
  testável em paper isolado, com contrafactual já medido; (d) risco baixo, 100%
  virtual, nunca toca o Champion.
- **Critério de aprovação:** PnL líquido do challenger > Champion na MESMA janela/
  regime, por ≥2 janelas, com custos reais + 2× estressados, sem aumentar
  drawdown nem distância de liquidação.
- **Critério de abandono:** não bate o Champion, ou aumenta inversões/drawdown.
- **Rollback:** é paper isolado — desligar o challenger, nada a reverter no Champion.

**Não** recomendo challenger de seleção/ranking (seleção já ótima) nem de troca
de capital (0 positivos agora) como primeiro.

## 10. Integridade (item 12)

`git diff` não altera `src/cli/*`, `src/inteligencia`, `src/funding`, `src/risk`
nem estado dos motores. **Champion intacto.** Tudo leitura/observação/shadow.
