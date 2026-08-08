# Auditoria do replay + payback (itens 1,2)

## Payback de 5 min — auditado (item 2)

A mediana de ~5 min até o payback **é dominada por aberturas perto do settlement**:
- **85%** das posições recebem o 1º funding em <10 min após abrir.
- Modo normal: 1º funding em ~5.1 min (faixa apertada 5.1–6.3 min).
- Capturas: ~10 min; `faltamMin` na abertura = 8.7–11.8 min (abertas ~9–12 min
  antes do settlement).

**Conclusão:** o funding rápido NÃO é mágica — o motor **abre logo antes de um
settlement** (por design: captura um funding barato e fecha). Logo "segurar mais"
significa esperar o **próximo** settlement (+1h ou +8h), um compromisso bem maior,
com custo de oportunidade e risco. O sinal de "43% de fechamentos precoces" da
fase 2 fica **temperado**: funding posterior positivo (bruto) NÃO basta para
classificar como precoce — é preciso EV **líquido** (funding esperado − custo de
saída − slippage − risco − custo de oportunidade), como manda o item 1.

## Contrafactual enriquecido (item 1)

O replay de fechamento (`auditoria/shadow/close-replay.json`) estima funding
adicional do `apr` do historico. Para a decisão de precocidade, o simulador de
challengers (`challenger-metrics.json`) inclui: funding adicional estimado,
custo de saída (pago uma vez, independente de quando fecha — segurar NÃO adiciona
custo de saída, só o adia), custo de oportunidade (capital-horas × taxa de
referência do Champion) e a distância de liquidação. Slippage/mark por perna e
PnL residual por perna são parcialmente instrumentados (marcacao só tem o estado
atual, não histórico por ciclo) — lacunas marcadas, não fabricadas.
