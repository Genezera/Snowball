/**
 * Dashboard — quinta geração, reconstruída do zero a pedido do usuário.
 * HTML + CSS + SVG + JS puro, sem dependência externa, mesmo contrato de
 * dados do server.ts (retrato() via /api/stream e /api/dados).
 *
 * Conceito: "terminal de observação". Fundo quase preto, cartões de vidro
 * (glassmorphism), acento gradiente ciano->violeta, números em monoespaçada,
 * tudo animado com propósito (pulso de vida nos processos, curva desenhando
 * sozinha, preço piscando quando muda, barras de progresso com transição) —
 * não decoração gratuita, cada animação comunica um estado.
 *
 * Regras que valem a pena repetir, porque já quebraram o arquivo antes:
 *
 * 1. NENHUMA CRASE em lugar nenhum deste arquivo fora da abertura/fechamento
 *    do template literal. A página inteira é uma string; uma crase solta
 *    (inclusive dentro de comentário do <script>) fecha a string e derruba
 *    o servidor com um erro de sintaxe apontando pro lugar errado.
 * 2. Por causa da regra 1, o JavaScript do cliente NUNCA usa template
 *    literals (interpolação de string) — só concatenação com "+" e
 *    Array.join(''). É mais verboso, é o preço de viver dentro de outro
 *    template literal.
 * 3. render(d) é chamada a cada evento do SSE (mudança em disco) e a cada
 *    ~2,5s quando o preço ao vivo chega — então nunca reconstrói o DOM
 *    inteiro. Cada seção só atualiza o que mudou, para animações contínuas
 *    (pulso, curva) não reiniciarem a cada tick.
 */
export const PAGINA = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Snowball · Painel</title>
<style>
:root{
  --bg:#04060c; --bg2:#080b16; --panel:rgba(255,255,255,.035); --panel-hi:rgba(255,255,255,.06);
  --border:rgba(255,255,255,.09); --border-hi:rgba(255,255,255,.16);
  --text:#e9edf7; --dim:#8a93ad; --dim2:#5c6480;
  --cyan:#5eead4; --violet:#a78bfa; --blue:#60a5fa;
  --green:#34d399; --red:#fb7185; --yellow:#fbbf24;
  --mono:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;
  --radius:16px;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--bg); color:var(--text); font-family:var(--sans);
  min-height:100vh; overflow-x:hidden; -webkit-font-smoothing:antialiased;
}
.aurora{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.aurora i{position:absolute;border-radius:50%;filter:blur(90px);opacity:.16}
.aurora i:nth-child(1){width:520px;height:520px;background:var(--cyan);top:-180px;left:-120px;animation:drift1 26s ease-in-out infinite}
.aurora i:nth-child(2){width:600px;height:600px;background:var(--violet);top:20%;right:-220px;animation:drift2 32s ease-in-out infinite}
.aurora i:nth-child(3){width:420px;height:420px;background:var(--blue);bottom:-160px;left:30%;animation:drift3 29s ease-in-out infinite}
@keyframes drift1{0%,100%{transform:translate(0,0)}50%{transform:translate(60px,80px)}}
@keyframes drift2{0%,100%{transform:translate(0,0)}50%{transform:translate(-70px,50px)}}
@keyframes drift3{0%,100%{transform:translate(0,0)}50%{transform:translate(50px,-60px)}}

.wrap{position:relative;z-index:1;max-width:1440px;margin:0 auto;padding:20px 22px 80px}

.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:6px 2px 22px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:12px}
.brand .mark{width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,var(--cyan),var(--violet));display:flex;align-items:center;justify-content:center;font-weight:800;color:#04060c;font-size:1.1rem;box-shadow:0 0 26px rgba(94,234,212,.35)}
.brand h1{font-size:1.18rem;font-weight:800;letter-spacing:.01em}
.brand small{display:block;color:var(--dim);font-size:.72rem;font-weight:500;margin-top:1px}
.topmeta{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.pill{display:inline-flex;align-items:center;gap:7px;background:var(--panel);border:1px solid var(--border);border-radius:999px;padding:7px 13px;font-size:.76rem;color:var(--dim)}
.dot{width:8px;height:8px;border-radius:50%;flex:none}
.dot.live{background:var(--green);box-shadow:0 0 0 0 rgba(52,211,153,.6);animation:pulse 1.8s infinite}
.dot.dead{background:var(--red)}
.dot.warn{background:var(--yellow)}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(52,211,153,.55)}70%{box-shadow:0 0 0 9px rgba(52,211,153,0)}100%{box-shadow:0 0 0 0 rgba(52,211,153,0)}}
#clock{font-family:var(--mono);color:var(--text)}

.card{
  background:linear-gradient(180deg,var(--panel),rgba(255,255,255,.015));
  border:1px solid var(--border); border-radius:var(--radius);
  padding:18px 20px; backdrop-filter:blur(14px);
  animation:fadeUp .5s ease both;
}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.card h2{margin:0 0 14px;font-size:.82rem;text-transform:uppercase;letter-spacing:.09em;color:var(--dim);font-weight:700;display:flex;align-items:center;justify-content:space-between;gap:8px}
.card h2 span.tag{text-transform:none;letter-spacing:0;font-weight:500;color:var(--dim2);font-size:.72rem}
section{margin-bottom:16px}

.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:12px}
@media(max-width:1100px){.kpis{grid-template-columns:repeat(3,1fr)}}
@media(max-width:600px){.kpis{grid-template-columns:repeat(2,1fr)}}
.kpi{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:14px 16px;animation:fadeUp .5s ease both}
.kpi .lbl{font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:var(--dim2);font-weight:700}
.kpi .val{font-family:var(--mono);font-size:1.5rem;font-weight:700;margin-top:6px;letter-spacing:-.01em}
.kpi .sub{font-size:.72rem;color:var(--dim);margin-top:4px;font-family:var(--mono)}
.up{color:var(--green)} .down{color:var(--red)} .neu{color:var(--dim)}

.grid2{display:grid;grid-template-columns:1.4fr 1fr;gap:16px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
@media(max-width:980px){.grid2,.grid3{grid-template-columns:1fr}}

.chart-wrap{width:100%;height:210px}
.chart-wrap svg{width:100%;height:100%;overflow:visible}
.eqline{fill:none;stroke:url(#gradline);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.eqarea{fill:url(#gradfill)}
.barbg rect{fill:rgba(255,255,255,.04)}

.procgrid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}
@media(max-width:900px){.procgrid{grid-template-columns:repeat(2,1fr)}}
.proc{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:12px 14px;transition:border-color .3s}
.proc.vivo{border-color:rgba(52,211,153,.25)}
.proc.morto{border-color:rgba(251,113,133,.35)}
.proc .row{display:flex;align-items:center;gap:8px}
.proc .nome{font-weight:700;font-size:.86rem}
.proc .info{font-family:var(--mono);font-size:.71rem;color:var(--dim);margin-top:6px}

.wdlog{max-height:150px;overflow-y:auto;font-family:var(--mono);font-size:.71rem;color:var(--dim);line-height:1.6;margin-top:12px;border-top:1px solid var(--border);padding-top:10px}
.wdlog div{white-space:pre-wrap;word-break:break-word}

.poscards{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px}
.poscard{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:16px}
.poscard .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.poscard .sym{font-weight:800;font-size:1rem}
.badge{font-size:.68rem;font-weight:700;padding:3px 9px;border-radius:999px;text-transform:uppercase;letter-spacing:.04em}
.badge.ok{background:rgba(52,211,153,.14);color:var(--green)}
.badge.warn{background:rgba(251,191,36,.14);color:var(--yellow)}
.badge.bad{background:rgba(251,113,133,.14);color:var(--red)}
.legs{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}
.leg{background:rgba(255,255,255,.03);border-radius:10px;padding:8px 10px}
.leg .exid{font-size:.68rem;color:var(--dim2);text-transform:uppercase;letter-spacing:.04em}
.leg .price{font-family:var(--mono);font-size:.95rem;font-weight:700;margin-top:3px;transition:background-color .3s;border-radius:4px}
.flash-up{background-color:rgba(52,211,153,.25)!important}
.flash-down{background-color:rgba(251,113,133,.25)!important}
.gauge{height:6px;border-radius:99px;background:rgba(255,255,255,.06);overflow:hidden;margin-top:10px}
.gauge i{display:block;height:100%;border-radius:99px;transition:width .6s ease}
.poscard .meta{display:flex;justify-content:space-between;font-size:.72rem;color:var(--dim);margin-top:8px;font-family:var(--mono)}
.empty{color:var(--dim);font-size:.85rem;padding:22px;text-align:center;border:1px dashed var(--border);border-radius:12px}

table{width:100%;border-collapse:collapse;font-size:.8rem}
th{text-align:left;color:var(--dim2);font-weight:700;font-size:.66rem;text-transform:uppercase;letter-spacing:.05em;padding:8px 10px;border-bottom:1px solid var(--border)}
td{padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.04);font-family:var(--mono)}
tr.row-hover:hover{background:rgba(255,255,255,.025)}
.mini-bar{width:70px;height:5px;border-radius:99px;background:rgba(255,255,255,.07);display:inline-block;overflow:hidden;vertical-align:middle;margin-left:6px}
.mini-bar i{display:block;height:100%;transition:width .5s ease}

.acct{display:flex;flex-direction:column;gap:12px}
.acctrow .head{display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:6px}
.acctrow .head b{text-transform:uppercase;letter-spacing:.03em;font-size:.74rem;color:var(--dim)}
.barmeter{position:relative;height:10px;border-radius:99px;background:rgba(255,255,255,.06);overflow:hidden}
.barmeter i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--cyan),var(--violet));transition:width .6s ease}
.barmeter .mark{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--yellow);opacity:.8}

.exprow{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:.82rem}
.exprow:last-child{border-bottom:none}

.healthgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.hchip{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:10px 12px}
.hchip .nm{font-weight:700;font-size:.78rem;display:flex;align-items:center;gap:6px}
.hchip .dt{font-size:.68rem;color:var(--dim);margin-top:4px}

.timeline{max-height:420px;overflow-y:auto;display:flex;flex-direction:column;gap:0}
.tl-item{display:flex;gap:10px;padding:10px 2px;border-bottom:1px solid rgba(255,255,255,.04);font-size:.78rem}
.tl-item:last-child{border-bottom:none}
.tl-dot{width:8px;height:8px;border-radius:50%;margin-top:5px;flex:none}
.tl-body b{font-weight:700}
.tl-body .motivo{color:var(--dim);margin-top:2px;font-size:.75rem;line-height:1.4}
.tl-time{color:var(--dim2);font-size:.68rem;font-family:var(--mono);white-space:nowrap}

.progress-readiness{height:8px;border-radius:99px;background:rgba(255,255,255,.06);overflow:hidden;margin-top:10px}
.progress-readiness i{display:block;height:100%;background:linear-gradient(90deg,var(--blue),var(--cyan));transition:width .8s ease}

::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:99px}
::-webkit-scrollbar-track{background:transparent}

.skel{opacity:.4}
footer.foot{text-align:center;color:var(--dim2);font-size:.72rem;padding:26px 0 0}
</style></head>
<body>
<div class="aurora"><i></i><i></i><i></i></div>
<div class="wrap">

  <div class="topbar">
    <div class="brand">
      <div class="mark">S</div>
      <div>
        <h1>Snowball</h1>
        <small>renda delta-neutra · observatório em tempo real</small>
      </div>
    </div>
    <div class="topmeta">
      <span class="pill"><span class="dot live" id="dot-vig"></span><span id="txt-vig">conectando…</span></span>
      <span class="pill"><span class="dot" id="dot-stream"></span><span id="txt-stream">conectando…</span></span>
      <span class="pill" id="clock">--:--:--</span>
    </div>
  </div>

  <section class="kpis" id="kpis"></section>

  <section class="grid2">
    <div class="card">
      <h2>Curva de capital <span class="tag" id="curva-tag"></span></h2>
      <div class="chart-wrap"><svg id="svg-curva" viewBox="0 0 1000 210" preserveAspectRatio="none">
        <defs>
          <linearGradient id="gradline" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#5eead4"/><stop offset="1" stop-color="#a78bfa"/>
          </linearGradient>
          <linearGradient id="gradfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#5eead4" stop-opacity=".22"/><stop offset="1" stop-color="#5eead4" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path class="eqarea" id="path-area"></path>
        <path class="eqline" id="path-line"></path>
      </svg></div>
    </div>
    <div class="card">
      <h2>Funding por dia <span class="tag" id="pagtag"></span></h2>
      <div class="chart-wrap"><svg id="svg-bar" viewBox="0 0 1000 210" preserveAspectRatio="none"></svg></div>
    </div>
  </section>

  <section class="card">
    <h2>Processos <span class="tag">watchdog verifica a cada 30s</span></h2>
    <div class="procgrid" id="procgrid"></div>
    <div class="wdlog" id="wdlog"></div>
  </section>

  <section class="card">
    <h2>Posições abertas <span class="tag" id="pos-tag"></span></h2>
    <div class="poscards" id="poscards"></div>
  </section>

  <section class="grid2">
    <div class="card">
      <h2>Contas por exchange</h2>
      <div class="acct" id="acct"></div>
    </div>
    <div class="card">
      <h2>Exposição &amp; direção</h2>
      <div id="exposure"></div>
    </div>
  </section>

  <section class="card">
    <h2>Varredura — ranking ao vivo <span class="tag" id="scan-tag"></span></h2>
    <div style="overflow-x:auto"><table id="scan-table">
      <thead><tr>
        <th>Par</th><th>Rota</th><th>Spread</th><th>APR</th><th>Consist.</th>
        <th>Vida esp.</th><th>Payback</th><th>Caminho</th><th>Portão</th>
      </tr></thead>
      <tbody id="scan-body"></tbody>
    </table></div>
  </section>

  <section class="grid3">
    <div class="card">
      <h2>Saúde das exchanges</h2>
      <div class="healthgrid" id="custodia-grid"></div>
    </div>
    <div class="card">
      <h2>Coleta de longo prazo</h2>
      <div id="coleta-box"></div>
    </div>
    <div class="card">
      <h2>Prontidão de ML</h2>
      <div id="ml-box"></div>
    </div>
  </section>

  <section class="card">
    <h2>Basis trade (spot+perp, coleta) <span class="tag">não opera — só observa</span></h2>
    <div id="basis-box"></div>
  </section>

  <section class="card">
    <h2>Decisões do motor</h2>
    <div class="timeline" id="timeline"></div>
  </section>

  <footer class="foot">Snowball · nenhuma ordem é enviada além do paper trading declarado · atualizado em <span id="foot-ts">—</span></footer>
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
function esc(s){
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ---- animação de números: interpola do valor antigo pro novo em ~500ms ----
var animState={};
function animateNumber(id,val,fmt){
  var node=el(id); if(!node)return;
  var from=animState[id]==null?val:animState[id];
  animState[id]=val;
  if(!isFinite(val)){node.textContent=fmt(val);return}
  var t0=performance.now(),dur=550;
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
      return '<div class="kpi"><div class="lbl">'+esc(it.lbl)+'</div><div class="val '+(it.cls||'')+'" id="'+it.id+'">—</div><div class="sub" id="'+it.id+'-sub">—</div></div>';
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
function diasDesde(ts){
  var d=(Date.now()-ts)/86400000;
  return d<1?Math.round(d*24)+'h':d.toFixed(1)+'d';
}

// ---- curva de capital (SVG line + area) ----
var curvaDesenhada=false;
function renderCurva(d){
  var pts=(d.curva||[]).filter(function(p){return isFinite(p.capital)});
  el('curva-tag').textContent=pts.length+' pontos';
  if(pts.length<2){
    el('path-line').setAttribute('d','');
    el('path-area').setAttribute('d','');
    return;
  }
  var W=1000,H=210,pad=8;
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
  var pathLine=el('path-line'), pathArea=el('path-area');
  pathLine.setAttribute('d',line.join(' '));
  pathArea.setAttribute('d',area.join(' '));
  if(!curvaDesenhada){
    try{
      var len=pathLine.getTotalLength();
      pathLine.style.strokeDasharray=len;
      pathLine.style.strokeDashoffset=len;
      pathLine.getBoundingClientRect();
      pathLine.style.transition='stroke-dashoffset 1.1s ease';
      pathLine.style.strokeDashoffset='0';
    }catch(e){}
    curvaDesenhada=true;
  }
}

// ---- funding por dia (barras) ----
function renderBarras(d){
  var linhas=(d.pagamentosPorDia||[]).slice(-14);
  el('pagtag').textContent=linhas.length+' dias';
  var svg=el('svg-bar');
  if(!linhas.length){svg.innerHTML='';return}
  var W=1000,H=210,pad=6,gap=6;
  var max=Math.max.apply(null,linhas.map(function(l){return l.total}).concat([0.0001]));
  var bw=(W-2*pad)/linhas.length-gap;
  var out=[];
  linhas.forEach(function(l,i){
    var h=Math.max(2,(H-30)*(l.total/max));
    var x=pad+i*((W-2*pad)/linhas.length);
    var y=H-24-h;
    var cor=l.total>=0?'url(#gradline)':'#fb7185';
    out.push('<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="3" fill="'+cor+'"><title>'+esc(l.dia)+': '+fmtUsd(l.total)+'</title></rect>');
    out.push('<text x="'+(x+bw/2).toFixed(1)+'" y="'+(H-8)+'" font-size="13" fill="#5c6480" text-anchor="middle" font-family="ui-monospace,monospace">'+esc(l.dia.slice(5))+'</text>');
  });
  svg.innerHTML=out.join('');
}

// ---- processos ----
function renderProcessos(d){
  var procs=d.processos||[];
  var host=el('procgrid');
  host.innerHTML=procs.map(function(p){
    var uptime=p.vivo&&p.desde?diasDesde(p.desde):'—';
    return '<div class="proc '+(p.vivo?'vivo':'morto')+'">'+
      '<div class="row"><span class="dot '+(p.vivo?'live':'dead')+'"></span><span class="nome">'+esc(p.nome)+'</span></div>'+
      '<div class="info">'+(p.vivo?('ativo há '+uptime+' · '+(p.memoriaMB||0)+' MB'):'não detectado')+'</div>'+
      '</div>';
  }).join('');

  var wd=d.watchdog||[];
  el('wdlog').innerHTML=wd.length
    ? wd.map(function(l){return '<div>'+esc(l)+'</div>'}).join('')
    : '<div style="color:#5c6480">sem eventos registrados ainda</div>';
}

// ---- posições abertas ----
var ultimoPreco={};
function renderPosicoes(d){
  var pos=d.posicoes||[];
  el('pos-tag').textContent=pos.length?(pos.length+' aberta'+(pos.length>1?'s':'')):'nenhuma';
  var host=el('poscards');
  if(!pos.length){
    host.innerHTML='<div class="empty">Nenhuma posição aberta agora — o portão de valor esperado ainda não achou nada que pague o próprio custo. Isso é o resultado correto quando o mercado não oferece spread suficiente.</div>';
    return;
  }
  host.innerHTML=pos.map(function(p,idx){
    var distMin=p.distanciaMinima;
    var corGauge=distMin>0.08?'#34d399':(distMin>0.03?'#fbbf24':'#fb7185');
    var pctGauge=Math.max(2,Math.min(100,(distMin/0.15)*100));
    var badge=distMin>0.08?'ok':(distMin>0.03?'warn':'bad');
    var keyS='p'+idx+'s', keyL='p'+idx+'l';
    var flashS=flashClass(keyS,p.precoAoVivoShort);
    var flashL=flashClass(keyL,p.precoAoVivoLong);
    return '<div class="poscard">'+
      '<div class="top"><span class="sym">'+esc((p.symbol||'').replace('/USDT:USDT',''))+'</span>'+
        '<span class="badge '+badge+'">perna em risco: '+esc(p.pernaEmRisco||'—')+'</span></div>'+
      '<div class="legs">'+
        '<div class="leg"><div class="exid">short · '+esc(p.exchangeShort)+'</div><div class="price '+flashS+'" id="'+keyS+'">'+(p.precoAoVivoShort?fmtUsd(p.precoAoVivoShort):'—')+'</div></div>'+
        '<div class="leg"><div class="exid">long · '+esc(p.exchangeLong)+'</div><div class="price '+flashL+'" id="'+keyL+'">'+(p.precoAoVivoLong?fmtUsd(p.precoAoVivoLong):'—')+'</div></div>'+
      '</div>'+
      '<div class="gauge"><i style="width:'+pctGauge+'%;background:'+corGauge+'"></i></div>'+
      '<div class="meta"><span>distância liq. '+fmtPct(distMin,1)+'</span><span>aberta há '+fmtHoras(p.horasAberta)+'</span></div>'+
      '</div>';
  }).join('');
}
function flashClass(key,val){
  if(val==null)return '';
  var ant=ultimoPreco[key];
  ultimoPreco[key]=val;
  if(ant==null||ant===val)return '';
  return val>ant?'flash-up':'flash-down';
}
// remove a classe de flash pouco depois de aplicada, senão fica presa
setInterval(function(){
  document.querySelectorAll('.flash-up,.flash-down').forEach(function(n){
    n.classList.remove('flash-up');n.classList.remove('flash-down');
  });
},650);

// ---- contas por exchange ----
function renderContas(d){
  var contas=d.contas||[];
  var host=el('acct');
  if(!contas.length){host.innerHTML='<div class="empty">sem saldos ainda</div>';return}
  host.innerHTML=contas.map(function(c){
    var pct=Math.min(100,(c.fracaoUsada||0)*100);
    var markPct=c.saldo>0?Math.min(100,(c.alvoReserva/c.saldo)*100):0;
    return '<div class="acctrow">'+
      '<div class="head"><b>'+esc(c.exchange)+'</b><span>'+fmtUsd(c.saldo)+'</span></div>'+
      '<div class="barmeter"><i style="width:'+pct+'%"></i><span class="mark" style="left:'+(100-markPct)+'%"></span></div>'+
      '<div class="meta" style="display:flex;justify-content:space-between;font-size:.7rem;color:#8a93ad;margin-top:5px;font-family:ui-monospace,monospace">'+
        '<span>margem usada '+fmtUsd(c.margemUsada)+'</span><span>livre '+fmtUsd(c.livre)+'</span></div>'+
      '</div>';
  }).join('');
}

// ---- exposição / concentração / dreno ----
function renderExposicao(d){
  var conc=d.concentracao||{exchange:'—',fracao:0};
  var teto=(d.config&&d.config.tetoPorExchange)||0.4;
  var estourou=conc.fracao>teto;
  var dreno=d.dreno||{};
  var linhas=Object.keys(dreno).map(function(k){return {ex:k,v:dreno[k]}}).sort(function(a,b){return Math.abs(b.v)-Math.abs(a.v)}).slice(0,5);
  var out=[];
  out.push('<div class="exprow"><span>Maior concentração</span><span class="'+(estourou?'down':'up')+'">'+esc(conc.exchange)+' · '+fmtPct(conc.fracao,1)+' (teto '+fmtPct(teto,0)+')</span></div>');
  out.push('<div class="exprow"><span>Pior dreno direcional</span><span>'+fmtUsd(d.piorDreno||0)+'</span></div>');
  linhas.forEach(function(l){
    out.push('<div class="exprow"><span>'+esc(l.ex)+'</span><span class="'+(l.v>=0?'up':'down')+'">'+fmtUsd(l.v)+'</span></div>');
  });
  if(!linhas.length) out.push('<div class="exprow"><span style="color:#5c6480">sem posições abertas para medir exposição</span></div>');
  el('exposure').innerHTML=out.join('');
}

// ---- varredura / scan ----
function renderScan(d){
  var scan=(d.scan||[]).slice().sort(function(a,b){return (b.pctDoCaminho||0)-(a.pctDoCaminho||0)});
  el('scan-tag').textContent=(d.vigilancia?d.vigilancia.fonte:'') + (d.idadeVarreduraMin!=null&&d.idadeVarreduraMin>=0?' · dado de '+d.idadeVarreduraMin+' min':'');
  var body=el('scan-body');
  if(!scan.length){
    body.innerHTML='<tr><td colspan="9" style="color:#5c6480;text-align:center;padding:20px">sem candidatos no momento</td></tr>';
    return;
  }
  body.innerHTML=scan.map(function(o){
    var pct=Math.max(0,Math.min(100,o.pctDoCaminho||0));
    var corBar=o.passaPortao?'#34d399':(pct>60?'#fbbf24':'#fb7185');
    return '<tr class="row-hover">'+
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
}

// ---- saúde das exchanges (custódia) ----
function renderCustodia(d){
  var c=d.custodia||{saude:{}};
  var host=el('custodia-grid');
  var ids=Object.keys(c.saude||{});
  if(!ids.length){host.innerHTML='<div class="empty">sem dado de custódia ainda</div>';return}
  var corNivel={ok:'#34d399',atencao:'#fbbf24','alerta':'#fb7185','critico':'#fb7185',desconhecido:'#5c6480'};
  host.innerHTML=ids.map(function(id){
    var s=c.saude[id];
    var cor=corNivel[s.nivel]||'#5c6480';
    return '<div class="hchip"><div class="nm"><span class="dot" style="background:'+cor+'"></span>'+esc(id)+'</div>'+
      '<div class="dt">'+esc(s.detalhe||s.nivel)+'</div></div>';
  }).join('');
}

// ---- coleta de longo prazo ----
function renderColeta(d){
  var c=d.coleta;
  var host=el('coleta-box');
  if(!c){host.innerHTML='<div class="empty">coletor ainda não escreveu estado</div>';return}
  host.innerHTML=
    '<div class="exprow"><span>Observações</span><span>'+fmtNum(c.totalObservacoes)+'</span></div>'+
    '<div class="exprow"><span>Ciclos</span><span>'+fmtNum(c.totalCiclos)+'</span></div>'+
    '<div class="exprow"><span>Registros de custódia</span><span>'+fmtNum(c.totalCustodia)+'</span></div>'+
    '<div class="exprow"><span>Coletando há</span><span>'+(c.coletandoDesde?diasDesde(c.coletandoDesde):'—')+'</span></div>';
}

// ---- prontidão de ML ----
function renderMl(d){
  var m=d.ml||{confiaveis:0,positivos:0,minimoNecessario:30};
  var pct=Math.min(100,(m.positivos/Math.max(1,m.minimoNecessario))*100);
  el('ml-box').innerHTML=
    '<div class="exprow"><span>Ciclos confiáveis</span><span>'+fmtNum(m.confiaveis)+'</span></div>'+
    '<div class="exprow"><span>Exemplos positivos</span><span>'+fmtNum(m.positivos)+' / '+fmtNum(m.minimoNecessario)+'</span></div>'+
    '<div class="progress-readiness"><i style="width:'+pct+'%"></i></div>'+
    '<div style="font-size:.7rem;color:#5c6480;margin-top:6px">'+(pct>=100?'pronto para treinar':pct.toFixed(0)+'% do mínimo para treinar')+'</div>';
}

// ---- basis trade ----
function renderBasis(d){
  var b=d.basis||{vivas:0,fechadas:0,duracaoMedianaHoras:0,duracaoMaximaHoras:0,top:[]};
  var out='<div class="grid3" style="margin-bottom:14px">'+
    '<div class="kpi"><div class="lbl">Vivos</div><div class="val">'+fmtNum(b.vivas)+'</div></div>'+
    '<div class="kpi"><div class="lbl">Fechados</div><div class="val">'+fmtNum(b.fechadas)+'</div></div>'+
    '<div class="kpi"><div class="lbl">Duração mediana</div><div class="val" style="font-size:1.1rem">'+fmtHoras(b.duracaoMedianaHoras)+'</div></div>'+
    '</div>';
  if(b.top&&b.top.length){
    out+='<table><thead><tr><th>Par</th><th>Exchange</th><th>APR</th><th>Observações</th><th>Vivo há</th></tr></thead><tbody>'+
      b.top.map(function(t){
        return '<tr class="row-hover"><td>'+esc((t.symbol||'').replace('/USDT:USDT',''))+'</td><td>'+esc(t.exchange)+'</td>'+
          '<td>'+fmtPct((t.apr||0)/100,1)+'</td><td>'+fmtNum(t.observacoes)+'</td><td>'+fmtHoras(t.horasVivo)+'</td></tr>';
      }).join('')+'</tbody></table>';
  }
  el('basis-box').innerHTML=out;
}

// ---- linha do tempo de decisões ----
var corEvento={
  abertura:'#34d399', 'abre':'#34d399', fechamento:'#fb7185', 'fecha':'#fb7185',
  bloqueado:'#5c6480', funding:'#5eead4', transferencia:'#60a5fa', reinvestimento:'#a78bfa'
};
function renderTimeline(d){
  var itens=(d.diario||[]).slice(0,60);
  var host=el('timeline');
  if(!itens.length){host.innerHTML='<div class="empty">sem eventos ainda</div>';return}
  host.innerHTML=itens.map(function(e){
    var cor=corEvento[e.evento]||'#8a93ad';
    var titulo=(e.evento||'evento')+(e.symbol?' · '+e.symbol.replace('/USDT:USDT',''):'');
    return '<div class="tl-item"><span class="tl-dot" style="background:'+cor+'"></span>'+
      '<div class="tl-body"><b>'+esc(titulo)+'</b><div class="motivo">'+esc(e.motivo||'')+'</div></div>'+
      '<div class="tl-time">'+timeAgo(e.ts)+'</div></div>';
  }).join('');
}

// ---- vigilância / status do stream ----
function renderStatus(d){
  var v=d.vigilancia||{};
  el('dot-vig').className='dot '+(v.viva?'live':'dead');
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

// ---- relógio ----
setInterval(function(){
  el('clock').textContent=new Date().toLocaleTimeString('pt-BR');
},1000);

// ---- conexão: SSE com fallback para polling ----
var es=null, poll=null;
function pararPolling(){if(poll){clearInterval(poll);poll=null}}
function iniciarPolling(){
  pararPolling();
  el('dot-stream').className='dot warn';
  el('txt-stream').textContent='sondando (sem stream)';
  poll=setInterval(function(){
    fetch('/api/dados').then(function(r){return r.json()}).then(render).catch(function(){});
  },5000);
}
function conectar(){
  el('dot-stream').className='dot warn';
  el('txt-stream').textContent='conectando…';
  try{es=new EventSource('/api/stream')}catch(e){iniciarPolling();return}
  es.onopen=function(){
    el('dot-stream').className='dot live';
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
