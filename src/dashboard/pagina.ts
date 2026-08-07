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
  /* tokens do kit de ícones Snowball (snowball-svg-icons) — tema escuro */
  --sb-primary:#EAFBFF; --sb-soft:#102E55; --sb-accent:#18D8FF; --sb-invert:#061C40;
}
:root[data-theme="light"]{
  --bg-main:#eef5fb; --bg-secondary:#e4eff8;
  --surface:rgba(255,255,255,.78); --surface-strong:rgba(255,255,255,.94);
  --panel:#ffffff; --panel-hi:#f2f8fc;
  --border:rgba(11,42,85,.11); --border-hi:rgba(11,42,85,.24);
  --cyan:#0d8fb8; --cyan-glow:rgba(13,143,184,.22);
  --ice:#0891b2; --blue:#0b6fd6; --navy:#0b2a55;
  --violet:#6e4fd6; --violet-glow:rgba(110,79,214,.22);
  --white:#0b2a55; --text:#0b2a55; --dim:#4f6a8c; --faint:#7c93b0;
  --positive:#0f9d67; --positive-glow:rgba(15,157,103,.22);
  --warning:#a8710a; --warning-glow:rgba(168,113,10,.22);
  --danger:#c81b40; --danger-glow:rgba(200,27,64,.22);
  /* tokens do kit de ícones — tema claro */
  --sb-primary:#0B2A55; --sb-soft:#E8F8FF; --sb-accent:#0d8fb8; --sb-invert:#fff;
}
:root[data-theme="light"] body{
  background:
    radial-gradient(1100px 650px at 12% -8%, rgba(13,143,184,.08), transparent 58%),
    radial-gradient(950px 760px at 100% 4%, rgba(110,79,214,.07), transparent 55%),
    radial-gradient(1px 1px at 20% 30%, rgba(11,42,85,.08), transparent),
    var(--bg-main);
}
:root[data-theme="light"] body::before{
  background-image:linear-gradient(rgba(11,42,85,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(11,42,85,.035) 1px,transparent 1px);
}
/* tamanhos do kit de ícones Snowball */
.sb-icon{width:1.5rem;height:1.5rem;display:inline-block;vertical-align:middle;overflow:visible}
.sb-icon--sm{width:1rem;height:1rem}.sb-icon--md{width:1.5rem;height:1.5rem}.sb-icon--lg{width:2rem;height:2rem}.sb-icon--xl{width:3rem;height:3rem}
.sb-icon--live .sb-accent-fill{animation:sb-pulse 1.8s ease-in-out infinite;transform-origin:center}
@keyframes sb-pulse{0%,100%{opacity:.72;transform:scale(.9)}50%{opacity:1;transform:scale(1.14)}}
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
.proc.morto .proc-ic{--sb-primary:var(--danger);--sb-accent:var(--danger);opacity:.55}
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

/* ---- heatmap ---- */
.heatmap{display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:6px}
.heat-cell{aspect-ratio:1;border-radius:9px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:.62rem;font-weight:800;color:var(--white);border:1px solid var(--border);cursor:default;transition:transform var(--dur)}
.heat-cell:hover{transform:scale(1.06);z-index:2;border-color:var(--border-hi)}
.heat-cell .hv{font-family:var(--mono);font-size:.72rem}

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

/* ---- paleta de comandos (Ctrl+K) ---- */
.cmdk-overlay{position:fixed;inset:0;z-index:100;background:rgba(5,11,24,.6);backdrop-filter:blur(4px);display:none;align-items:flex-start;justify-content:center;padding-top:12vh}
.cmdk-overlay.open{display:flex}
.cmdk-box{width:min(560px,92vw);background:var(--surface-strong);backdrop-filter:blur(20px);border:1px solid var(--border-hi);border-radius:var(--radius);box-shadow:0 24px 60px rgba(0,0,0,.5);overflow:hidden;animation:cmdkIn .18s var(--ease) both}
@keyframes cmdkIn{from{opacity:0;transform:translateY(-8px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
.cmdk-input-row{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border);color:var(--dim)}
.cmdk-input-row input{flex:1;background:none;border:none;outline:none;color:var(--text);font-size:.92rem;font-family:var(--sans)}
.cmdk-esc{font-size:.62rem;color:var(--faint);border:1px solid var(--border);border-radius:5px;padding:2px 6px;font-family:var(--mono)}
.cmdk-results{max-height:50vh;overflow-y:auto;padding:6px}
.cmdk-empty{padding:24px;text-align:center;color:var(--faint);font-size:.8rem}
.cmdk-group{font-size:.6rem;text-transform:uppercase;letter-spacing:.07em;color:var(--faint);font-weight:800;padding:10px 12px 4px}
.cmdk-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:9px;cursor:pointer;font-size:.82rem}
.cmdk-item:hover,.cmdk-item.sel{background:rgba(23,217,255,.1)}
.cmdk-item .cmdk-ic{flex:none;width:18px;height:18px;color:var(--faint)}
.cmdk-item .cmdk-lbl{flex:1}
.cmdk-item .cmdk-sub{color:var(--faint);font-size:.7rem;font-family:var(--mono)}

@media(max-width:860px){
  .sidebar{position:fixed;left:0;top:0;bottom:0;transform:translateX(-100%);transition:transform var(--dur) var(--ease)}
  .app.mobile-open .sidebar{transform:translateX(0)}
  .app.sb-collapsed .sidebar{width:var(--sidebar-w)}
  .app.sb-collapsed .sb-label{display:block}
  .sb-open-btn{display:flex}
  .wrap{padding:16px 14px 80px}
  .kpis{grid-template-columns:repeat(2,1fr)}
}

/* ============================================================
   PROFIT LAB — champion (real) vs. paper lab (virtual), sempre
   visualmente distintos. Nunca deixar um número paper parecer real.
   ============================================================ */
.pl-banner{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}
.pl-chip{font-size:.66rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:7px 13px;border-radius:999px;border:1px solid var(--border)}
.pl-chip--champion{color:var(--white);background:rgba(23,217,255,.10);border-color:var(--border-hi)}
.pl-chip--lab{color:#c79bff;background:rgba(160,110,255,.12);border-color:rgba(160,110,255,.35)}
.pl-chip--virtual{color:var(--warning);background:rgba(255,200,87,.10);border-color:rgba(255,200,87,.3)}
.pl-statusbar{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.pl-stat{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:10px 13px}
.pl-stat .lbl{font-size:.6rem;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);font-weight:800}
.pl-stat .val{font-family:var(--mono);font-size:.98rem;font-weight:800;margin-top:4px;display:flex;align-items:center;gap:7px}
.pl-dot{width:8px;height:8px;border-radius:50%;flex:none}
.pl-dot.saudavel{background:var(--positive)}
.pl-dot.degradado{background:var(--warning)}
.pl-dot.stale{background:var(--warning)}
.pl-dot.parado{background:var(--danger)}
.pl-dot.erro{background:var(--danger)}
.pl-dot.validacao_em_andamento{background:#c79bff}
.pl-alerta{margin-top:12px;padding:12px 14px;border-radius:12px;background:rgba(255,92,122,.09);border:1px solid rgba(255,92,122,.35);color:var(--danger);font-size:.8rem;line-height:1.6}
.pl-subnav{display:flex;gap:6px;flex-wrap:wrap;margin:16px 0}
.pl-tab{background:var(--panel);border:1px solid var(--border);color:var(--dim);font-size:.72rem;font-weight:700;padding:8px 13px;border-radius:999px;cursor:pointer;transition:all .15s}
.pl-tab:hover{color:var(--text);border-color:var(--border-hi)}
.pl-tab.active{color:var(--white);background:linear-gradient(90deg,rgba(23,217,255,.16),rgba(23,217,255,.03));border-color:var(--border-hi)}
.pl-page{display:none}
.pl-page.active{display:block;display:flex;flex-direction:column;gap:16px}
.pl-fam{font-size:.6rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:999px}
.pl-fam-control{background:rgba(23,217,255,.14);color:var(--ice)}
.pl-fam-exploitation{background:rgba(54,227,160,.14);color:var(--positive)}
.pl-fam-exploration{background:rgba(255,200,87,.14);color:var(--warning)}
.pl-risco-alto{background:rgba(255,92,122,.16);color:var(--danger);font-size:.6rem;font-weight:800;text-transform:uppercase;letter-spacing:.03em;padding:2px 8px;border-radius:999px;white-space:nowrap}
.pl-oracle{background:rgba(160,110,255,.16);color:#c79bff;font-size:.6rem;font-weight:800;text-transform:uppercase;padding:2px 8px;border-radius:999px}
.pl-chal-lista{max-height:560px;overflow-y:auto;display:flex;flex-direction:column;gap:6px}
.pl-chal-item{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:9px 12px;cursor:pointer;transition:all .15s;font-size:.78rem}
.pl-chal-item:hover{border-color:var(--border-hi)}
.pl-chal-item.active{border-color:var(--cyan);background:rgba(23,217,255,.06)}
.pl-chal-item .row1{display:flex;justify-content:space-between;align-items:center;gap:8px}
.pl-chal-item .id{font-weight:800;font-family:var(--mono);font-size:.74rem}
.pl-cfg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-top:10px}
.pl-cfg-item{background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:8px;padding:7px 10px}
.pl-cfg-item .k{font-size:.6rem;text-transform:uppercase;color:var(--faint);font-weight:800}
.pl-cfg-item .v{font-family:var(--mono);font-size:.82rem;margin-top:2px}
.pl-cenario-card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:10px}
.pl-cenario-card h3{font-size:.8rem;margin:0 0 8px}
.pl-checklist{display:flex;flex-direction:column;gap:8px}
.pl-check{display:flex;align-items:center;gap:9px;font-size:.8rem}
.pl-check .box{width:16px;height:16px;border-radius:4px;border:1.5px solid var(--border-hi);flex:none;display:flex;align-items:center;justify-content:center;font-size:.65rem}
.pl-check.done .box{background:var(--positive);border-color:var(--positive);color:#02140c}
.pl-markdown{font-size:.84rem;line-height:1.75;color:var(--text)}
.pl-markdown h1,.pl-markdown h2,.pl-markdown h3{margin:16px 0 8px}
.pl-markdown code{font-family:var(--mono);background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px}
.pl-btn{background:var(--panel);border:1px solid var(--border-hi);color:var(--text);font-size:.68rem;font-weight:700;padding:5px 10px;border-radius:8px;cursor:pointer;transition:all .15s}
.pl-btn:hover{background:rgba(23,217,255,.08)}
.pl-btn.danger{border-color:rgba(255,92,122,.4);color:var(--danger)}
.pl-btn.danger:hover{background:rgba(255,92,122,.08)}
</style></head>
<body>
<div class="app" id="app">

  <aside class="sidebar" id="sidebar">
    <div class="sb-brand">
      <img src="/logo.png" alt="Snowball">
      <div class="mark"></div>
    </div>
    <nav class="sb-nav" id="sb-nav">
      <div class="sb-item active" data-tab="visao" data-tip="Visão geral" tabindex="0"><svg class="sb-ic sb-icon" viewBox="0 0 64 64"><use href="#sb-dashboard"/></svg><span class="sb-label">Visão geral</span></div>
      <div class="sb-item" data-tab="operacoes" data-tip="Operações" tabindex="0"><svg class="sb-ic sb-icon" viewBox="0 0 64 64"><use href="#sb-neutrality"/></svg><span class="sb-label">Operações</span></div>
      <div class="sb-item" data-tab="oportunidades" data-tip="Oportunidades" tabindex="0"><svg class="sb-ic sb-icon" viewBox="0 0 64 64"><use href="#sb-opportunities"/></svg><span class="sb-label">Oportunidades</span></div>
      <div class="sb-item" data-tab="exchanges" data-tip="Exchanges" tabindex="0"><svg class="sb-ic sb-icon" viewBox="0 0 64 64"><use href="#sb-exchanges"/></svg><span class="sb-label">Exchanges</span></div>
      <div class="sb-item" data-tab="risco" data-tip="Risco" tabindex="0"><svg class="sb-ic sb-icon" viewBox="0 0 64 64"><use href="#sb-risk"/></svg><span class="sb-label">Risco</span></div>
      <div class="sb-item" data-tab="processos" data-tip="Processos" tabindex="0"><svg class="sb-ic sb-icon" viewBox="0 0 64 64"><use href="#sb-processes"/></svg><span class="sb-label">Processos</span></div>
      <div class="sb-item" data-tab="pesquisa" data-tip="Pesquisa" tabindex="0"><svg class="sb-ic sb-icon" viewBox="0 0 64 64"><use href="#sb-research"/></svg><span class="sb-label">Pesquisa</span></div>
      <div class="sb-item" data-tab="historico" data-tip="Histórico" tabindex="0"><svg class="sb-ic sb-icon" viewBox="0 0 64 64"><use href="#sb-history"/></svg><span class="sb-label">Histórico</span></div>
      <div class="sb-item" data-tab="logs" data-tip="Logs" tabindex="0"><svg class="sb-ic sb-icon" viewBox="0 0 64 64"><use href="#sb-logs"/></svg><span class="sb-label">Logs</span></div>
      <div class="sb-item" data-tab="sistema" data-tip="Sistema" tabindex="0"><svg class="sb-ic sb-icon" viewBox="0 0 64 64"><use href="#sb-settings"/></svg><span class="sb-label">Sistema</span></div>
      <div class="sb-item" data-tab="profitlab" data-tip="Profit Lab" tabindex="0"><svg class="sb-ic sb-icon" viewBox="0 0 64 64"><use href="#sb-research"/></svg><span class="sb-label">Profit Lab</span></div>
    </nav>
    <div class="sb-foot">
      <button class="sb-toggle" id="sb-toggle-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg><span class="sb-label">Recolher</span></button>
    </div>
  </aside>

  <div class="main">
    <div class="topbar"><div class="topbar-in">
      <button class="sb-open-btn" id="sb-open-btn" aria-label="Abrir menu"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg></button>
      <div class="page-title" id="page-title">Visão geral<span class="sub" id="page-sub">centro de operações — dois motores, papel</span></div>
      <span class="pill paper"><svg class="sb-icon sb-icon--sm"><use href="#sb-paper"/></svg>PAPER</span>
      <span class="pill"><span class="led" id="led-vig"></span><span id="txt-vig">carregando</span></span>
      <span class="pill"><span class="led" id="led-stream"></span><span id="txt-stream">carregando</span></span>
      <span class="pill" id="clock">--:--:-- <span class="utc">· UTC --:--</span></span>
      <button class="iconbtn" id="btn-cmdk" title="Paleta de comandos (Ctrl+K)" aria-label="Abrir paleta de comandos"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" stroke-linecap="round"/></svg></button>
      <button class="iconbtn" id="btn-theme" title="Alternar tema claro/escuro" aria-label="Alternar tema claro/escuro">
        <svg id="ic-theme-dark" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
        <svg id="ic-theme-light" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke-linecap="round"/></svg>
      </button>
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

      <section class="card">
        <h2>Heatmap de spread por ativo <span class="note">mesmo dado da tabela acima, em outra visão</span></h2>
        <p class="caption">Cada célula é um candidato real da varredura — quanto mais intenso o azul, maior o spread. Passe o mouse pra ver os detalhes.</p>
        <div id="heatmap-spread"></div>
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

    <!-- ============ PROFIT LAB ============ -->
    <div class="tabpanel" id="panel-profitlab">
      <div class="pl-banner">
        <span class="pl-chip pl-chip--champion">CHAMPION — sistema principal</span>
        <span class="pl-chip pl-chip--lab">PAPER LAB — experimentos virtuais</span>
        <span class="pl-chip pl-chip--virtual">100% PAPER · VIRTUAL · NÃO REAL</span>
      </div>

      <section class="card" id="pl-status-card">
        <h2>Status do Profit Lab</h2>
        <div class="pl-statusbar" id="pl-statusbar"></div>
        <div id="pl-alerta-parado" style="display:none" class="pl-alerta"></div>
      </section>

      <div class="pl-subnav" id="pl-subnav">
        <button class="pl-tab active" data-pl="visao">Visão geral</button>
        <button class="pl-tab" data-pl="championcontrol">Champion vs. Control</button>
        <button class="pl-tab" data-pl="leaderboard">Leaderboard</button>
        <button class="pl-tab" data-pl="challengers">Challengers</button>
        <button class="pl-tab" data-pl="experimentos">Experimentos</button>
        <button class="pl-tab" data-pl="frequencia">Frequência</button>
        <button class="pl-tab" data-pl="custos">Custos</button>
        <button class="pl-tab" data-pl="capital">Capital</button>
        <button class="pl-tab" data-pl="risco">Risco e realismo</button>
        <button class="pl-tab" data-pl="captura">Captura de settlement</button>
        <button class="pl-tab" data-pl="telemetria">Telemetria</button>
        <button class="pl-tab" data-pl="relatorios">Relatórios da IA</button>
      </div>

      <!-- Visão geral -->
      <div class="pl-page active" id="pl-page-visao">
        <section class="kpis" id="pl-kpis-visao"></section>
        <section class="grid2">
          <div class="card">
            <h2>Champion <span class="note">sistema principal — dinheiro real</span></h2>
            <div id="pl-champion-detalhe"></div>
          </div>
          <div class="card">
            <h2>Control <span class="note">réplica virtual do champion, mesma lógica</span></h2>
            <div id="pl-control-detalhe"></div>
          </div>
        </section>
      </div>

      <!-- Champion vs Control -->
      <div class="pl-page" id="pl-page-championcontrol">
        <section class="card">
          <h2>Validação evento a evento <span class="note" id="pl-cc-status"></span></h2>
          <p class="caption">O control só é considerado validado quando reproduz TODOS os tipos de evento do champion — 100% de fidelidade em poucos eventos não conta.</p>
          <div style="overflow-x:auto"><table>
            <thead><tr><th>Métrica</th><th>Champion</th><th>Control</th><th>Divergência</th></tr></thead>
            <tbody id="pl-cc-table"></tbody>
          </table></div>
        </section>
        <section class="grid2">
          <div class="card">
            <h2>Checklist de tipos de evento observados</h2>
            <div id="pl-cc-checklist"></div>
          </div>
          <div class="card">
            <h2>Fidelidade de decisões</h2>
            <div id="pl-cc-fidelidade"></div>
          </div>
        </section>
      </div>

      <!-- Leaderboard -->
      <div class="pl-page" id="pl-page-leaderboard">
        <section class="card">
          <h2>Leaderboard <span class="note">clique no cabeçalho pra ordenar</span></h2>
          <div class="tbl-toolbar">
            <select id="pl-lb-familia">
              <option value="todas">Todas as famílias</option>
              <option value="control">control</option>
              <option value="exploitation">exploitation</option>
              <option value="exploration">exploration</option>
            </select>
          </div>
          <div style="overflow-x:auto"><table id="pl-lb-table">
            <thead><tr>
              <th>#</th><th>Challenger</th><th>Família</th><th class="sortable" data-col="trades">Trades</th>
              <th class="sortable" data-col="pnlPaperBase">PnL base</th><th class="sortable" data-col="pnlPaperAjustado">PnL ajustado</th>
              <th class="sortable" data-col="pnlIncremental">Incremental</th><th class="sortable" data-col="retornoPorMargem">Retorno/margem</th>
              <th class="sortable" data-col="drawdownMaxPct">Drawdown</th><th>Evidência</th><th>Ações</th>
            </tr></thead>
            <tbody id="pl-lb-body"></tbody>
          </table></div>
        </section>
      </div>

      <!-- Challengers -->
      <div class="pl-page" id="pl-page-challengers">
        <section class="grid2">
          <div class="card">
            <h2>Todos os challengers <span class="note" id="pl-chal-count"></span></h2>
            <div id="pl-chal-lista" class="pl-chal-lista"></div>
          </div>
          <div class="card">
            <h2>Detalhe <span class="note" id="pl-chal-detalhe-tag"></span></h2>
            <div id="pl-chal-detalhe"><div class="empty">selecione um challenger à esquerda</div></div>
          </div>
        </section>
      </div>

      <!-- Experimentos -->
      <div class="pl-page" id="pl-page-experimentos">
        <section class="card">
          <h2>Experimentos <span class="note">cada challenger aprovado É um experimento — hipótese, família, status</span></h2>
          <div style="overflow-x:auto"><table>
            <thead><tr><th>Challenger</th><th>Família</th><th>Hipótese</th><th>Config desde</th><th>Status</th><th>Amostra</th><th>Ação</th></tr></thead>
            <tbody id="pl-exp-body"></tbody>
          </table></div>
        </section>
      </div>

      <!-- Frequência -->
      <div class="pl-page" id="pl-page-frequencia">
        <section class="card">
          <h2>Funil de oportunidades</h2>
          <div id="pl-funil"></div>
        </section>
        <section class="card">
          <h2>Motivos de rejeição</h2>
          <div id="pl-motivos-rejeicao"></div>
        </section>
        <section class="card">
          <h2>Payback Grid <span class="note">payback-110 a payback-200</span></h2>
          <p class="caption">Onde mais frequência começa a destruir a qualidade — compare trades × PnL × drawdown ao longo do grid.</p>
          <div style="overflow-x:auto"><table>
            <thead><tr><th>Payback</th><th>Trades</th><th>Funding</th><th>Custos</th><th>PnL</th><th>Fee/gross</th><th>Drawdown</th></tr></thead>
            <tbody id="pl-payback-grid-body"></tbody>
          </table></div>
        </section>
      </div>

      <!-- Custos -->
      <div class="pl-page" id="pl-page-custos">
        <section class="card">
          <h2>Champion <span class="note">decomposição real, do diário</span></h2>
          <div id="pl-custos-champion"></div>
        </section>
        <section class="card">
          <h2>Decomposição por challenger</h2>
          <div style="overflow-x:auto"><table>
            <thead><tr><th>Challenger</th><th>Trading puro</th><th>Gerenciamento</th><th>Total</th><th>Fee/gross trading</th><th>Fee/gross total</th></tr></thead>
            <tbody id="pl-custos-body"></tbody>
          </table></div>
        </section>
      </div>

      <!-- Capital -->
      <div class="pl-page" id="pl-page-capital">
        <section class="card">
          <h2>Capital virtual por challenger <span class="note">nunca somado ao capital do champion</span></h2>
          <div style="overflow-x:auto"><table>
            <thead><tr><th>Challenger</th><th>Família</th><th>Posições abertas</th><th>Capital ocioso</th><th>Concentração máxima</th></tr></thead>
            <tbody id="pl-capital-body"></tbody>
          </table></div>
        </section>
      </div>

      <!-- Risco e realismo -->
      <div class="pl-page" id="pl-page-risco">
        <section class="card">
          <h2>Risco por challenger</h2>
          <div style="overflow-x:auto"><table>
            <thead><tr><th>Challenger</th><th>Drawdown</th><th>Concentração</th><th>Alavancagem</th></tr></thead>
            <tbody id="pl-risco-body"></tbody>
          </table></div>
        </section>
        <section class="card">
          <h2>Cenários de realismo <span class="note">ideal · base · conservador · stress</span></h2>
          <p class="caption">Um único "PnL ajustado" nunca conta a história inteira — aqui estão as 4 premissas lado a lado, por challenger.</p>
          <div id="pl-cenarios"></div>
        </section>
      </div>

      <!-- Captura de settlement -->
      <div class="pl-page" id="pl-page-captura">
        <section class="card">
          <h2>Captura de settlement <span class="note">capture-3m a capture-60m</span></h2>
          <div class="empty">Os challengers de captura (9 janelas × 2 modos) ainda não foram implementados — ver backlog do Paper Profit Lab. Esta página está pronta pra receber os dados assim que existirem; nenhum número é fabricado enquanto isso.</div>
        </section>
      </div>

      <!-- Telemetria -->
      <div class="pl-page" id="pl-page-telemetria">
        <section class="kpis" id="pl-telemetria-kpis"></section>
        <section class="card">
          <h2>Status por challenger</h2>
          <div id="pl-telemetria-status" class="procgrid"></div>
        </section>
      </div>

      <!-- Relatórios da IA -->
      <div class="pl-page" id="pl-page-relatorios">
        <section class="card">
          <h2>Relatório do dia <span class="note" id="pl-relatorio-data"></span></h2>
          <div id="pl-relatorio-md" class="pl-markdown"></div>
        </section>
        <section class="card">
          <h2>Auditoria de ações do dashboard <span class="note">toda pausa/retomada/observação, com usuário e motivo</span></h2>
          <div style="overflow-x:auto"><table>
            <thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Challenger</th><th>Motivo</th></tr></thead>
            <tbody id="pl-auditoria-body"></tbody>
          </table></div>
        </section>
      </div>
    </div>

    <footer class="foot">SNOWBALL — nenhuma ordem enviada além do paper trading declarado — atualizado <span id="foot-ts">—</span></footer>
    </div>
  </div>
</div>

<div class="cmdk-overlay" id="cmdk-overlay">
  <div class="cmdk-box" role="dialog" aria-modal="true" aria-label="Paleta de comandos">
    <div class="cmdk-input-row">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" stroke-linecap="round"/></svg>
      <input type="text" id="cmdk-input" placeholder="Buscar ativos, exchanges, processos, páginas..." autocomplete="off">
      <span class="cmdk-esc">esc</span>
    </div>
    <div class="cmdk-results" id="cmdk-results"></div>
  </div>
</div>

<svg width="0" height="0" style="position:absolute" aria-hidden="true">
<style>
.sb-primary{fill:none;stroke:var(--sb-primary,#0B2A55);stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.sb-accent{fill:none;stroke:var(--sb-accent,#18D8FF);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.sb-soft{fill:var(--sb-soft,#E8F8FF);stroke:var(--sb-primary,#0B2A55);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.sb-accent-fill{fill:var(--sb-accent,#18D8FF)}
.sb-primary-fill{fill:var(--sb-primary,#0B2A55)}
.sb-invert{fill:none;stroke:var(--sb-invert,#fff);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
</style>
<symbol id="sb-dashboard" viewBox="0 0 64 64">
<title>Visão geral</title>
<linearGradient id="sb-grad-dashboard" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<rect class="sb-soft" x="9" y="10" width="19" height="17" rx="4"/>
<rect class="sb-soft" x="36" y="10" width="19" height="10" rx="4"/>
<rect class="sb-soft" x="36" y="28" width="19" height="26" rx="4"/>
<rect class="sb-soft" x="9" y="35" width="19" height="19" rx="4"/>
<path class="sb-accent" d="M13 22l4-4 4 2 4-6"/>
<path class="sb-primary" d="M40 15h11M13 41h11M13 47h7"/>
<path class="sb-accent" d="M41 47c4-10 7-10 11-14"/>
</symbol><symbol id="sb-capital" viewBox="0 0 64 64">
<title>Capital</title>
<linearGradient id="sb-grad-capital" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<circle class="sb-soft" cx="31" cy="34" r="14"/>
<path class="sb-primary" d="M20 35c3 8 13 12 21 6 7-6 4-18-5-21-7-2-14 1-17 7"/>
<path class="sb-accent" d="M17 26c2-8 9-14 18-14 6 0 11 2 15 7"/>
<path class="sb-accent" d="M46 13l5 7-8 2"/>
<path class="sb-primary" d="M23 47h26"/>
<path class="sb-accent" d="M39 39v7M45 34v12M51 27v19"/>
</symbol><symbol id="sb-opportunities" viewBox="0 0 64 64">
<title>Oportunidades</title>
<linearGradient id="sb-grad-opportunities" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<circle class="sb-primary" cx="30" cy="32" r="20"/>
<circle class="sb-soft" cx="30" cy="32" r="12"/>
<circle class="sb-accent-fill" cx="38" cy="24" r="3"/>
<path class="sb-accent" d="M30 32l14-13"/>
<path class="sb-primary" d="M30 12v5M30 47v5M10 32h5M45 32h5"/>
<path class="sb-accent" d="M47 45l5 5M52 45l-5 5"/>
</symbol><symbol id="sb-positions" viewBox="0 0 64 64">
<title>Posições</title>
<linearGradient id="sb-grad-positions" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<circle class="sb-soft" cx="32" cy="32" r="8"/>
<path class="sb-accent" d="M14 24c5-9 17-14 28-9 4 2 7 4 9 8"/>
<path class="sb-accent" d="M49 16l3 8-8 1"/>
<path class="sb-primary" d="M50 40c-5 9-17 14-28 9-4-2-7-4-9-8"/>
<path class="sb-primary" d="M15 48l-3-8 8-1"/>
<path class="sb-accent" d="M29 32h6M32 29v6"/>
</symbol><symbol id="sb-funding" viewBox="0 0 64 64">
<title>Funding</title>
<linearGradient id="sb-grad-funding" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<circle class="sb-soft" cx="32" cy="32" r="13"/>
<path class="sb-accent" d="M18 20c4-5 9-8 15-8 8 0 15 4 19 11"/>
<path class="sb-accent" d="M48 14l4 9-9 1"/>
<path class="sb-primary" d="M46 45c-4 5-9 7-15 7-8 0-15-4-19-11"/>
<path class="sb-primary" d="M16 50l-4-9 9-1"/>
<path class="sb-accent" d="M27 29c0-3 2-5 6-5 3 0 5 1 6 3M27 36c1 2 3 4 6 4 4 0 6-2 6-5 0-7-12-2-12-9"/>
</symbol><symbol id="sb-pnl" viewBox="0 0 64 64">
<title>PnL</title>
<linearGradient id="sb-grad-pnl" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<path class="sb-primary" d="M12 50V14M12 50h42"/>
<path class="sb-soft" d="M17 45l9-10 8 5 13-18 7 5v23H17z"/>
<path class="sb-accent" d="M17 45l9-10 8 5 13-18 7 5"/>
<circle class="sb-accent-fill" cx="47" cy="22" r="3"/>
<path class="sb-primary" d="M47 12v5M47 27v5M37 22h5M52 22h5"/>
</symbol><symbol id="sb-costs" viewBox="0 0 64 64">
<title>Custos</title>
<linearGradient id="sb-grad-costs" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<circle class="sb-soft" cx="29" cy="31" r="14"/>
<path class="sb-primary" d="M17 31a14 14 0 1023-10"/>
<path class="sb-accent" d="M16 24c2-6 8-10 14-10 5 0 10 2 13 6"/>
<path class="sb-accent" d="M39 14l5 6-7 3"/>
<path class="sb-primary" d="M25 27h9M25 34h9"/>
<path class="sb-accent" d="M45 44h11"/>
</symbol><symbol id="sb-exchanges" viewBox="0 0 64 64">
<title>Exchanges</title>
<linearGradient id="sb-grad-exchanges" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<circle class="sb-soft" cx="18" cy="23" r="7"/>
<circle class="sb-soft" cx="46" cy="23" r="7"/>
<circle class="sb-soft" cx="32" cy="47" r="7"/>
<path class="sb-primary" d="M25 23h14M22 29l7 12M42 29l-7 12"/>
<path class="sb-accent" d="M13 20l5-3 5 3M41 20l5-3 5 3M27 45l5-3 5 3"/>
<circle class="sb-accent-fill" cx="32" cy="27" r="2"/>
</symbol><symbol id="sb-exchange-health" viewBox="0 0 64 64">
<title>Saúde da exchange</title>
<linearGradient id="sb-grad-exchange-health" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<rect class="sb-soft" x="14" y="12" width="36" height="40" rx="7"/>
<path class="sb-primary" d="M21 21h22M21 29h22M21 37h7M39 37h4"/>
<circle class="sb-accent-fill" cx="18" cy="21" r="1.7"/>
<circle class="sb-accent-fill" cx="18" cy="29" r="1.7"/>
<path class="sb-accent" d="M20 45h7l3-6 5 12 4-6h7"/>
</symbol><symbol id="sb-risk" viewBox="0 0 64 64">
<title>Risco</title>
<linearGradient id="sb-grad-risk" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<path class="sb-soft" d="M32 9l20 8v13c0 12-8 21-20 25-12-4-20-13-20-25V17z"/>
<path class="sb-primary" d="M32 9l20 8v13c0 12-8 21-20 25-12-4-20-13-20-25V17z"/>
<path class="sb-accent" d="M23 35l6 6 13-16"/>
<path class="sb-primary" d="M32 17v5M32 47v4"/>
</symbol><symbol id="sb-liquidation" viewBox="0 0 64 64">
<title>Liquidação</title>
<linearGradient id="sb-grad-liquidation" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<path class="sb-primary" d="M12 42a22 22 0 1140 0"/>
<path class="sb-accent" d="M18 39a16 16 0 0128 0"/>
<path class="sb-primary" d="M32 32l12-10"/>
<circle class="sb-accent-fill" cx="32" cy="32" r="3"/>
<path class="sb-primary" d="M17 47h30"/>
<path class="sb-accent" d="M32 15v5M19 21l4 4M45 21l-4 4"/>
</symbol><symbol id="sb-neutrality" viewBox="0 0 64 64">
<title>Neutralidade</title>
<linearGradient id="sb-grad-neutrality" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<path class="sb-primary" d="M32 12v38M19 50h26M14 24h36"/>
<path class="sb-accent" d="M17 24l-7 12h14zM47 24l-7 12h14z"/>
<path class="sb-primary" d="M14 24l4-7M50 24l-4-7"/>
<circle class="sb-soft" cx="32" cy="19" r="5"/>
<path class="sb-accent" d="M29 19h6"/>
</symbol><symbol id="sb-vigilance" viewBox="0 0 64 64">
<title>Vigilância</title>
<linearGradient id="sb-grad-vigilance" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<circle class="sb-primary" cx="32" cy="32" r="22"/>
<circle class="sb-soft" cx="32" cy="32" r="14"/>
<circle class="sb-primary" cx="32" cy="32" r="5"/>
<path class="sb-accent" d="M32 32l17-12"/>
<path class="sb-primary" d="M32 10v5M32 49v5M10 32h5M49 32h5"/>
<circle class="sb-accent-fill" cx="44" cy="24" r="3"/>
</symbol><symbol id="sb-engine" viewBox="0 0 64 64">
<title>Motor</title>
<linearGradient id="sb-grad-engine" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<path class="sb-soft" d="M32 9l17 10v26L32 55 15 45V19z"/>
<path class="sb-primary" d="M32 9l17 10v26L32 55 15 45V19z"/>
<circle class="sb-primary" cx="32" cy="32" r="10"/>
<path class="sb-accent" d="M25 34h5l3-7 4 11 3-4h4"/>
<path class="sb-accent" d="M32 14v5M18 23l5 3M46 23l-5 3M18 41l5-3M46 41l-5-3M32 45v5"/>
</symbol><symbol id="sb-custody" viewBox="0 0 64 64">
<title>Custódia</title>
<linearGradient id="sb-grad-custody" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<rect class="sb-soft" x="12" y="18" width="40" height="34" rx="7"/>
<path class="sb-primary" d="M12 27h40M22 18v-4h20v4"/>
<circle class="sb-primary" cx="32" cy="38" r="7"/>
<path class="sb-accent" d="M32 34v5l4 2"/>
<path class="sb-accent" d="M18 23h8M38 23h8"/>
</symbol><symbol id="sb-collector" viewBox="0 0 64 64">
<title>Coletor</title>
<linearGradient id="sb-grad-collector" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<ellipse class="sb-soft" cx="32" cy="16" rx="17" ry="7"/>
<path class="sb-primary" d="M15 16v30c0 4 8 7 17 7s17-3 17-7V16"/>
<path class="sb-primary" d="M15 26c0 4 8 7 17 7s17-3 17-7M15 36c0 4 8 7 17 7s17-3 17-7"/>
<path class="sb-accent" d="M27 17h10M32 12v10"/>
</symbol><symbol id="sb-watchdog" viewBox="0 0 64 64">
<title>Watchdog</title>
<linearGradient id="sb-grad-watchdog" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<path class="sb-soft" d="M8 32s9-15 24-15 24 15 24 15-9 15-24 15S8 32 8 32z"/>
<path class="sb-primary" d="M8 32s9-15 24-15 24 15 24 15-9 15-24 15S8 32 8 32z"/>
<circle class="sb-primary" cx="32" cy="32" r="8"/>
<path class="sb-accent" d="M27 33h4l2-5 3 8 2-3h4"/>
<path class="sb-accent" d="M45 14l5 2-2 5"/>
</symbol><symbol id="sb-processes" viewBox="0 0 64 64">
<title>Processos</title>
<linearGradient id="sb-grad-processes" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<rect class="sb-soft" x="8" y="12" width="14" height="12" rx="3"/>
<rect class="sb-soft" x="25" y="26" width="14" height="12" rx="3"/>
<rect class="sb-soft" x="42" y="40" width="14" height="12" rx="3"/>
<path class="sb-primary" d="M22 18h10v8M39 32h10v8"/>
<path class="sb-accent" d="M29 22l3 4 4-4M46 36l3 4 4-4"/>
<circle class="sb-accent-fill" cx="15" cy="18" r="2"/>
<circle class="sb-accent-fill" cx="32" cy="32" r="2"/>
<circle class="sb-accent-fill" cx="49" cy="46" r="2"/>
</symbol><symbol id="sb-logs" viewBox="0 0 64 64">
<title>Logs</title>
<linearGradient id="sb-grad-logs" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<rect class="sb-soft" x="9" y="11" width="46" height="42" rx="6"/>
<path class="sb-primary" d="M9 21h46"/>
<circle class="sb-accent-fill" cx="15" cy="16" r="1.5"/>
<circle class="sb-accent-fill" cx="20" cy="16" r="1.5"/>
<path class="sb-accent" d="M17 31l5 4-5 4M27 39h10"/>
<path class="sb-primary" d="M29 29h16M29 34h12M17 46h28"/>
</symbol><symbol id="sb-history" viewBox="0 0 64 64">
<title>Histórico</title>
<linearGradient id="sb-grad-history" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<circle class="sb-soft" cx="32" cy="33" r="20"/>
<path class="sb-primary" d="M16 18a20 20 0 103-3"/>
<path class="sb-accent" d="M12 14l7 1-1 7"/>
<path class="sb-primary" d="M32 21v13l9 5"/>
<circle class="sb-accent-fill" cx="32" cy="34" r="2.5"/>
</symbol><symbol id="sb-research" viewBox="0 0 64 64">
<title>Pesquisa</title>
<linearGradient id="sb-grad-research" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<path class="sb-primary" d="M25 10h14M28 10v13L16 45c-2 5 1 9 7 9h18c6 0 9-4 7-9L36 23V10"/>
<path class="sb-soft" d="M20 42h24l4 8H16z"/>
<path class="sb-accent" d="M21 41h22M25 36l5-5 4 3 6-8"/>
<circle class="sb-accent-fill" cx="27" cy="46" r="2"/>
<circle class="sb-accent-fill" cx="37" cy="49" r="1.5"/>
</symbol><symbol id="sb-ml" viewBox="0 0 64 64">
<title>Machine learning</title>
<linearGradient id="sb-grad-ml" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<circle class="sb-soft" cx="32" cy="32" r="8"/>
<circle class="sb-primary" cx="14" cy="18" r="5"/>
<circle class="sb-primary" cx="50" cy="18" r="5"/>
<circle class="sb-primary" cx="14" cy="46" r="5"/>
<circle class="sb-primary" cx="50" cy="46" r="5"/>
<path class="sb-primary" d="M18 21l8 7M46 21l-8 7M18 43l8-7M46 43l-8-7"/>
<path class="sb-accent" d="M32 26v12M26 32h12M28 28l8 8M36 28l-8 8"/>
</symbol><symbol id="sb-basis" viewBox="0 0 64 64">
<title>Basis trade</title>
<linearGradient id="sb-grad-basis" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<path class="sb-primary" d="M11 49h42M11 14v35"/>
<path class="sb-accent" d="M16 38l9-9 8 5 14-17"/>
<path class="sb-primary" d="M16 44l9-6 8 2 14-12"/>
<path class="sb-accent" d="M49 17v11"/>
<path class="sb-accent" d="M46 19l3-3 3 3M46 26l3 3 3-3"/>
<circle class="sb-accent-fill" cx="25" cy="29" r="2"/>
<circle class="sb-primary-fill" cx="25" cy="38" r="2"/>
</symbol><symbol id="sb-settings" viewBox="0 0 64 64">
<title>Configurações</title>
<linearGradient id="sb-grad-settings" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<path class="sb-primary" d="M13 18h38M13 32h38M13 46h38"/>
<circle class="sb-soft" cx="24" cy="18" r="5"/>
<circle class="sb-soft" cx="42" cy="32" r="5"/>
<circle class="sb-soft" cx="29" cy="46" r="5"/>
<path class="sb-accent" d="M24 14v8M42 28v8M29 42v8"/>
</symbol><symbol id="sb-success" viewBox="0 0 64 64">
<title>Aprovado</title>
<linearGradient id="sb-grad-success" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<circle class="sb-soft" cx="32" cy="32" r="22"/>
<circle class="sb-primary" cx="32" cy="32" r="22"/>
<path class="sb-accent" d="M21 32l7 8 16-18"/>
<path class="sb-accent" d="M32 10v4M32 50v4M10 32h4M50 32h4"/>
</symbol><symbol id="sb-blocked" viewBox="0 0 64 64">
<title>Bloqueado</title>
<linearGradient id="sb-grad-blocked" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<path class="sb-soft" d="M32 9l20 8v13c0 12-8 21-20 25-12-4-20-13-20-25V17z"/>
<path class="sb-primary" d="M32 9l20 8v13c0 12-8 21-20 25-12-4-20-13-20-25V17z"/>
<path class="sb-accent" d="M23 23l18 18M41 23L23 41"/>
</symbol><symbol id="sb-warning" viewBox="0 0 64 64">
<title>Atenção</title>
<linearGradient id="sb-grad-warning" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<path class="sb-soft" d="M32 10l24 42H8z"/>
<path class="sb-primary" d="M32 10l24 42H8z"/>
<path class="sb-accent" d="M32 24v13"/>
<circle class="sb-accent-fill" cx="32" cy="44" r="2.3"/>
</symbol><symbol id="sb-offline" viewBox="0 0 64 64">
<title>Offline</title>
<linearGradient id="sb-grad-offline" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<path class="sb-primary" d="M25 39l-5 5a8 8 0 01-11-11l9-9a8 8 0 0111 0M39 25l5-5a8 8 0 0111 11l-9 9a8 8 0 01-11 0"/>
<path class="sb-accent" d="M23 41l18-18M13 13l38 38"/>
</symbol><symbol id="sb-stale" viewBox="0 0 64 64">
<title>Desatualizado</title>
<linearGradient id="sb-grad-stale" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<circle class="sb-soft" cx="32" cy="32" r="20"/>
<path class="sb-primary" d="M17 17a20 20 0 1028 0"/>
<path class="sb-accent" d="M44 11l2 8-8-1"/>
<path class="sb-primary" d="M32 21v12l8 4"/>
<path class="sb-accent" d="M24 46h16"/>
</symbol><symbol id="sb-live" viewBox="0 0 64 64">
<title>Ao vivo</title>
<linearGradient id="sb-grad-live" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<circle class="sb-soft" cx="32" cy="32" r="7"/>
<circle class="sb-accent-fill" cx="32" cy="32" r="4"/>
<path class="sb-primary" d="M20 20a17 17 0 000 24M44 20a17 17 0 010 24"/>
<path class="sb-accent" d="M14 14a25 25 0 000 36M50 14a25 25 0 010 36"/>
</symbol><symbol id="sb-paper" viewBox="0 0 64 64">
<title>Paper trading</title>
<linearGradient id="sb-grad-paper" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<path class="sb-soft" d="M17 9h22l10 10v36H17z"/>
<path class="sb-primary" d="M17 9h22l10 10v36H17zM39 9v10h10"/>
<path class="sb-accent" d="M24 29h18M24 36h14M24 43h18"/>
<circle class="sb-accent-fill" cx="46" cy="48" r="6"/>
<path class="sb-invert" d="M44 48l2 2 4-5"/>
</symbol><symbol id="sb-alert" viewBox="0 0 64 64">
<title>Alerta</title>
<linearGradient id="sb-grad-alert" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#8AF0FF"/><stop offset=".5" stop-color="#18D8FF"/><stop offset="1" stop-color="#168CFF"/></linearGradient>
<path class="sb-soft" d="M19 43h26l-3-5V28a10 10 0 00-20 0v10z"/>
<path class="sb-primary" d="M19 43h26l-3-5V28a10 10 0 00-20 0v10zM27 48a5 5 0 0010 0"/>
<path class="sb-accent" d="M32 10v5M14 22l5 3M50 22l-5 3"/>
<circle class="sb-accent-fill" cx="45" cy="17" r="4"/>
</symbol>
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
  sistema:{t:'Sistema',s:'coleta, prontidão de ML, diagnóstico do dashboard'},
  profitlab:{t:'Profit Lab',s:'champion vs. challengers — tudo em paper, capital 100% virtual'}
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

// ---- tema claro/escuro ----
(function(){
  var root=document.documentElement;
  var btn=el('btn-theme');
  var icDark=el('ic-theme-dark'), icLight=el('ic-theme-light');
  function aplicar(tema){
    if(tema==='light')root.setAttribute('data-theme','light'); else root.removeAttribute('data-theme');
    icDark.style.display=tema==='light'?'none':'block';
    icLight.style.display=tema==='light'?'block':'none';
    btn.title=tema==='light'?'Mudar para tema escuro':'Mudar para tema claro';
  }
  var salvo=null;
  try{salvo=localStorage.getItem('snowball-tema')}catch(e){}
  var inicial=salvo||((window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark');
  aplicar(inicial);
  btn.addEventListener('click',function(){
    var atual=root.getAttribute('data-theme')==='light'?'light':'dark';
    var novo=atual==='light'?'dark':'light';
    aplicar(novo);
    try{localStorage.setItem('snowball-tema',novo)}catch(e){}
  });
})();

// ---- paleta de comandos (Ctrl+K) — busca só no dado real já carregado ----
(function(){
  var overlay=el('cmdk-overlay'), input=el('cmdk-input'), results=el('cmdk-results');
  var selecionado=-1, itensAtuais=[];

  function construirIndice(){
    var out=[];
    Object.keys(PAGE_INFO).forEach(function(k){
      out.push({tipo:'página',icone:ICONE_PROCESSO[PAGE_INFO[k].t]||'sb-'+({visao:'dashboard',operacoes:'neutrality',oportunidades:'opportunities',exchanges:'exchanges',risco:'risk',processos:'processes',pesquisa:'research',historico:'history',logs:'logs',sistema:'settings'}[k]||'dashboard'),label:PAGE_INFO[k].t,sub:PAGE_INFO[k].s,acao:function(){irPara(k)}});
    });
    var d=ULTIMO_DADO||{};
    (d.processos||[]).forEach(function(p){
      out.push({tipo:'processo',icone:ICONE_PROCESSO[p.nome]||'sb-processes',label:p.nome,sub:p.vivo?'vivo':'não detectado',acao:function(){irPara('processos')}});
    });
    (d.contas||[]).forEach(function(c){
      out.push({tipo:'exchange',icone:'sb-exchanges',label:c.exchange,sub:fmtUsd(c.saldo),acao:function(){irPara('exchanges')}});
    });
    var vistos={};
    (d.scan||[]).forEach(function(o){
      var nome=(o.symbol||'').replace('/USDT:USDT','');
      if(!nome||vistos[nome])return; vistos[nome]=1;
      out.push({tipo:'ativo',icone:'sb-opportunities',label:nome,sub:o.exchangeShort+' → '+o.exchangeLong,acao:function(){
        irPara('oportunidades');
        setTimeout(function(){var b=el('scan-busca'); if(b){b.value=nome;b.dispatchEvent(new Event('input'))}},60);
      }});
    });
    return out;
  }
  function irPara(alvo){
    var item=document.querySelector('.sb-item[data-tab="'+alvo+'"]');
    if(item)item.click();
    fechar();
  }
  function pintar(lista){
    itensAtuais=lista; selecionado=lista.length?0:-1;
    if(!lista.length){results.innerHTML='<div class="cmdk-empty">nada encontrado</div>';return}
    var porTipo={};
    lista.forEach(function(it){(porTipo[it.tipo]=porTipo[it.tipo]||[]).push(it)});
    var html='';
    Object.keys(porTipo).forEach(function(tipo){
      html+='<div class="cmdk-group">'+esc(tipo)+'</div>';
      porTipo[tipo].forEach(function(it){
        var idx=lista.indexOf(it);
        html+='<div class="cmdk-item'+(idx===selecionado?' sel':'')+'" data-idx="'+idx+'">'+
          '<svg class="cmdk-ic sb-icon sb-icon--sm"><use href="#'+it.icone+'"/></svg>'+
          '<span class="cmdk-lbl">'+esc(it.label)+'</span><span class="cmdk-sub">'+esc(it.sub||'')+'</span></div>';
      });
    });
    results.innerHTML=html;
  }
  function filtrar(){
    var termo=input.value.toLowerCase();
    var base=construirIndice();
    if(!termo){pintar(base.slice(0,12));return}
    pintar(base.filter(function(it){return (it.label+' '+it.sub).toLowerCase().indexOf(termo)!==-1}).slice(0,30));
  }
  function abrir(){
    overlay.classList.add('open');
    input.value=''; filtrar();
    setTimeout(function(){input.focus()},10);
  }
  function fechar(){overlay.classList.remove('open')}
  document.addEventListener('keydown',function(ev){
    if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='k'){ev.preventDefault();abrir();return}
    if(ev.key==='Escape'&&overlay.classList.contains('open')){fechar();return}
    if(!overlay.classList.contains('open'))return;
    if(ev.key==='ArrowDown'){ev.preventDefault();selecionado=Math.min(itensAtuais.length-1,selecionado+1);pintar(itensAtuais)}
    else if(ev.key==='ArrowUp'){ev.preventDefault();selecionado=Math.max(0,selecionado-1);pintar(itensAtuais)}
    else if(ev.key==='Enter'){ev.preventDefault();var it=itensAtuais[selecionado];if(it)it.acao()}
  });
  input.addEventListener('input',filtrar);
  results.addEventListener('click',function(ev){
    var alvo=ev.target.closest('.cmdk-item');
    if(!alvo)return;
    var it=itensAtuais[Number(alvo.getAttribute('data-idx'))];
    if(it)it.acao();
  });
  overlay.addEventListener('click',function(ev){if(ev.target===overlay)fechar()});
  el('btn-cmdk').addEventListener('click',abrir);
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
  var out=
    '<defs><linearGradient id="'+grad1+'" x1="0" y1="0" x2="1" y2="0">'+
    '<stop offset="0" stop-color="'+corStroke+'" stop-opacity=".55"/><stop offset="1" stop-color="'+corStroke+'"/>'+
    '</linearGradient><linearGradient id="'+grad2+'" x1="0" y1="0" x2="0" y2="1">'+
    '<stop offset="0" stop-color="'+corStroke+'" stop-opacity=".22"/><stop offset="1" stop-color="'+corStroke+'" stop-opacity="0"/>'+
    '</linearGradient></defs>'+
    '<path d="'+area.join(' ')+'" fill="url(#'+grad2+')"/>'+
    '<path d="'+line.join(' ')+'" fill="none" stroke="url(#'+grad1+')" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
  // marcadores de evento real (abriu/fechou/funding) — direto do diário, não
  // decoração: cada bolinha é um evento que realmente aconteceu naquele ponto
  var corMarcador={abre:'#17d9ff',fecha:'#ff5c7a',funding:'#168cff'};
  for(var m=0;m<n;m++){
    var ev=pts[m].evento;
    var cor=corMarcador[ev];
    if(!cor)continue;
    var mx=X(m).toFixed(1), my=Y(pts[m].capital).toFixed(1);
    out+='<circle cx="'+mx+'" cy="'+my+'" r="3.4" fill="'+cor+'" stroke="'+corStroke+'" stroke-opacity=".25" stroke-width="4"><title>'+
      esc(ev==='abre'?'Posição aberta':ev==='fecha'?'Posição fechada':'Funding recebido')+' · '+new Date(pts[m].ts).toLocaleString('pt-BR')+
      ' · '+fmtUsd(pts[m].capital)+'</title></circle>';
  }
  svg.innerHTML=out;
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
  'Vigilância':'sb-vigilance','Custódia':'sb-custody','Motor':'sb-engine','Dashboard':'sb-dashboard',
  'Coletor':'sb-collector','Modo Agressivo':'sb-research','Preenchimento':'sb-costs','Pares':'sb-neutrality'
};
function renderProcessos(d){
  var procs=d.processos||[];
  renderIfChanged('processos',procs,function(){
    var html=procs.map(function(p){
      var uptime=p.vivo&&p.desde?diasDesde(p.desde):'—';
      var icone=ICONE_PROCESSO[p.nome]||'sb-processes';
      return '<div class="proc '+(p.vivo?'vivo':'morto')+'">'+
        '<div class="row"><svg class="sb-icon sb-icon--sm proc-ic"><use href="#'+icone+'"/></svg><span class="led '+(p.vivo?'on':'off')+'"></span><span class="nome">'+esc(p.nome)+'</span></div>'+
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

function iconeVazio(nome){
  return '<svg class="sb-icon sb-icon--xl" style="margin:0 auto 10px;display:block"><use href="#'+(nome||'sb-opportunities')+'"/></svg>';
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
  renderHeatmapSpread(scanBruto);
}
// heatmap: mesmo dado do scan, cor de fundo mapeada linearmente ao spread —
// nenhum número novo, só outra forma de olhar pro mesmo dado real
function renderHeatmapSpread(scan){
  var host=el('heatmap-spread');
  if(!host)return;
  renderIfChanged('heatmap',scan,function(){
    if(!scan.length){host.innerHTML='<div class="empty">sem candidatos pra desenhar ainda</div>';return}
    var maxSpread=Math.max.apply(null,scan.map(function(o){return o.spread||0}).concat([0.0001]));
    host.innerHTML='<div class="heatmap">'+scan.map(function(o){
      var frac=Math.max(0.08,(o.spread||0)/maxSpread);
      var alpha=(0.15+frac*0.75).toFixed(2);
      var nome=(o.symbol||'').replace('/USDT:USDT','');
      return '<div class="heat-cell" style="background:rgba(23,217,255,'+alpha+')" title="'+esc(nome)+' · '+esc(o.exchangeShort)+' → '+esc(o.exchangeLong)+' · spread '+fmtPct(o.spread,3)+' · '+(o.passaPortao?'passa o portão':'barrado')+'">'+
        '<span>'+esc(nome)+'</span><span class="hv">'+fmtPct(o.spread,2)+'</span></div>';
    }).join('')+'</div>';
  });
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
  var m=d.ml||{confiaveis:0,positivos:0,minimoNecessario:30,ultimoTreino:null};
  renderIfChanged('ml',m,function(){
    var pct=Math.min(100,(m.positivos/Math.max(1,m.minimoNecessario))*100);
    var html=
      '<div class="exprow"><span>Ciclos confiáveis</span><span>'+fmtNum(m.confiaveis)+'</span></div>'+
      '<div class="exprow"><span>Exemplos positivos</span><span>'+fmtNum(m.positivos)+' / '+fmtNum(m.minimoNecessario)+'</span></div>'+
      '<div class="progress-readiness"><i style="width:'+pct+'%"></i></div>'+
      '<div style="font-size:.7rem;color:var(--faint);margin-top:6px" class="num">'+(pct>=100?'pronto para treinar':pct.toFixed(0)+'% do mínimo para treinar')+'</div>';
    var t=m.ultimoTreino;
    if(!t){
      html+='<div class="empty" style="margin-top:14px">o coletor treina sozinho assim que houver positivos suficientes — pipeline pronto, só esperando o dado real acumular</div>';
    } else if(t.motivo){
      html+='<div class="empty" style="margin-top:14px">último treino real ('+timeAgo(t.treinadoEm)+'): '+esc(t.motivo)+'</div>';
    } else {
      html+='<div class="kpis" style="grid-template-columns:repeat(3,1fr);margin-top:14px">'+
        '<div class="kpi"><div class="lbl">AUC (holdout temporal)</div><div class="val num">'+(t.auc!=null?t.auc.toFixed(3):'—')+'</div></div>'+
        '<div class="kpi"><div class="lbl">Precisão</div><div class="val num">'+(t.precisao!=null?fmtPct(t.precisao,0):'—')+'</div></div>'+
        '<div class="kpi"><div class="lbl">Recall</div><div class="val num">'+(t.recall!=null?fmtPct(t.recall,0):'—')+'</div></div>'+
        '</div>'+
        '<p class="caption" style="margin-top:10px">Treinado '+timeAgo(t.treinadoEm)+' · '+fmtNum(t.amostraTreino)+' exemplos de treino ('+fmtNum(t.positivosTreino)+' positivos) · '+fmtNum(t.amostraTeste)+' de teste ('+fmtNum(t.positivosTeste)+' positivos). Corte por tempo, não aleatório — treina no passado, valida no futuro. Amostra ainda pequena: não é uma alegação de modelo pronto pra decidir nada sozinho.</p>';
    }
    el('ml-box').innerHTML=html;
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
var ULTIMO_DADO=null;
function render(d){
  ULTIMO_DADO=d;
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

// ============================================================
// PROFIT LAB — conexão, estado e render próprios, deliberadamente
// separados do render(d) do champion acima. Nunca mistura capital
// virtual de challenger com capital/equity do champion (Parte 1).
// ============================================================
var PL_ULTIMO=null, PL_CHAL_SEL=null, PL_LB_SORT={col:'pnlPaperAjustado',desc:true};
var PL_STATUS_LBL={saudavel:'saudável',degradado:'degradado',stale:'stale',parado:'parado',erro:'erro'};

function plUsuario(){
  var u=null;
  try{u=localStorage.getItem('snowball-pl-usuario')}catch(e){}
  if(!u){
    u=(window.prompt('Seu nome — fica registrado em toda ação de auditoria do Profit Lab:','operador')||'operador').trim()||'operador';
    try{localStorage.setItem('snowball-pl-usuario',u)}catch(e){}
  }
  return u;
}

function plChamarControle(acao,challengerId,extra){
  var usuario=plUsuario();
  var motivo=(extra&&extra.motivo!=null)?extra.motivo:(window.prompt('Motivo (fica registrado na auditoria):')||'');
  if((acao==='pausar')&&!motivo.trim()){window.alert('Motivo é obrigatório pra pausar.');return}
  var body={acao:acao,challengerId:challengerId,motivo:motivo,usuario:usuario};
  if(extra&&extra.texto!=null)body.texto=extra.texto;
  if(extra&&extra.status!=null)body.status=extra.status;
  fetch('/api/profit-lab/controle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){return r.json()})
    .then(function(j){
      if(!j.ok){window.alert('Não foi possível: '+(j.erro||'erro desconhecido'));return}
      plFetchUmaVez();
    }).catch(function(){window.alert('Falha de rede ao enviar o comando.')});
}

function plLinhaDetalhe(l,v){
  return '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:.82rem">'+
    '<span style="color:var(--dim)">'+esc(l)+'</span><span class="num" style="font-family:var(--mono);font-weight:700">'+v+'</span></div>';
}
function plFam(f){
  if(!f)return '—';
  return '<span class="pl-fam pl-fam-'+esc(f)+'">'+esc(f)+'</span>';
}
function plEvidencia(niv){
  var map={amostra_insuficiente:'amostra insuficiente',sinal_inicial:'sinal inicial',evidencia_intermediaria:'evidência intermediária',candidato_a_promocao:'candidato a promoção'};
  return '<span class="badge '+(niv==='candidato_a_promocao'?'ok':(niv==='amostra_insuficiente'?'warn':'ok'))+'">'+esc(map[niv]||niv||'—')+'</span>';
}
function plBadges(l){
  var b=[];
  if(l.eliminado)b.push('<span class="badge bad">eliminado</span>');
  if(l.pausado)b.push('<span class="badge warn">pausado</span>');
  if(l.altoRiscoAlavancagem)b.push('<span class="pl-risco-alto">alto risco</span>');
  if(l.recomendadoEliminar&&!l.eliminado)b.push('<span class="badge warn">resultado provisório</span>');
  return b.join(' ');
}

// ---- barra de status ----
function plRenderStatus(d){
  var host=el('pl-statusbar'); if(!host)return;
  var hb=d.heartbeat||{};
  var uptimeH=hb.startedAt?(Date.now()-hb.startedAt)/3600000:0;
  var idadeCicloMin=hb.ultimoCiclo?((Date.now()-hb.ultimoCiclo)/60000):null;
  var ativos=(d.resumo&&d.resumo.numeroAtivos!=null)?d.resumo.numeroAtivos:null;
  var pausados=(d.resumo&&d.resumo.numeroPausados!=null)?d.resumo.numeroPausados:null;
  var val=(d.championVsControl&&d.championVsControl.validacao)?d.championVsControl.validacao:null;
  var ccStatus=val?val.status:'validacao_em_andamento';
  var itens=[
    {lbl:'Champion',val:'operando',dot:'saudavel'},
    {lbl:'Paper Lab',val:PL_STATUS_LBL[d.status]||d.status||'—',dot:d.status},
    {lbl:'Control validation',val:ccStatus==='validado'?'validado':'validação em andamento',dot:ccStatus==='validado'?'saudavel':'validacao_em_andamento'},
    {lbl:'Challengers ativos',val:ativos!=null?String(ativos):'—'},
    {lbl:'Challengers pausados',val:pausados!=null?String(pausados):'—'},
    {lbl:'Último ciclo',val:hb.ultimoCiclo?timeAgo(hb.ultimoCiclo):'nunca'},
    {lbl:'Idade do feed',val:idadeCicloMin!=null?idadeCicloMin.toFixed(1)+'min':'—'},
    {lbl:'Uptime',val:fmtHoras(uptimeH)},
    {lbl:'Reinícios',val:String(hb.reinicios||0)},
    {lbl:'Erros 24h',val:d.telemetria?String(d.telemetria.errosUltimas24h):'—'}
  ];
  host.innerHTML=itens.map(function(it){
    return '<div class="pl-stat"><div class="lbl">'+esc(it.lbl)+'</div><div class="val">'+(it.dot?'<span class="pl-dot '+esc(it.dot)+'"></span>':'')+esc(it.val)+'</div></div>';
  }).join('');
  var alerta=el('pl-alerta-parado');
  if(alerta){
    if(d.status==='parado'){
      alerta.style.display='block';
      alerta.textContent='Paper Profit Lab não processa ciclos há '+(idadeCicloMin!=null?idadeCicloMin.toFixed(0):'muitos')+' minutos. O champion continua operando normalmente.';
    } else { alerta.style.display='none' }
  }
}

// ---- visão geral ----
function plRenderVisao(d){
  var host=el('pl-kpis-visao'); if(!host)return;
  var r=d.resumo;
  if(!r){host.innerHTML='<div class="empty">agregados ainda não existem — aguardando o primeiro ciclo do Lab</div>';return}
  var kpis=[
    {l:'PnL do champion',v:fmtUsd(r.champion.pnlRealizado)},
    {l:'PnL do control',v:r.control?fmtUsd(r.control.pnlBase):'—'},
    {l:'Melhor PnL challenger',v:r.melhorPnlBase.challengerId?(esc(r.melhorPnlBase.challengerId)+' · '+fmtUsd(r.melhorPnlBase.valor)):'—'},
    {l:'Melhor PnL ajustado',v:r.melhorPnlAjustado.challengerId?(esc(r.melhorPnlAjustado.challengerId)+' · '+fmtUsd(r.melhorPnlAjustado.valor)):'—'},
    {l:'Melhor retorno/margem',v:r.melhorRetornoPorMargem.challengerId?esc(r.melhorRetornoPorMargem.challengerId):'—'},
    {l:'Menor drawdown',v:r.menorDrawdown.challengerId?(esc(r.menorDrawdown.challengerId)+' · '+fmtNum(r.menorDrawdown.valor,1)+'%'):'—'},
    {l:'Maior frequência',v:r.maiorFrequencia.challengerId?esc(r.maiorFrequencia.challengerId):'—'},
    {l:'Menor custo',v:r.menorCusto.challengerId?esc(r.menorCusto.challengerId):'—'},
    {l:'Capital virtual total',v:fmtUsd(r.capitalVirtualTotal)},
    {l:'Trades paper',v:fmtNum(r.tradesTotaisPaper,0)},
    {l:'Settlements capturados',v:fmtNum(r.settlementsTotaisPaper,0)}
  ];
  host.innerHTML=kpis.map(function(k){return '<div class="kpi"><div class="lbl">'+esc(k.l)+'</div><div class="val">'+k.v+'</div></div>'}).join('');

  var c=r.champion;
  var ch=el('pl-champion-detalhe');
  if(ch){
    ch.innerHTML=[
      plLinhaDetalhe('PnL realizado',fmtUsd(c.pnlRealizado)),
      plLinhaDetalhe('PnL não realizado (mark)',fmtUsd(c.pnlNaoRealizadoMark)),
      plLinhaDetalhe('PnL não realizado (executável)',fmtUsd(c.pnlNaoRealizadoExecutavel)),
      plLinhaDetalhe('Equity mark',fmtUsd(c.equityMark)),
      plLinhaDetalhe('Equity de liquidação',fmtUsd(c.equityLiquidacao)),
      plLinhaDetalhe('Funding bruto',fmtUsd(c.fundingBruto)),
      plLinhaDetalhe('Custos totais',fmtUsd(c.custosTotais)),
      plLinhaDetalhe('PnL %',fmtNum(c.pnlPct,2)+'%')
    ].join('')+(c.marcacaoDisponivel?'':'<div class="empty" style="margin-top:10px">marcação a mercado ainda não disponível — mostrando só o realizado</div>');
  }
  var cd=el('pl-control-detalhe');
  if(cd){
    cd.innerHTML=r.control?[
      plLinhaDetalhe('PnL base',fmtUsd(r.control.pnlBase)),
      plLinhaDetalhe('PnL ajustado',fmtUsd(r.control.pnlAjustado)),
      plLinhaDetalhe('Retorno %',fmtNum(r.control.retornoPct,2)+'%'),
      plLinhaDetalhe('Trades',fmtNum(r.control.trades,0))
    ].join(''):'<div class="empty">control ainda não tem linha no leaderboard</div>';
  }
}

// ---- champion vs control ----
var PL_CC_TIPOS=[
  {chave:'candidata_rejeitada',lbl:'Candidatas rejeitadas'},
  {chave:'abertura_normal',lbl:'Entradas'},
  {chave:'abertura_parcial',lbl:'Entradas parciais'},
  {chave:'escalonamento',lbl:'Escalonamentos'},
  {chave:'apara',lbl:'Aparas'},
  {chave:'reinvestimento',lbl:'Reinvestimentos'},
  {chave:'funding',lbl:'Funding'},
  {chave:'saida',lbl:'Saídas'},
  {chave:'captura',lbl:'Captura'},
  {chave:'bloqueio_por_saldo',lbl:'Bloqueios por saldo'}
];
var PL_CC_CHECKLIST=[
  {tipos:['abertura_normal','abertura_parcial'],lbl:'abertura observada'},
  {tipos:['saida'],lbl:'fechamento observado'},
  {tipos:['funding'],lbl:'funding observado'},
  {tipos:['escalonamento'],lbl:'escalonamento observado'},
  {tipos:['apara'],lbl:'apara observada'},
  {tipos:['reinvestimento'],lbl:'reinvestimento observado'},
  {tipos:['bloqueio_por_saldo'],lbl:'bloqueio por saldo observado'},
  {tipos:['captura'],lbl:'captura observada'},
  {tipos:['multiplas_posicoes'],lbl:'múltiplas posições observadas'}
];
function plRenderChampionControl(d){
  var tabela=el('pl-cc-table'), checklist=el('pl-cc-checklist'), fidel=el('pl-cc-fidelidade'), statusTag=el('pl-cc-status');
  if(!tabela)return;
  var payload=d.championVsControl;
  if(!payload||!payload.validacao){
    tabela.innerHTML='<tr><td colspan="4" class="empty">validação ainda não rodou — o control precisa acumular decisões comparáveis primeiro</td></tr>';
    if(checklist)checklist.innerHTML='';
    if(fidel)fidel.innerHTML='';
    if(statusTag)statusTag.textContent='';
    return;
  }
  var val=payload.validacao;
  if(statusTag)statusTag.textContent=val.status==='validado'?'validado':'validação em andamento — nunca marcado como validado só por % alto em poucos eventos';

  var comps=val.comparacoes||[];
  function contaChampion(tipo){return comps.filter(function(c){return c.eventoChampion===tipo}).length}
  function contaControl(tipo){return comps.filter(function(c){return c.eventoControl===tipo}).length}
  var somaCustoChampion=comps.reduce(function(s,c){return s+(c.custoChampion||0)},0);
  var somaCustoControl=comps.reduce(function(s,c){return s+(c.custoControl||0)},0);
  var ultimoCapChampion=null;
  for(var i=comps.length-1;i>=0;i--){if(comps[i].capitalChampion!=null){ultimoCapChampion=comps[i].capitalChampion;break}}

  var linhas=PL_CC_TIPOS.map(function(t){
    var ch=contaChampion(t.chave), cc=contaControl(t.chave);
    return '<tr><td>'+esc(t.lbl)+'</td><td class="num">'+ch+'</td><td class="num">'+cc+'</td><td class="num">'+(ch-cc)+'</td></tr>';
  });
  linhas.push('<tr><td>Custos (soma, US$)</td><td class="num">'+somaCustoChampion.toFixed(3)+'</td><td class="num">'+somaCustoControl.toFixed(3)+'</td><td class="num">'+(somaCustoChampion-somaCustoControl).toFixed(3)+'</td></tr>');
  linhas.push('<tr><td>Capital realizado (champion, último visto)</td><td class="num">'+(ultimoCapChampion!=null?fmtUsd(ultimoCapChampion):'—')+'</td><td class="num">—</td><td class="num">—</td></tr>');
  linhas.push('<tr><td>Equity</td><td class="num" colspan="3" style="color:var(--faint)">não comparável evento a evento nesta versão — ver Visão geral</td></tr>');
  tabela.innerHTML=linhas.join('');

  if(checklist){
    checklist.innerHTML='<div class="pl-checklist">'+PL_CC_CHECKLIST.map(function(item){
      var ok=item.tipos.some(function(t){return val.tiposDeEventoCobertos.indexOf(t)!==-1});
      return '<div class="pl-check'+(ok?' done':'')+'"><span class="box">'+(ok?'✓':'')+'</span><span>'+esc(item.lbl)+'</span></div>';
    }).join('')+'</div>';
  }
  if(fidel){
    fidel.innerHTML=
      plLinhaDetalhe('fidelidadeDecisoes',fmtPct(val.fidelidadeDecisoes,1))+
      plLinhaDetalhe('decisoesComparaveis',String(val.decisoesComparaveis))+
      plLinhaDetalhe('decisoesIguais',String(val.decisoesIguais))+
      plLinhaDetalhe('decisoesDivergentes',String(val.decisoesComparaveis-val.decisoesIguais))+
      '<div style="margin-top:10px;font-size:.72rem;color:var(--faint)">tiposDeEventoFaltando: '+(val.tiposDeEventoFaltando.length?esc(val.tiposDeEventoFaltando.join(', ')):'nenhum')+'</div>';
  }
}

// ---- leaderboard ----
function plOrdenarLinhas(linhas){
  var col=PL_LB_SORT.col, desc=PL_LB_SORT.desc;
  return linhas.slice().sort(function(a,b){
    var av=a[col], bv=b[col];
    if(typeof av!=='number')av=0; if(typeof bv!=='number')bv=0;
    return desc?(bv-av):(av-bv);
  });
}
function plRenderLeaderboard(d){
  var body=el('pl-lb-body'); if(!body)return;
  var lb=d.leaderboard;
  if(!lb||!lb.linhas||!lb.linhas.length){body.innerHTML='<tr><td colspan="11" class="empty">leaderboard ainda vazio</td></tr>';return}
  var filtroFam=el('pl-lb-familia')?el('pl-lb-familia').value:'todas';
  var linhas=lb.linhas.filter(function(l){return filtroFam==='todas'||l.familia===filtroFam});
  linhas=plOrdenarLinhas(linhas);
  body.innerHTML=linhas.map(function(l,i){
    var acoes=l.pausado
      ? '<button class="pl-btn" data-pl-acao="retomar" data-pl-id="'+esc(l.challengerId)+'">retomar</button>'
      : '<button class="pl-btn danger" data-pl-acao="pausar" data-pl-id="'+esc(l.challengerId)+'">pausar</button>';
    return '<tr>'+
      '<td class="num">'+(i+1)+'</td>'+
      '<td><b>'+esc(l.challengerId)+'</b> '+plBadges(l)+'</td>'+
      '<td>'+plFam(l.familia)+'</td>'+
      '<td class="num">'+l.trades+'</td>'+
      '<td class="num">'+fmtUsd(l.pnlPaperBase)+'</td>'+
      '<td class="num">'+fmtUsd(l.pnlPaperAjustado)+'</td>'+
      '<td class="num '+(l.pnlIncremental>=0?'up':'down')+'">'+(l.pnlIncremental>=0?'+':'')+fmtNum(l.pnlIncremental,2)+'pp</td>'+
      '<td class="num">'+fmtNum(l.retornoPorMargem*100,2)+'%</td>'+
      '<td class="num">'+fmtNum(l.drawdownMaxPct,1)+'%</td>'+
      '<td>'+plEvidencia(l.nivelEvidencia)+'</td>'+
      '<td>'+acoes+'</td>'+
      '</tr>';
  }).join('');
}

// ---- challengers (lista + detalhe) ----
function plRenderChallengers(d){
  var lista=el('pl-chal-lista'), count=el('pl-chal-count');
  if(!lista)return;
  var lb=d.leaderboard;
  if(!lb||!lb.linhas){lista.innerHTML='<div class="empty">nenhum challenger ainda</div>';return}
  if(count)count.textContent=lb.linhas.length+' aprovados';
  lista.innerHTML=lb.linhas.map(function(l){
    return '<div class="pl-chal-item'+(PL_CHAL_SEL===l.challengerId?' active':'')+'" data-pl-chal="'+esc(l.challengerId)+'">'+
      '<div class="row1"><span class="id">'+esc(l.challengerId)+'</span>'+plFam(l.familia)+'</div>'+
      '<div style="margin-top:4px;font-size:.7rem;color:var(--dim)">'+fmtUsd(l.pnlPaperAjustado)+' · '+l.trades+' trades'+(l.pausado?' · pausado':'')+'</div>'+
      '</div>';
  }).join('');
  if(PL_CHAL_SEL)plRenderChallengerDetalhe(PL_CHAL_SEL,d);
}
function plRenderChallengerDetalhe(id,d){
  var host=el('pl-chal-detalhe'), tag=el('pl-chal-detalhe-tag');
  if(!host)return;
  var linha=(d.leaderboard&&d.leaderboard.linhas||[]).find(function(l){return l.challengerId===id});
  var cfg=(d.aprovados||[]).find(function(c){return c.challengerId===id});
  if(tag)tag.textContent=id;
  if(!linha){host.innerHTML='<div class="empty">sem dados ainda pra este challenger</div>';return}
  var acoes='<div style="display:flex;gap:8px;margin:10px 0;flex-wrap:wrap">'+
    (linha.pausado
      ? '<button class="pl-btn" data-pl-acao="retomar" data-pl-id="'+esc(id)+'">retomar</button>'
      : '<button class="pl-btn danger" data-pl-acao="pausar" data-pl-id="'+esc(id)+'">pausar</button>')+
    '<button class="pl-btn" data-pl-acao="observacao" data-pl-id="'+esc(id)+'">adicionar observação</button>'+
    '<button class="pl-btn" data-pl-acao="duplicar" data-pl-id="'+esc(id)+'">duplicar como nova versão</button>'+
    '</div>';
  var basico=[
    plLinhaDetalhe('Versão / config',esc(linha.hipotese?'':'')+esc(cfg?cfg.familia+' · '+id:id)),
    plLinhaDetalhe('Família',plFam(linha.familia)),
    plLinhaDetalhe('Status',esc(linha.experimentoStatus||'—')),
    plLinhaDetalhe('Config desde',linha.configDesde?timeAgo(linha.configDesde):'—'),
    plLinhaDetalhe('PnL realizado',fmtUsd(linha.pnlPaperBruto)),
    plLinhaDetalhe('PnL ajustado (base)',fmtUsd(linha.pnlPaperAjustado)),
    plLinhaDetalhe('Equity',fmtUsd(linha.equity)),
    plLinhaDetalhe('Drawdown',fmtNum(linha.drawdownMaxPct,1)+'%'),
    plLinhaDetalhe('Trades',String(linha.trades)),
    plLinhaDetalhe('Settlements',String(linha.settlements)),
    plLinhaDetalhe('Custos totais',fmtUsd(linha.custosTotais)),
    plLinhaDetalhe('Fee/gross',isFinite(linha.feeToGross)?fmtNum(linha.feeToGross*100,1)+'%':'∞'),
    plLinhaDetalhe('Capital ocioso',fmtUsd(linha.capitalOcioso)),
    plLinhaDetalhe('Concentração máxima',fmtNum(linha.concentracaoMaxima*100,1)+'%'),
    plLinhaDetalhe('Nível de evidência',plEvidencia(linha.nivelEvidencia))
  ].join('');
  var hipotese=linha.hipotese?'<div class="empty" style="text-align:left;margin:10px 0">'+esc(linha.hipotese)+'</div>':'';
  var cfgHtml='';
  if(cfg){
    cfgHtml='<div class="pl-cfg-grid">'+
      ['exchanges: '+((cfg.exchanges||[]).join(', ')),'capital/exchange: US$ '+cfg.capitalPorExchange,'alavancagem: '+cfg.alavancagem+'x',
       'reserva: '+fmtNum(cfg.reserva*100,0)+'%','margemPayback: '+cfg.margemPayback+'x','maxPosicoes: '+cfg.maxPosicoes,
       'fracaoEstagioInicial: '+(cfg.fracaoEstagioInicial!=null?fmtNum(cfg.fracaoEstagioInicial*100,0)+'%':'padrão (25%)'),
       'modoEscalonamento: '+(cfg.modoEscalonamento||'imediato')
      ].map(function(s){var kv=s.split(': ');return '<div class="pl-cfg-item"><div class="k">'+esc(kv[0])+'</div><div class="v">'+esc(kv[1])+'</div></div>'}).join('')+
      '</div>';
  }
  host.innerHTML=hipotese+acoes+basico+'<h3 style="font-size:.8rem;margin:16px 0 4px">Configuração completa (somente leitura)</h3>'+cfgHtml;

  // eventos recentes — busca sob demanda, não vem no payload principal
  fetch('/api/profit-lab/challenger?id='+encodeURIComponent(id)).then(function(r){return r.json()}).then(function(j){
    if(!j.ok||!j.diario)return;
    var eventos=j.diario.slice(0,25);
    var html='<h3 style="font-size:.8rem;margin:16px 0 4px">Últimos eventos</h3>'+
      (eventos.length?'<div class="timeline">'+eventos.map(function(ev){
        var cor=corEvento[ev.evento]||'#516a8c';
        var titulo=(ev.evento||'evento')+(ev.symbol?' · '+ev.symbol.replace('/USDT:USDT',''):'');
        return '<div class="tl-item"><span class="tl-dot" style="background:'+cor+'"></span>'+
          '<div class="tl-body"><b>'+esc(titulo)+'</b><div class="motivo">'+esc(ev.motivo||ev.detalhe||'')+'</div></div>'+
          '<div class="tl-time">'+timeAgo(ev.ts)+'</div></div>';
      }).join('')+'</div>':'<div class="empty">sem eventos ainda</div>');
    var atual=el('pl-chal-detalhe');
    if(atual && PL_CHAL_SEL===id) atual.innerHTML+=html;
  }).catch(function(){});
}

// ---- experimentos ----
function plRenderExperimentos(d){
  var body=el('pl-exp-body'); if(!body)return;
  var lb=d.leaderboard;
  if(!lb||!lb.linhas.length){body.innerHTML='<tr><td colspan="7" class="empty">nenhum experimento ainda</td></tr>';return}
  body.innerHTML=lb.linhas.map(function(l){
    return '<tr><td><b>'+esc(l.challengerId)+'</b></td><td>'+plFam(l.familia)+'</td>'+
      '<td style="max-width:280px;white-space:normal">'+esc(l.hipotese||'—')+'</td>'+
      '<td>'+(l.configDesde?timeAgo(l.configDesde):'—')+'</td>'+
      '<td>'+esc(l.experimentoStatus||'—')+'</td>'+
      '<td>'+l.trades+' trades</td>'+
      '<td><select class="pl-exp-status" data-pl-id="'+esc(l.challengerId)+'">'+
        ['planejado','rodando','pausado','concluido','eliminado','inconclusivo'].map(function(s){
          return '<option value="'+s+'"'+(s===l.experimentoStatus?' selected':'')+'>'+s+'</option>';
        }).join('')+'</select></td></tr>';
  }).join('');
}

// ---- frequência ----
function plRenderFrequencia(d){
  var funilHost=el('pl-funil'), motivosHost=el('pl-motivos-rejeicao'), gridBody=el('pl-payback-grid-body');
  var f=d.frequencia;
  if(!f){if(funilHost)funilHost.innerHTML='<div class="empty">sem dados ainda</div>';return}
  if(funilHost){
    var etapas=[
      {l:'Observadas',v:f.funilGlobal.observadas},
      {l:'Avaliadas',v:f.funilGlobal.avaliadas},
      {l:'Aprovadas pelo portão',v:f.funilGlobal.aprovadasPeloPortao},
      {l:'Abertas',v:f.funilGlobal.abertas},
      {l:'Chegaram ao settlement',v:f.funilGlobal.chegaramAoSettlement}
    ];
    var max=Math.max(1,etapas[0].v);
    funilHost.innerHTML=etapas.map(function(e){
      var pct=Math.min(100,(e.v/max)*100);
      return '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:4px"><span>'+esc(e.l)+'</span><span class="num">'+fmtNum(e.v,0)+'</span></div>'+
        '<div class="barmeter"><i style="width:'+pct+'%"></i></div></div>';
    }).join('')+'<div style="margin-top:8px;font-size:.72rem;color:var(--faint)">ciclos com candidata: '+f.global.ciclosComCandidata+' · sem candidata: '+f.global.ciclosSemCandidata+'</div>';
  }
  if(motivosHost){
    var m=f.motivosRejeicao;
    motivosHost.innerHTML=[
      plLinhaDetalhe('Payback insuficiente',fmtNum(m.paybackInsuficiente,0)),
      plLinhaDetalhe('Saldo',fmtNum(m.saldo,0)),
      plLinhaDetalhe('Liquidez',m.liquidez==null?'não instrumentado':String(m.liquidez)),
      plLinhaDetalhe('Custo',m.conCusto==null?'não instrumentado':String(m.conCusto)),
      plLinhaDetalhe('Consistência',m.consistencia==null?'não instrumentado':String(m.consistencia)),
      plLinhaDetalhe('Reserva',m.reserva==null?'não instrumentado':String(m.reserva)),
      plLinhaDetalhe('Concentração',m.concentracao==null?'não instrumentado':String(m.concentracao)),
      plLinhaDetalhe('Risco',m.risco==null?'não instrumentado':String(m.risco)),
      plLinhaDetalhe('Fora da janela de captura',m.foraDaJanelaDeCaptura==null?'não instrumentado':String(m.foraDaJanelaDeCaptura))
    ].join('')+'<div style="margin-top:10px;font-size:.72rem;color:var(--faint)">'+esc(m.nota)+'</div>';
  }
  if(gridBody){
    gridBody.innerHTML=f.paybackGrid.length?f.paybackGrid.map(function(g){
      return '<tr><td><b>'+fmtNum(g.margemPayback,2)+'x</b> <span style="color:var(--faint);font-size:.7rem">'+esc(g.challengerId)+'</span></td>'+
        '<td class="num">'+g.trades+'</td><td class="num">'+fmtUsd(g.funding)+'</td><td class="num">'+fmtUsd(g.custosTotais)+'</td>'+
        '<td class="num">'+fmtUsd(g.pnlBase)+'</td><td class="num">'+(isFinite(g.feeToGross)?fmtNum(g.feeToGross*100,1)+'%':'∞')+'</td>'+
        '<td class="num">'+fmtNum(g.drawdownMaxPct,1)+'%</td></tr>';
    }).join(''):'<tr><td colspan="7" class="empty">grid ainda sem dados</td></tr>';
  }
}

// ---- custos ----
function plRenderCustos(d){
  var champHost=el('pl-custos-champion'), body=el('pl-custos-body');
  var c=d.custos;
  if(!c){if(body)body.innerHTML='<tr><td colspan="6" class="empty">sem dados ainda</td></tr>';return}
  if(champHost){
    champHost.innerHTML=c.champion?[
      plLinhaDetalhe('Trading puro',fmtUsd(c.champion.custoTradingPuro)),
      plLinhaDetalhe('Gerenciamento',fmtUsd(c.champion.custoGerenciamento)),
      plLinhaDetalhe('Total',fmtUsd(c.champion.custoTotal)),
      plLinhaDetalhe('Fee/gross trading',isFinite(c.champion.feeToGrossTrading)?fmtNum(c.champion.feeToGrossTrading*100,1)+'%':'∞'),
      plLinhaDetalhe('Fee/gross total',isFinite(c.champion.feeToGrossTotal)?fmtNum(c.champion.feeToGrossTotal*100,1)+'%':'∞')
    ].join(''):'<div class="empty">decomposição do champion ainda não disponível (poucos eventos na janela lida)</div>';
  }
  if(body){
    body.innerHTML=c.porChallenger.length?c.porChallenger.map(function(l){
      return '<tr><td><b>'+esc(l.challengerId)+'</b></td><td class="num">'+fmtUsd(l.custoTradingPuro)+'</td><td class="num">'+fmtUsd(l.custoGerenciamento)+'</td>'+
        '<td class="num">'+fmtUsd(l.custoTotal)+'</td><td class="num">'+(isFinite(l.feeToGrossTrading)?fmtNum(l.feeToGrossTrading*100,1)+'%':'∞')+'</td>'+
        '<td class="num">'+(isFinite(l.feeToGrossTotal)?fmtNum(l.feeToGrossTotal*100,1)+'%':'∞')+'</td></tr>';
    }).join(''):'<tr><td colspan="6" class="empty">sem challengers ainda</td></tr>';
  }
}

// ---- capital ----
function plRenderCapital(d){
  var body=el('pl-capital-body'); if(!body)return;
  var r=d.riscos;
  if(!r||!r.porChallenger.length){body.innerHTML='<tr><td colspan="5" class="empty">sem dados ainda</td></tr>';return}
  body.innerHTML=r.porChallenger.map(function(l){
    return '<tr><td><b>'+esc(l.challengerId)+'</b></td><td>'+plFam(l.familia)+'</td><td class="num">'+l.posicoesAbertas+'</td>'+
      '<td class="num">'+fmtUsd(l.capitalOcioso)+'</td><td class="num">'+fmtNum(l.concentracaoMaxima*100,1)+'%</td></tr>';
  }).join('');
}

// ---- risco e realismo ----
function plRenderRisco(d){
  var body=el('pl-risco-body'), cenariosHost=el('pl-cenarios');
  var r=d.riscos;
  if(body){
    body.innerHTML=(r&&r.porChallenger.length)?r.porChallenger.map(function(l){
      return '<tr><td><b>'+esc(l.challengerId)+'</b></td><td class="num">'+fmtNum(l.drawdownMaxPct,1)+'%</td>'+
        '<td class="num">'+fmtNum(l.concentracaoMaxima*100,1)+'%</td>'+
        '<td>'+(l.altoRiscoAlavancagem?'<span class="pl-risco-alto">EXPLORAÇÃO PAPER — ALTO RISCO</span>':'padrão')+'</td></tr>';
    }).join(''):'<tr><td colspan="4" class="empty">sem dados ainda</td></tr>';
  }
  if(cenariosHost){
    var lb=d.leaderboard;
    if(!lb||!lb.linhas.length){cenariosHost.innerHTML='<div class="empty">sem dados ainda</div>';return}
    cenariosHost.innerHTML=lb.linhas.slice(0,12).map(function(l){
      return '<div class="pl-cenario-card"><h3>'+esc(l.challengerId)+' '+(l.altoRiscoAlavancagem?'<span class="pl-risco-alto">alto risco</span>':'')+'</h3>'+
        '<div style="overflow-x:auto"><table><thead><tr><th>Cenário</th><th>PnL ajustado</th></tr></thead><tbody>'+
        ['ideal','base','conservador','stress'].map(function(nome){
          return '<tr><td>'+esc(nome)+'</td><td class="num">'+fmtUsd(l.cenarios[nome])+'</td></tr>';
        }).join('')+'</tbody></table></div></div>';
    }).join('');
  }
}

// ---- telemetria ----
function plRenderTelemetria(d){
  var kpisHost=el('pl-telemetria-kpis'), statusHost=el('pl-telemetria-status');
  var t=d.telemetria;
  if(!t){if(kpisHost)kpisHost.innerHTML='<div class="empty">sem dados ainda</div>';return}
  if(kpisHost){
    var kpis=[
      {l:'Uptime',v:fmtHoras(t.uptimeMs/3600000)},
      {l:'Ciclos processados',v:fmtNum(t.ciclosProcessados,0)},
      {l:'Ciclos com erro',v:fmtNum(t.ciclosComErro,0)},
      {l:'Reinícios',v:fmtNum(t.reinicios,0)},
      {l:'Latência p50',v:fmtNum(t.latencia.p50,0)+'ms'},
      {l:'Latência p95',v:fmtNum(t.latencia.p95,0)+'ms'},
      {l:'Latência p99',v:fmtNum(t.latencia.p99,0)+'ms'},
      {l:'Latência máxima',v:fmtNum(t.latencia.max,0)+'ms'},
      {l:'Erros últimas 24h',v:fmtNum(t.errosUltimas24h,0)},
      {l:'Idade do último ciclo',v:isFinite(t.idadeUltimoCicloMs)?fmtHoras(t.idadeUltimoCicloMs/3600000):'nunca rodou'}
    ];
    kpisHost.innerHTML=kpis.map(function(k){return '<div class="kpi"><div class="lbl">'+esc(k.l)+'</div><div class="val">'+k.v+'</div></div>'}).join('');
  }
  if(statusHost){
    var entradas=Object.keys(t.statusPorChallenger||{});
    statusHost.innerHTML=entradas.length?entradas.map(function(id){
      var st=t.statusPorChallenger[id];
      var cls=st==='ok'?'ok':(st==='eliminado'?'':'bad');
      return '<div class="proc'+(st!=='ok'?' morto':'')+'"><div class="proc-nome">'+esc(id)+'</div><div class="proc-status">'+esc(st)+'</div></div>';
    }).join(''):'<div class="empty">sem status ainda</div>';
  }
}

// ---- relatórios da IA ----
function plMarkdownSimples(md){
  // conversor propositalmente mínimo — só o suficiente pro relatório do LLM
  // Profit Analyst (gerarRelatorioDiario/formatarMarkdown), nunca genérico
  var linhas=md.split('\\n');
  var html=linhas.map(function(l){
    if(l.indexOf('### ')===0)return '<h3>'+esc(l.slice(4))+'</h3>';
    if(l.indexOf('## ')===0)return '<h2>'+esc(l.slice(3))+'</h2>';
    if(l.indexOf('# ')===0)return '<h1>'+esc(l.slice(2))+'</h1>';
    if(l.indexOf('- ')===0)return '<div style="margin-left:14px">• '+esc(l.slice(2))+'</div>';
    if(!l.trim())return '<div style="height:6px"></div>';
    return '<p>'+esc(l)+'</p>';
  }).join('');
  return html;
}
function plRenderRelatorios(d){
  var host=el('pl-relatorio-md'), dataTag=el('pl-relatorio-data'), audBody=el('pl-auditoria-body');
  var r=d.relatorios;
  if(host){
    if(r&&r.maisRecente){
      if(dataTag)dataTag.textContent=r.maisRecente.data;
      host.innerHTML=plMarkdownSimples(r.maisRecente.markdown);
    } else {
      host.innerHTML='<div class="empty">nenhum relatório diário gerado ainda</div>';
    }
  }
  if(audBody){
    var aud=d.auditoria||[];
    audBody.innerHTML=aud.length?aud.slice(0,50).map(function(ev){
      return '<tr><td>'+new Date(ev.ts).toLocaleString('pt-BR')+'</td><td>'+esc(ev.usuario)+'</td><td>'+esc(ev.acao)+'</td>'+
        '<td>'+esc(ev.challenger)+'</td><td style="max-width:280px;white-space:normal">'+esc(ev.motivo||'')+'</td></tr>';
    }).join(''):'<tr><td colspan="5" class="empty">nenhuma ação registrada ainda</td></tr>';
  }
}

function plRender(d){
  PL_ULTIMO=d;
  plRenderStatus(d);
  plRenderVisao(d);
  plRenderChampionControl(d);
  plRenderLeaderboard(d);
  plRenderChallengers(d);
  plRenderExperimentos(d);
  plRenderFrequencia(d);
  plRenderCustos(d);
  plRenderCapital(d);
  plRenderRisco(d);
  plRenderTelemetria(d);
  plRenderRelatorios(d);
}

// ---- sub-navegação, ordenação, cliques delegados ----
(function(){
  var subnav=el('pl-subnav');
  if(!subnav)return;
  subnav.addEventListener('click',function(ev){
    var btn=ev.target.closest('.pl-tab'); if(!btn)return;
    var alvo=btn.getAttribute('data-pl');
    document.querySelectorAll('.pl-tab').forEach(function(b){b.classList.remove('active')});
    document.querySelectorAll('.pl-page').forEach(function(p){p.classList.remove('active')});
    btn.classList.add('active');
    var page=el('pl-page-'+alvo); if(page)page.classList.add('active');
  });

  var lbTable=el('pl-lb-table');
  if(lbTable)lbTable.addEventListener('click',function(ev){
    var th=ev.target.closest('.sortable'); if(!th)return;
    var col=th.getAttribute('data-col');
    if(PL_LB_SORT.col===col)PL_LB_SORT.desc=!PL_LB_SORT.desc; else PL_LB_SORT={col:col,desc:true};
    if(PL_ULTIMO)plRenderLeaderboard(PL_ULTIMO);
  });
  var lbFam=el('pl-lb-familia');
  if(lbFam)lbFam.addEventListener('change',function(){if(PL_ULTIMO)plRenderLeaderboard(PL_ULTIMO)});

  var chalLista=el('pl-chal-lista');
  if(chalLista)chalLista.addEventListener('click',function(ev){
    var item=ev.target.closest('[data-pl-chal]'); if(!item)return;
    PL_CHAL_SEL=item.getAttribute('data-pl-chal');
    if(PL_ULTIMO)plRenderChallengers(PL_ULTIMO);
  });

  var expBody=el('pl-exp-body');
  if(expBody)expBody.addEventListener('change',function(ev){
    var sel=ev.target.closest('.pl-exp-status'); if(!sel)return;
    plChamarControle('status-experimento',sel.getAttribute('data-pl-id'),{status:sel.value,motivo:'alterado via página Experimentos'});
  });

  // ações delegadas (pausar/retomar/observação/duplicar) em qualquer página do Profit Lab
  el('panel-profitlab').addEventListener('click',function(ev){
    var btn=ev.target.closest('[data-pl-acao]'); if(!btn)return;
    var acao=btn.getAttribute('data-pl-acao'), id=btn.getAttribute('data-pl-id');
    if(acao==='observacao'){
      var texto=window.prompt('Observação para '+id+':');
      if(texto&&texto.trim())plChamarControle('observacao',id,{texto:texto,motivo:'observação via dashboard'});
      return;
    }
    if(acao==='duplicar'){
      plChamarControle('duplicar',id,{motivo:'tentativa via dashboard'});
      return;
    }
    plChamarControle(acao,id,{});
  });
})();

function plFetchUmaVez(){
  fetch('/api/profit-lab/dados').then(function(r){return r.json()}).then(plRender).catch(function(){});
}

var plEs=null, plPoll=null;
function plPararPolling(){if(plPoll){clearInterval(plPoll);plPoll=null}}
function plIniciarPolling(){plPararPolling();plPoll=setInterval(plFetchUmaVez,8000)}
function plConectar(){
  try{plEs=new EventSource('/api/profit-lab/stream')}catch(e){plIniciarPolling();return}
  plEs.onopen=function(){plPararPolling()};
  plEs.onmessage=function(ev){try{plRender(JSON.parse(ev.data))}catch(e){}};
  plEs.onerror=function(){if(plEs)plEs.close();plIniciarPolling();setTimeout(plConectar,6000)};
}
plConectar();

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
