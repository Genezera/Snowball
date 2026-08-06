# Snowball SVG Icon Set

Kit com **32 ícones SVG originais** criado para a identidade visual do projeto Snowball.

## Conteúdo

- `icons/light/`: versão para superfícies claras, em azul-marinho e ciano.
- `icons/dark/`: versão para superfícies escuras, em branco glacial e ciano.
- `snowball-icons-sprite.svg`: sprite com símbolos `sb-*`.
- `snowball-icons.css`: tamanhos, temas e animação leve para estado ao vivo.
- `preview.html`: galeria interativa em temas claro e escuro.
- `preview-grid.svg`: folha visual com toda a coleção.

## Uso de arquivo individual

```html
<img src="icons/dark/risk.svg" width="24" height="24" alt="Risco">
```

## Uso do sprite

Insira o conteúdo de `snowball-icons-sprite.svg` uma vez no HTML e depois utilize:

```html
<svg class="sb-icon sb-icon-theme-dark" aria-label="Funding">
  <use href="#sb-funding"></use>
</svg>
```

Para trocar o tema por CSS:

```css
.meu-icone {
  --sb-primary: #eafbff;
  --sb-soft: #102e55;
  --sb-accent: #18d8ff;
  width: 28px;
  height: 28px;
}
```

## Ícones

- `dashboard` — Visão geral
- `capital` — Capital
- `opportunities` — Oportunidades
- `positions` — Posições
- `funding` — Funding
- `pnl` — PnL
- `costs` — Custos
- `exchanges` — Exchanges
- `exchange-health` — Saúde da exchange
- `risk` — Risco
- `liquidation` — Liquidação
- `neutrality` — Neutralidade
- `vigilance` — Vigilância
- `engine` — Motor
- `custody` — Custódia
- `collector` — Coletor
- `watchdog` — Watchdog
- `processes` — Processos
- `logs` — Logs
- `history` — Histórico
- `research` — Pesquisa
- `ml` — Machine learning
- `basis` — Basis trade
- `settings` — Configurações
- `success` — Aprovado
- `blocked` — Bloqueado
- `warning` — Atenção
- `offline` — Offline
- `stale` — Desatualizado
- `live` — Ao vivo
- `paper` — Paper trading
- `alert` — Alerta

## Recomendações

- Use 20–24 px em menus e tabelas.
- Use 28–36 px em cards e estados.
- Reserve 48–80 px para estados vazios e diagramas.
- Não use brilho SVG pesado em listas extensas.
- Para status críticos, combine o ícone com texto; não dependa apenas da cor.
- Mantenha os ícones de produção, paper trading e pesquisa visualmente identificados.

Os SVGs são independentes de bibliotecas e adequados ao dashboard em HTML, CSS, SVG e JavaScript puro.
