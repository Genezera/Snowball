/**
 * Dashboard — sexta geração, refeita do zero a pedido explícito do usuário:
 * "completamente diferente do de agora, tudo diferente, cores, tudo, mude a
 * identidade". A quinta geração era vidro escuro com acento ciano/violeta
 * ("terminal de observação"); esta é o oposto de propósito — PAPEL CLARO,
 * tinta preta, sem gradiente, sem blur, sem brilho neon. O conceito é uma
 * FICHA DE REGISTRO/LIVRO-CAIXA: cor só aparece para dizer ganho, perda ou
 * alerta — o resto é preto sobre creme, hairlines finas, carimbos em vez de
 * pontos pulsando de neon.
 *
 * A sessão anterior tinha dois bugs reais que não eram estética:
 *
 * 1. "Processos: não detectado" com os 5 vivos — corrigido no server.ts
 *    (mesmo bug de barra invertida do watchdog, em código irmão).
 * 2. O basis trade (e, sem o usuário ter reparado ainda, o resto das
 *    seções "lentas") piscava porque render() reconstruía TODO innerHTML
 *    a cada tick de preço ao vivo (~2,5s), mesmo quando o dado da seção
 *    não tinha mudado nada. Corrigido aqui com `renderIfChanged(chave,
 *    dado, fn)`: cada seção guarda o hash do que renderizou por último e
 *    só toca o DOM de novo se o dado mudou de verdade. Isso não é só o
 *    basis — era sistêmico (scan, custódia, coleta, ML, timeline, contas,
 *    exposição, processos, watchdog sofriam do mesmo problema em grau
 *    menor, só menos visível que o basis por causa da cor).
 *
 * Regras que já quebraram este arquivo antes, repetidas porque continuam
 * valendo:
 *
 * 1. NENHUMA CRASE fora da abertura/fechamento do template literal — nem
 *    dentro de comentário do <script>. Uma crase solta fecha a string e
 *    derruba o servidor com erro de sintaxe apontando pro lugar errado.
 * 2. Por causa da regra 1, o JavaScript do cliente NUNCA usa template
 *    literals — só concatenação com "+" e Array.join('').
 */
export const PAGINA = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Snowball · Livro-caixa</title>
<style>
:root{
  --paper:#f3efe4; --paper2:#eae4d3; --card:#faf7ee;
  --ink:#201c14; --ink-dim:#6b6455; --ink-faint:#a39a86;
  --line:rgba(32,28,20,.14); --line-strong:rgba(32,28,20,.34);
  --green:#1f6f4a; --green-bg:#e3ece3; --red:#a3291f; --red-bg:#f3e2df;
  --amber:#93641c; --amber-bg:#f1e6cf; --blue:#2c5a7a; --blue-bg:#e3ecf1;
  --serif:Georgia,'Iowan Old Style','Palatino Linotype',serif;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;
}
:root[data-theme="dark"]{
  --paper:#171410; --paper2:#0f0d0a; --card:#1d1a14;
  --ink:#ece6d6; --ink-dim:#a89d85; --ink-faint:#6b6350;
  --line:rgba(236,230,214,.14); --line-strong:rgba(236,230,214,.3);
  --green:#6fbf8f; --green-bg:#1c2b20; --red:#e08a7d; --red-bg:#2e1c18;
  --amber:#d9ac5c; --amber-bg:#2c250f; --blue:#8fb8d6; --blue-bg:#182530;
}
@media(prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --paper:#171410; --paper2:#0f0d0a; --card:#1d1a14;
    --ink:#ece6d6; --ink-dim:#a89d85; --ink-faint:#6b6350;
    --line:rgba(236,230,214,.14); --line-strong:rgba(236,230,214,.3);
    --green:#6fbf8f; --green-bg:#1c2b20; --red:#e08a7d; --red-bg:#2e1c18;
    --amber:#d9ac5c; --amber-bg:#2c250f; --blue:#8fb8d6; --blue-bg:#182530;
  }
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--paper);
  background-image:
    repeating-linear-gradient(180deg,transparent,transparent 27px,var(--line) 28px),
    linear-gradient(180deg,var(--paper),var(--paper2));
  color:var(--ink); font-family:var(--sans); min-height:100vh;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1360px;margin:0 auto;padding:22px 24px 90px}

.masthead{display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:14px;border-bottom:3px solid var(--ink);padding-bottom:14px;margin-bottom:20px}
.masthead .id{display:flex;align-items:baseline;gap:12px}
.masthead h1{font-family:var(--serif);font-size:2.1rem;font-weight:700;margin:0;letter-spacing:-.01em}
.masthead .kicker{font-size:.72rem;text-transform:uppercase;letter-spacing:.14em;color:var(--ink-dim);font-weight:600}
.mstats{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end}
.stamp{border:1.5px solid var(--line-strong);padding:5px 11px;font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;display:inline-flex;align-items:center;gap:7px;background:var(--card)}
.stamp .led{width:7px;height:7px;border-radius:50%;flex:none}
.led.on{background:var(--green);animation:tick 2.4s steps(1) infinite}
.led.off{background:var(--red)}
.led.mid{background:var(--amber)}
@keyframes tick{0%,49%{opacity:1}50%,100%{opacity:.35}}
#clock{font-family:var(--mono);font-size:.78rem;color:var(--ink-dim)}
.themebtn{border:1.5px solid var(--line-strong);background:var(--card);color:var(--ink);font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:5px 11px;cursor:pointer;font-family:var(--sans)}
.themebtn:hover{background:var(--paper2);color:var(--paper)}

section{margin-bottom:20px}
.ledger{border:1.5px solid var(--ink);background:var(--card);position:relative}
.ledger::before{content:'';position:absolute;top:5px;left:5px;right:-5px;bottom:-5px;border:1.5px solid var(--line-strong);z-index:-1;pointer-events:none}
.ledger-head{display:flex;justify-content:space-between;align-items:baseline;padding:12px 16px;border-bottom:1.5px solid var(--ink);gap:10px;flex-wrap:wrap}
.ledger-head h2{font-family:var(--serif);font-size:1.02rem;font-weight:700;margin:0;letter-spacing:.01em}
.ledger-head .note{font-size:.7rem;color:var(--ink-dim);font-family:var(--mono)}
.ledger-body{padding:16px}

.figures{display:grid;grid-template-columns:repeat(6,1fr);gap:0;border:1.5px solid var(--ink);background:var(--card)}
.figures .fig{padding:14px 16px;border-right:1.5px solid var(--line-strong)}
.figures .fig:last-child{border-right:none}
@media(max-width:1100px){.figures{grid-template-columns:repeat(3,1fr)}.figures .fig:nth-child(3n){border-right:none}}
@media(max-width:640px){.figures{grid-template-columns:repeat(2,1fr)}.figures .fig:nth-child(2n){border-right:none}}
.fig .lbl{font-size:.63rem;text-transform:uppercase;letter-spacing:.09em;color:var(--ink-dim);font-weight:700}
.fig .val{font-family:var(--mono);font-size:1.4rem;font-weight:700;margin-top:5px}
.fig .sub{font-size:.7rem;color:var(--ink-faint);margin-top:3px;font-family:var(--mono)}
.up{color:var(--green)} .down{color:var(--red)} .neu{color:var(--ink-dim)}

.grid2{display:grid;grid-template-columns:1.3fr 1fr;gap:16px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
@media(max-width:980px){.grid2,.grid3{grid-template-columns:1fr}}

.chart-wrap{width:100%;height:190px}
.chart-wrap svg{width:100%;height:100%;overflow:visible}
.ax{stroke:var(--line);stroke-width:1}
.eqline{fill:none;stroke:var(--ink);stroke-width:1.6}
.eqdot{fill:var(--card);stroke:var(--ink);stroke-width:1.4}

.procgrid{display:grid;grid-template-columns:repeat(5,1fr);gap:0;border:1.5px solid var(--ink)}
@media(max-width:900px){.procgrid{grid-template-columns:repeat(2,1fr)}}
.proc{padding:12px 14px;border-right:1.5px solid var(--line-strong);border-bottom:1.5px solid transparent;position:relative}
.proc:last-child{border-right:none}
.proc .nome{font-weight:700;font-size:.84rem;display:flex;align-items:center;gap:7px}
.proc .info{font-family:var(--mono);font-size:.7rem;color:var(--ink-dim);margin-top:6px}
.proc .badge-corner{position:absolute;top:6px;right:8px;font-size:.6rem;font-weight:800;letter-spacing:.06em;padding:1px 6px;border:1px solid currentColor;transform:rotate(4deg)}
.proc.vivo .badge-corner{color:var(--green)}
.proc.morto .badge-corner{color:var(--red)}

.wdlog{max-height:150px;overflow-y:auto;font-family:var(--mono);font-size:.71rem;color:var(--ink-dim);line-height:1.65;margin-top:14px;border-top:1.5px solid var(--line-strong);padding-top:10px}
.wdlog div{white-space:pre-wrap;word-break:break-word}

.poscards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
.poscard{border:1.5px solid var(--ink);background:var(--card);padding:14px}
.poscard .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;border-bottom:1px dashed var(--line-strong);padding-bottom:8px}
.poscard .sym{font-weight:800;font-size:1rem;font-family:var(--serif)}
.badge{font-size:.65rem;font-weight:800;padding:2px 8px;text-transform:uppercase;letter-spacing:.05em;border:1px solid currentColor}
.badge.ok{color:var(--green)} .badge.warn{color:var(--amber)} .badge.bad{color:var(--red)}
.legs{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}
.leg{border:1px solid var(--line-strong);padding:7px 9px}
.leg .exid{font-size:.63rem;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.05em}
.leg .price{font-family:var(--mono);font-size:.92rem;font-weight:700;margin-top:3px;transition:color .4s}
.flash-up{color:var(--green)!important} .flash-down{color:var(--red)!important}
.gauge{height:5px;background:var(--line);overflow:hidden;margin-top:9px;border:1px solid var(--line-strong)}
.gauge i{display:block;height:100%;transition:width .6s ease}
.poscard .meta{display:flex;justify-content:space-between;font-size:.7rem;color:var(--ink-dim);margin-top:8px;font-family:var(--mono)}
.empty{color:var(--ink-dim);font-size:.85rem;padding:22px;text-align:center;border:1px dashed var(--line-strong)}

table{width:100%;border-collapse:collapse;font-size:.79rem}
th{text-align:left;color:var(--ink-dim);font-weight:700;font-size:.63rem;text-transform:uppercase;letter-spacing:.05em;padding:8px 9px;border-bottom:1.5px solid var(--ink)}
td{padding:8px 9px;border-bottom:1px solid var(--line);font-family:var(--mono)}
tbody tr:nth-child(odd){background:rgba(0,0,0,.018)}
.mini-bar{width:64px;height:5px;display:inline-block;overflow:hidden;vertical-align:middle;margin-left:6px;border:1px solid var(--line-strong)}
.mini-bar i{display:block;height:100%}

.acct{display:flex;flex-direction:column;gap:12px}
.acctrow .head{display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:6px;font-family:var(--mono)}
.acctrow .head b{text-transform:uppercase;letter-spacing:.03em;font-size:.72rem;color:var(--ink-dim);font-family:var(--sans)}
.barmeter{position:relative;height:9px;background:var(--line);border:1px solid var(--line-strong);overflow:hidden}
.barmeter i{display:block;height:100%;background:var(--ink)}
.barmeter .mark{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--amber)}

.exprow{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px dashed var(--line-strong);font-size:.81rem;font-family:var(--mono)}
.exprow:last-child{border-bottom:none}
.exprow span:first-child{font-family:var(--sans);color:var(--ink-dim)}

.healthgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.hchip{border:1.5px solid var(--line-strong);padding:9px 11px}
.hchip .nm{font-weight:700;font-size:.78rem;display:flex;align-items:center;gap:6px}
.hchip .dt{font-size:.68rem;color:var(--ink-dim);margin-top:4px;font-family:var(--mono)}
.swatch{width:8px;height:8px;flex:none}

.timeline{max-height:420px;overflow-y:auto}
.tl-item{display:flex;gap:10px;padding:9px 2px;border-bottom:1px dashed var(--line-strong);font-size:.78rem}
.tl-item:last-child{border-bottom:none}
.tl-bar{width:3px;align-self:stretch;flex:none}
.tl-body b{font-weight:700}
.tl-body .motivo{color:var(--ink-dim);margin-top:2px;font-size:.75rem;line-height:1.45}
.tl-time{color:var(--ink-faint);font-size:.67rem;font-family:var(--mono);white-space:nowrap}

.progress-readiness{height:8px;background:var(--line);border:1px solid var(--line-strong);overflow:hidden;margin-top:10px}
.progress-readiness i{display:block;height:100%;background:var(--ink)}

::-webkit-scrollbar{width:9px;height:9px}
::-webkit-scrollbar-thumb{background:var(--line-strong)}
::-webkit-scrollbar-track{background:transparent}

footer.foot{text-align:center;color:var(--ink-faint);font-size:.71rem;padding:26px 0 0;font-family:var(--mono)}
</style></head>
<body>
<div class="wrap">

  <div class="masthead">
    <div class="id">
      <h1>❄ Snowball</h1>
      <span class="kicker">livro-caixa · renda delta-neutra</span>
    </div>
    <div class="mstats">
      <span class="stamp"><span class="led" id="led-vig"></span><span id="txt-vig">carregando</span></span>
      <span class="stamp"><span class="led" id="led-stream"></span><span id="txt-stream">carregando</span></span>
      <button class="themebtn" id="btn-theme" type="button">modo</button>
      <span id="clock">--:--:--</span>
    </div>
  </div>

  <section class="figures" id="kpis"></section>

  <section class="grid2">
    <div class="ledger">
      <div class="ledger-head"><h2>Curva de capital</h2><span class="note" id="curva-tag"></span></div>
      <div class="ledger-body"><div class="chart-wrap"><svg id="svg-curva" viewBox="0 0 1000 190" preserveAspectRatio="none"></svg></div></div>
    </div>
    <div class="ledger">
      <div class="ledger-head"><h2>Funding por dia</h2><span class="note" id="pagtag"></span></div>
      <div class="ledger-body"><div class="chart-wrap"><svg id="svg-bar" viewBox="0 0 1000 190" preserveAspectRatio="none"></svg></div></div>
    </div>
  </section>

  <section class="ledger">
    <div class="ledger-head"><h2>Processos</h2><span class="note">watchdog verifica a cada 30s</span></div>
    <div class="ledger-body">
      <div class="procgrid" id="procgrid"></div>
      <div class="wdlog" id="wdlog"></div>
    </div>
  </section>

  <section class="ledger">
    <div class="ledger-head"><h2>Posições abertas</h2><span class="note" id="pos-tag"></span></div>
    <div class="ledger-body"><div class="poscards" id="poscards"></div></div>
  </section>

  <section class="grid2">
    <div class="ledger">
      <div class="ledger-head"><h2>Contas por exchange</h2></div>
      <div class="ledger-body"><div class="acct" id="acct"></div></div>
    </div>
    <div class="ledger">
      <div class="ledger-head"><h2>Exposição &amp; direção</h2></div>
      <div class="ledger-body" id="exposure"></div>
    </div>
  </section>

  <section class="ledger">
    <div class="ledger-head"><h2>Varredura — ranking ao vivo</h2><span class="note" id="scan-tag"></span></div>
    <div class="ledger-body" style="overflow-x:auto;padding:0"><table id="scan-table">
      <thead><tr>
        <th>Par</th><th>Rota</th><th>Spread</th><th>APR</th><th>Consist.</th>
        <th>Vida esp.</th><th>Payback</th><th>Caminho</th><th>Portão</th>
      </tr></thead>
      <tbody id="scan-body"></tbody>
    </table></div>
  </section>

  <section class="grid3">
    <div class="ledger">
      <div class="ledger-head"><h2>Saúde</h2></div>
      <div class="ledger-body"><div class="healthgrid" id="custodia-grid"></div></div>
    </div>
    <div class="ledger">
      <div class="ledger-head"><h2>Coleta</h2></div>
      <div class="ledger-body" id="coleta-box"></div>
    </div>
    <div class="ledger">
      <div class="ledger-head"><h2>Prontidão ML</h2></div>
      <div class="ledger-body" id="ml-box"></div>
    </div>
  </section>

  <section class="ledger">
    <div class="ledger-head"><h2>Basis trade</h2><span class="note">spot+perp, coleta — não opera</span></div>
    <div class="ledger-body" id="basis-box"></div>
  </section>

  <section class="ledger">
    <div class="ledger-head"><h2>Decisões do motor</h2></div>
    <div class="ledger-body"><div class="timeline" id="timeline"></div></div>
  </section>

  <footer class="foot">SNOWBALL — nenhuma ordem enviada além do paper trading declarado — atualizado <span id="foot-ts">—</span></footer>
</div>

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

// ---- anti-flicker: cada seção só toca o DOM quando o dado dela mudou ----
var lastHash={};
function renderIfChanged(key,data,fn){
  var h;
  try{h=JSON.stringify(data)}catch(e){h=String(Date.now())}
  if(lastHash[key]===h)return;
  lastHash[key]=h;
  fn();
}

// ---- animação de números: interpola do valor antigo pro novo em ~500ms ----
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
    var cur=from+(val-from)*e;
    node.textContent=fmt(cur);
    if(p<1)requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ---- KPIs ----
function renderKpis(d){
  var e=d.estado||{};
  var cap=e.capital!=null?e.capital:0;
  var capIni=e.capitalInicial||cap||1;
  var variacao=(cap-capIni)/capIni;
  var itens=[
    {id:'k-capital',lbl:'Capital atual',val:cap,fmt:fmtUsd,sub:(variacao>=0?'+':'')+fmtPct(variacao,2)+' desde o início',cls:variacao>=0?'up':'down'},
    {id:'k-pico',lbl:'Pico',val:e.pico||cap,fmt:fmtUsd,sub:'capital inicial '+fmtUsd(capIni)},
    {id:'k-funding',lbl:'Funding recebido',val:e.fundingTotal||0,fmt:fmtUsd,sub:(e.pagamentos||0)+' pagamentos'},
    {id:'k-custos',lbl:'Custos pagos',val:e.custosTotal||0,fmt:fmtUsd,sub:(e.trocas||0)+' trocas de posição'},
    {id:'k-ocioso',lbl:'Caixa ocioso',val:e.caixaOcioso||0,fmt:fmtUsd,sub:(e.reinvestimentos||0)+' reinvestimentos'},
    {id:'k-uptime',lbl:'Coletando há',val:null,fmt:null,sub:e.iniciadoEm?timeAgo(e.iniciadoEm).replace(' atrás',''):'—',raw:e.iniciadoEm?diasDesde(e.iniciadoEm):'—'}
  ];
  var host=el('kpis');
  if(!host.dataset.built){
    host.innerHTML=itens.map(function(it){
      return '<div class="fig"><div class="lbl">'+esc(it.lbl)+'</div><div class="val '+(it.cls||'')+'" id="'+it.id+'">—</div><div class="sub" id="'+it.id+'-sub">—</div></div>';
    }).join('');
    host.dataset.built='1';
  }
  itens.forEach(function(it){
    if(it.fmt) animateNumber(it.id,it.val,it.fmt);
    else el(it.id).textContent=it.raw;
    var subNode=el(it.id+'-sub'); if(subNode) subNode.textContent=it.sub;
    var valNode=el(it.id); if(valNode&&it.cls){valNode.className='val '+it.cls}
  });
}

// ---- curva de capital (SVG, traço fino tipo gráfico de livro-caixa) ----
function renderCurva(d){
  var pts=(d.curva||[]).filter(function(p){return isFinite(p.capital)});
  renderIfChanged('curva',pts,function(){
    el('curva-tag').textContent=pts.length+' pontos';
    var svg=el('svg-curva');
    if(pts.length<2){svg.innerHTML='';return}
    var W=1000,H=190,pad=10;
    var vals=pts.map(function(p){return p.capital});
    var lo=Math.min.apply(null,vals),hi=Math.max.apply(null,vals);
    if(lo===hi){lo-=1;hi+=1}
    var n=pts.length;
    function X(i){return pad+(W-2*pad)*(i/(n-1))}
    function Y(v){return H-pad-(H-2*pad)*((v-lo)/(hi-lo))}
    var out=['<line class="ax" x1="'+pad+'" y1="'+(H-pad)+'" x2="'+(W-pad)+'" y2="'+(H-pad)+'"/>'];
    out.push('<line class="ax" x1="'+pad+'" y1="'+pad+'" x2="'+pad+'" y2="'+(H-pad)+'"/>');
    var line=[];
    for(var i=0;i<n;i++){
      var x=X(i).toFixed(1),y=Y(pts[i].capital).toFixed(1);
      line.push((i===0?'M':'L')+x+','+y);
    }
    out.push('<path class="eqline" d="'+line.join(' ')+'"/>');
    var lastX=X(n-1).toFixed(1),lastY=Y(pts[n-1].capital).toFixed(1);
    out.push('<circle class="eqdot" cx="'+lastX+'" cy="'+lastY+'" r="3.4"/>');
    svg.innerHTML=out.join('');
  });
}

// ---- funding por dia (barras de traço, sem cor a menos que negativo) ----
function renderBarras(d){
  var linhas=(d.pagamentosPorDia||[]).slice(-14);
  renderIfChanged('barras',linhas,function(){
    el('pagtag').textContent=linhas.length+' dias';
    var svg=el('svg-bar');
    if(!linhas.length){svg.innerHTML='';return}
    var W=1000,H=190,pad=6;
    var max=Math.max.apply(null,linhas.map(function(l){return Math.abs(l.total)}).concat([0.0001]));
    var bw=(W-2*pad)/linhas.length-6;
    var out=['<line class="ax" x1="'+pad+'" y1="'+(H-24)+'" x2="'+(W-pad)+'" y2="'+(H-24)+'"/>'];
    linhas.forEach(function(l,i){
      var h=Math.max(2,(H-46)*(Math.abs(l.total)/max));
      var x=pad+i*((W-2*pad)/linhas.length);
      var neg=l.total<0;
      var y=neg?(H-24):(H-24-h);
      var cor=neg?'var(--red)':'var(--ink)';
      out.push('<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)+'" fill="'+cor+'"><title>'+esc(l.dia)+': '+fmtUsd(l.total)+'</title></rect>');
      out.push('<text x="'+(x+bw/2).toFixed(1)+'" y="'+(H-8)+'" font-size="13" fill="var(--ink-faint)" text-anchor="middle" font-family="ui-monospace,monospace">'+esc(l.dia.slice(5))+'</text>');
    });
    svg.innerHTML=out.join('');
  });
}

// ---- processos ----
function renderProcessos(d){
  var procs=d.processos||[];
  renderIfChanged('processos',procs,function(){
    var host=el('procgrid');
    host.innerHTML=procs.map(function(p){
      var uptime=p.vivo&&p.desde?diasDesde(p.desde):'—';
      return '<div class="proc '+(p.vivo?'vivo':'morto')+'">'+
        '<span class="badge-corner">'+(p.vivo?'ativo':'offline')+'</span>'+
        '<div class="nome">'+esc(p.nome)+'</div>'+
        '<div class="info">'+(p.vivo?('há '+uptime+' · '+(p.memoriaMB||0)+' MB'):'não detectado')+'</div>'+
        '</div>';
    }).join('');
  });

  var wd=d.watchdog||[];
  renderIfChanged('watchdog',wd,function(){
    el('wdlog').innerHTML=wd.length
      ? wd.map(function(l){return '<div>'+esc(l)+'</div>'}).join('')
      : '<div style="color:var(--ink-faint)">sem eventos registrados ainda</div>';
  });
}

// ---- posições abertas ----
var ultimoPreco={};
function renderPosicoes(d){
  var pos=d.posicoes||[];
  el('pos-tag').textContent=pos.length?(pos.length+' aberta'+(pos.length>1?'s':'')):'nenhuma';
  renderIfChanged('posicoes',pos,function(){
    var host=el('poscards');
    if(!pos.length){
      host.innerHTML='<div class="empty">Nenhuma posição aberta agora — o portão de valor esperado ainda não achou nada que pague o próprio custo. Isso é o resultado correto quando o mercado não oferece spread suficiente.</div>';
      return;
    }
    host.innerHTML=pos.map(function(p,idx){
      var distMin=p.distanciaMinima;
      var corGauge=distMin>0.08?'var(--green)':(distMin>0.03?'var(--amber)':'var(--red)');
      var pctGauge=Math.max(2,Math.min(100,(distMin/0.15)*100));
      var badge=distMin>0.08?'ok':(distMin>0.03?'warn':'bad');
      var keyS='p'+idx+'s', keyL='p'+idx+'l';
      var flashS=flashClass(keyS,p.precoAoVivoShort);
      var flashL=flashClass(keyL,p.precoAoVivoLong);
      return '<div class="poscard">'+
        '<div class="top"><span class="sym">'+esc((p.symbol||'').replace('/USDT:USDT',''))+'</span>'+
          '<span class="badge '+badge+'">risco: '+esc(p.pernaEmRisco||'—')+'</span></div>'+
        '<div class="legs">'+
          '<div class="leg"><div class="exid">short · '+esc(p.exchangeShort)+'</div><div class="price '+flashS+'" id="'+keyS+'">'+(p.precoAoVivoShort?fmtUsd(p.precoAoVivoShort):'—')+'</div></div>'+
          '<div class="leg"><div class="exid">long · '+esc(p.exchangeLong)+'</div><div class="price '+flashL+'" id="'+keyL+'">'+(p.precoAoVivoLong?fmtUsd(p.precoAoVivoLong):'—')+'</div></div>'+
        '</div>'+
        '<div class="gauge"><i style="width:'+pctGauge+'%;background:'+corGauge+'"></i></div>'+
        '<div class="meta"><span>distância liq. '+fmtPct(distMin,1)+'</span><span>aberta há '+fmtHoras(p.horasAberta)+'</span></div>'+
        '</div>';
    }).join('');
  });
}
function flashClass(key,val){
  if(val==null)return '';
  var ant=ultimoPreco[key];
  ultimoPreco[key]=val;
  if(ant==null||ant===val)return '';
  return val>ant?'flash-up':'flash-down';
}
setInterval(function(){
  document.querySelectorAll('.flash-up,.flash-down').forEach(function(n){
    n.classList.remove('flash-up');n.classList.remove('flash-down');
  });
},900);

// ---- contas por exchange ----
function renderContas(d){
  var contas=d.contas||[];
  renderIfChanged('contas',contas,function(){
    var host=el('acct');
    if(!contas.length){host.innerHTML='<div class="empty">sem saldos ainda</div>';return}
    host.innerHTML=contas.map(function(c){
      var pct=Math.min(100,(c.fracaoUsada||0)*100);
      var markPct=c.saldo>0?Math.min(100,(c.alvoReserva/c.saldo)*100):0;
      return '<div class="acctrow">'+
        '<div class="head"><b>'+esc(c.exchange)+'</b><span>'+fmtUsd(c.saldo)+'</span></div>'+
        '<div class="barmeter"><i style="width:'+pct+'%"></i><span class="mark" style="left:'+(100-markPct)+'%"></span></div>'+
        '<div class="meta" style="display:flex;justify-content:space-between;font-size:.7rem;color:var(--ink-dim);margin-top:5px;font-family:ui-monospace,monospace">'+
          '<span>margem usada '+fmtUsd(c.margemUsada)+'</span><span>livre '+fmtUsd(c.livre)+'</span></div>'+
        '</div>';
    }).join('');
  });
}

// ---- exposição / concentração / dreno ----
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
    if(!linhas.length) out.push('<div class="exprow"><span style="color:var(--ink-faint)">sem posições abertas para medir exposição</span></div>');
    el('exposure').innerHTML=out.join('');
  });
}

// ---- varredura / scan ----
function renderScan(d){
  var scan=(d.scan||[]).slice().sort(function(a,b){return (b.pctDoCaminho||0)-(a.pctDoCaminho||0)});
  el('scan-tag').textContent=(d.vigilancia?d.vigilancia.fonte:'') + (d.idadeVarreduraMin!=null&&d.idadeVarreduraMin>=0?' · dado de '+d.idadeVarreduraMin+' min':'');
  renderIfChanged('scan',scan,function(){
    var body=el('scan-body');
    if(!scan.length){
      body.innerHTML='<tr><td colspan="9" style="color:var(--ink-faint);text-align:center;padding:20px">sem candidatos no momento</td></tr>';
      return;
    }
    body.innerHTML=scan.map(function(o){
      var pct=Math.max(0,Math.min(100,o.pctDoCaminho||0));
      var corBar=o.passaPortao?'var(--green)':(pct>60?'var(--amber)':'var(--red)');
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

// ---- saúde das exchanges (custódia) ----
function renderCustodia(d){
  var c=d.custodia||{saude:{}};
  renderIfChanged('custodia',c,function(){
    var host=el('custodia-grid');
    var ids=Object.keys(c.saude||{});
    if(!ids.length){host.innerHTML='<div class="empty">sem dado de custódia ainda</div>';return}
    var corNivel={ok:'var(--green)',atencao:'var(--amber)','alerta':'var(--red)','critico':'var(--red)',desconhecido:'var(--ink-faint)'};
    host.innerHTML=ids.map(function(id){
      var s=c.saude[id];
      var cor=corNivel[s.nivel]||'var(--ink-faint)';
      return '<div class="hchip"><div class="nm"><span class="swatch" style="background:'+cor+'"></span>'+esc(id)+'</div>'+
        '<div class="dt">'+esc(s.detalhe||s.nivel)+'</div></div>';
    }).join('');
  });
}

// ---- coleta de longo prazo ----
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

// ---- prontidão de ML ----
function renderMl(d){
  var m=d.ml||{confiaveis:0,positivos:0,minimoNecessario:30};
  renderIfChanged('ml',m,function(){
    var pct=Math.min(100,(m.positivos/Math.max(1,m.minimoNecessario))*100);
    el('ml-box').innerHTML=
      '<div class="exprow"><span>Ciclos confiáveis</span><span>'+fmtNum(m.confiaveis)+'</span></div>'+
      '<div class="exprow"><span>Exemplos positivos</span><span>'+fmtNum(m.positivos)+' / '+fmtNum(m.minimoNecessario)+'</span></div>'+
      '<div class="progress-readiness"><i style="width:'+pct+'%"></i></div>'+
      '<div style="font-size:.7rem;color:var(--ink-faint);margin-top:6px;font-family:ui-monospace,monospace">'+(pct>=100?'pronto para treinar':pct.toFixed(0)+'% do mínimo para treinar')+'</div>';
  });
}

// ---- basis trade ----
function renderBasis(d){
  var b=d.basis||{vivas:0,fechadas:0,duracaoMedianaHoras:0,duracaoMaximaHoras:0,top:[]};
  renderIfChanged('basis',b,function(){
    var out='<div class="figures" style="border-width:1.5px;margin-bottom:14px">'+
      '<div class="fig"><div class="lbl">Vivos</div><div class="val">'+fmtNum(b.vivas)+'</div></div>'+
      '<div class="fig"><div class="lbl">Fechados</div><div class="val">'+fmtNum(b.fechadas)+'</div></div>'+
      '<div class="fig"><div class="lbl">Duração mediana</div><div class="val" style="font-size:1.1rem">'+fmtHoras(b.duracaoMedianaHoras)+'</div></div>'+
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

// ---- linha do tempo de decisões ----
var corEvento={
  abertura:'var(--green)','abre':'var(--green)', fechamento:'var(--red)','fecha':'var(--red)',
  bloqueado:'var(--ink-faint)', funding:'var(--blue)', transferencia:'var(--blue)', reinvestimento:'var(--amber)'
};
function renderTimeline(d){
  var itens=(d.diario||[]).slice(0,60);
  renderIfChanged('timeline',itens,function(){
    var host=el('timeline');
    if(!itens.length){host.innerHTML='<div class="empty">sem eventos ainda</div>';return}
    host.innerHTML=itens.map(function(e){
      var cor=corEvento[e.evento]||'var(--ink-faint)';
      var titulo=(e.evento||'evento')+(e.symbol?' · '+e.symbol.replace('/USDT:USDT',''):'');
      return '<div class="tl-item"><span class="tl-bar" style="background:'+cor+'"></span>'+
        '<div class="tl-body"><b>'+esc(titulo)+'</b><div class="motivo">'+esc(e.motivo||'')+'</div></div>'+
        '<div class="tl-time">'+timeAgo(e.ts)+'</div></div>';
    }).join('');
  });
}

// ---- vigilância / status do stream ----
function renderStatus(d){
  var v=d.vigilancia||{};
  el('led-vig').className='led '+(v.viva?'on':'off');
  el('txt-vig').textContent=v.viva?('vigilância viva · '+(v.candidatos||0)+' candidatos'):'vigilância caiu';
  el('foot-ts').textContent=new Date(d.atualizadoEm||Date.now()).toLocaleString('pt-BR');
}

// ---- render mestre ----
function render(d){
  renderKpis(d);
  renderCurva(d);
  renderBarras(d);
  renderProcessos(d);
  renderPosicoes(d);
  renderContas(d);
  renderExposicao(d);
  renderScan(d);
  renderCustodia(d);
  renderColeta(d);
  renderMl(d);
  renderBasis(d);
  renderTimeline(d);
  renderStatus(d);
}

// ---- tema claro/escuro manual (respeita prefers-color-scheme por padrão) ----
(function(){
  var salvo=null;
  try{salvo=localStorage.getItem('snowball-tema')}catch(e){}
  if(salvo)document.documentElement.setAttribute('data-theme',salvo);
  el('btn-theme').addEventListener('click',function(){
    var atual=document.documentElement.getAttribute('data-theme');
    var escuroPreferido=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;
    var efetivo=atual||(escuroPreferido?'dark':'light');
    var novo=efetivo==='dark'?'light':'dark';
    document.documentElement.setAttribute('data-theme',novo);
    try{localStorage.setItem('snowball-tema',novo)}catch(e){}
  });
})();

// ---- relógio ----
setInterval(function(){
  el('clock').textContent=new Date().toLocaleTimeString('pt-BR');
},1000);

// ---- conexão: SSE com fallback para polling ----
var es=null, poll=null;
function pararPolling(){if(poll){clearInterval(poll);poll=null}}
function iniciarPolling(){
  pararPolling();
  el('led-stream').className='led mid';
  el('txt-stream').textContent='sondando (sem stream)';
  poll=setInterval(function(){
    fetch('/api/dados').then(function(r){return r.json()}).then(render).catch(function(){});
  },5000);
}
function conectar(){
  el('led-stream').className='led mid';
  el('txt-stream').textContent='conectando';
  try{es=new EventSource('/api/stream')}catch(e){iniciarPolling();return}
  es.onopen=function(){
    el('led-stream').className='led on';
    el('txt-stream').textContent='ao vivo';
  };
  es.onmessage=function(ev){
    pararPolling();
    try{render(JSON.parse(ev.data))}catch(e){}
  };
  es.onerror=function(){
    es.close();
    iniciarPolling();
    setTimeout(conectar,4000);
  };
}
conectar();
</script>
</body></html>`;
