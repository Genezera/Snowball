/**
 * Dashboard — HTML + SVG puro, sem dependência externa.
 *
 * Decisões de desenho que valem registrar:
 *
 * · TUDO QUE O SISTEMA FAZ, VISÍVEL. Cinco processos rodam por trás disso
 *   (vigilância, custódia, motor, dashboard, coletor) e antes só apareciam
 *   em logs que ninguém olhava. A tira de saúde no topo mostra os cinco ao
 *   vivo, com memória e há quanto tempo estão de pé — é o mesmo dado que o
 *   watchdog usa pra decidir se religa algo, só que visível.
 *
 * · CURVA SUAVE COM SPLINE MONOTÔNICA. Uma polilinha reta entre pontos parece
 *   amadora; uma spline comum (Catmull-Rom) inventa oscilação que não existe
 *   nos dados. A interpolação monotônica de Fritsch-Carlson suaviza SEM
 *   ultrapassar os valores reais, obrigatório num gráfico financeiro.
 *
 * · NÚMEROS QUE SE MOVEM, NÃO QUE TROCAM. Capital, pagamentos e afins usam
 *   interpolação por frame (`animarNumero`) em vez de substituir o texto na
 *   marra — o olho pega movimento muito mais rápido que troca instantânea.
 *
 * · ANEL DE PROGRESSO NO PORTÃO. "42% do caminho" escrito por extenso exige
 *   ler; um anel preenchido se lê num piscar — e é a métrica mais repetida
 *   da tela inteira (uma por linha da varredura).
 *
 * · ESTADOS VAZIOS INFORMATIVOS. "Sem dados" não ajuda; "o funding chega a
 *   cada 8 horas" explica o que esperar e quando.
 */
export const PAGINA = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Snowball · Motor de Spread</title>
<style>
:root{
  --bg:#05070c; --s1:#0b0f18; --s2:#111726; --s3:#171f31;
  --br:#1c2434; --br2:#293349;
  --t1:#f1f4fa; --t2:#9aa5bd; --t3:#5c6784;
  --up:#00e0a0; --up-dim:rgba(0,224,160,.14);
  --dn:#ff5c7a; --dn-dim:rgba(255,92,122,.14);
  --ac:#4d8dff; --ac-dim:rgba(77,141,255,.14);
  --wa:#ffb340; --wa-dim:rgba(255,179,64,.14);
  --pu:#a687ff; --pu-dim:rgba(166,135,255,.14);
  --r:16px; --r2:11px;
}
*{box-sizing:border-box;margin:0;padding:0}
::selection{background:rgba(77,141,255,.3)}
html{scroll-behavior:smooth}
body{
  background:
    radial-gradient(900px 560px at 12% -8%, rgba(0,224,160,.10) 0%, transparent 60%),
    radial-gradient(760px 520px at 92% 8%, rgba(77,141,255,.09) 0%, transparent 58%),
    radial-gradient(1000px 700px at 50% 115%, rgba(166,135,255,.06) 0%, transparent 60%),
    var(--bg);
  background-attachment:fixed;
  color:var(--t1);min-height:100vh;
  font:14px/1.55 ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;
  padding:24px 26px 48px;max-width:1660px;margin:0 auto;
  -webkit-font-smoothing:antialiased;position:relative;overflow-x:hidden}
.mono{font-variant-numeric:tabular-nums;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;letter-spacing:-.02em}

/* orbes flutuantes no fundo, puramente decorativos e bem sutis */
.orb{position:fixed;border-radius:50%;filter:blur(70px);opacity:.16;pointer-events:none;z-index:0}
.orb1{width:420px;height:420px;background:var(--up);top:-140px;left:-100px;animation:float1 22s ease-in-out infinite}
.orb2{width:380px;height:380px;background:var(--ac);top:30%;right:-140px;animation:float2 26s ease-in-out infinite}
.orb3{width:340px;height:340px;background:var(--pu);bottom:-160px;left:35%;animation:float1 30s ease-in-out infinite reverse}
@keyframes float1{0%,100%{transform:translate(0,0)}50%{transform:translate(40px,50px)}}
@keyframes float2{0%,100%{transform:translate(0,0)}50%{transform:translate(-50px,40px)}}
header,.row,.card{position:relative;z-index:1}

header{display:flex;align-items:flex-start;justify-content:space-between;gap:22px;flex-wrap:wrap;margin-bottom:18px}
.brand{display:flex;align-items:center;gap:14px}
.mark{width:40px;height:40px;border-radius:12px;flex-shrink:0;
  background:linear-gradient(140deg,var(--up),var(--ac));
  display:grid;place-items:center;font-weight:800;font-size:1.1rem;color:#03130f;
  box-shadow:0 8px 26px rgba(0,224,160,.28),inset 0 1px 0 rgba(255,255,255,.3)}
h1{font-size:1.22rem;font-weight:750;letter-spacing:-.02em;line-height:1.25}
.sub{color:var(--t3);font-size:.76rem;margin-top:3px}
.status{display:flex;align-items:center;gap:9px;background:var(--s1);border:1px solid var(--br);
  border-radius:99px;padding:8px 16px;font-size:.75rem;color:var(--t2);white-space:nowrap}
.led{width:8px;height:8px;border-radius:50%;background:var(--up);flex-shrink:0;
  box-shadow:0 0 0 3px rgba(0,224,160,.18);animation:p 2.2s ease-in-out infinite}
.led.dn{background:var(--dn);box-shadow:0 0 0 3px rgba(255,92,122,.18)}
@keyframes p{0%,100%{opacity:1}50%{opacity:.45}}

/* ── tira de saude dos processos ─────────────────────────────────────── */
.procs{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px}
.proc{flex:1;min-width:150px;background:linear-gradient(180deg,var(--s1),#080b12);border:1px solid var(--br);
  border-radius:var(--r2);padding:12px 14px;display:flex;align-items:center;gap:11px;
  transition:border-color .2s,transform .2s;cursor:default}
.proc:hover{transform:translateY(-2px);border-color:var(--br2)}
.proc .orbe{width:11px;height:11px;border-radius:50%;flex-shrink:0;position:relative}
.proc .orbe.on{background:var(--up);box-shadow:0 0 10px 1px rgba(0,224,160,.6)}
.proc .orbe.on::after{content:'';position:absolute;inset:-5px;border-radius:50%;
  border:1.5px solid var(--up);opacity:.55;animation:ring 1.8s ease-out infinite}
.proc .orbe.off{background:var(--dn);box-shadow:0 0 8px 1px rgba(255,92,122,.5)}
@keyframes ring{0%{transform:scale(.5);opacity:.7}100%{transform:scale(1.6);opacity:0}}
.proc .info{min-width:0}
.proc .nome{font-size:.74rem;font-weight:700;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.proc .det{font-size:.65rem;color:var(--t3);margin-top:1px;white-space:nowrap}

.row{display:grid;gap:16px;margin-bottom:16px}
.c4{grid-template-columns:repeat(4,minmax(0,1fr))}
.c2{grid-template-columns:minmax(0,1.58fr) minmax(0,1fr)}
.c3{grid-template-columns:repeat(3,minmax(0,1fr))}
@media(max-width:1180px){.c4{grid-template-columns:repeat(2,minmax(0,1fr))}.c2{grid-template-columns:1fr}.c3{grid-template-columns:1fr}}
@media(max-width:600px){.c4{grid-template-columns:1fr}}

.card{background:linear-gradient(180deg,var(--s1),#080b12);border:1px solid var(--br);
  border-radius:var(--r);padding:20px 22px;min-width:0;position:relative;overflow:hidden;
  transition:border-color .25s,box-shadow .25s}
.card::before{content:'';position:absolute;inset:0 0 auto;height:1px;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.06),transparent)}
.card:hover{border-color:var(--br2)}
.card.flash{animation:flashCard 1s ease}
@keyframes flashCard{0%{box-shadow:0 0 0 1px var(--ac),0 0 24px rgba(77,141,255,.35)}100%{box-shadow:none}}
.hd{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
.lbl{font-size:.65rem;text-transform:uppercase;letter-spacing:.11em;color:var(--t3);font-weight:700}
.note{font-size:.7rem;color:var(--t3)}

.kpi{display:flex;justify-content:space-between;align-items:flex-end;gap:12px}
.kpi .v{font-size:1.86rem;font-weight:760;letter-spacing:-.03em;line-height:1.02;margin-top:3px}
.kpi .d{font-size:.73rem;color:var(--t2);margin-top:8px;display:flex;align-items:center;gap:5px}
.spark{width:74px;height:34px;flex-shrink:0;opacity:.9}
.up{color:var(--up)}.dn{color:var(--dn)}.ac{color:var(--ac)}.wa{color:var(--wa)}.pu{color:var(--pu)}.mut{color:var(--t3)}

.chart{width:100%;height:230px;position:relative}
.chart svg{width:100%;height:100%;display:block;overflow:visible}
.tip{position:absolute;pointer-events:none;opacity:0;transition:opacity .12s;
  background:rgba(10,14,22,.98);border:1px solid var(--br2);border-radius:9px;
  padding:8px 11px;font-size:.74rem;white-space:nowrap;z-index:5;
  box-shadow:0 12px 34px rgba(0,0,0,.65);transform:translate(-50%,-118%)}
.tip b{font-size:.86rem;display:block;margin-top:2px}
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;
  gap:7px;color:var(--t3);font-size:.82rem;text-align:center}
.empty .ic{width:36px;height:36px;border-radius:50%;border:1.5px dashed var(--br2);
  display:grid;place-items:center;font-size:1rem;opacity:.6}
.legend{display:flex;gap:18px;font-size:.7rem;color:var(--t3);margin-top:13px;flex-wrap:wrap}
.dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:6px;vertical-align:middle}

.pos{border:1px solid rgba(0,224,160,.24);border-radius:13px;padding:18px 19px;
  background:linear-gradient(155deg,rgba(0,224,160,.08),rgba(77,141,255,.03))}
.tk{font-size:1.46rem;font-weight:790;letter-spacing:-.02em}
.legs{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:15px 0 4px}
.leg{background:rgba(0,0,0,.3);border:1px solid var(--br);border-radius:var(--r2);padding:11px 13px}
.leg .t{font-size:.61rem;font-weight:800;letter-spacing:.09em;margin-bottom:6px;display:flex;align-items:center;gap:5px}
.leg .e{font-size:.88rem;font-weight:650;letter-spacing:-.01em}
.kv{display:flex;justify-content:space-between;align-items:baseline;gap:12px;
  padding:9px 0;border-bottom:1px solid rgba(255,255,255,.045);font-size:.79rem}
.kv:last-child{border:none}
.kv>span:first-child{color:var(--t2)}

table{width:100%;border-collapse:collapse;font-size:.79rem}
th{text-align:left;color:var(--t3);font-weight:700;font-size:.62rem;text-transform:uppercase;
  letter-spacing:.09em;padding:10px 11px;border-bottom:1px solid var(--br);white-space:nowrap}
td{padding:10px 11px;border-bottom:1px solid rgba(255,255,255,.035);white-space:nowrap}
tbody tr{transition:background .15s}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover{background:var(--s2)}
tr.on{background:rgba(0,224,160,.08)}
tr.on td:first-child{box-shadow:inset 2.5px 0 0 var(--up)}
tr.novo{animation:slideIn .5s ease}
@keyframes slideIn{from{opacity:0;transform:translateX(-10px);background:rgba(77,141,255,.12)}to{opacity:1;transform:translateX(0)}}
.right{text-align:right}
.wrap{overflow-x:auto;margin:0 -22px;padding:0 22px}
.wrap::-webkit-scrollbar{height:7px}
.wrap::-webkit-scrollbar-thumb{background:var(--br2);border-radius:9px}

.tag{display:inline-flex;align-items:center;font-size:.59rem;font-weight:800;padding:4px 9px;
  border-radius:6px;letter-spacing:.06em;text-transform:uppercase}
.t-abre{background:var(--up-dim);color:var(--up)}
.t-fecha{background:var(--dn-dim);color:var(--dn)}
.t-funding{background:var(--ac-dim);color:var(--ac)}
.t-reinveste{background:var(--wa-dim);color:var(--wa)}
.t-transfere{background:var(--pu-dim);color:var(--pu)}
.t-semana{background:rgba(255,255,255,.06);color:var(--t2)}
.t-init{background:rgba(255,255,255,.05);color:var(--t3)}
.t-bloqueado{background:rgba(255,92,122,.08);color:#c17c88}
.t-apara{background:var(--wa-dim);color:var(--wa)}
.t-socorre{background:var(--pu-dim);color:var(--pu)}
.t-piso{background:var(--dn-dim);color:var(--dn)}
.badge{background:var(--up-dim);color:var(--up);font-size:.54rem;font-weight:800;
  padding:3px 7px;border-radius:5px;margin-left:8px;letter-spacing:.07em;text-transform:uppercase}

.meter{height:6px;background:rgba(255,255,255,.055);border-radius:99px;overflow:hidden;margin:11px 0 8px}
.meter>i{display:block;height:100%;border-radius:99px;transition:width .6s cubic-bezier(.4,0,.2,1)}
.gauge{display:flex;align-items:center;gap:15px;margin-bottom:4px}

.custBadge{display:inline-flex;align-items:center;gap:5px;font-size:.68rem;font-weight:700;
  padding:4px 10px;margin:0 6px 6px 0;border-radius:99px;background:rgba(255,255,255,.05);
  border:1px solid var(--br);cursor:default}

.anel{display:inline-flex;align-items:center;gap:7px;vertical-align:middle}
.anel span{font-size:.72rem;font-weight:700}

.statgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
@media(max-width:760px){.statgrid{grid-template-columns:repeat(2,1fr)}}
.stat{text-align:center;padding:12px 8px;background:rgba(255,255,255,.02);border-radius:var(--r2);border:1px solid var(--br)}
.stat .v{font-size:1.3rem;font-weight:750;letter-spacing:-.02em}
.stat .l{font-size:.63rem;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-top:4px}

.meter{height:6px;background:rgba(255,255,255,.055);border-radius:99px;overflow:hidden;margin:11px 0 8px}
</style></head><body>

<div class="orb orb1"></div><div class="orb orb2"></div><div class="orb orb3"></div>

<header>
  <div class="brand">
    <div class="mark">S</div>
    <div>
      <h1>Motor de Spread entre Exchanges</h1>
      <div class="sub" id="sub">carregando…</div>
    </div>
  </div>
  <div class="status"><span class="led" id="ledGeral"></span><span id="pill">delta-neutro</span></div>
</header>

<div class="procs" id="procs"></div>

<div class="row c4" id="kpis"></div>

<div class="row c2">
  <div class="card">
    <div class="hd"><span class="lbl">Curva de capital</span><span class="note" id="capNota"></span></div>
    <div class="chart" id="gCapWrap"><div id="gCap" style="height:100%"></div><div class="tip" id="tip"></div></div>
    <div class="legend">
      <span><i class="dot" style="background:var(--up)"></i>capital</span>
      <span><i class="dot" style="background:var(--wa)"></i>abertura</span>
      <span><i class="dot" style="background:var(--dn)"></i>fechamento</span>
    </div>
  </div>
  <div class="card">
    <div class="hd"><span class="lbl">Posição montada</span></div>
    <div id="pos"></div>
  </div>
</div>

<div class="row c2">
  <div class="card">
    <div class="hd"><span class="lbl">Funding por dia</span><span class="note" id="pagNota"></span></div>
    <div class="chart" style="height:172px" id="gPag"></div>
  </div>
  <div class="card">
    <div class="hd"><span class="lbl">Economia da operação</span></div>
    <div id="eco"></div>
  </div>
</div>

<div class="card" style="margin-bottom:16px">
  <div class="hd"><span class="lbl">Varredura ao vivo</span><span class="note" id="scanNota"></span></div>
  <div class="wrap"><table><thead><tr>
    <th>Ativo</th><th>Vendido</th><th>Comprado</th>
    <th class="right">Preço agora</th>
    <th class="right">Spread médio</th><th class="right">APR</th>
    <th class="right">Consistência</th><th class="right">Vive há</th>
    <th class="right">Payback</th><th class="right">Portão</th>
  </tr></thead><tbody id="scan"></tbody></table></div>
</div>

<div class="row c2" style="margin-bottom:16px">
  <div class="card">
    <div class="hd"><span class="lbl">Coleta de longo prazo</span><span class="note" id="coletaNota"></span></div>
    <div class="statgrid" id="coleta"></div>
  </div>
  <div class="card">
    <div class="hd"><span class="lbl">Estabilidade do sistema</span><span class="note" id="wdNota"></span></div>
    <div id="watchdog"></div>
  </div>
</div>

<div class="card">
  <div class="hd"><span class="lbl">Decisões do motor</span><span class="note">o raciocínio, não só o resultado</span></div>
  <div class="wrap"><table><thead><tr>
    <th style="width:118px">Quando</th><th style="width:112px">Evento</th><th>Detalhe</th><th class="right">Valor</th>
  </tr></thead><tbody id="log"></tbody></table></div>
</div>

<script>
const f=(n,d=2)=>Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d});
const hm=t=>new Date(t).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
const dm=t=>new Date(t).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
const vazio=(t,s)=>'<div class="empty"><div class="ic">◷</div><div>'+t+'</div>'+(s?'<div style="font-size:.72rem;opacity:.75">'+s+'</div>':'')+'</div>';

/**
 * Spline monotônica (Fritsch-Carlson). Suaviza sem ultrapassar os valores
 * reais — indispensável num gráfico financeiro, onde uma curva que sobe acima
 * do maior ponto mente sobre o dado.
 */
function suave(pts){
  const n=pts.length;
  if(n<2)return '';
  if(n===2)return 'M'+pts[0][0]+','+pts[0][1]+' L'+pts[1][0]+','+pts[1][1];
  const dx=[],dy=[],m=[];
  for(let i=0;i<n-1;i++){dx[i]=pts[i+1][0]-pts[i][0];dy[i]=pts[i+1][1]-pts[i][1];m[i]=dy[i]/(dx[i]||1e-9)}
  const t=[m[0]];
  for(let i=1;i<n-1;i++){
    if(m[i-1]*m[i]<=0)t[i]=0;
    else{const w1=2*dx[i]+dx[i-1],w2=dx[i]+2*dx[i-1];t[i]=(w1+w2)/(w1/m[i-1]+w2/m[i])}
  }
  t[n-1]=m[n-2];
  let d='M'+pts[0][0].toFixed(1)+','+pts[0][1].toFixed(1);
  for(let i=0;i<n-1;i++){
    const h=dx[i]/3;
    d+=' C'+(pts[i][0]+h).toFixed(1)+','+(pts[i][1]+h*t[i]).toFixed(1)
      +' '+(pts[i+1][0]-h).toFixed(1)+','+(pts[i+1][1]-h*t[i+1]).toFixed(1)
      +' '+pts[i+1][0].toFixed(1)+','+pts[i+1][1].toFixed(1);
  }
  return d;
}

function sparkline(vals,cor){
  if(!vals||vals.length<2)return '';
  const W=74,H=34,p=3;
  let lo=Math.min(...vals),hi=Math.max(...vals);
  if(hi-lo<1e-9){lo-=1;hi+=1}
  const pts=vals.map((v,i)=>[p+(W-2*p)*(i/(vals.length-1)),p+(H-2*p)*(1-(v-lo)/(hi-lo))]);
  return '<svg class="spark" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'
    +'<path d="'+suave(pts)+' L'+(W-p)+','+(H-p)+' L'+p+','+(H-p)+' Z" fill="'+cor+'" opacity=".12"/>'
    +'<path d="'+suave(pts)+'" fill="none" stroke="'+cor+'" stroke-width="1.8" stroke-linecap="round"/></svg>';
}

/** Anel de progresso — a métrica de "% do caminho até o portão" lida num piscar. */
function anel(pct,cor,tam){
  tam=tam||30;
  const r=tam/2-3.2,c=2*Math.PI*r,pctc=Math.max(0,Math.min(100,pct));
  const off=c*(1-pctc/100);
  return '<svg width="'+tam+'" height="'+tam+'" viewBox="0 0 '+tam+' '+tam+'">'
    +'<circle cx="'+(tam/2)+'" cy="'+(tam/2)+'" r="'+r+'" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="3"/>'
    +'<circle cx="'+(tam/2)+'" cy="'+(tam/2)+'" r="'+r+'" fill="none" stroke="'+cor+'" stroke-width="3" '
    +'stroke-dasharray="'+c.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'" stroke-linecap="round" '
    +'transform="rotate(-90 '+(tam/2)+' '+(tam/2)+')" style="transition:stroke-dashoffset .7s cubic-bezier(.4,0,.2,1)"/></svg>';
}

let pontosCurva=[];
function linha(serie,eventos){
  if(!serie||serie.length<2)return vazio('aguardando leituras','a curva aparece a partir de 2 pontos');
  const W=820,H=230,pl=58,pr=18,pt=20,pb=30;
  const vs=serie.map(d=>d.capital);
  let lo=Math.min(...vs),hi=Math.max(...vs);
  const sp=hi-lo,pad=sp<1e-6?Math.max(.4,hi*.0025):sp*.18;
  lo-=pad;hi+=pad;
  const t0=serie[0].ts,t1=serie[serie.length-1].ts,dt=Math.max(1,t1-t0);
  const X=t=>pl+(W-pl-pr)*((t-t0)/dt), Y=v=>pt+(H-pt-pb)*(1-(v-lo)/(hi-lo));
  const pts=serie.map(d=>[X(d.ts),Y(d.capital)]);
  pontosCurva=serie.map((d,i)=>({x:pts[i][0],y:pts[i][1],ts:d.ts,v:d.capital,W}));

  let g='';
  for(let i=0;i<=4;i++){
    const y=pt+(H-pt-pb)*(i/4),v=hi-(hi-lo)*(i/4);
    g+='<line x1="'+pl+'" y1="'+y.toFixed(1)+'" x2="'+(W-pr)+'" y2="'+y.toFixed(1)+'" stroke="rgba(255,255,255,.04)"/>'
      +'<text x="'+(pl-10)+'" y="'+(y+3.6).toFixed(1)+'" fill="#5c6784" font-size="10.5" text-anchor="end" class="mono">$'+f(v)+'</text>';
  }
  let mk='';
  for(const e of eventos||[]){
    if((e.evento!=='abre'&&e.evento!=='fecha')||e.ts<t0||e.ts>t1)continue;
    const x=X(e.ts),c=e.evento==='abre'?'#ffb340':'#ff5c7a';
    mk+='<line x1="'+x.toFixed(1)+'" y1="'+pt+'" x2="'+x.toFixed(1)+'" y2="'+(H-pb)+'" stroke="'+c+'" stroke-width="1" stroke-dasharray="3,5" opacity=".45"/>'
      +'<circle cx="'+x.toFixed(1)+'" cy="'+pt+'" r="3.6" fill="'+c+'"/>';
  }
  const d=suave(pts);
  const dots=pts.length<=50?pts.map(p=>'<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="2.4" fill="#00e0a0" opacity=".9"/>').join(''):'';

  return '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" id="svgCap">'
    +'<defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">'
    +'<stop offset="0" stop-color="#00e0a0" stop-opacity=".32"/><stop offset="1" stop-color="#00e0a0" stop-opacity="0"/></linearGradient></defs>'
    +g+'<path d="'+d+' L'+pts[pts.length-1][0].toFixed(1)+','+(H-pb)+' L'+pts[0][0].toFixed(1)+','+(H-pb)+' Z" fill="url(#ga)"/>'
    +mk+'<path d="'+d+'" fill="none" stroke="#00e0a0" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>'
    +dots+'<line id="cross" x1="0" y1="'+pt+'" x2="0" y2="'+(H-pb)+'" stroke="#4d8dff" stroke-width="1" opacity="0"/>'
    +'<circle id="crossD" r="4.5" fill="#4d8dff" stroke="#05070c" stroke-width="2" opacity="0"/>'
    +'<text x="'+pl+'" y="'+(H-8)+'" fill="#5c6784" font-size="10.5">'+dm(t0)+' '+hm(t0)+'</text>'
    +'<text x="'+(W-pr)+'" y="'+(H-8)+'" fill="#5c6784" font-size="10.5" text-anchor="end">'+dm(t1)+' '+hm(t1)+'</text></svg>';
}

function barras(dados){
  if(!dados||!dados.length)return vazio('nenhum pagamento ainda','o funding chega a cada 8 horas');
  const W=820,H=172,pl=58,pr=18,pt=20,pb=26;
  const mx=Math.max(...dados.map(d=>d.total),1e-9);
  const faixa=(W-pl-pr)/dados.length;
  const bw=Math.min(46,Math.max(9,faixa*.55));
  let g='';
  for(let i=0;i<=2;i++){
    const y=pt+(H-pt-pb)*(i/2),v=mx-mx*(i/2);
    g+='<line x1="'+pl+'" y1="'+y.toFixed(1)+'" x2="'+(W-pr)+'" y2="'+y.toFixed(1)+'" stroke="rgba(255,255,255,.04)"/>'
      +'<text x="'+(pl-10)+'" y="'+(y+3.6).toFixed(1)+'" fill="#5c6784" font-size="10" text-anchor="end" class="mono">$'+f(v,4)+'</text>';
  }
  let b='';
  dados.forEach((d,i)=>{
    const cx=pl+faixa*(i+.5),x=cx-bw/2;
    const h=Math.max(3,(H-pt-pb)*(d.total/mx));
    b+='<rect x="'+x.toFixed(1)+'" y="'+(H-pb-h).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="3.5" fill="url(#gb)"/>'
      +'<text x="'+cx.toFixed(1)+'" y="'+(H-pb-h-7).toFixed(1)+'" fill="#9aa5bd" font-size="9.5" text-anchor="middle" class="mono">$'+f(d.total,4)+'</text>';
    if(dados.length<=16)b+='<text x="'+cx.toFixed(1)+'" y="'+(H-8)+'" fill="#5c6784" font-size="9.5" text-anchor="middle">'+d.dia.slice(8)+'/'+d.dia.slice(5,7)+'</text>';
  });
  return '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'
    +'<defs><linearGradient id="gb" x1="0" y1="0" x2="0" y2="1">'
    +'<stop offset="0" stop-color="#4d8dff"/><stop offset="1" stop-color="#4d8dff" stop-opacity=".45"/></linearGradient></defs>'
    +g+b+'</svg>';
}

// crosshair interativo
const wrap=document.getElementById('gCapWrap'),tip=document.getElementById('tip');
wrap.addEventListener('mousemove',ev=>{
  if(!pontosCurva.length)return;
  const svg=document.getElementById('svgCap');if(!svg)return;
  const r=svg.getBoundingClientRect();
  const sx=((ev.clientX-r.left)/r.width)*pontosCurva[0].W;
  let best=pontosCurva[0];
  for(const p of pontosCurva)if(Math.abs(p.x-sx)<Math.abs(best.x-sx))best=p;
  const cl=document.getElementById('cross'),cd=document.getElementById('crossD');
  if(cl){cl.setAttribute('x1',best.x);cl.setAttribute('x2',best.x);cl.setAttribute('opacity','.55')}
  if(cd){cd.setAttribute('cx',best.x);cd.setAttribute('cy',best.y);cd.setAttribute('opacity','1')}
  tip.style.opacity='1';
  tip.style.left=((best.x/pontosCurva[0].W)*r.width)+'px';
  tip.style.top=((best.y/230)*r.height)+'px';
  tip.innerHTML='<span style="color:#5c6784">'+dm(best.ts)+' '+hm(best.ts)+'</span><b class="mono">$'+f(best.v)+'</b>';
});
wrap.addEventListener('mouseleave',()=>{
  tip.style.opacity='0';
  const cl=document.getElementById('cross'),cd=document.getElementById('crossD');
  if(cl)cl.setAttribute('opacity','0'); if(cd)cd.setAttribute('opacity','0');
});

/** Números que se movem em vez de trocar na marra — o olho pega movimento. */
const valoresAnimados={};
function animarNumero(id,alvo,formatar){
  const el=document.getElementById(id);
  if(!el)return;
  const de=valoresAnimados[id]!=null?valoresAnimados[id]:alvo;
  if(Math.abs(de-alvo)<1e-9){el.textContent=formatar(alvo);valoresAnimados[id]=alvo;return}
  const t0=performance.now(),dur=650;
  function passo(t){
    const p=Math.min(1,(t-t0)/dur),ease=1-Math.pow(1-p,3);
    const v=de+(alvo-de)*ease;
    el.textContent=formatar(v);
    if(p<1)requestAnimationFrame(passo);else valoresAnimados[id]=alvo;
  }
  requestAnimationFrame(passo);
}
function flashCard(el){
  if(!el)return;
  el.classList.remove('flash');void el.offsetWidth;el.classList.add('flash');
}

let ultimoCapital=null;
let idsVistosLog=new Set();

function render(d){
  const e=d.estado;
  if(!e){document.getElementById('sub').textContent='aguardando primeiro ciclo do motor';return}

  const dias=(Date.now()-e.iniciadoEm)/864e5, lucro=e.capital-e.capitalInicial;
  const sem=(e.semanas||[]).filter(w=>w.lucro!==0), semPos=sem.filter(w=>w.lucro>0).length;
  const curva=d.curva||[], vals=curva.map(x=>x.capital);

  const vg=d.vigilancia||{};
  document.getElementById('sub').textContent='dia '+dias.toFixed(1)+' · atualizado '+hm(d.atualizadoEm)
    +(d.idadeVarreduraMin>=0?' · dado de '+d.idadeVarreduraMin+' min':' · varrendo')
    +(vg.fonte?' · '+vg.fonte:'')
    +(vg.viva?' · '+vg.varreduras+' varreduras · '+vg.vivas+' spreads vivos':'');

  // ── saúde geral: verde só se os 5 processos estiverem de pé ───────────
  const procs=d.processos||[];
  const todosVivos=procs.length&&procs.every(p=>p.vivo);
  const led=document.getElementById('ledGeral');
  led.className='led'+(todosVivos?'':' dn');
  document.getElementById('pill').textContent=todosVivos?'sistema saudável':((procs.filter(p=>!p.vivo).length)+' processo(s) fora do ar');

  document.getElementById('procs').innerHTML=procs.map(p=>{
    const memTxt=p.vivo?p.memoriaMB+' MB':'—';
    const horas=p.vivo&&p.desde?((Date.now()-p.desde)/3.6e6):0;
    const upTxt=p.vivo?(horas<1?(horas*60).toFixed(0)+'min':horas.toFixed(1)+'h'):'caiu';
    return '<div class="proc" title="'+p.nome+' · '+(p.vivo?'rodando há '+upTxt+' · '+memTxt:'não detectado')+'">'
      +'<span class="orbe '+(p.vivo?'on':'off')+'"></span>'
      +'<div class="info"><div class="nome">'+p.nome+'</div><div class="det">'+(p.vivo?upTxt+' · '+memTxt:'fora do ar')+'</div></div></div>';
  }).join('');

  // O motor passou a operar várias posições; posicao é o formato antigo.
  // Sem crases neste comentário: ele vive DENTRO do template literal da página,
  // e uma crase aqui fecha a string e quebra o arquivo inteiro.
  const abertas=(d.posicoes&&d.posicoes.length?d.posicoes:null)||e.posicoes||(e.posicao&&[e.posicao])||[];
  const conc=d.concentracao||{exchange:'—',fracao:0};
  document.getElementById('pill').textContent=(todosVivos?'':'⚠ ')+(abertas.length
    ?abertas.length+(abertas.length>1?' posições':' posição')+' · '
      +abertas.map(p=>p.symbol.replace('/USDT:USDT','')).join(', ')
      +' · máx '+(conc.fracao*100).toFixed(0)+'% em '+conc.exchange
    :'sem posição · exposição zero');

  const pagVals=(d.pagamentosPorDia||[]).map(x=>x.total);
  const kpiCapEl=document.getElementById('kpiCap');
  if(ultimoCapital!==null&&Math.abs(ultimoCapital-e.capital)>1e-9)flashCard(kpiCapEl);
  ultimoCapital=e.capital;

  document.getElementById('kpis').innerHTML=[
    ['kpiCap','Capital','$',f(e.capital),(lucro>=0?'▲ +':'▼ −')+'$'+f(Math.abs(lucro),3)+' desde o início',lucro>=0?'up':'dn',sparkline(vals,'#00e0a0'),e.capital],
    ['kpiPag','Pagamentos','',e.pagamentos,'bruto $'+f(e.fundingTotal,4),'ac',sparkline(pagVals,'#4d8dff'),e.pagamentos],
    ['kpiSem','Semanas positivas','',sem.length?semPos+'/'+sem.length:'—',sem.length?'':'primeira semana em curso','up','',null],
    ['kpiConc','Concentração máxima','',abertas.length?(conc.fracao*100).toFixed(0)+'%':'—',
      abertas.length?conc.exchange+' · teto '+((d.tetoPorExchange||0.4)*100).toFixed(0)+'%':'sem exposição',
      conc.fracao>(d.tetoPorExchange||0.4)?'dn':conc.fracao>0.35?'wa':'up','',null],
  ].map(([id,l,pref,v,s,c,sk])=>'<div class="card" id="'+id+'"><div class="lbl">'+l+'</div><div class="kpi"><div>'
    +'<div class="v '+c+'" id="'+id+'v">'+(typeof v==='number'?pref+f(v):v)+'</div><div class="d">'+s+'</div></div>'+sk+'</div></div>').join('');

  document.getElementById('capNota').textContent=curva.length+' leituras';
  document.getElementById('gCap').innerHTML=linha(curva,d.diario);
  document.getElementById('pagNota').textContent=(d.pagamentosPorDia||[]).length+' dias';
  document.getElementById('gPag').innerHTML=barras(d.pagamentosPorDia);

  {
    const contas=(d.contas||[]).slice().sort((a,b)=>b.saldo-a.saldo);
    const teto=(d.tetoPorExchange||0.4);
    const cst=d.custodia||{saude:{}};
    const nivelInfo={
      ok:['●','up','saudável'], degradado:['▲','wa','degradado'],
      evacuar:['✕','dn','evacuar'], desconhecido:['?','mut','sem verificação'],
    };
    const custodiaBadges=contas.map(c=>{
      const s=(cst.saude||{})[c.exchange];
      const nivel=s?s.nivel:'desconhecido';
      const [ic,cls,rotulo]=nivelInfo[nivel]||nivelInfo.desconhecido;
      const titulo=(s&&s.detalhe?s.detalhe:'sem verificação ainda').replace(/"/g,'&quot;');
      return '<span class="custBadge" title="'+titulo+'"><b class="'+cls+'">'+ic+'</b> '+c.exchange+' · '+rotulo+'</span>';
    }).join('');
    const contasHtml=contas.length?('<div class="pos" style="border-color:var(--br);background:var(--s2)">'
      +'<div class="lbl" style="margin-bottom:8px">CONTAS POR EXCHANGE</div>'
      +contas.map(c=>{
        const pct=(c.fracaoUsada||0)*100, cor=pct>teto*100?'dn':pct>35?'wa':'up';
        return '<div class="kv"><span>'+c.exchange+'</span><b class="mono '+cor+'">'
          +'$'+f(c.livre,2)+' livre de $'+f(c.saldo,2)+' · '+pct.toFixed(0)+'% em uso'
          +'</b></div>';
      }).join('')
      +'</div>'):'';

    if(abertas.length){
      const dreno=d.piorDreno||0;
      document.getElementById('pos').innerHTML=
        (custodiaBadges?'<div style="margin-bottom:4px">'+custodiaBadges+'</div>':'')
        +abertas.map(p=>{
          const h=typeof p.horasAberta==='number'?p.horasAberta:(Date.now()-p.abertaEm)/36e5;
          const dmin=typeof p.distanciaMinima==='number'?p.distanciaMinima:null;
          const distLinha=dmin==null?'':'<div class="kv"><span>distância até liquidação</span><b class="mono '
            +(dmin<0.03?'dn':dmin<0.06?'wa':'up')+'">'+(dmin*100).toFixed(1)+'% · perna em risco: '+(p.pernaEmRisco||'—')+'</b></div>';
          const casas=v=>v<1?6:4;
          const linhaTick=(preco,variacao)=>typeof preco!=='number'?'':
            '<div class="mono" style="font-size:.72rem;margin-top:5px;color:var(--t2)">$'+f(preco,casas(preco))
            +' <span class="'+(variacao>=0?'up':'dn')+'">'+(variacao>=0?'▲':'▼')+' '+f(Math.abs(variacao*100),2)+'%</span></div>';
          return '<div class="pos" style="margin-bottom:10px">'
            +'<div class="tk">'+p.symbol.replace('/USDT:USDT','')+'</div>'
            +'<div class="legs">'
            +'<div class="leg"><div class="t dn">▼ VENDIDO</div><div class="e">'+p.exchangeShort+'</div>'+linhaTick(p.precoAoVivoShort,p.variacaoShort)+'</div>'
            +'<div class="leg"><div class="t up">▲ COMPRADO</div><div class="e">'+p.exchangeLong+'</div>'+linhaTick(p.precoAoVivoLong,p.variacaoLong)+'</div></div>'
            +'<div class="kv"><span>notional por perna</span><b class="mono">$'+f(p.notionalPorPerna)+'</b></div>'
            +'<div class="kv"><span>spread na entrada</span><b class="mono">'+f(p.spreadNaEntrada*100,4)+'%</b></div>'
            +'<div class="kv"><span>funding acumulado</span><b class="mono up">+$'+f(p.fundingAcumulado,4)+'</b></div>'
            +distLinha
            +'<div class="kv"><span>aberta há</span><b class="mono">'+h.toFixed(1)+'h</b></div></div>';
        }).join('')
        +contasHtml
        +'<div class="note" style="margin-top:13px;line-height:1.55">Mesmo ativo, exchanges diferentes. '
        +'As pernas se cancelam — <b class="up">exposição a preço zero</b>. O que sobra é risco de '
        +'custódia, e é isso que o teto por exchange limita. Pior dreno direcional numa alta: '
        +'<b class="mono">$'+f(dreno,2)+'</b>.</div>';
    }else{
      document.getElementById('pos').innerHTML=
        (custodiaBadges?'<div style="margin-bottom:10px">'+custodiaBadges+'</div>':'')
        +'<div class="pos" style="border-color:var(--br);background:var(--s2);min-height:150px">'
        +vazio('sem posição montada','aguardando spread acima do mínimo')+'</div>'
        +contasHtml;
    }
  }

  const cst=e.custosTotal||0,fnd=e.fundingTotal||0,res=fnd-cst;
  const pct=fnd>0?Math.min(100,(cst/fnd)*100):100;
  const cor=pct>=100?'var(--dn)':pct>=50?'var(--wa)':'var(--up)';
  document.getElementById('eco').innerHTML=
    '<div class="kv"><span>funding recebido</span><b class="mono up">+$'+f(fnd,4)+'</b></div>'
    +'<div class="kv"><span>custos pagos</span><b class="mono dn">−$'+f(cst,4)+'</b></div>'
    +'<div class="kv"><span>resultado</span><b class="mono '+(res>=0?'up':'dn')+'">'+(res>=0?'+':'−')+'$'+f(Math.abs(res),4)+'</b></div>'
    +'<div class="meter"><i style="width:'+pct.toFixed(0)+'%;background:'+cor+'"></i></div>'
    +'<div class="note">custos consomem '+pct.toFixed(0)+'% do funding'+(pct>=100?' — a montagem ainda não se pagou':'')+'</div>'
    +'<div style="margin-top:16px">'
    +'<div class="kv"><span>transferências de margem</span><b class="mono">'+(e.transferencias||0)+'</b></div>'
    +'<div class="kv"><span>trocas de ativo</span><b class="mono">'+(e.trocas||0)+'</b></div>'
    +'<div class="kv"><span>reinvestimentos</span><b class="mono">'+(e.reinvestimentos||0)+'</b></div></div>';

  const sc=d.scan||[];
  // O painel mostrava candidatas como se fossem acionáveis. Desde o portão de
  // valor esperado isso engana: quase todas estão barradas, e a tabela não
  // dizia. Agora cada linha mostra payback, vida e se o portão libera.
  const passou=sc.filter(s=>s.passaPortao).length;
  document.getElementById('scanNota').textContent=sc.length
    ?sc.length+' pares · '+(passou?passou+' passam no portão':'nenhum passa no portão ainda')+' · '+(vg.fonte||'')
    :(vg.motivo||(d.varrendo?'varrendo exchanges…':'aguardando varredura'));
  document.getElementById('scan').innerHTML=sc.length?sc.map(s=>{
    const on=abertas.some(p=>p.symbol===s.symbol), c=s.consistencia*100;
    const pb=s.paybackHoras, viva=s.duracaoHoras||0, pct=s.pctDoCaminho||0;
    const casas=v=>v<1?6:2;
    const precoTxt=(s.precoShortAoVivo&&s.precoLongAoVivo)
      ?'$'+f(s.precoShortAoVivo,casas(s.precoShortAoVivo))+' / $'+f(s.precoLongAoVivo,casas(s.precoLongAoVivo))
      :'—';
    const corAnel=s.passaPortao?'#00e0a0':pct>=50?'#ffb340':'#ff5c7a';
    return '<tr class="'+(on?'on':'')+'">'
      +'<td><b>'+s.symbol.replace('/USDT:USDT','')+'</b>'+(on?'<span class="badge">montada</span>':'')+'</td>'
      +'<td class="mut">'+s.exchangeShort+'</td><td class="mut">'+s.exchangeLong+'</td>'
      +'<td class="right mono mut" style="font-size:.72rem">'+precoTxt+'</td>'
      +'<td class="right mono">'+f(s.spread*100,4)+'%</td>'
      +'<td class="right mono">'+f(s.aprSpread*100,1)+'%</td>'
      +'<td class="right mono '+(c>=95?'up':c>=80?'wa':'dn')+'">'+c.toFixed(0)+'%</td>'
      +'<td class="right mono mut">'+(viva<1?(viva*60).toFixed(0)+'min':viva.toFixed(1)+'h')+'</td>'
      +'<td class="right mono mut">'+(pb&&pb<10000?pb.toFixed(0)+'h':'—')+'</td>'
      +'<td class="right"><span class="anel">'+anel(pct,corAnel,28)+'<span class="'+(s.passaPortao?'up':pct>=50?'wa':'dn')+'">'
        +(s.passaPortao?'✓':pct.toFixed(0)+'%')+'</span></span></td></tr>';
  }).join(''):'<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--t3)">varrendo exchanges…</td></tr>';

  // ── coleta de longo prazo ──────────────────────────────────────────────
  const cl=d.coleta;
  if(cl){
    const diasColeta=cl.coletandoDesde?(Date.now()-cl.coletandoDesde)/864e5:0;
    document.getElementById('coletaNota').textContent=diasColeta.toFixed(1)+' dias coletando';
    document.getElementById('coleta').innerHTML=[
      [cl.totalObservacoes,'observações'],
      [cl.totalCiclos,'ciclos fechados'],
      [cl.totalCustodia,'amostras de custódia'],
      [diasColeta.toFixed(1),'dias acumulando'],
    ].map(([v,l])=>'<div class="stat"><div class="v mono ac">'+v+'</div><div class="l">'+l+'</div></div>').join('');
  }else{
    document.getElementById('coletaNota').textContent='';
    document.getElementById('coleta').innerHTML='<div class="note" style="grid-column:1/-1">coletor ainda não gravou nada — ver npm run coletor</div>';
  }

  // ── estabilidade: eventos do watchdog, se houver ────────────────────────
  const wd=d.watchdog||[];
  document.getElementById('wdNota').textContent=wd.length?wd.length+' evento(s) registrado(s)':'';
  document.getElementById('watchdog').innerHTML=wd.length
    ?'<div class="wrap" style="margin:0"><table><tbody>'+wd.slice(0,8).map(l=>{
        const caiu=l.includes('CAIU');
        return '<tr><td class="mono" style="font-size:.76rem;color:'+(caiu?'var(--dn)':'var(--t2)')+'">'+l.replace(/</g,'&lt;')+'</td></tr>';
      }).join('')+'</table></div>'
    :vazio('nenhuma queda registrada','o watchdog religa sozinho em até 30-60s se algo cair');

  document.getElementById('log').innerHTML=(d.diario||[]).map(x=>{
    let det='',val='',cls='';const s=(x.symbol||'').replace('/USDT:USDT','');
    if(x.evento==='abre'){det='<b>'+s+'</b> · '+x.short+' → '+x.long+' · consistência '+f((x.consistencia||0)*100,0)+'%';val='$'+f(x.notional,0)}
    else if(x.evento==='fecha'){det='<b>'+s+'</b> · '+(x.motivo||'');val='+$'+f(x.fundingAcumulado,4);cls='up'}
    else if(x.evento==='funding'){det='spread '+f((x.spread||0)*100,4)+'%';val='+$'+f(x.ganho,5);cls='up'}
    else if(x.evento==='reinveste'){det='notional passou para $'+f(x.notionalNovo,0);val='+$'+f(x.notionalExtra,3);cls='wa'}
    else if(x.evento==='transfere'){det='preço '+f((x.variacao||0)*100,1)+'% desde a entrada';val='$'+f(x.transferido,2)}
    else if(x.evento==='apara'){det='<b>'+s+'</b> · posição aparada pra caber na cota'}
    else if(x.evento==='socorre'){det='<b>'+s+'</b> · socorro de margem entre exchanges'}
    else if(x.evento==='piso'){det='motor parado — piso de capital atingido'}
    else if(x.evento==='semana'){det='semana fechada';val=(x.lucro>=0?'+':'−')+'$'+f(Math.abs(x.lucro),3);cls=x.lucro>=0?'up':'dn'}
    else if(x.evento==='bloqueado'){det=(s?'<b>'+s+'</b> · ':'')+(x.motivo||'')}
    else if(x.evento==='init'){det='motor iniciado com $'+f(x.capital,0)}
    const chave=x.ts+'-'+x.evento;
    const novo=!idsVistosLog.has(chave)&&idsVistosLog.size>0;
    idsVistosLog.add(chave);
    return '<tr class="'+(novo?'novo':'')+'"><td class="mono mut">'+dm(x.ts)+' '+hm(x.ts)+'</td>'
      +'<td><span class="tag t-'+x.evento+'">'+x.evento+'</span></td>'
      +'<td>'+det+'</td><td class="right mono '+cls+'">'+val+'</td></tr>';
  }).join('');
}

/**
 * Streaming em tempo real via SSE, com fallback para polling se a conexão
 * cair. O servidor observa estado.json, diario.jsonl, ciclos.json e
 * custodia.json com fs.watch e manda um evento no instante em que qualquer
 * um muda — não até 5 segundos depois — mais um heartbeat de 10s para os
 * campos que dependem só do relógio (idade do dado, horas de posição aberta).
 */
let modoPolling=null;
function pararPolling(){if(modoPolling){clearInterval(modoPolling);modoPolling=null}}
function iniciarPolling(){
  if(modoPolling)return;
  const tick=async()=>{let d;try{d=await (await fetch('/api/dados')).json()}catch{return}render(d)};
  tick();modoPolling=setInterval(tick,5000);
}
function conectar(){
  let es;
  try{es=new EventSource('/api/stream')}catch{iniciarPolling();return}
  es.onmessage=ev=>{
    pararPolling();
    try{render(JSON.parse(ev.data))}catch{}
  };
  es.onerror=()=>{
    es.close();
    iniciarPolling();
    setTimeout(conectar,4000);
  };
}
conectar();
</script></body></html>`;
