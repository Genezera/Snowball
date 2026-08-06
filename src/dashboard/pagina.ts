/**
 * Dashboard — oitava geração: centro de operações quantitativas.
 *
 * Pedido explícito do usuário: reestruturar a experiência inteira (não só
 * ajustar cores) em torno da identidade visual da logo — sidebar em vez de
 * abas no topo, seções novas (Oportunidades, Risco, Pesquisa, Histórico,
 * Logs), visual glacial/técnico. Mesmo contrato de dados de sempre
 * (retrato() via /api/stream e /api/dados, /api/candles, /api/logs — novo)
 * — nada na forma como os processos escrevem estado mudou, só como esta
 * página lê e mostra.
 *
 * O que NÃO mudou nesta reescrita, de propósito — lógica já testada em
 * produção, só resposicionada em outro lugar da tela:
 *   · desenharCurva / desenharCandles / desenharPonte (SVG dos gráficos)
 *   · garantirGrafico / observarCandle (candle sob demanda, lazy-load)
 *   · computeFluxo / agregarPorExchange (a ponte "de onde veio o dinheiro")
 *   · renderIfChanged / animateNumber (anti-flicker)
 *   · a conexão SSE com fallback pra polling
 *
 * Regras que já quebraram este arquivo antes, continuam valendo:
 *
 * 1. NENHUMA CRASE fora da abertura/fechamento do template literal — nem
 *    dentro de comentário do <script>. Uma crase solta fecha a string e
 *    derruba o servidor com erro de sintaxe apontando pro lugar errado.
 * 2. Por causa da regra 1, o JavaScript do cliente NUNCA usa template
 *    literals — só concatenação com "+" e Array.join('').
 * 3. render(d) roda a cada evento do SSE — cada seção só toca o DOM quando
 *    o dado dela mudou de verdade (renderIfChanged), senão pisca.
 * 4. Nenhuma lista de posições ganha gráfico de candle individual SEM
 *    carregamento sob demanda — foi isso que deixou o modo agressivo (40
 *    posições) lento o bastante pra ser tirado do painel.
 *
 * O que este painel deliberadamente NÃO tenta ser, por falta de dado real
 * pra sustentar (ver o pedido original, item 25 — honestidade visual):
 * paleta de comandos, replay histórico, heatmap de correlação, ferramentas
 * de desenho manual em candle, monitor de drift de ML. Adicionar qualquer
 * um desses exigiria inventar dado ou construir um pipeline novo — nenhum
 * dos dois cabe numa reestruturação que também promete não quebrar o que
 * já funciona.
 */
export const PAGINA = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Snowball · Centro de Operações</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>
/* ============================================================
   TOKENS — paleta glacial da identidade Snowball
   ============================================================ */
:root{
  --bg-main:#050b18; --bg-secondary:#091426;
  --surface:rgba(12,29,51,.72); --surface-strong:rgba(13,35,63,.94);
  --panel:#0c1526; --panel-hi:#101d34;
  --border:rgba(91,211,255,.14); --border-hi:rgba(91,211,255,.30);
  --cyan:#17d9ff; --cyan-glow:rgba(23,217,255,.42);
  --ice:#75e8ff; --blue:#168cff; --navy:#061c40;
  --violet:#8b6cf2; --violet-glow:rgba(139,108,242,.4);
  --white:#f7fbff; --text:#eef4fb; --dim:#8ea3c2; --faint:#516a8c;
  --positive:#36e3a0; --positive-glow:rgba(54,227,160,.4);
  --warning:#ffc857; --warning-glow:rgba(255,200,87,.4);
  --danger:#ff5c7a; --danger-glow:rgba(255,92,122,.4);
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Consolas,monospace;
  --radius:16px; --radius-sm:10px;
  --sidebar-w:230px; --sidebar-w-collapsed:64px;
  --dur:.22s; --ease:cubic-bezier(.2,.7,.2,1);
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:
    radial-gradient(1100px 650px at 12% -8%, rgba(23,217,255,.08), transparent 58%),
    radial-gradient(950px 760px at 100% 4%, rgba(139,108,242,.09), transparent 55%),
    radial-gradient(1px 1px at 20% 30%, rgba(117,232,255,.5), transparent),
    var(--bg-main);
  background-size:auto,auto,26px 26px,auto;
  color:var(--text); font-family:var(--sans); min-height:100vh;
  -webkit-font-smoothing:antialiased;
}
/* grade técnica sutil, fixa no fundo */
body::before{
  content:'';position:fixed;inset:0;z-index:0;pointer-events:none;
  background-image:linear-gradient(rgba(91,211,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(91,211,255,.035) 1px,transparent 1px);
  background-size:38px 38px; mask-image:radial-gradient(1200px 800px at 30% 0%,#000,transparent 75%);
}
::-webkit-scrollbar{width:9px;height:9px}
::-webkit-scrollbar-thumb{background:var(--border-hi);border-radius:99px}
::-webkit-scrollbar-track{background:transparent}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums}
.up{color:var(--positive)} .down{color:var(--danger)} .neu{color:var(--dim)}
a{color:inherit}
button{font-family:inherit;cursor:pointer}
@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}
}
.app.perf-off *{animation:none!important;transition:none!important}

/* ============================================================
   SHELL — sidebar + topbar
   ============================================================ */
.app{display:flex;min-height:100vh;position:relative;z-index:1}
.sidebar{
  width:var(--sidebar-w);flex:none;position:sticky;top:0;height:100vh;overflow-y:auto;
  background:var(--surface-strong);backdrop-filter:blur(20px);border-right:1px solid var(--border);
  display:flex;flex-direction:column;transition:width var(--dur) var(--ease);z-index:40;
}
.app.sb-collapsed .sidebar{width:var(--sidebar-w-collapsed)}
.sb-brand{display:flex;align-items:center;gap:10px;padding:18px 16px;border-bottom:1px solid var(--border)}
.sb-brand img{height:30px;width:auto;flex:none;filter:drop-shadow(0 0 8px var(--cyan-glow))}
.sb-brand .mark{width:30px;height:30px;flex:none;border-radius:9px;display:none;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--cyan),var(--blue));box-shadow:0 0 14px var(--cyan-glow)}
.app.sb-collapsed .sb-brand img{display:none}
.app.sb-collapsed .sb-brand .mark{display:flex}
.sb-nav{flex:1;padding:10px 10px;display:flex;flex-direction:column;gap:2px}
.sb-item{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:var(--radius-sm);color:var(--dim);font-size:.82rem;font-weight:700;cursor:pointer;white-space:nowrap;position:relative;border:1px solid transparent;transition:background-color var(--dur),color var(--dur),border-color var(--dur)}
.sb-item:hover{color:var(--text);background:rgba(255,255,255,.04)}
.sb-item.active{color:var(--white);background:linear-gradient(90deg,rgba(23,217,255,.14),rgba(23,217,255,.02));border-color:var(--border-hi)}
.sb-item.active .sb-ic{color:var(--cyan)}
.sb-item .sb-ic{flex:none;width:18px;height:18px;color:var(--faint);transition:color var(--dur)}
.sb-item .sb-label{overflow:hidden;text-overflow:ellipsis;flex:1}
.sb-item .sb-dot{width:6px;height:6px;border-radius:50%;flex:none}
.app.sb-collapsed .sb-label{display:none}
.app.sb-collapsed .sb-item{justify-content:center}
.sb-item[data-tip]{position:relative}
.app.sb-collapsed .sb-item[data-tip]:hover::after{
  content:attr(data-tip);position:absolute;left:calc(100% + 10px);top:50%;transform:translateY(-50%);
  background:var(--surface-strong);border:1px solid var(--border-hi);color:var(--white);
  padding:6px 10px;border-radius:8px;font-size:.72rem;white-space:nowrap;z-index:60;box-shadow:0 8px 24px rgba(0,0,0,.5)
}
.sb-foot{padding:12px;border-top:1px solid var(--border)}
.sb-toggle{width:100%;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--dim);padding:9px;display:flex;align-items:center;justify-content:center;gap:8px;font-size:.72rem;font-weight:700;transition:background-color var(--dur),color var(--dur)}
.sb-toggle:hover{color:var(--text);background:rgba(255,255,255,.06)}
.sb-toggle svg{transition:transform var(--dur)}
.app.sb-collapsed .sb-toggle svg{transform:rotate(180deg)}
.app.sb-collapsed .sb-toggle .sb-label{display:none}

.main{flex:1;min-width:0;display:flex;flex-direction:column}
.topbar{position:sticky;top:0;z-index:35;backdrop-filter:blur(18px);background:rgba(5,11,24,.82);border-bottom:1px solid var(--border)}
.topbar-in{padding:12px 24px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.sb-open-btn{display:none;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:9px;color:var(--dim);width:34px;height:34px;align-items:center;justify-content:center;flex:none}
.page-title{font-size:.98rem;font-weight:800;margin-right:auto}
.page-title .sub{display:block;font-size:.68rem;font-weight:600;color:var(--faint);margin-top:1px}
.pill{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.035);border:1px solid var(--border);border-radius:999px;padding:6px 11px;font-size:.72rem;color:var(--dim)}
.pill.paper{color:var(--ice);border-color:rgba(117,232,255,.35);background:rgba(23,217,255,.07);font-weight:800;letter-spacing:.04em}
.led{width:7px;height:7px;border-radius:50%;flex:none}
.led.on{background:var(--positive);box-shadow:0 0 0 0 var(--positive-glow);animation:pulse 1.8s infinite}
.led.off{background:var(--danger)}
.led.mid{background:var(--warning)}
@keyframes pulse{0%{box-shadow:0 0 0 0 var(--positive-glow)}70%{box-shadow:0 0 0 8px rgba(54,227,160,0)}100%{box-shadow:0 0 0 0 rgba(54,227,160,0)}}
.iconbtn{background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:9px;color:var(--dim);width:32px;height:32px;display:flex;align-items:center;justify-content:center;transition:background-color var(--dur),color var(--dur)}
.iconbtn:hover{color:var(--text);background:rgba(255,255,255,.07)}
.iconbtn.active{color:var(--cyan);border-color:var(--border-hi)}
#clock{font-family:var(--mono);font-size:.7rem;color:var(--dim);white-space:nowrap}
#clock .utc{color:var(--faint)}

/* ---- fita de preços ---- */
.ticker-wrap{border-bottom:1px solid var(--border);background:rgba(255,255,255,.012);overflow:hidden;white-space:nowrap;position:relative}
.ticker-wrap::before,.ticker-wrap::after{content:'';position:absolute;top:0;bottom:0;width:60px;z-index:2;pointer-events:none}
.ticker-wrap::before{left:0;background:linear-gradient(90deg,var(--bg-main),transparent)}
.ticker-wrap::after{right:0;background:linear-gradient(270deg,var(--bg-main),transparent)}
.ticker-track{display:inline-flex;gap:0;animation:ticker-scroll 55s linear infinite;padding:7px 0}
.ticker-wrap:hover .ticker-track{animation-play-state:paused}
@keyframes ticker-scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.tick-item{display:inline-flex;align-items:baseline;gap:7px;padding:0 18px;border-right:1px solid var(--border);font-size:.78rem}
.tick-item .sym{font-weight:800}
.tick-item .px{font-family:var(--mono)}
.tick-item .chg{font-family:var(--mono);font-size:.7rem}

.wrap{padding:20px 24px 90px}
.tabpanel{display:none;animation:fadeUp .32s var(--ease) both}
.tabpanel.active{display:block}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

section{margin-bottom:18px}
.card{background:linear-gradient(180deg,var(--surface),var(--panel-hi));backdrop-filter:blur(10px);border:1px solid var(--border);border-radius:var(--radius);padding:18px 20px;transition:border-color var(--dur)}
.card:hover{border-color:var(--border-hi)}
.card h2{margin:0 0 3px;font-size:.92rem;font-weight:800;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.card .caption{font-size:.72rem;color:var(--faint);margin:0 0 14px;line-height:1.55}
.card .note{font-size:.68rem;color:var(--dim);font-weight:500}

.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:12px}
@media(max-width:1100px){.kpis{grid-template-columns:repeat(3,1fr)}}
@media(max-width:640px){.kpis{grid-template-columns:repeat(2,1fr)}}
.kpi{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:14px 16px;transition:transform var(--dur),border-color var(--dur)}
.kpi:hover{transform:translateY(-2px);border-color:var(--border-hi)}
.kpi .lbl{font-size:.6rem;text-transform:uppercase;letter-spacing:.08em;color:var(--faint);font-weight:800}
.kpi .val{font-family:var(--mono);font-size:1.3rem;font-weight:800;margin-top:5px;letter-spacing:-.01em}
.kpi .sub{font-size:.66rem;color:var(--dim);margin-top:3px}

.grid2{display:grid;grid-template-columns:1.3fr 1fr;gap:16px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
@media(max-width:980px){.grid2,.grid3{grid-template-columns:1fr}}

.chart-wrap{width:100%;height:210px}
.chart-wrap svg{width:100%;height:100%;overflow:visible}

/* ---- gráfico de candles ---- */
.candle-box{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:14px 16px;margin-top:12px}
.candle-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px}
.candle-head .tt{font-weight:800;font-size:.86rem}
.candle-head .exs{font-size:.68rem;color:var(--dim);font-family:var(--mono)}
.candle-svg-wrap{width:100%;height:260px}
.candle-svg-wrap svg{width:100%;height:100%;display:block}
.candle-legend{display:flex;gap:14px;margin-top:8px;font-size:.68rem;color:var(--dim);flex-wrap:wrap}
.candle-legend span{display:inline-flex;align-items:center;gap:5px}
.leg-dot{width:8px;height:8px;border-radius:2px}
@keyframes candleIn{from{opacity:0;transform:scaleY(.3)}to{opacity:1;transform:scaleY(1)}}

.procgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
@media(max-width:900px){.procgrid{grid-template-columns:repeat(2,1fr)}}
.proc{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:12px 14px;transition:border-color var(--dur)}
.proc.vivo{border-color:rgba(23,217,255,.26)}
.proc.morto{border-color:rgba(255,92,122,.4)}
.proc .row{display:flex;align-items:center;gap:8px}
.proc .nome{font-weight:700;font-size:.84rem}
.proc .info{font-family:var(--mono);font-size:.7rem;color:var(--dim);margin-top:6px}

.wdlog{max-height:160px;overflow-y:auto;font-family:var(--mono);font-size:.7rem;color:var(--dim);line-height:1.65;margin-top:12px;border-top:1px solid var(--border);padding-top:10px}
.wdlog div{white-space:pre-wrap;word-break:break-word}

.poscards{display:flex;flex-direction:column;gap:14px}
.poscard{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:16px}
.poscard .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.poscard .sym{font-weight:900;font-size:1.05rem}
.badge{font-size:.62rem;font-weight:800;padding:3px 9px;border-radius:999px;text-transform:uppercase;letter-spacing:.04em}
.badge.ok{background:rgba(54,227,160,.14);color:var(--positive)}
.badge.warn{background:rgba(255,200,87,.14);color:var(--warning)}
.badge.bad{background:rgba(255,92,122,.14);color:var(--danger)}
.legs{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}
.leg{background:rgba(255,255,255,.03);border-radius:10px;padding:8px 10px;border:1px solid var(--border)}
.leg .exid{font-size:.64rem;color:var(--faint);text-transform:uppercase;letter-spacing:.04em}
.leg .price{font-family:var(--mono);font-size:.94rem;font-weight:800;margin-top:3px;transition:color .35s}
.flash-up{color:var(--positive)!important;text-shadow:0 0 10px var(--positive-glow)}
.flash-down{color:var(--danger)!important;text-shadow:0 0 10px var(--danger-glow)}
.gauge{height:6px;border-radius:99px;background:rgba(255,255,255,.06);overflow:hidden;margin-top:10px}
.gauge i{display:block;height:100%;border-radius:99px;transition:width .6s ease}
.poscard .meta{display:flex;justify-content:space-between;font-size:.7rem;color:var(--dim);margin-top:8px;font-family:var(--mono)}
.empty{color:var(--dim);font-size:.85rem;padding:26px 20px;text-align:center;border:1px dashed var(--border);border-radius:14px;line-height:1.6}
.empty svg{display:block;margin:0 auto 10px;opacity:.6}

table{width:100%;border-collapse:collapse;font-size:.78rem}
th{text-align:left;color:var(--faint);font-weight:800;font-size:.6rem;text-transform:uppercase;letter-spacing:.05em;padding:9px 10px;border-bottom:1px solid var(--border)}
td{padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.035);font-family:var(--mono)}
tbody tr{transition:background-color .15s}
tbody tr:hover{background:rgba(255,255,255,.03)}
.mini-bar{width:64px;height:5px;border-radius:99px;background:rgba(255,255,255,.07);display:inline-block;overflow:hidden;vertical-align:middle;margin-left:6px}
.mini-bar i{display:block;height:100%;transition:width .5s ease}

.acct{display:flex;flex-direction:column;gap:12px}
.acctrow .head{display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:6px}
.acctrow .head b{text-transform:uppercase;letter-spacing:.03em;font-size:.72rem;color:var(--dim)}
.barmeter{position:relative;height:9px;border-radius:99px;background:rgba(255,255,255,.06);overflow:hidden}
.barmeter i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--cyan),var(--violet))}
.barmeter .mark{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--warning)}

.exprow{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:.82rem}
.exprow:last-child{border-bottom:none}

.healthgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.hchip{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:10px 12px}
.hchip .nm{font-weight:700;font-size:.78rem;display:flex;align-items:center;gap:6px}
.hchip .dt{font-size:.68rem;color:var(--dim);margin-top:4px}

.timeline{max-height:420px;overflow-y:auto}
.tl-item{display:flex;gap:10px;padding:10px 2px;border-bottom:1px solid rgba(255,255,255,.04);font-size:.78rem}
.tl-item:last-child{border-bottom:none}
.tl-dot{width:8px;height:8px;border-radius:50%;margin-top:5px;flex:none}
.tl-body b{font-weight:700}
.tl-body .motivo{color:var(--dim);margin-top:2px;font-size:.75rem;line-height:1.4}
.tl-time{color:var(--faint);font-size:.66rem;font-family:var(--mono);white-space:nowrap}

.op-badge{display:inline-block;font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:999px}
.op-det{color:var(--dim);font-size:.76rem}

.progress-readiness{height:8px;border-radius:99px;background:rgba(255,255,255,.06);overflow:hidden;margin-top:10px}
.progress-readiness i{display:block;height:100%;background:linear-gradient(90deg,var(--blue),var(--cyan))}

/* ---- toolbar de tabela (busca/filtro) ---- */
.tbl-toolbar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.tbl-toolbar input[type=text]{background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:9px;color:var(--text);padding:8px 12px;font-size:.78rem;font-family:var(--sans);min-width:200px;flex:1}
.tbl-toolbar input[type=text]:focus{outline:none;border-color:var(--border-hi)}
.tbl-toolbar select{background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:9px;color:var(--text);padding:8px 10px;font-size:.76rem;font-family:var(--sans)}
th.sortable{cursor:pointer;user-select:none}
th.sortable:hover{color:var(--text)}
th.sortable .arrow{opacity:.5;margin-left:3px}

/* ---- badges de pesquisa ---- */
.strat-badge{font-size:.6rem;font-weight:800;text-transform:uppercase;letter-spacing:.03em;padding:3px 9px;border-radius:999px;white-space:nowrap}
.strat-badge.producao{background:rgba(54,227,160,.14);color:var(--positive)}
.strat-badge.validada{background:rgba(23,217,255,.14);color:var(--cyan)}
.strat-badge.parcial{background:rgba(255,200,87,.14);color:var(--warning)}
.strat-badge.descartada{background:rgba(255,92,122,.14);color:var(--danger)}
.strat-badge.pesquisa{background:rgba(139,108,242,.14);color:var(--violet)}

/* ---- visualizador de logs ---- */
.log-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
.log-view{background:#030710;border:1px solid var(--border);border-radius:12px;padding:12px 14px;max-height:520px;overflow-y:auto;font-family:var(--mono);font-size:.72rem;line-height:1.65}
.log-line{white-space:pre-wrap;word-break:break-word;color:var(--dim);border-left:2px solid transparent;padding-left:8px}
.log-line.erro{color:var(--danger);border-left-color:var(--danger)}
.log-empty{color:var(--faint);text-align:center;padding:30px}

/* ---- aviso paper / halted ---- */
.aviso{font-size:.76rem;color:var(--dim);background:rgba(23,217,255,.06);border:1px solid rgba(23,217,255,.25);border-radius:14px;padding:12px 16px;margin-bottom:16px;line-height:1.55}
.aviso b{color:var(--cyan)}
.aviso.perigo{background:rgba(255,92,122,.08);border-color:rgba(255,92,122,.35);color:var(--danger)}

footer.foot{text-align:center;color:var(--faint);font-size:.7rem;padding:30px 0 0;font-family:var(--mono)}
code{background:rgba(255,255,255,.06);padding:1px 5px;border-radius:5px;font-size:.9em}

@media(max-width:860px){
  .sidebar{position:fixed;left:0;top:0;bottom:0;transform:translateX(-100%);transition:transform var(--dur) var(--ease)}
  .app.mobile-open .sidebar{transform:translateX(0)}
  .app.sb-collapsed .sidebar{width:var(--sidebar-w)}
  .app.sb-collapsed .sb-label{display:block}
  .sb-open-btn{display:flex}
  .wrap{padding:16px 14px 80px}
  .kpis{grid-template-columns:repeat(2,1fr)}
}
</style></head>
<body>
<div class="app" id="app">

  <aside class="sidebar" id="sidebar">
    <div class="sb-brand">
      <img src="/logo.png" alt="Snowball">
      <div class="mark"></div>
    </div>
    <nav class="sb-nav" id="sb-nav">
      <div class="sb-item active" data-tab="visao" data-tip="Visão geral" tabindex="0"><svg class="sb-ic" viewBox="0 0 24 24" fill="none"><use href="#ic-grid"/></svg><span class="sb-label">Visão geral</span></div>
      <div class="sb-item" data-tab="operacoes" data-tip="Operações" tabindex="0"><svg class="sb-ic" viewBox="0 0 24 24" fill="none"><use href="#ic-scale"/></svg><span class="sb-label">Operações</span></div>
      <div class="sb-item" data-tab="oportunidades" data-tip="Oportunidades" tabindex="0"><svg class="sb-ic" viewBox="0 0 24 24" fill="none"><use href="#ic-radar"/></svg><span class="sb-label">Oportunidades</span></div>
      <div class="sb-item" data-tab="exchanges" data-tip="Exchanges" tabindex="0"><svg class="sb-ic" viewBox="0 0 24 24" fill="none"><use href="#ic-nodes"/></svg><span class="sb-label">Exchanges</span></div>
      <div class="sb-item" data-tab="risco" data-tip="Risco" tabindex="0"><svg class="sb-ic" viewBox="0 0 24 24" fill="none"><use href="#ic-shield"/></svg><span class="sb-label">Risco</span></div>
      <div class="sb-item" data-tab="processos" data-tip="Processos" tabindex="0"><svg class="sb-ic" viewBox="0 0 24 24" fill="none"><use href="#ic-cpu"/></svg><span class="sb-label">Processos</span></div>
      <div class="sb-item" data-tab="pesquisa" data-tip="Pesquisa" tabindex="0"><svg class="sb-ic" viewBox="0 0 24 24" fill="none"><use href="#ic-flask"/></svg><span class="sb-label">Pesquisa</span></div>
      <div class="sb-item" data-tab="historico" data-tip="Histórico" tabindex="0"><svg class="sb-ic" viewBox="0 0 24 24" fill="none"><use href="#ic-clock"/></svg><span class="sb-label">Histórico</span></div>
      <div class="sb-item" data-tab="logs" data-tip="Logs" tabindex="0"><svg class="sb-ic" viewBox="0 0 24 24" fill="none"><use href="#ic-terminal"/></svg><span class="sb-label">Logs</span></div>
      <div class="sb-item" data-tab="sistema" data-tip="Sistema" tabindex="0"><svg class="sb-ic" viewBox="0 0 24 24" fill="none"><use href="#ic-cog"/></svg><span class="sb-label">Sistema</span></div>
    </nav>
    <div class="sb-foot">
      <button class="sb-toggle" id="sb-toggle-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg><span class="sb-label">Recolher</span></button>
    </div>
  </aside>

  <div class="main">
    <div class="topbar"><div class="topbar-in">
      <button class="sb-open-btn" id="sb-open-btn" aria-label="Abrir menu"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg></button>
      <div class="page-title" id="page-title">Visão geral<span class="sub" id="page-sub">centro de operações — dois motores, papel</span></div>
      <span class="pill paper">PAPER</span>
      <span class="pill"><span class="led" id="led-vig"></span><span id="txt-vig">carregando</span></span>
      <span class="pill"><span class="led" id="led-stream"></span><span id="txt-stream">carregando</span></span>
      <span class="pill" id="clock">--:--:-- <span class="utc">· UTC --:--</span></span>
      <button class="iconbtn" id="btn-pause" title="Pausar atualizações visuais" aria-label="Pausar atualizações visuais"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg></button>
      <button class="iconbtn" id="btn-fullscreen" title="Tela cheia" aria-label="Tela cheia"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 00-2 2v3M16 3h3a2 2 0 012 2v3M8 21H5a2 2 0 01-2-2v-3M16 21h3a2 2 0 002-2v-3"/></svg></button>
    </div></div>

    <div class="ticker-wrap"><div class="ticker-track" id="ticker-track"></div></div>

    <div class="wrap">

    <!-- ============ VISÃO GERAL (Command Center) ============ -->
    <div class="tabpanel active" id="panel-visao">
      <section class="kpis" id="kpis-geral"></section>

      <section class="card">
        <h2>Curva de capital — modo normal</h2>
        <p class="caption">Capital total das 6 exchanges financiadas, ao longo do tempo.</p>
        <div class="chart-wrap"><svg id="svg-curva" viewBox="0 0 1000 190" preserveAspectRatio="none"></svg></div>
      </section>

      <section class="card">
        <h2>Ranking de exchanges — lucro individual <span class="note">US$ 100 declarado em cada, desde o início</span></h2>
        <div id="ranking-box"></div>
      </section>

      <section class="card">
        <h2>Ranking de pares — a melhor combinação de 2 exchanges <span class="note" id="pares-tag"></span></h2>
        <p class="caption">A estrutura sempre usa DUAS exchanges por posição — vendida numa, comprada na outra. "Folga" é a mesma conta que o portão real usa (vida útil média ÷ payback exigido pela taxa combinada das duas), calculada com a média histórica de cada par, não uma candidata isolada. Quando for pra dinheiro real com só 2 exchanges, é este número que decide quais.</p>
        <div style="overflow-x:auto"><table id="pares-table">
          <thead><tr><th>Par</th><th>Amostra</th><th>Taxa combinada</th><th>Spread médio</th><th>Vida útil média</th><th>Payback exigido</th><th>Folga</th><th>Trades reais</th></tr></thead>
          <tbody id="pares-body"></tbody>
        </table></div>
      </section>

      <section class="card">
        <h2>Processos <span class="note">watchdog verifica a cada 30s</span></h2>
        <div class="procgrid" id="procgrid"></div>
      </section>
    </div>

    <!-- ============ OPERAÇÕES (modo normal) ============ -->
    <div class="tabpanel" id="panel-operacoes">
      <section class="kpis" id="kpis"></section>

      <section class="grid2">
        <div class="card">
          <h2>Curva de capital</h2>
          <p class="caption">Soma do saldo nas 6 exchanges. Sobe com funding recebido, desce com custo de montagem/saída.</p>
          <div class="chart-wrap"><svg id="svg-curva-2" viewBox="0 0 1000 190" preserveAspectRatio="none"></svg></div>
        </div>
        <div class="card">
          <h2>Funding recebido por dia</h2>
          <p class="caption">Pagamento contratual entre comprados e vendidos, a cada ~8h por posição.</p>
          <div class="chart-wrap"><svg id="svg-bar" viewBox="0 0 1000 190" preserveAspectRatio="none"></svg></div>
        </div>
      </section>

      <section class="card">
        <h2>Posições — duas pernas, market-neutro <span class="note" id="pos-tag"></span></h2>
        <p class="caption">Cada posição é DUAS pernas — vendida numa exchange, comprada em outra, mesmo ativo, tamanho equivalente. O gráfico mostra o candle real do mercado com a entrada marcada.</p>
        <div class="poscards" id="poscards"></div>
      </section>

      <section class="card">
        <h2>De onde veio o dinheiro</h2>
        <p class="caption">Ponte do capital inicial até o atual: verde é o que ENTROU (funding), azul e vermelho são o que SAIU (custo de montar e de fechar posição). Laranja não é ganho nem perda — é dinheiro que só mudou de lugar dentro da mesma exchange, pra afastar uma posição da liquidação.</p>
        <div class="chart-wrap" style="height:260px"><svg id="svg-fluxo" viewBox="0 0 1000 260" preserveAspectRatio="none"></svg></div>
        <div class="kpis" style="grid-template-columns:repeat(4,1fr);margin-top:14px" id="fluxo-kpis"></div>
        <div class="timeline" id="fluxo-lista" style="margin-top:14px"></div>
      </section>

      <section class="card">
        <h2>Por exchange — o mesmo dinheiro, separado por conta</h2>
        <p class="caption">Cada trade tem duas pernas em exchanges diferentes; ganho/custo é dividido meio a meio entre as duas. "Socorreu" aqui é o valor que ENTROU naquela exchange especificamente (reforço vindo do saldo livre dela mesma).</p>
        <div style="overflow-x:auto"><table id="fluxo-ex-table">
          <thead><tr><th>Exchange</th><th>Saldo agora</th><th>Ganhou</th><th>Investiu</th><th>Perdeu</th><th>Socorreu</th></tr></thead>
          <tbody id="fluxo-ex-body"></tbody>
        </table></div>
      </section>
    </div>

    <!-- ============ OPORTUNIDADES ============ -->
    <div class="tabpanel" id="panel-oportunidades">
      <section class="card">
        <h2>Varredura — ranking ao vivo <span class="note" id="scan-tag"></span></h2>
        <p class="caption">Candidatas ordenadas por quanto já cruzaram o portão de valor esperado (coluna "Caminho"). "Passa" = o motor pode abrir; "Barra" = ainda não vale o custo.</p>
        <div class="tbl-toolbar">
          <input type="text" id="scan-busca" placeholder="Buscar ativo ou exchange...">
          <select id="scan-filtro">
            <option value="todos">Todos os status</option>
            <option value="passa">Só passou o portão</option>
            <option value="barra">Só barrados</option>
          </select>
        </div>
        <div style="overflow-x:auto"><table id="scan-table">
          <thead><tr>
            <th class="sortable" data-col="symbol">Par</th><th>Rota</th>
            <th class="sortable" data-col="spread">Spread</th><th class="sortable" data-col="apr">APR</th>
            <th class="sortable" data-col="consistencia">Consist.</th>
            <th class="sortable" data-col="vidaEsperadaHoras">Vida esp.</th>
            <th class="sortable" data-col="paybackHoras">Payback</th>
            <th class="sortable" data-col="pctDoCaminho">Caminho</th><th>Portão</th>
          </tr></thead>
          <tbody id="scan-body"></tbody>
        </table></div>
      </section>
    </div>

    <!-- ============ EXCHANGES ============ -->
    <div class="tabpanel" id="panel-exchanges">
      <section class="card">
        <h2>Preços ao vivo <span class="note">pernas de posições abertas + melhores candidatas da varredura</span></h2>
        <div id="mercado-grid" class="procgrid"></div>
      </section>
      <section class="grid2">
        <div class="card">
          <h2>Contas por exchange</h2>
          <div class="acct" id="acct"></div>
        </div>
        <div class="card">
          <h2>Saúde das exchanges</h2>
          <div class="healthgrid" id="custodia-grid"></div>
        </div>
      </section>
    </div>

    <!-- ============ RISCO ============ -->
    <div class="tabpanel" id="panel-risco">
      <section class="card">
        <h2>Exposição &amp; direção</h2>
        <p class="caption">Concentração é o risco de custódia (quanto do capital está numa exchange só); dreno é o quanto uma alta forte do mercado desequilibraria as contas.</p>
        <div id="exposure"></div>
      </section>
      <section class="card">
        <h2>Distância até liquidação, por posição</h2>
        <p class="caption">Fração de movimento adverso de preço que a margem de cada perna ainda aguenta antes de liquidar. Quanto maior, mais seguro.</p>
        <div id="risco-liq-box"></div>
      </section>
      <section class="card">
        <h2>Travas de risco</h2>
        <div id="risco-travas-box"></div>
      </section>
    </div>

    <!-- ============ PROCESSOS ============ -->
    <div class="tabpanel" id="panel-processos">
      <section class="card">
        <h2>Arquitetura — como os processos se falam</h2>
        <p class="caption">Por arquivo em disco, não chamada direta — se um cai, os outros percebem pela idade do dado em vez de travar.</p>
        <div id="arq-diagrama"></div>
      </section>
      <section class="card">
        <h2>Processos <span class="note">watchdog verifica a cada 30s</span></h2>
        <div class="procgrid" id="procgrid-2"></div>
        <div class="wdlog" id="wdlog"></div>
      </section>
    </div>

    <!-- ============ PESQUISA ============ -->
    <div class="tabpanel" id="panel-pesquisa">
      <section class="card">
        <h2>Famílias de estratégia testadas <span class="note">mesma disciplina de holdout cego em todas</span></h2>
        <p class="caption">Descoberta separada de holdout, parâmetros fixos sem reajuste, correção honesta sempre que um teste mais rigoroso derrubava um resultado bonito. Números completos e metodologia em <code>docs/RESULTADOS.md</code>.</p>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Família</th><th>Melhor achado</th><th>Holdout</th><th>Custo/risco real</th><th>Status</th></tr></thead>
          <tbody id="estrategias-body"></tbody>
        </table></div>
      </section>

      <section class="card">
        <h2>Modo agressivo — ts-momentum <span class="note" id="agressivo-tag"></span></h2>
        <p class="caption">Multi-ativo, experimental, roda em paralelo no backend — sem cards por posição aqui de propósito (40 posições com gráfico cada uma é o que deixava esta seção lenta).</p>
        <div id="agressivo-box"></div>
      </section>

      <section class="card">
        <h2>Pares cointegrados — mercado-neutro <span class="note" id="coint-tag"></span></h2>
        <p class="caption">Aposta na relação entre dois ativos (compra o barato, vende o caro), não na direção do mercado. Resultado 14: misturado com o momentum, corta a chance de ruína de ~46% para ~15%.</p>
        <div id="coint-box"></div>
      </section>

      <section class="card">
        <h2>Ordem limite vs. mercado — mede se maker preenche rápido o bastante <span class="note" id="preench-tag"></span></h2>
        <p class="caption">Ordem a mercado (taker) custa 0,05-0,06%; ordem limite (maker) custa ~0,02% — mas só preenche se o preço tocar nela, e o toque costuma vir acompanhado de movimento contra quem forneceu a liquidez. Isto simula uma ordem limite "no toque" nas duas pernas dos melhores candidatos da vigilância, sem enviar ordem nenhuma.</p>
        <div id="preench-box"></div>
      </section>

      <section class="card">
        <h2>Basis trade <span class="note">spot+perp, coleta — não opera</span></h2>
        <div id="basis-box"></div>
      </section>

      <section class="card">
        <h2>Prontidão de ML</h2>
        <div id="ml-box"></div>
      </section>
    </div>

    <!-- ============ HISTÓRICO ============ -->
    <div class="tabpanel" id="panel-historico">
      <section class="card">
        <h2>Decisões do motor</h2>
        <p class="caption">Cada avaliação de cada ciclo, inclusive os bloqueios — é o log de raciocínio completo, não só o resultado.</p>
        <div class="timeline" id="timeline"></div>
      </section>
      <section class="card">
        <h2>Histórico de operações <span class="note" id="ops-tag">tudo que foi de fato executado, sem os bloqueios</span></h2>
        <div style="overflow-x:auto"><table id="ops-table">
          <thead><tr><th>Quando</th><th>Tipo</th><th>Ativo</th><th>Detalhes</th></tr></thead>
          <tbody id="ops-body"></tbody>
        </table></div>
      </section>
    </div>

    <!-- ============ LOGS ============ -->
    <div class="tabpanel" id="panel-logs">
      <section class="card">
        <h2>Visualizador de logs <span class="note">arquivos reais dos processos, em disco</span></h2>
        <div class="log-toolbar">
          <select id="log-processo">
            <option value="vigilancia">vigilância</option>
            <option value="motor">motor</option>
            <option value="custodia">custódia</option>
            <option value="dashboard">dashboard</option>
            <option value="coletor">coletor</option>
            <option value="momentum">modo agressivo</option>
            <option value="pares">pares</option>
            <option value="preenchimento">preenchimento</option>
            <option value="watchdog">watchdog</option>
          </select>
          <input type="text" id="log-busca" placeholder="Filtrar linhas...">
          <button class="iconbtn active" id="log-seguir" title="Seguir automaticamente">⇩</button>
          <button class="iconbtn" id="log-pausar" title="Pausar polling">⏸</button>
          <button class="iconbtn" id="log-copiar" title="Copiar tudo">⧉</button>
        </div>
        <div class="log-view" id="log-view"><div class="log-empty">selecione um processo</div></div>
      </section>
    </div>

    <!-- ============ SISTEMA ============ -->
    <div class="tabpanel" id="panel-sistema">
      <section class="grid3">
        <div class="card">
          <h2>Coleta de longo prazo</h2>
          <div id="coleta-box"></div>
        </div>
        <div class="card">
          <h2>Saúde do dashboard <span class="note">memória, achado depois de quedas sem erro</span></h2>
          <div id="diag-box"></div>
        </div>
        <div class="card">
          <h2>Sobre este painel</h2>
          <p class="caption" style="margin:0">HTML + CSS + SVG + JS puro, sem dependência externa, servido pelo próprio motor. Nenhuma ordem é enviada de nenhum modo — os motores só leem as exchanges e simulam.</p>
        </div>
      </section>
    </div>

    <footer class="foot">SNOWBALL — nenhuma ordem enviada além do paper trading declarado — atualizado <span id="foot-ts">—</span></footer>
    </div>
  </div>
</div>

<svg width="0" height="0" style="position:absolute" aria-hidden="true">
<defs>
<symbol id="ic-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/><rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/><rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/><rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/></symbol>
<symbol id="ic-scale" viewBox="0 0 24 24"><path d="M12 3v18M5 7l-3 6a3 3 0 006 0l-3-6zM19 7l-3 6a3 3 0 006 0l-3-6zM5 7h14M8 21h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="ic-radar" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><path d="M12 12L19 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></symbol>
<symbol id="ic-nodes" viewBox="0 0 24 24"><circle cx="5" cy="6" r="2.4" stroke="currentColor" stroke-width="1.8"/><circle cx="19" cy="6" r="2.4" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="18" r="2.4" stroke="currentColor" stroke-width="1.8"/><path d="M7 7l8-1M6.5 8l5 8M17.5 8l-4.5 8" stroke="currentColor" stroke-width="1.6"/></symbol>
<symbol id="ic-shield" viewBox="0 0 24 24"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="ic-cpu" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/><rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></symbol>
<symbol id="ic-flask" viewBox="0 0 24 24"><path d="M9 3h6M10 3v6l-5.5 9a2 2 0 001.7 3h11.6a2 2 0 001.7-3L14 9V3" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 15h8" stroke="currentColor" stroke-width="1.6"/></symbol>
<symbol id="ic-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l4 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="ic-terminal" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M7 9l3 3-3 3M13 15h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="ic-cog" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></symbol>
<symbol id="ic-snow" viewBox="0 0 24 24"><path d="M12 2v20M4.2 6l15.6 12M19.8 6L4.2 18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/></symbol>
</defs>
</svg>

<script>
'use strict';

function el(id){return document.getElementById(id)}
function fmtUsd(n){
  if(n==null||!isFinite(n))return '—';
  var s=n<0?'-':''; n=Math.abs(n);
  return s+'US$ '+n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function fmtNum(n,d){
  if(n==null||!isFinite(n))return '—';
  return n.toLocaleString('pt-BR',{minimumFractionDigits:d||0,maximumFractionDigits:d||0});
}
function fmtPct(n,d){
  if(n==null||!isFinite(n))return '—';
  return (n*100).toLocaleString('pt-BR',{minimumFractionDigits:d==null?1:d,maximumFractionDigits:d==null?1:d})+'%';
}
function fmtHoras(h){
  if(h==null||!isFinite(h))return '—';
  if(h<1)return Math.round(h*60)+'min';
  if(h<48)return h.toFixed(1)+'h';
  return (h/24).toFixed(1)+'d';
}
function timeAgo(ts){
  if(!ts)return '—';
  var s=Math.max(0,Math.floor((Date.now()-ts)/1000));
  if(s<60)return s+'s atrás';
  if(s<3600)return Math.floor(s/60)+'min atrás';
  if(s<86400)return Math.floor(s/3600)+'h atrás';
  return Math.floor(s/86400)+'d atrás';
}
function diasDesde(ts){
  var d=(Date.now()-ts)/86400000;
  return d<1?Math.round(d*24)+'h':d.toFixed(1)+'d';
}
function esc(s){
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ---- sidebar: navegação + colapso + mobile ----
var PAGE_INFO={
  visao:{t:'Visão geral',s:'centro de operações — dois motores, papel'},
  operacoes:{t:'Operações',s:'delta-neutro — posições, fluxo de capital, decisões'},
  oportunidades:{t:'Oportunidades',s:'ranking ao vivo da vigilância, com o veredito do portão'},
  exchanges:{t:'Exchanges',s:'saldos, saúde e preços ao vivo'},
  risco:{t:'Risco',s:'exposição, concentração, distância até liquidação'},
  processos:{t:'Processos',s:'arquitetura e saúde dos 8 processos supervisionados'},
  pesquisa:{t:'Pesquisa',s:'famílias de estratégia, modo agressivo, pares, preenchimento'},
  historico:{t:'Histórico',s:'linha do tempo completa de decisões e operações'},
  logs:{t:'Logs',s:'streaming dos arquivos de log reais'},
  sistema:{t:'Sistema',s:'coleta, prontidão de ML, diagnóstico do dashboard'}
};
(function(){
  var app=el('app');
  var items=document.querySelectorAll('.sb-item');
  function ativar(alvo){
    items.forEach(function(x){x.classList.remove('active')});
    document.querySelectorAll('.tabpanel').forEach(function(x){x.classList.remove('active')});
    var item=document.querySelector('.sb-item[data-tab="'+alvo+'"]');
    var panel=el('panel-'+alvo);
    if(!item||!panel)return;
    item.classList.add('active');
    panel.classList.add('active');
    var info=PAGE_INFO[alvo];
    if(info){el('page-title').innerHTML=esc(info.t)+'<span class="sub">'+esc(info.s)+'</span>'}
    try{localStorage.setItem('snowball-aba',alvo)}catch(e){}
    app.classList.remove('mobile-open');
  }
  items.forEach(function(t){
    t.addEventListener('click',function(){ativar(t.getAttribute('data-tab'))});
    t.addEventListener('keydown',function(ev){if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();ativar(t.getAttribute('data-tab'))}});
  });
  var salva=null;
  try{salva=localStorage.getItem('snowball-aba')}catch(e){}
  if(salva&&PAGE_INFO[salva])ativar(salva);

  var toggleBtn=el('sb-toggle-btn');
  toggleBtn.addEventListener('click',function(){
    app.classList.toggle('sb-collapsed');
    try{localStorage.setItem('snowball-sb-collapsed',app.classList.contains('sb-collapsed')?'1':'0')}catch(e){}
  });
  try{if(localStorage.getItem('snowball-sb-collapsed')==='1')app.classList.add('sb-collapsed')}catch(e){}

  el('sb-open-btn').addEventListener('click',function(){app.classList.toggle('mobile-open')});
})();

// ---- pausar atualizações visuais / tela cheia ----
var PAUSADO=false;
(function(){
  var btn=el('btn-pause');
  btn.addEventListener('click',function(){
    PAUSADO=!PAUSADO;
    btn.classList.toggle('active',PAUSADO);
    btn.title=PAUSADO?'Retomar atualizações visuais':'Pausar atualizações visuais';
  });
  el('btn-fullscreen').addEventListener('click',function(){
    if(document.fullscreenElement)document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(function(){});
  });
})();

// ---- anti-flicker ----
var lastHash={};
function renderIfChanged(key,data,fn){
  if(PAUSADO)return;
  var h;
  try{h=JSON.stringify(data)}catch(e){h=String(Date.now())}
  if(lastHash[key]===h)return;
  lastHash[key]=h;
  fn();
}

// ---- animação de números ----
var animState={};
function animateNumber(id,val,fmt){
  var node=el(id); if(!node)return;
  var from=animState[id]==null?val:animState[id];
  animState[id]=val;
  if(!isFinite(val)){node.textContent=fmt(val);return}
  var t0=performance.now(),dur=500;
  function step(t){
    var p=Math.min(1,(t-t0)/dur);
    var e=1-Math.pow(1-p,3);
    node.textContent=fmt(from+(val-from)*e);
    if(p<1)requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ---- fita de preços ----
function renderTicker(d){
  var itens=[];
  var pos=(d.posicoes||[]);
  pos.forEach(function(p){
    if(p.precoAoVivoShort)itens.push({sym:(p.symbol||'').replace('/USDT:USDT','')+' · '+p.exchangeShort,px:p.precoAoVivoShort,chg:p.variacaoShort});
    if(p.precoAoVivoLong)itens.push({sym:(p.symbol||'').replace('/USDT:USDT','')+' · '+p.exchangeLong,px:p.precoAoVivoLong,chg:p.variacaoLong});
  });
  (d.scan||[]).slice(0,10).forEach(function(o){
    if(o.precoShortAoVivo)itens.push({sym:(o.symbol||'').replace('/USDT:USDT',''),px:o.precoShortAoVivo,chg:0});
  });
  renderIfChanged('ticker',itens.map(function(i){return i.sym+i.px}),function(){
    if(!itens.length){el('ticker-track').innerHTML='<span class="tick-item">aguardando preços ao vivo…</span>';return}
    var html=itens.map(function(i){
      var cls=i.chg>0?'up':(i.chg<0?'down':'neu');
      return '<span class="tick-item"><span class="sym">'+esc(i.sym)+'</span><span class="px num">'+fmtUsd(i.px)+'</span>'+
        (i.chg?'<span class="chg '+cls+'">'+(i.chg>=0?'+':'')+fmtPct(i.chg,2)+'</span>':'')+'</span>';
    }).join('');
    el('ticker-track').innerHTML=html+html; // duplicado pra rolagem contínua sem costura
  });
}

// ---- KPIs (visão geral + operações) ----
function montarKpisNormal(d){
  var e=d.estado||{};
  var cap=e.capital!=null?e.capital:0;
  var capIni=e.capitalInicial||cap||1;
  var variacao=(cap-capIni)/capIni;
  return [
    {id:'k-capital',lbl:'Capital atual · normal',val:cap,fmt:fmtUsd,sub:(variacao>=0?'+':'')+fmtPct(variacao,2)+' desde o início',cls:variacao>=0?'up':'down'},
    {id:'k-pico',lbl:'Pico',val:e.pico||cap,fmt:fmtUsd,sub:'capital inicial '+fmtUsd(capIni)},
    {id:'k-funding',lbl:'Funding recebido',val:e.fundingTotal||0,fmt:fmtUsd,sub:(e.pagamentos||0)+' pagamentos'},
    {id:'k-custos',lbl:'Custos pagos',val:e.custosTotal||0,fmt:fmtUsd,sub:(e.trocas||0)+' trocas de posição'},
    {id:'k-ocioso',lbl:'Caixa ocioso',val:e.caixaOcioso||0,fmt:fmtUsd,sub:(e.reinvestimentos||0)+' reinvestimentos'},
    {id:'k-uptime',lbl:'Coletando há',val:null,fmt:null,sub:e.iniciadoEm?timeAgo(e.iniciadoEm).replace(' atrás',''):'—',raw:e.iniciadoEm?diasDesde(e.iniciadoEm):'—'}
  ];
}
function montarFigura(it){
  return '<div class="kpi"><div class="lbl">'+esc(it.lbl)+'</div><div class="val '+(it.cls||'')+'" id="'+it.id+'">—</div><div class="sub" id="'+it.id+'-sub">—</div></div>';
}
function aplicarFiguras(host,itens){
  if(!host.dataset.built){host.innerHTML=itens.map(montarFigura).join('');host.dataset.built='1'}
  itens.forEach(function(it){
    if(it.fmt) animateNumber(it.id,it.val,it.fmt); else { var n=el(it.id); if(n) n.textContent=it.raw }
    var subNode=el(it.id+'-sub'); if(subNode) subNode.textContent=it.sub;
    var valNode=el(it.id); if(valNode&&it.cls){valNode.className='val '+it.cls}
  });
}
function renderKpis(d){
  aplicarFiguras(el('kpis'),montarKpisNormal(d));
  var geral=el('kpis-geral');
  var itensGeral=montarKpisNormal(d).map(function(it){return {id:'g-'+it.id,lbl:it.lbl,val:it.val,fmt:it.fmt,sub:it.sub,cls:it.cls,raw:it.raw}});
  aplicarFiguras(geral,itensGeral);
}

// ---- curva de capital ----
function desenharCurva(svgId, pts, corStroke){
  var svg=el(svgId);
  if(!svg)return;
  if(pts.length<2){svg.innerHTML='';return}
  var W=1000,H=190,pad=8;
  var vals=pts.map(function(p){return p.capital});
  var lo=Math.min.apply(null,vals),hi=Math.max.apply(null,vals);
  if(lo===hi){lo-=1;hi+=1}
  var n=pts.length;
  function X(i){return pad+(W-2*pad)*(i/(n-1))}
  function Y(v){return H-pad-(H-2*pad)*((v-lo)/(hi-lo))}
  var line=[],area=[];
  for(var i=0;i<n;i++){
    var x=X(i).toFixed(1),y=Y(pts[i].capital).toFixed(1);
    line.push((i===0?'M':'L')+x+','+y);
  }
  area.push('M'+X(0).toFixed(1)+','+(H-pad));
  area.push(line.join(' ').replace('M','L'));
  area.push('L'+X(n-1).toFixed(1)+','+(H-pad)+' Z');
  var grad1='grad-'+svgId, grad2='gradfill-'+svgId;
  svg.innerHTML=
    '<defs><linearGradient id="'+grad1+'" x1="0" y1="0" x2="1" y2="0">'+
    '<stop offset="0" stop-color="'+corStroke+'" stop-opacity=".55"/><stop offset="1" stop-color="'+corStroke+'"/>'+
    '</linearGradient><linearGradient id="'+grad2+'" x1="0" y1="0" x2="0" y2="1">'+
    '<stop offset="0" stop-color="'+corStroke+'" stop-opacity=".22"/><stop offset="1" stop-color="'+corStroke+'" stop-opacity="0"/>'+
    '</linearGradient></defs>'+
    '<path d="'+area.join(' ')+'" fill="url(#'+grad2+')"/>'+
    '<path d="'+line.join(' ')+'" fill="none" stroke="url(#'+grad1+')" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
}
function renderCurva(d){
  var pts=(d.curva||[]).filter(function(p){return isFinite(p.capital)});
  renderIfChanged('curva',pts,function(){
    desenharCurva('svg-curva',pts,'#17d9ff');
    desenharCurva('svg-curva-2',pts,'#17d9ff');
  });
}
// ---- funding por dia ----
function renderBarras(d){
  var linhas=(d.pagamentosPorDia||[]).slice(-14);
  renderIfChanged('barras',linhas,function(){
    var svg=el('svg-bar');
    if(!linhas.length){svg.innerHTML='';return}
    var W=1000,H=190,pad=6;
    var max=Math.max.apply(null,linhas.map(function(l){return Math.abs(l.total)}).concat([0.0001]));
    var bw=(W-2*pad)/linhas.length-6;
    var out=[];
    linhas.forEach(function(l,i){
      var h=Math.max(2,(H-46)*(Math.abs(l.total)/max));
      var x=pad+i*((W-2*pad)/linhas.length);
      var neg=l.total<0;
      var y=neg?(H-24):(H-24-h);
      var cor=neg?'#ff5c7a':'#17d9ff';
      out.push('<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="3" fill="'+cor+'"><title>'+esc(l.dia)+': '+fmtUsd(l.total)+'</title></rect>');
      out.push('<text x="'+(x+bw/2).toFixed(1)+'" y="'+(H-8)+'" font-size="13" fill="#516a8c" text-anchor="middle" font-family="ui-monospace,monospace">'+esc(l.dia.slice(5))+'</text>');
    });
    svg.innerHTML=out.join('');
  });
}

// ---- gráfico de candles (com a entrada da posição marcada) ----
var GRAFICOS={};
// Carregamento preguiçoso: buscar o gráfico de todas as posições de uma vez
// dispararia N fetches simultâneos batendo numa chamada de exchange ao vivo
// no servidor — foi isso que deixou o modo agressivo (40 posições) lento o
// bastante pra ser tirado do painel. Só busca o candle quando o card entra
// de fato na tela.
var CANDLE_OBSERVER=null;
function elementPertoDaTela(box){
  var r=box.getBoundingClientRect();
  var folga=400;
  return r.bottom>-folga&&r.top<(window.innerHeight||800)+folga;
}
function observarCandle(box,cb){
  if(elementPertoDaTela(box)){cb();return}
  if(!('IntersectionObserver' in window)){cb();return}
  var disparado=false;
  var disparar=function(){
    if(disparado)return;
    disparado=true;
    box._candleCb=null;
    if(CANDLE_OBSERVER)CANDLE_OBSERVER.unobserve(box);
    clearTimeout(fallback);
    cb();
  };
  var fallback=setTimeout(disparar,4000);
  if(!CANDLE_OBSERVER){
    CANDLE_OBSERVER=new IntersectionObserver(function(entries){
      entries.forEach(function(ent){
        if(ent.isIntersecting&&ent.target._candleCb)ent.target._candleCb();
      });
    },{rootMargin:'400px'});
  }
  box._candleCb=disparar;
  CANDLE_OBSERVER.observe(box);
}
function desenharCandles(svgEl, candles, entryPrice, side){
  if(!candles||candles.length<2){svgEl.innerHTML='<text x="500" y="130" text-anchor="middle" fill="#516a8c" font-size="14">sem dado de candle ainda</text>';return}
  var W=1000,H=260,padL=8,padR=54,padT=14,padB=22;
  var highs=candles.map(function(c){return c[2]}), lows=candles.map(function(c){return c[3]});
  var hi=Math.max.apply(null,highs), lo=Math.min.apply(null,lows);
  if(entryPrice){hi=Math.max(hi,entryPrice);lo=Math.min(lo,entryPrice)}
  var pad=(hi-lo)*0.08||hi*0.01||1; hi+=pad; lo-=pad;
  var n=candles.length;
  var plotW=W-padL-padR, plotH=H-padT-padB;
  function X(i){return padL+plotW*((i+0.5)/n)}
  function Y(v){return padT+plotH*(1-(v-lo)/(hi-lo))}
  var cw=Math.max(1.5,(plotW/n)*0.62);
  var out=[];
  for(var g=0;g<=3;g++){
    var v=lo+(hi-lo)*(g/3), y=Y(v).toFixed(1);
    out.push('<line x1="'+padL+'" y1="'+y+'" x2="'+(W-padR)+'" y2="'+y+'" stroke="rgba(117,232,255,.06)"/>');
    out.push('<text x="'+(W-padR+6)+'" y="'+(Number(y)+3)+'" font-size="12" fill="#516a8c" font-family="ui-monospace,monospace">'+v.toFixed(v<1?5:2)+'</text>');
  }
  candles.forEach(function(c,i){
    var o=c[1],h=c[2],l=c[3],cl=c[4];
    var alta=cl>=o;
    var cor=alta?'#17d9ff':'#ff5c7a';
    var x=X(i);
    out.push('<line x1="'+x.toFixed(1)+'" y1="'+Y(h).toFixed(1)+'" x2="'+x.toFixed(1)+'" y2="'+Y(l).toFixed(1)+'" stroke="'+cor+'" stroke-width="1.2"/>');
    var yo=Y(o),yc=Y(cl);
    var top=Math.min(yo,yc), hgt=Math.max(1.4,Math.abs(yc-yo));
    out.push('<rect x="'+(x-cw/2).toFixed(1)+'" y="'+top.toFixed(1)+'" width="'+cw.toFixed(1)+'" height="'+hgt.toFixed(1)+'" fill="'+cor+'" style="animation:candleIn .4s ease both;animation-delay:'+(i*4)+'ms;transform-origin:'+x.toFixed(1)+'px '+Y((o+cl)/2).toFixed(1)+'px"><title>O '+o.toFixed(4)+' · H '+h.toFixed(4)+' · L '+l.toFixed(4)+' · C '+cl.toFixed(4)+'</title></rect>');
  });
  if(entryPrice){
    var ye=Y(entryPrice).toFixed(1);
    var corEntrada=side==='short'?'#ff5c7a':'#17d9ff';
    out.push('<line x1="'+padL+'" y1="'+ye+'" x2="'+(W-padR)+'" y2="'+ye+'" stroke="'+corEntrada+'" stroke-width="1.4" stroke-dasharray="5,4"/>');
    out.push('<rect x="'+(W-padR+2)+'" y="'+(Number(ye)-9)+'" width="50" height="18" rx="4" fill="'+corEntrada+'"/>');
    out.push('<text x="'+(W-padR+27)+'" y="'+(Number(ye)+4)+'" font-size="11" fill="#050b18" font-weight="700" text-anchor="middle" font-family="ui-monospace,monospace">'+entryPrice.toFixed(entryPrice<1?5:2)+'</text>');
    out.push('<text x="'+padL+'" y="'+(Number(ye)-6)+'" font-size="11" fill="'+corEntrada+'" font-family="ui-monospace,monospace">entrada ('+esc(side)+')</text>');
  }
  svgEl.innerHTML=out.join('');
}
function garantirGrafico(container, key, exchange, symbol, timeframe, entryPrice, side){
  var id='candle-svg-'+key;
  var precisouRecriarDom=!el(id);
  if(precisouRecriarDom){
    var box=document.createElement('div');
    box.className='candle-box';
    box.innerHTML='<div class="candle-head"><span class="tt">Mercado — '+esc((symbol||'').replace('/USDT:USDT',''))+'</span>'+
      '<span class="exs">'+esc(exchange)+' · '+esc(timeframe)+'</span></div>'+
      '<div class="candle-svg-wrap"><svg id="'+id+'" viewBox="0 0 1000 260" preserveAspectRatio="none"></svg></div>'+
      '<div class="candle-legend"><span><i class="leg-dot" style="background:#17d9ff"></i>alta</span><span><i class="leg-dot" style="background:#ff5c7a"></i>baixa</span>'+
      '<span><i class="leg-dot" style="background:'+(side==='short'?'#ff5c7a':'#17d9ff')+'"></i>preço de entrada</span></div>';
    container.appendChild(box);
  }
  if(!GRAFICOS[key]){
    GRAFICOS[key]={entryPrice:entryPrice,side:side,ultimoCandles:null,timer:null};
    var atualizar=function(){
      fetch('/api/candles?exchange='+encodeURIComponent(exchange)+'&symbol='+encodeURIComponent(symbol)+'&timeframe='+encodeURIComponent(timeframe))
        .then(function(r){return r.json()})
        .then(function(j){
          if(j&&j.ok){
            GRAFICOS[key].ultimoCandles=j.candles;
            var svgEl=el(id); if(svgEl) desenharCandles(svgEl,j.candles,GRAFICOS[key].entryPrice,GRAFICOS[key].side);
          }
        }).catch(function(){});
    };
    observarCandle(container,function(){
      atualizar();
      GRAFICOS[key].timer=setInterval(atualizar,20000);
    });
  } else {
    GRAFICOS[key].entryPrice=entryPrice;
    GRAFICOS[key].side=side;
    if(precisouRecriarDom&&GRAFICOS[key].ultimoCandles){
      var svgAgora=el(id);
      if(svgAgora) desenharCandles(svgAgora,GRAFICOS[key].ultimoCandles,entryPrice,side);
    }
  }
}
function limparGraficosOrfaos(chavesVivas){
  Object.keys(GRAFICOS).forEach(function(k){
    if(chavesVivas.indexOf(k)===-1){clearInterval(GRAFICOS[k].timer);delete GRAFICOS[k]}
  });
}

// ---- processos ----
var ICONE_PROCESSO={
  'Vigilância':'ic-radar','Custódia':'ic-shield','Motor':'ic-cog','Dashboard':'ic-terminal',
  'Coletor':'ic-clock','Modo Agressivo':'ic-flask','Preenchimento':'ic-scale','Pares':'ic-nodes'
};
function renderProcessos(d){
  var procs=d.processos||[];
  renderIfChanged('processos',procs,function(){
    var html=procs.map(function(p){
      var uptime=p.vivo&&p.desde?diasDesde(p.desde):'—';
      return '<div class="proc '+(p.vivo?'vivo':'morto')+'">'+
        '<div class="row"><span class="led '+(p.vivo?'on':'off')+'"></span><span class="nome">'+esc(p.nome)+'</span></div>'+
        '<div class="info">'+(p.vivo?('há '+uptime+' · '+(p.memoriaMB||0)+' MB'):'não detectado')+'</div>'+
        '</div>';
    }).join('');
    var g1=el('procgrid'); if(g1)g1.innerHTML=html;
    var g2=el('procgrid-2'); if(g2)g2.innerHTML=html;
  });
  var wd=d.watchdog||[];
  renderIfChanged('watchdog',wd,function(){
    el('wdlog').innerHTML=wd.length ? wd.map(function(l){return '<div>'+esc(l)+'</div>'}).join('') : '<div style="color:#516a8c">sem eventos registrados ainda</div>';
  });
}

// ---- diagrama de arquitetura (estático, leve) ----
(function(){
  var host=el('arq-diagrama');
  if(!host)return;
  host.innerHTML=
    '<svg viewBox="0 0 900 260" style="width:100%;height:auto;max-height:260px" role="img" aria-label="Vigilância e Custódia alimentam o Motor, que alimenta o Dashboard; Coletor arquiva o histórico; Watchdog supervisiona todos">'+
    '<defs><marker id="arqseta" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0L6,3L0,6Z" fill="#17d9ff"/></marker></defs>'+
    '<g font-family="ui-sans-serif,system-ui" font-size="13" fill="#eef4fb">'+
    '<rect x="20" y="20" width="160" height="52" rx="10" fill="rgba(23,217,255,.08)" stroke="#17d9ff" stroke-width="1.2"/><text x="100" y="51" text-anchor="middle">Vigilância</text>'+
    '<rect x="20" y="188" width="160" height="52" rx="10" fill="rgba(139,108,242,.08)" stroke="#8b6cf2" stroke-width="1.2"/><text x="100" y="219" text-anchor="middle">Custódia</text>'+
    '<rect x="370" y="104" width="160" height="52" rx="10" fill="rgba(54,227,160,.08)" stroke="#36e3a0" stroke-width="1.2"/><text x="450" y="135" text-anchor="middle">Motor + Pares</text>'+
    '<rect x="720" y="104" width="160" height="52" rx="10" fill="rgba(255,200,87,.08)" stroke="#ffc857" stroke-width="1.2"/><text x="800" y="135" text-anchor="middle">Dashboard</text>'+
    '<rect x="370" y="20" width="160" height="52" rx="10" fill="rgba(255,92,122,.06)" stroke="#ff5c7a" stroke-width="1.2"/><text x="450" y="51" text-anchor="middle">Coletor → histórico</text>'+
    '<rect x="370" y="188" width="160" height="52" rx="10" fill="rgba(117,232,255,.06)" stroke="#75e8ff" stroke-width="1.2"/><text x="450" y="219" text-anchor="middle">Watchdog → todos</text>'+
    '<path d="M180,46L370,127" stroke="#17d9ff" stroke-width="1.4" fill="none" marker-end="url(#arqseta)" opacity=".7"/>'+
    '<path d="M180,214L370,133" stroke="#8b6cf2" stroke-width="1.4" fill="none" marker-end="url(#arqseta)" opacity=".7"/>'+
    '<path d="M530,130L720,130" stroke="#36e3a0" stroke-width="1.4" fill="none" marker-end="url(#arqseta)" opacity=".7"/>'+
    '</g></svg>';
})();

// ---- posições abertas (operações) — com gráfico de candle ----
var ultimoPreco={};
function flashClass(key,val){
  if(val==null)return '';
  var ant=ultimoPreco[key];
  ultimoPreco[key]=val;
  if(ant==null||ant===val)return '';
  return val>ant?'flash-up':'flash-down';
}
setInterval(function(){
  document.querySelectorAll('.flash-up,.flash-down').forEach(function(n){n.classList.remove('flash-up');n.classList.remove('flash-down')});
},900);

function iconeVazio(){
  return '<svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><use href="#ic-radar"/></svg>';
}
function renderPosicoes(d){
  var pos=d.posicoes||[];
  el('pos-tag').textContent=pos.length?(pos.length+' aberta'+(pos.length>1?'s':'')):'nenhuma';
  var host=el('poscards');
  if(!pos.length){
    host.innerHTML='<div class="empty">'+iconeVazio()+'Nenhuma posição aberta agora — o motor está protegendo o capital enquanto aguarda uma oportunidade que pague os próprios custos. Isso é o resultado correto quando o mercado não oferece spread suficiente.</div>';
    host.dataset.count='0';
    limparGraficosOrfaos([]);
    return;
  }
  if(host.dataset.count!==String(pos.length)){
    host.innerHTML=pos.map(function(p,idx){return '<div class="poscard" id="poscard-'+idx+'"></div>'}).join('');
    host.dataset.count=String(pos.length);
  }
  var chaves=[];
  pos.forEach(function(p,idx){
    var distMin=p.distanciaMinima;
    var corGauge=distMin>0.08?'#17d9ff':(distMin>0.03?'#ffc857':'#ff5c7a');
    var pctGauge=Math.max(2,Math.min(100,(distMin/0.15)*100));
    var badge=distMin>0.08?'ok':(distMin>0.03?'warn':'bad');
    var keyS='p'+idx+'s', keyL='p'+idx+'l';
    var card=el('poscard-'+idx);
    if(!card.dataset.built){
      card.innerHTML=
        '<div class="top"><span class="sym"></span><span class="badge"></span></div>'+
        '<div class="legs">'+
          '<div class="leg"><div class="exid"></div><div class="price" id="'+keyS+'">—</div></div>'+
          '<div class="leg"><div class="exid"></div><div class="price" id="'+keyL+'">—</div></div>'+
        '</div>'+
        '<div class="gauge"><i></i></div>'+
        '<div class="meta"><span class="m-dist"></span><span class="m-aberta"></span></div>'+
        '<div class="candle-slot" id="candle-slot-'+idx+'"></div>';
      card.dataset.built='1';
    }
    card.querySelector('.sym').textContent=(p.symbol||'').replace('/USDT:USDT','');
    var badgeEl=card.querySelector('.badge'); badgeEl.className='badge '+badge; badgeEl.textContent='risco: '+(p.pernaEmRisco||'—');
    var exidEls=card.querySelectorAll('.exid');
    exidEls[0].textContent='short · '+(p.exchangeShort||'');
    exidEls[1].textContent='long · '+(p.exchangeLong||'');
    var priceS=el(keyS), priceL=el(keyL);
    var flashS=flashClass(keyS,p.precoAoVivoShort), flashL=flashClass(keyL,p.precoAoVivoLong);
    priceS.textContent=p.precoAoVivoShort?fmtUsd(p.precoAoVivoShort):'—';
    priceL.textContent=p.precoAoVivoLong?fmtUsd(p.precoAoVivoLong):'—';
    if(flashS)priceS.className='price '+flashS; else priceS.className='price';
    if(flashL)priceL.className='price '+flashL; else priceL.className='price';
    var gaugeI=card.querySelector('.gauge i'); gaugeI.style.width=pctGauge+'%'; gaugeI.style.background=corGauge;
    card.querySelector('.m-dist').textContent='distância liq. '+fmtPct(distMin,1);
    card.querySelector('.m-aberta').textContent='aberta há '+fmtHoras(p.horasAberta);

    var chave='n-'+p.symbol+'-'+p.exchangeShort;
    chaves.push(chave);
    garantirGrafico(el('candle-slot-'+idx), chave, p.exchangeShort, p.symbol, '15m', p.precoEntrada, 'short');
  });
  limparGraficosOrfaos(chaves);
}

// ---- ranking de exchanges ----
function renderRanking(d){
  var r=d.rankingExchanges||[];
  renderIfChanged('ranking',r,function(){
    var host=el('ranking-box');
    if(!r.length){host.innerHTML='<div class="empty">sem exchanges configuradas ainda</div>';return}
    var maxAbs=Math.max.apply(null,r.map(function(x){return Math.abs(x.lucro)}).concat([0.01]));
    host.innerHTML='<table><tbody>'+r.map(function(x){
      var pctBar=Math.max(2,Math.min(100,(Math.abs(x.lucro)/maxAbs)*100));
      var cor=x.lucro>=0?'#17d9ff':'#ff5c7a';
      var cls=x.lucro>=0?'up':'down';
      return '<tr><td style="font-weight:800;width:36px">#'+x.posicao+'</td>'+
        '<td style="font-weight:800;text-transform:uppercase">'+esc(x.exchange)+'</td>'+
        '<td style="width:200px"><div class="mini-bar" style="width:150px"><i style="width:'+pctBar+'%;background:'+cor+'"></i></div></td>'+
        '<td class="'+cls+'" style="text-align:right">'+(x.lucro>=0?'+':'')+fmtUsd(x.lucro)+' ('+(x.lucroPct>=0?'+':'')+fmtPct(x.lucroPct,2)+')</td>'+
        '</tr>';
    }).join('')+'</tbody></table>';
  });
}

// ---- ranking de pares de exchange ----
function contarTradesReaisPorPar(operacoes){
  var cont={};
  (operacoes||[]).forEach(function(e){
    if(e.evento!=='abre')return;
    var es=e.exchangeShort||e.short, el2=e.exchangeLong||e.long;
    if(!es||!el2)return;
    var par=[es,el2].sort().join('+');
    cont[par]=(cont[par]||0)+1;
  });
  return cont;
}
function renderRankingPares(d){
  var r=d.rankingPares||[];
  var ops=d.operacoes||[];
  renderIfChanged('pares',{r:r,ops:ops},function(){
    el('pares-tag').textContent=r.length+' pares com amostra suficiente';
    var host=el('pares-body');
    if(!r.length){host.innerHTML='<tr><td colspan="8" style="color:var(--faint);text-align:center;padding:20px">vigilância ainda não tem amostra suficiente pra nenhum par</td></tr>';return}
    var trades=contarTradesReaisPorPar(ops);
    var maxFolga=Math.max.apply(null,r.map(function(x){return x.folga}).concat([0.01]));
    host.innerHTML=r.map(function(x,idx){
      var par=x.exchangeA+'+'+x.exchangeB;
      var nTrades=trades[par]||0;
      var pctBar=Math.max(2,Math.min(100,(x.folga/maxFolga)*100));
      var cor=idx===0?'#17d9ff':(x.folga>=0.05?'#ffc857':'#8ea3c2');
      return '<tr>'+
        '<td style="font-weight:800;text-transform:uppercase">'+(idx===0?'★ ':'')+esc(x.exchangeA)+' + '+esc(x.exchangeB)+'</td>'+
        '<td>'+fmtNum(x.amostra)+' ciclos</td>'+
        '<td>'+fmtPct(x.taxaCombinada,3)+'</td>'+
        '<td>'+fmtPct(x.spreadMedio,4)+'</td>'+
        '<td>'+fmtHoras(x.vidaEsperadaHoras)+'</td>'+
        '<td>'+fmtHoras(x.paybackHoras)+'</td>'+
        '<td>'+x.folga.toFixed(2)+'<span class="mini-bar"><i style="width:'+pctBar+'%;background:'+cor+'"></i></span></td>'+
        '<td'+(nTrades?' class="up"':'')+'>'+(nTrades||'—')+'</td>'+
        '</tr>';
    }).join('');
  });
}

// ---- medição de preenchimento maker (item B6) ----
function renderPreenchimento(d){
  var p=d.preenchimento;
  renderIfChanged('preench',p,function(){
    var host=el('preench-box');
    if(!p||!p.geral||!p.geral.amostras){
      el('preench-tag').textContent='';
      host.innerHTML='<div class="empty">monitor ainda coletando — sem amostra suficiente ainda</div>';
      return;
    }
    el('preench-tag').textContent=p.geral.amostras+' amostras';
    var linha=function(nome,s){
      if(!s||!s.amostras)return '<tr><td>'+nome+'</td><td colspan="4" style="color:var(--faint)">sem amostra</td></tr>';
      var tempo=s.msParaEncherMediana!=null?fmtHoras(s.msParaEncherMediana/3_600_000):'—';
      var reacao=s.retornoPosPreenchimentoMedio!=null?fmtPct(s.retornoPosPreenchimentoMedio,3):'—';
      var favoravel=s.fracaoFavoravel!=null?fmtPct(s.fracaoFavoravel,0):'—';
      return '<tr>'+
        '<td style="font-weight:700">'+nome+'</td>'+
        '<td>'+fmtNum(s.amostras)+'</td>'+
        '<td>'+fmtPct(s.taxaPreenchimento,0)+'</td>'+
        '<td>'+tempo+'</td>'+
        '<td'+(s.retornoPosPreenchimentoMedio>0?' class="down"':' class="up"')+'>'+reacao+'</td>'+
        '<td>'+favoravel+'</td>'+
        '</tr>';
    };
    host.innerHTML='<div style="overflow-x:auto"><table>'+
      '<thead><tr><th>Perna</th><th>Amostras</th><th>Taxa de preenchimento</th><th>Tempo mediano</th><th>Reação pós-preenchimento</th><th>% favorável</th></tr></thead>'+
      '<tbody>'+linha('geral',p.geral)+linha('venda (perna short)',p.venda)+linha('compra (perna long)',p.compra)+'</tbody>'+
      '</table></div>'+
      '<p class="caption" style="margin-top:10px">Reação positiva = o preço continuou na direção que favoreceu quem negociou com a gente (seleção adversa). Com poucas amostras, nenhum destes números ainda vale decisão — mesma regra da vigilância: cautela até acumular horas de dado real.</p>';
  });
}

// ---- motor de pares cointegrados (resumo leve — sem candle chart por posição) ----
function renderPares(d){
  var p=d.pares;
  renderIfChanged('coint',p,function(){
    var host=el('coint-box');
    if(!p){
      el('coint-tag').textContent='';
      host.innerHTML='<div class="empty">motor de pares ainda não gravou estado — deve estar no primeiro ciclo (recalibração inicial demora ~30s)</div>';
      return;
    }
    el('coint-tag').textContent=fmtUsd(p.capital)+' · '+p.paresCalibrados+' pares calibrados';
    var variacao=p.capitalInicial?((p.capital-p.capitalInicial)/p.capitalInicial):0;
    var pos=p.posicoesAbertas||[];
    var kpis='<div class="kpis" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">'+
      '<div class="kpi"><div class="lbl">Capital</div><div class="val num '+(variacao>=0?'up':'down')+'">'+fmtUsd(p.capital)+'</div><div class="sub">'+(variacao>=0?'+':'')+fmtPct(variacao,2)+' desde o início</div></div>'+
      '<div class="kpi"><div class="lbl">Posições abertas</div><div class="val num">'+pos.length+'</div><div class="sub">de '+p.paresCalibrados+' pares calibrados</div></div>'+
      '<div class="kpi"><div class="lbl">Trades fechados</div><div class="val num">'+fmtNum(p.fechados||0)+'</div><div class="sub">'+(p.taxaVitoria!=null?fmtPct(p.taxaVitoria,0)+' de vitórias':'sem trades ainda')+'</div></div>'+
      '<div class="kpi"><div class="lbl">Custos pagos</div><div class="val num">'+fmtUsd(p.custosTotal||0)+'</div><div class="sub">taxas + slippage acumulados</div></div>'+
      '</div>';
    if(p.halted){
      kpis='<div class="empty" style="border-color:var(--danger);color:var(--danger);margin-bottom:14px">motor pausado: '+esc(p.haltReason||'')+'</div>'+kpis;
    }
    var tabelaPos=!pos.length?'<div class="empty">nenhuma posição aberta agora — nenhum dos pares calibrados cruzou o z-score de entrada</div>':
      '<div style="overflow-x:auto"><table><thead><tr><th>Par</th><th>Direção</th><th>Z entrada</th><th>Aberta há</th></tr></thead><tbody>'+
      pos.map(function(x){
        var nomeA=(x.a||'').replace('/USDT:USDT',''), nomeB=(x.b||'').replace('/USDT:USDT','');
        var desc=x.direcao==='curtoA'?('venda '+nomeA+' / compra '+nomeB):('compra '+nomeA+' / venda '+nomeB);
        return '<tr><td style="font-weight:700">'+esc(nomeA)+' / '+esc(nomeB)+'</td><td>'+esc(desc)+'</td><td class="num">'+x.zEntrada.toFixed(2)+'</td><td>'+fmtHoras(x.horasAberta)+'</td></tr>';
      }).join('')+'</tbody></table></div>';
    host.innerHTML=kpis+tabelaPos;
  });
}

// ---- modo agressivo (resumo leve) ----
function renderAgressivoResumo(d){
  var procs=d.processos||[];
  var proc=procs.filter(function(p){return p.nome==='Modo Agressivo'})[0];
  renderIfChanged('agressivo-resumo',proc,function(){
    el('agressivo-tag').textContent=proc&&proc.vivo?'processo vivo':'processo não detectado';
    var host=el('agressivo-box');
    host.innerHTML='<p class="caption" style="margin:0">ts-momentum multi-ativo, a única de 7 famílias de estratégia testadas neste projeto que sobreviveu a holdout cego (p=0,008 — Resultado 6/10). Bootstrap por blocos mede ~9-13% de chance de bater a meta em anos, ~15-45% de chance de perder o capital — não é lucro garantido em nenhum prazo. Estado detalhado fica só no backend (<code>momentum/diario.jsonl</code>) — foi tirado do painel porque 40 posições com candle chart cada uma deixavam esta seção lenta.</p>';
  });
}

// ---- tabela estática de famílias de estratégia (dados de docs/RESULTADOS.md) ----
var FAMILIAS_ESTRATEGIA=[
  {fam:'Arbitragem de funding (cross-exchange)',achado:'—',holdout:'—',custo:'✅ em produção (paper)',status:'producao'},
  {fam:'Direcional cripto (múltiplos timeframes)',achado:'body-breakout, 4h',holdout:'⚠ parcial',custo:'❌ não sobrevive a custo taker',status:'descartada'},
  {fam:'Direcional ações',achado:'momentum-breakout, 1h',holdout:'⚠ parcial',custo:'—',status:'parcial'},
  {fam:'Time-series momentum (cripto, 1d)',achado:'+0,049R',holdout:'✅ p=0,008',custo:'⚠ fraco isolado',status:'validada'},
  {fam:'Pares cointegrados (cripto, 1d)',achado:'+0,014/trade',holdout:'✅ após 2 correções',custo:'⚠ só a baixa alavancagem',status:'validada'},
  {fam:'Momentum + pares (portfólio misto)',achado:'~9-12% chance de sucesso',holdout:'✅',custo:'✅ em produção (paper)',status:'producao'},
  {fam:'Basis trade (spot+perp)',achado:'−0,249%/ciclo',holdout:'—',custo:'❌ estrutural',status:'descartada'},
  {fam:'Captura de liquidação',achado:'—',holdout:'—',custo:'❌ 0 operações no dado real',status:'descartada'}
];
(function(){
  var host=el('estrategias-body');
  if(!host)return;
  var rotulo={producao:'produção paper',validada:'validada',parcial:'parcial',descartada:'descartada',pesquisa:'pesquisa'};
  host.innerHTML=FAMILIAS_ESTRATEGIA.map(function(f){
    return '<tr><td style="font-weight:700">'+esc(f.fam)+'</td><td>'+esc(f.achado)+'</td><td>'+esc(f.holdout)+'</td><td>'+esc(f.custo)+'</td>'+
      '<td><span class="strat-badge '+f.status+'">'+esc(rotulo[f.status])+'</span></td></tr>';
  }).join('');
})();

// ---- oportunidades: busca + filtro + ordenação (client-side, dataset pequeno) ----
var scanEstado={busca:'',filtro:'todos',ordCol:'pctDoCaminho',ordDir:-1};
function renderScan(d){
  var scanBruto=(d.scan||[]);
  el('scan-tag').textContent=(d.vigilancia?d.vigilancia.fonte:'') + (d.idadeVarreduraMin!=null&&d.idadeVarreduraMin>=0?' · dado de '+d.idadeVarreduraMin+' min':'');
  window._scanBruto=scanBruto;
  aplicarFiltroScan();
}
function aplicarFiltroScan(){
  var scan=(window._scanBruto||[]).slice();
  var termo=scanEstado.busca.toLowerCase();
  if(termo){
    scan=scan.filter(function(o){
      var alvo=((o.symbol||'')+' '+(o.exchangeShort||'')+' '+(o.exchangeLong||'')).toLowerCase();
      return alvo.indexOf(termo)!==-1;
    });
  }
  if(scanEstado.filtro==='passa')scan=scan.filter(function(o){return o.passaPortao});
  if(scanEstado.filtro==='barra')scan=scan.filter(function(o){return !o.passaPortao});
  var col=scanEstado.ordCol,dir=scanEstado.ordDir;
  scan.sort(function(a,b){return ((b[col]||0)-(a[col]||0))*dir});
  renderIfChanged('scan',{scan:scan,estado:scanEstado},function(){
    var body=el('scan-body');
    if(!scan.length){body.innerHTML='<tr><td colspan="9" style="color:var(--faint);text-align:center;padding:20px">sem candidatos que batam com o filtro</td></tr>';return}
    body.innerHTML=scan.map(function(o){
      var pct=Math.max(0,Math.min(100,o.pctDoCaminho||0));
      var corBar=o.passaPortao?'#17d9ff':(pct>60?'#ffc857':'#ff5c7a');
      return '<tr>'+
        '<td>'+esc((o.symbol||'').replace('/USDT:USDT',''))+'</td>'+
        '<td>'+esc(o.exchangeShort)+' → '+esc(o.exchangeLong)+'</td>'+
        '<td>'+fmtPct(o.spread,3)+'</td>'+
        '<td>'+fmtPct((o.apr||0)/100,1)+'</td>'+
        '<td>'+fmtPct(o.consistencia,0)+'</td>'+
        '<td>'+fmtHoras(o.vidaEsperadaHoras)+'</td>'+
        '<td>'+fmtHoras(o.paybackHoras)+'</td>'+
        '<td>'+pct.toFixed(0)+'%<span class="mini-bar"><i style="width:'+pct+'%;background:'+corBar+'"></i></span></td>'+
        '<td><span class="badge '+(o.passaPortao?'ok':'bad')+'">'+(o.passaPortao?'passa':'barra')+'</span></td>'+
        '</tr>';
    }).join('');
  });
}
(function(){
  var busca=el('scan-busca'), filtro=el('scan-filtro');
  if(!busca)return;
  var deb=null;
  busca.addEventListener('input',function(){
    clearTimeout(deb);
    deb=setTimeout(function(){scanEstado.busca=busca.value;aplicarFiltroScan()},180);
  });
  filtro.addEventListener('change',function(){scanEstado.filtro=filtro.value;aplicarFiltroScan()});
  document.querySelectorAll('#scan-table th.sortable').forEach(function(th){
    th.addEventListener('click',function(){
      var col=th.getAttribute('data-col');
      if(scanEstado.ordCol===col)scanEstado.ordDir*=-1; else {scanEstado.ordCol=col;scanEstado.ordDir=-1}
      aplicarFiltroScan();
    });
  });
})();

// ---- mercado (grade de preços ao vivo) ----
function renderMercado(d){
  var itens=[];
  (d.posicoes||[]).forEach(function(p){
    if(p.precoAoVivoShort)itens.push({sym:(p.symbol||'').replace('/USDT:USDT','')+' · '+p.exchangeShort,px:p.precoAoVivoShort});
    if(p.precoAoVivoLong)itens.push({sym:(p.symbol||'').replace('/USDT:USDT','')+' · '+p.exchangeLong,px:p.precoAoVivoLong});
  });
  (d.scan||[]).slice(0,15).forEach(function(o){
    if(o.precoShortAoVivo)itens.push({sym:(o.symbol||'').replace('/USDT:USDT','')+' · '+o.exchangeShort,px:o.precoShortAoVivo});
  });
  renderIfChanged('mercado',itens,function(){
    var host=el('mercado-grid');
    if(!itens.length){host.innerHTML='<div class="empty" style="grid-column:1/-1">sem preços ao vivo ainda</div>';return}
    host.innerHTML=itens.map(function(i){
      return '<div class="proc vivo"><div class="nome">'+esc(i.sym)+'</div><div class="info num">'+fmtUsd(i.px)+'</div></div>';
    }).join('');
  });
}

// ---- custódia ----
function renderCustodia(d){
  var c=d.custodia||{saude:{}};
  renderIfChanged('custodia',c,function(){
    var host=el('custodia-grid');
    var ids=Object.keys(c.saude||{});
    if(!ids.length){host.innerHTML='<div class="empty">sem dado de custódia ainda</div>';return}
    var corNivel={ok:'#17d9ff',atencao:'#ffc857',alerta:'#ff5c7a',critico:'#ff5c7a',desconhecido:'#516a8c'};
    host.innerHTML=ids.map(function(id){
      var s=c.saude[id];
      var cor=corNivel[s.nivel]||'#516a8c';
      return '<div class="hchip"><div class="nm"><span class="led" style="background:'+cor+';box-shadow:none;position:static;animation:none"></span>'+esc(id)+'</div>'+
        '<div class="dt">'+esc(s.detalhe||s.nivel)+'</div></div>';
    }).join('');
  });
}

// ---- coleta ----
function renderColeta(d){
  var c=d.coleta;
  renderIfChanged('coleta',c,function(){
    var host=el('coleta-box');
    if(!c){host.innerHTML='<div class="empty">coletor ainda não escreveu estado</div>';return}
    host.innerHTML=
      '<div class="exprow"><span>Observações</span><span>'+fmtNum(c.totalObservacoes)+'</span></div>'+
      '<div class="exprow"><span>Ciclos</span><span>'+fmtNum(c.totalCiclos)+'</span></div>'+
      '<div class="exprow"><span>Registros de custódia</span><span>'+fmtNum(c.totalCustodia)+'</span></div>'+
      '<div class="exprow"><span>Coletando há</span><span>'+(c.coletandoDesde?diasDesde(c.coletandoDesde):'—')+'</span></div>';
  });
}

// ---- ML ----
function renderMl(d){
  var m=d.ml||{confiaveis:0,positivos:0,minimoNecessario:30};
  renderIfChanged('ml',m,function(){
    var pct=Math.min(100,(m.positivos/Math.max(1,m.minimoNecessario))*100);
    el('ml-box').innerHTML=
      '<div class="exprow"><span>Ciclos confiáveis</span><span>'+fmtNum(m.confiaveis)+'</span></div>'+
      '<div class="exprow"><span>Exemplos positivos</span><span>'+fmtNum(m.positivos)+' / '+fmtNum(m.minimoNecessario)+'</span></div>'+
      '<div class="progress-readiness"><i style="width:'+pct+'%"></i></div>'+
      '<div style="font-size:.7rem;color:var(--faint);margin-top:6px" class="num">'+(pct>=100?'pronto para treinar':pct.toFixed(0)+'% do mínimo para treinar')+'</div>';
  });
}

// ---- saúde do dashboard: memória e caches ----
var memoriaAnterior=null;
function renderDiag(d){
  var g=d.diagnostico;
  if(!g)return;
  renderIfChanged('diag',g,function(){
    var tendencia='';
    if(memoriaAnterior!=null&&g.memoriaRssMB>memoriaAnterior){
      tendencia=' <span class="down" style="font-size:.68rem">(subindo — normal logo após reiniciar, preocupante se não parar)</span>';
    }
    memoriaAnterior=g.memoriaRssMB;
    el('diag-box').innerHTML=
      '<div class="exprow"><span>Memória (RSS)</span><span class="num">'+g.memoriaRssMB+' MB'+tendencia+'</span></div>'+
      '<div class="exprow"><span>Conexões SSE abertas</span><span class="num">'+g.clientesSSE+'</span></div>'+
      '<div class="exprow"><span>Candles em cache</span><span class="num">'+g.cacheCandlesEntradas+'</span></div>'+
      '<div class="exprow"><span>Preços ao vivo rastreados</span><span class="num">'+g.precosAoVivoEntradas+'</span></div>';
  });
}

// ---- basis ----
function renderBasis(d){
  var b=d.basis||{vivas:0,fechadas:0,duracaoMedianaHoras:0,duracaoMaximaHoras:0,top:[]};
  renderIfChanged('basis',b,function(){
    var out='<div class="kpis" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">'+
      '<div class="kpi"><div class="lbl">Vivos</div><div class="val">'+fmtNum(b.vivas)+'</div></div>'+
      '<div class="kpi"><div class="lbl">Fechados</div><div class="val">'+fmtNum(b.fechadas)+'</div></div>'+
      '<div class="kpi"><div class="lbl">Duração mediana</div><div class="val" style="font-size:1.1rem">'+fmtHoras(b.duracaoMedianaHoras)+'</div></div>'+
      '</div>';
    if(b.top&&b.top.length){
      out+='<table><thead><tr><th>Par</th><th>Exchange</th><th>APR</th><th>Observações</th><th>Vivo há</th></tr></thead><tbody>'+
        b.top.map(function(t){
          return '<tr><td>'+esc((t.symbol||'').replace('/USDT:USDT',''))+'</td><td>'+esc(t.exchange)+'</td>'+
            '<td>'+fmtPct((t.apr||0)/100,1)+'</td><td>'+fmtNum(t.observacoes)+'</td><td>'+fmtHoras(t.horasVivo)+'</td></tr>';
        }).join('')+'</tbody></table>';
    }
    el('basis-box').innerHTML=out;
  });
}

// ---- timeline de decisões ----
var corEvento={
  abertura:'#17d9ff','abre':'#17d9ff', fechamento:'#ff5c7a','fecha':'#ff5c7a',
  bloqueado:'#516a8c', funding:'#168cff', transferencia:'#168cff', reinvestimento:'#ffc857', socorre:'#ffc857', escalona:'#8b6cf2'
};
function renderTimeline(d){
  var itens=(d.diario||[]).slice(0,60);
  renderIfChanged('timeline',itens,function(){
    var host=el('timeline');
    if(!itens.length){host.innerHTML='<div class="empty">sem eventos ainda</div>';return}
    host.innerHTML=itens.map(function(e){
      var cor=corEvento[e.evento]||'#516a8c';
      var titulo=(e.evento||'evento')+(e.symbol?' · '+e.symbol.replace('/USDT:USDT',''):'');
      return '<div class="tl-item"><span class="tl-dot" style="background:'+cor+'"></span>'+
        '<div class="tl-body"><b>'+esc(titulo)+'</b><div class="motivo">'+esc(e.motivo||'')+'</div></div>'+
        '<div class="tl-time">'+timeAgo(e.ts)+'</div></div>';
    }).join('');
  });
}

// ---- de onde veio o dinheiro (ponte/waterfall) ----
function categoriaOperacao(e){
  if(e.evento==='funding')return {cat:'ganhou',valor:e.ganho||0};
  if(e.evento==='abre')return {cat:'investiu',valor:e.custo||0};
  if(e.evento==='escalona')return {cat:'investiu',valor:e.custo||0};
  if(e.evento==='reinveste')return {cat:'investiu',valor:e.custo||0};
  if(e.evento==='fecha')return {cat:'perdeu',valor:e.custo||0};
  if(e.evento==='socorre')return {cat:'socorreu',valor:e.valor||0};
  return null;
}
function narrativaFluxo(e){
  var at=(e.symbol||'').replace('/USDT:USDT','');
  if(e.evento==='funding')return 'Veio do funding pago pela exchange entre comprados e vendidos em '+at+' — pagamento contratual a cada ~8h, não uma aposta de preço.';
  if(e.evento==='abre')return 'Foi pra taxa de abrir as duas pernas em '+at+' (2 exchanges × entrada) — o pedágio pra montar a posição.';
  if(e.evento==='escalona')return 'Foi pra taxa de escalonar '+at+' pro tamanho cheio, depois de provar 1,5x o payback exigido.';
  if(e.evento==='reinveste')return 'Funding já recebido foi reinvestido como notional extra na posição, em vez de ficar parado como caixa ocioso.';
  if(e.evento==='fecha')return 'Foi pra taxa de fechar '+at+' · motivo: '+(e.motivo||'—');
  if(e.evento==='socorre')return 'Reforço interno em '+(e.exchange||'—')+': saldo livre virou margem na MESMA conta, pra afastar a posição da liquidação. Sem custo, sem transferência entre exchanges.';
  return '';
}
var CAT_INFO={
  ganhou:{cor:'#36e3a0',label:'Ganhou'},
  investiu:{cor:'#168cff',label:'Investiu'},
  perdeu:{cor:'#ff5c7a',label:'Perdeu'},
  socorreu:{cor:'#ffc857',label:'Socorreu'}
};
function computeFluxo(operacoes){
  var tot={ganhou:0,investiu:0,perdeu:0,socorreu:0};
  var itens=[];
  (operacoes||[]).forEach(function(e){
    var c=categoriaOperacao(e);
    if(!c)return;
    tot[c.cat]+=c.valor;
    itens.push({e:e,cat:c.cat,valor:c.valor});
  });
  return {tot:tot,itens:itens};
}
function desenharPonte(svgEl, passos){
  if(!svgEl)return;
  if(!passos.length){svgEl.innerHTML='';return}
  var W=1000,H=260,padT=40,padB=46,padX=18;
  var vals=[0];
  passos.forEach(function(p){vals.push(p.tipo==='total'?p.valor:p.de,p.tipo==='total'?p.valor:p.para)});
  var lo=Math.min.apply(null,vals),hi=Math.max.apply(null,vals);
  var folga=(hi-lo)*0.18||Math.abs(hi)*0.1||1; lo-=folga; hi+=folga;
  var n=passos.length;
  var colW=(W-2*padX)/n;
  function Y(v){return padT+(H-padT-padB)*(1-(v-lo)/(hi-lo))}
  var baseY=Y(0);
  var out=[];
  out.push('<line x1="'+padX+'" y1="'+baseY.toFixed(1)+'" x2="'+(W-padX)+'" y2="'+baseY.toFixed(1)+'" stroke="rgba(117,232,255,.1)"/>');
  passos.forEach(function(p,idx){
    var x=padX+idx*colW+colW*0.16;
    var bw=colW*0.68;
    var y1,y2;
    if(p.tipo==='total'){y1=baseY;y2=Y(p.valor)}
    else {y1=Y(p.de);y2=Y(p.para)}
    var top=Math.min(y1,y2), h=Math.max(2,Math.abs(y2-y1));
    out.push('<rect x="'+x.toFixed(1)+'" y="'+top.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="6" fill="'+p.cor+'" style="animation:candleIn .5s ease both;animation-delay:'+(idx*70)+'ms"/>');
    var valorMostrado=p.tipo==='total'?p.valor:(p.para-p.de);
    var labelTop=Math.min(y1,y2)-10;
    out.push('<text x="'+(x+bw/2).toFixed(1)+'" y="'+labelTop.toFixed(1)+'" text-anchor="middle" font-size="13" font-weight="700" fill="'+p.cor+'" font-family="ui-monospace,monospace">'+(p.tipo==='delta'&&valorMostrado>=0?'+':'')+fmtUsd(Math.abs(valorMostrado)).replace('US$ ','')+'</text>');
    out.push('<text x="'+(x+bw/2).toFixed(1)+'" y="'+(H-padB+18)+'" text-anchor="middle" font-size="12" fill="#8ea3c2">'+esc(p.label)+'</text>');
    if(idx<n-1){
      var nx=padX+(idx+1)*colW+colW*0.16;
      out.push('<line x1="'+(x+bw).toFixed(1)+'" y1="'+y2.toFixed(1)+'" x2="'+nx.toFixed(1)+'" y2="'+y2.toFixed(1)+'" stroke="rgba(255,255,255,.22)" stroke-dasharray="4,4"/>');
    }
  });
  svgEl.innerHTML=out.join('');
}

// ---- o mesmo fluxo, quebrado por exchange ----
function mapaExchangesPorSimbolo(operacoes){
  var mapa={};
  (operacoes||[]).forEach(function(e){
    if(e.evento==='abre'&&e.symbol){
      var es=e.exchangeShort||e.short, el2=e.exchangeLong||e.long;
      if(es&&el2&&!mapa[e.symbol]) mapa[e.symbol]={short:es,long:el2};
    }
  });
  return mapa;
}
function exchangesDoEvento(e,mapa){
  var es=e.exchangeShort||e.short, el2=e.exchangeLong||e.long;
  if(es&&el2)return {short:es,long:el2};
  var m=mapa[e.symbol];
  return m||null;
}
function agregarPorExchange(operacoes){
  var mapa=mapaExchangesPorSimbolo(operacoes);
  var por={};
  function add(ex,cat,valor){
    if(!ex)return;
    if(!por[ex])por[ex]={ganhou:0,investiu:0,perdeu:0,socorreu:0};
    por[ex][cat]+=valor;
  }
  (operacoes||[]).forEach(function(e){
    if(e.evento==='socorre'){ add(e.exchange,'socorreu',e.valor||0); return; }
    var c=categoriaOperacao(e);
    if(!c)return;
    var exs=exchangesDoEvento(e,mapa);
    if(!exs)return;
    add(exs.short,c.cat,c.valor/2);
    add(exs.long,c.cat,c.valor/2);
  });
  return por;
}
function renderFluxoPorExchange(d){
  var ops=d.operacoes||[];
  var contas=d.contas||[];
  renderIfChanged('fluxo-ex',{ops:ops,contas:contas},function(){
    var por=agregarPorExchange(ops);
    var host=el('fluxo-ex-body');
    if(!contas.length){host.innerHTML='<tr><td colspan="6" style="color:var(--faint);text-align:center;padding:20px">sem contas ainda</td></tr>';return}
    host.innerHTML=contas.map(function(c){
      var f=por[c.exchange]||{ganhou:0,investiu:0,perdeu:0,socorreu:0};
      function cel(v,cor){return '<td style="color:'+cor+'">'+(v?fmtUsd(v):'—')+'</td>'}
      return '<tr><td style="font-weight:800;text-transform:uppercase">'+esc(c.exchange)+'</td>'+
        '<td class="num">'+fmtUsd(c.saldo)+'</td>'+
        cel(f.ganhou,CAT_INFO.ganhou.cor)+
        cel(f.investiu,CAT_INFO.investiu.cor)+
        cel(f.perdeu,CAT_INFO.perdeu.cor)+
        cel(f.socorreu,CAT_INFO.socorreu.cor)+
        '</tr>';
    }).join('');
  });
}

function renderFluxo(d){
  var ops=d.operacoes||[];
  var e=d.estado||{};
  var capIni=e.capitalInicial||0;
  var capAtual=e.capital!=null?e.capital:capIni;
  renderIfChanged('fluxo',ops,function(){
    var f=computeFluxo(ops);
    var passos=[
      {tipo:'total',label:'Capital inicial',valor:capIni,cor:'#8ea3c2'},
      {tipo:'delta',label:'Ganhou',de:capIni,para:capIni+f.tot.ganhou,cor:CAT_INFO.ganhou.cor},
      {tipo:'delta',label:'Investiu',de:capIni+f.tot.ganhou,para:capIni+f.tot.ganhou-f.tot.investiu,cor:CAT_INFO.investiu.cor},
      {tipo:'delta',label:'Perdeu',de:capIni+f.tot.ganhou-f.tot.investiu,para:capIni+f.tot.ganhou-f.tot.investiu-f.tot.perdeu,cor:CAT_INFO.perdeu.cor},
      {tipo:'total',label:'Capital atual',valor:capAtual,cor:'#8ea3c2'}
    ];
    desenharPonte(el('svg-fluxo'),passos);

    var kHost=el('fluxo-kpis');
    var itensK=[
      {lbl:'Ganhou · funding',val:f.tot.ganhou,cor:CAT_INFO.ganhou.cor},
      {lbl:'Investiu · abrir/escalonar',val:f.tot.investiu,cor:CAT_INFO.investiu.cor},
      {lbl:'Perdeu · custo de fechar',val:f.tot.perdeu,cor:CAT_INFO.perdeu.cor},
      {lbl:'Socorreu · realocação interna',val:f.tot.socorreu,cor:CAT_INFO.socorreu.cor}
    ];
    kHost.innerHTML=itensK.map(function(it){
      return '<div class="kpi"><div class="lbl">'+esc(it.lbl)+'</div><div class="val num" style="color:'+it.cor+'">'+fmtUsd(it.val)+'</div></div>';
    }).join('');

    var lHost=el('fluxo-lista');
    if(!f.itens.length){lHost.innerHTML='<div class="empty">sem movimentação de dinheiro ainda</div>';return}
    lHost.innerHTML=f.itens.slice(0,40).map(function(it){
      var info=CAT_INFO[it.cat];
      var sinal=it.cat==='ganhou'?'+':(it.cat==='socorreu'?'↔':'−');
      return '<div class="tl-item"><span class="tl-dot" style="background:'+info.cor+'"></span>'+
        '<div class="tl-body"><b style="color:'+info.cor+'">'+info.label+' '+sinal+fmtUsd(it.valor)+'</b>'+
        '<div class="motivo">'+narrativaFluxo(it.e)+'</div></div>'+
        '<div class="tl-time">'+timeAgo(it.e.ts)+'</div></div>';
    }).join('');
  });
}

// ---- histórico de operações ----
var TIPO_LABEL={abre:'Abriu',fecha:'Fechou',funding:'Funding',reinveste:'Reinveste',escalona:'Escalonou',socorre:'Socorreu'};
function detalheOperacaoNormal(e){
  if(e.evento==='abre'){
    var pct=(e.spread*100).toFixed(4)+'%', aprPct=(e.apr*100).toFixed(1)+'%';
    return 'vendido '+esc(e.exchangeShort||e.short||'—')+' / comprado '+esc(e.exchangeLong||e.long||'—')+
      ' · spread '+pct+' ('+aprPct+' APR) · consistência '+fmtPct(e.consistencia,0)+
      ' · notional '+fmtUsd(e.notional)+'/perna'+(e.estagio===1?' (fatia inicial)':'')+' · custo '+fmtUsd(e.custo);
  }
  if(e.evento==='fecha'){return esc(e.motivo||'—')+' · funding acumulado '+fmtUsd(e.fundingAcumulado)+' · custo de saída '+fmtUsd(e.custo)}
  if(e.evento==='funding'){return 'spread '+fmtPct(e.spread,4)+' · +'+fmtUsd(e.ganho)+' · capital '+fmtUsd(e.capital)}
  if(e.evento==='reinveste'){return '+'+fmtUsd(e.notionalExtra)+'/perna · notional agora '+fmtUsd(e.notionalNovo)+' · custo '+fmtUsd(e.custo)}
  if(e.evento==='escalona'){return 'provou 1,5x o payback · notional +'+fmtUsd(e.notionalAdicionado)+' → '+fmtUsd(e.notionalNovo)+'/perna · custo '+fmtUsd(e.custo)}
  if(e.evento==='socorre'){return 'reforço de '+fmtUsd(e.valor)+' em '+esc(e.exchange)+' · distância era '+fmtPct(e.distanciaLiquidacao,1)+' · preço '+fmtPct(e.variacao,1)+' desde a entrada'}
  return '';
}
function renderOperacoes(d){
  var ops=d.operacoes||[];
  el('ops-tag').textContent=ops.length+' operações registradas';
  renderIfChanged('ops',ops,function(){
    var body=el('ops-body');
    if(!ops.length){body.innerHTML='<tr><td colspan="4" style="color:var(--faint);text-align:center;padding:20px">nenhuma operação real ainda — só bloqueios até agora</td></tr>';return}
    body.innerHTML=ops.map(function(e){
      var cor=corEvento[e.evento]||'#516a8c';
      return '<tr>'+
        '<td class="num" style="font-size:.72rem;white-space:nowrap">'+timeAgo(e.ts)+'</td>'+
        '<td><span class="op-badge" style="color:'+cor+';border:1px solid '+cor+'">'+esc(TIPO_LABEL[e.evento]||e.evento)+'</span></td>'+
        '<td style="font-weight:800">'+esc((e.symbol||'').replace('/USDT:USDT',''))+'</td>'+
        '<td class="op-det">'+detalheOperacaoNormal(e)+'</td>'+
        '</tr>';
    }).join('');
  });
}

// ---- risco: exposição/direção + distância até liquidação consolidada ----
function renderExposicao(d){
  var conc=d.concentracao||{exchange:'—',fracao:0};
  var teto=(d.config&&d.config.tetoPorExchange)||0.4;
  var dreno=d.dreno||{};
  var payload={conc:conc,teto:teto,dreno:dreno,piorDreno:d.piorDreno};
  renderIfChanged('exposicao',payload,function(){
    var estourou=conc.fracao>teto;
    var linhas=Object.keys(dreno).map(function(k){return {ex:k,v:dreno[k]}}).sort(function(a,b){return Math.abs(b.v)-Math.abs(a.v)}).slice(0,5);
    var out=[];
    out.push('<div class="exprow"><span>Maior concentração</span><span class="'+(estourou?'down':'up')+'">'+esc(conc.exchange)+' · '+fmtPct(conc.fracao,1)+' (teto '+fmtPct(teto,0)+')</span></div>');
    out.push('<div class="exprow"><span>Pior dreno direcional</span><span>'+fmtUsd(d.piorDreno||0)+'</span></div>');
    linhas.forEach(function(l){
      out.push('<div class="exprow"><span>'+esc(l.ex)+'</span><span class="'+(l.v>=0?'up':'down')+'">'+fmtUsd(l.v)+'</span></div>');
    });
    if(!linhas.length) out.push('<div class="exprow"><span style="color:var(--faint)">sem posições abertas para medir exposição</span></div>');
    el('exposure').innerHTML=out.join('');
  });
}
function renderRiscoLiquidacao(d){
  var pos=d.posicoes||[];
  renderIfChanged('risco-liq',pos,function(){
    var host=el('risco-liq-box');
    if(!pos.length){host.innerHTML='<div class="empty">sem posições abertas — nada para medir risco de liquidação agora.</div>';return}
    host.innerHTML='<div style="overflow-x:auto"><table><thead><tr><th>Ativo</th><th>Perna em risco</th><th>Distância mínima</th><th>Com reserva</th></tr></thead><tbody>'+
      pos.map(function(p){
        var distMin=p.distanciaMinima;
        var cls=distMin>0.08?'up':(distMin>0.03?'':'down');
        return '<tr><td style="font-weight:700">'+esc((p.symbol||'').replace('/USDT:USDT',''))+'</td>'+
          '<td>'+esc(p.pernaEmRisco||'—')+'</td>'+
          '<td class="'+cls+'">'+fmtPct(distMin,1)+'</td>'+
          '<td>'+fmtPct(p.distanciaComReserva,1)+'</td></tr>';
      }).join('')+'</tbody></table></div>';
  });
}
function renderRiscoTravas(d){
  var e=d.estado||{};
  renderIfChanged('risco-travas',e,function(){
    var host=el('risco-travas-box');
    var itens=[
      {lbl:'Máximo de posições simultâneas',val:(d.config&&d.config.maxPosicoes)||'—',ok:true},
      {lbl:'Teto de concentração por exchange',val:fmtPct((d.config&&d.config.tetoPorExchange)||0.4,0),ok:true},
      {lbl:'Reserva alvo por exchange',val:fmtPct((d.config&&d.config.reserva)||0.3,0),ok:true},
      {lbl:'Margem de payback exigida (folga)',val:(d.config&&d.config.margemPayback||1.5)+'x',ok:true}
    ];
    host.innerHTML='<div class="exprow"><span style="color:var(--faint)">Travas fixas do motor — não são ajustadas dinamicamente por posição, de propósito.</span></div>'+
      itens.map(function(it){return '<div class="exprow"><span>'+esc(it.lbl)+'</span><span class="up">'+esc(String(it.val))+'</span></div>'}).join('');
  });
}

// ---- status ----
function renderStatus(d){
  var v=d.vigilancia||{};
  el('led-vig').className='led '+(v.viva?'on':'off');
  el('txt-vig').textContent=v.viva?('vigilância viva · '+(v.candidatos||0)+' candidatos'):'vigilância caiu';
  el('foot-ts').textContent=new Date(d.atualizadoEm||Date.now()).toLocaleString('pt-BR');
}

// ---- render mestre ----
function render(d){
  renderTicker(d);
  renderKpis(d);
  renderCurva(d);
  renderBarras(d);
  renderRanking(d);
  renderRankingPares(d);
  renderPreenchimento(d);
  renderPares(d);
  renderAgressivoResumo(d);
  renderProcessos(d);
  renderPosicoes(d);
  renderContas(d);
  renderExposicao(d);
  renderRiscoLiquidacao(d);
  renderRiscoTravas(d);
  renderScan(d);
  renderMercado(d);
  renderCustodia(d);
  renderColeta(d);
  renderMl(d);
  renderDiag(d);
  renderBasis(d);
  renderTimeline(d);
  renderOperacoes(d);
  renderFluxo(d);
  renderFluxoPorExchange(d);
  renderStatus(d);
}

// ---- contas ----
function renderContas(d){
  var contas=d.contas||[];
  renderIfChanged('contas',contas,function(){
    var host=el('acct');
    if(!contas.length){host.innerHTML='<div class="empty">sem saldos ainda</div>';return}
    host.innerHTML=contas.map(function(c){
      var pct=Math.min(100,(c.fracaoUsada||0)*100);
      var markPct=c.saldo>0?Math.min(100,(c.alvoReserva/c.saldo)*100):0;
      return '<div class="acctrow">'+
        '<div class="head"><b>'+esc(c.exchange)+'</b><span class="num">'+fmtUsd(c.saldo)+'</span></div>'+
        '<div class="barmeter"><i style="width:'+pct+'%"></i><span class="mark" style="left:'+(100-markPct)+'%"></span></div>'+
        '<div style="display:flex;justify-content:space-between;font-size:.7rem;color:var(--dim);margin-top:5px" class="num">'+
          '<span>margem usada '+fmtUsd(c.margemUsada)+'</span><span>livre '+fmtUsd(c.livre)+'</span></div>'+
        '</div>';
    }).join('');
  });
}

// ---- visualizador de logs ----
(function(){
  var sel=el('log-processo'), busca=el('log-busca'), view=el('log-view');
  var btnSeguir=el('log-seguir'), btnPausar=el('log-pausar'), btnCopiar=el('log-copiar');
  if(!sel)return;
  var seguir=true, pausado=false, linhasAtuais=[], poll=null;
  function pintar(){
    var termo=busca.value.toLowerCase();
    var filtradas=termo?linhasAtuais.filter(function(l){return l.texto.toLowerCase().indexOf(termo)!==-1}):linhasAtuais;
    if(!filtradas.length){view.innerHTML='<div class="log-empty">sem linhas ainda</div>';return}
    view.innerHTML=filtradas.map(function(l){
      return '<div class="log-line'+(l.erro?' erro':'')+'">'+esc(l.texto)+'</div>';
    }).join('');
    if(seguir)view.scrollTop=view.scrollHeight;
  }
  function buscarLog(){
    if(pausado)return;
    fetch('/api/logs?processo='+encodeURIComponent(sel.value)+'&linhas=400')
      .then(function(r){return r.json()})
      .then(function(j){
        if(j&&j.ok){linhasAtuais=j.linhas||[];pintar()}
      }).catch(function(){});
  }
  sel.addEventListener('change',buscarLog);
  busca.addEventListener('input',pintar);
  btnSeguir.addEventListener('click',function(){seguir=!seguir;btnSeguir.classList.toggle('active',seguir)});
  btnPausar.addEventListener('click',function(){
    pausado=!pausado;
    btnPausar.classList.toggle('active',pausado);
    btnPausar.title=pausado?'Retomar':'Pausar polling';
  });
  btnCopiar.addEventListener('click',function(){
    var texto=linhasAtuais.map(function(l){return l.texto}).join('\\n');
    if(navigator.clipboard)navigator.clipboard.writeText(texto).catch(function(){});
  });
  buscarLog();
  poll=setInterval(buscarLog,4000);
  // só busca quando a aba de logs está de fato aberta
  var logTab=document.querySelector('.sb-item[data-tab="logs"]');
  if(logTab)logTab.addEventListener('click',buscarLog);
})();

// ---- relógio (local + UTC) ----
setInterval(function(){
  var agora=new Date();
  var utc=agora.toISOString().slice(11,16);
  el('clock').innerHTML=agora.toLocaleTimeString('pt-BR')+' <span class="utc">· UTC '+utc+'</span>';
},1000);

// ---- documento em segundo plano: pausa animações caras ----
document.addEventListener('visibilitychange',function(){
  PAUSADO=document.hidden;
});

// ---- conexão: SSE com fallback para polling ----
var esConn=null, pollConn=null;
function pararPolling(){if(pollConn){clearInterval(pollConn);pollConn=null}}
function iniciarPolling(){
  pararPolling();
  el('led-stream').className='led mid';
  el('txt-stream').textContent='sondando (sem stream)';
  pollConn=setInterval(function(){
    fetch('/api/dados').then(function(r){return r.json()}).then(render).catch(function(){});
  },5000);
}
function conectar(){
  el('led-stream').className='led mid';
  el('txt-stream').textContent='conectando';
  try{esConn=new EventSource('/api/stream')}catch(e){iniciarPolling();return}
  esConn.onopen=function(){el('led-stream').className='led on';el('txt-stream').textContent='ao vivo'};
  esConn.onmessage=function(ev){pararPolling();try{render(JSON.parse(ev.data))}catch(e){}};
  esConn.onerror=function(){esConn.close();iniciarPolling();setTimeout(conectar,4000)};
}
conectar();
</script>
</body></html>`;
