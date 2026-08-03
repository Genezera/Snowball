/**
 * Dashboard — HTML + SVG puro, sem dependência externa.
 *
 * Decisões de desenho que valem registrar:
 *
 * · CURVA SUAVE COM SPLINE MONOTÔNICA. Uma polilinha reta entre pontos parece
 *   amadora; uma spline comum (Catmull-Rom) inventa oscilação que não existe
 *   nos dados — a curva sobe acima do maior ponto e desce abaixo do menor.
 *   A interpolação monotônica de Fritsch-Carlson suaviza SEM ultrapassar os
 *   valores reais, que é obrigatório num gráfico financeiro.
 *
 * · TOOLTIP COM CROSSHAIR. Ler valor exato de um gráfico contando pixels é
 *   ruim. O ponteiro encontra a leitura mais próxima e mostra o número.
 *
 * · SPARKLINES nos cartões. Um número sozinho não diz se está subindo ou
 *   caindo. A microcurva ao lado responde isso sem ocupar espaço.
 *
 * · ESTADOS VAZIOS INFORMATIVOS. "Sem dados" não ajuda; "o funding chega a cada
 *   8 horas" explica o que esperar e quando.
 */
export const PAGINA = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Snowball · Motor de Spread</title>
<style>
:root{
  --bg:#070a10; --s1:#0d111a; --s2:#121723; --s3:#171d2b;
  --br:#1e2634; --br2:#2a3446;
  --t1:#eef1f7; --t2:#97a1b8; --t3:#5f6a82;
  --up:#00d68f; --dn:#ff5470; --ac:#4d8dff; --wa:#ffab2e; --pu:#9d7bff;
  --r:14px; --r2:10px;
}
*{box-sizing:border-box;margin:0;padding:0}
::selection{background:rgba(77,141,255,.28)}
body{background:radial-gradient(1200px 700px at 15% -10%,#101827 0%,var(--bg) 55%);
  color:var(--t1);min-height:100vh;
  font:14px/1.55 ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;
  padding:26px 28px 40px;max-width:1620px;margin:0 auto;
  -webkit-font-smoothing:antialiased}
.mono{font-variant-numeric:tabular-nums;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;letter-spacing:-.02em}

header{display:flex;align-items:flex-start;justify-content:space-between;gap:22px;flex-wrap:wrap;margin-bottom:24px}
.brand{display:flex;align-items:center;gap:13px}
.mark{width:38px;height:38px;border-radius:11px;flex-shrink:0;
  background:linear-gradient(140deg,var(--up),var(--ac));
  display:grid;place-items:center;font-weight:800;font-size:1.05rem;color:#04121a;
  box-shadow:0 6px 22px rgba(0,214,143,.2)}
h1{font-size:1.18rem;font-weight:700;letter-spacing:-.015em;line-height:1.25}
.sub{color:var(--t3);font-size:.76rem;margin-top:3px}
.status{display:flex;align-items:center;gap:9px;background:var(--s1);border:1px solid var(--br);
  border-radius:99px;padding:8px 15px;font-size:.75rem;color:var(--t2);white-space:nowrap}
.led{width:7px;height:7px;border-radius:50%;background:var(--up);flex-shrink:0;
  box-shadow:0 0 0 3px rgba(0,214,143,.16);animation:p 2.4s ease-in-out infinite}
@keyframes p{0%,100%{opacity:1}50%{opacity:.4}}

.row{display:grid;gap:16px;margin-bottom:16px}
.c4{grid-template-columns:repeat(4,minmax(0,1fr))}
.c2{grid-template-columns:minmax(0,1.58fr) minmax(0,1fr)}
@media(max-width:1180px){.c4{grid-template-columns:repeat(2,minmax(0,1fr))}.c2{grid-template-columns:1fr}}
@media(max-width:600px){.c4{grid-template-columns:1fr}}

.card{background:linear-gradient(180deg,var(--s1),#0b0f17);border:1px solid var(--br);
  border-radius:var(--r);padding:19px 21px;min-width:0;position:relative;overflow:hidden}
.card::before{content:'';position:absolute;inset:0 0 auto;height:1px;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.055),transparent)}
.hd{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:15px}
.lbl{font-size:.65rem;text-transform:uppercase;letter-spacing:.11em;color:var(--t3);font-weight:700}
.note{font-size:.7rem;color:var(--t3)}

.kpi{display:flex;justify-content:space-between;align-items:flex-end;gap:12px}
.kpi .v{font-size:1.78rem;font-weight:750;letter-spacing:-.028em;line-height:1.02;margin-top:3px}
.kpi .d{font-size:.73rem;color:var(--t2);margin-top:8px;display:flex;align-items:center;gap:5px}
.spark{width:74px;height:34px;flex-shrink:0;opacity:.85}
.up{color:var(--up)}.dn{color:var(--dn)}.ac{color:var(--ac)}.wa{color:var(--wa)}.mut{color:var(--t3)}

.chart{width:100%;height:230px;position:relative}
.chart svg{width:100%;height:100%;display:block;overflow:visible}
.tip{position:absolute;pointer-events:none;opacity:0;transition:opacity .12s;
  background:rgba(12,17,26,.97);border:1px solid var(--br2);border-radius:9px;
  padding:8px 11px;font-size:.74rem;white-space:nowrap;z-index:5;
  box-shadow:0 10px 30px rgba(0,0,0,.6);transform:translate(-50%,-118%)}
.tip b{font-size:.86rem;display:block;margin-top:2px}
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;
  gap:7px;color:var(--t3);font-size:.82rem;text-align:center}
.empty .ic{width:34px;height:34px;border-radius:50%;border:1.5px dashed var(--br2);
  display:grid;place-items:center;font-size:.95rem;opacity:.6}
.legend{display:flex;gap:18px;font-size:.7rem;color:var(--t3);margin-top:13px;flex-wrap:wrap}
.dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:6px;vertical-align:middle}

.pos{border:1px solid rgba(0,214,143,.22);border-radius:12px;padding:17px 18px;
  background:linear-gradient(155deg,rgba(0,214,143,.07),rgba(77,141,255,.03))}
.tk{font-size:1.42rem;font-weight:780;letter-spacing:-.02em}
.legs{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:15px 0 4px}
.leg{background:rgba(0,0,0,.28);border:1px solid var(--br);border-radius:var(--r2);padding:11px 13px}
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
tbody tr{transition:background .12s}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover{background:var(--s2)}
tr.on{background:rgba(0,214,143,.07)}
tr.on td:first-child{box-shadow:inset 2.5px 0 0 var(--up)}
.right{text-align:right}
.wrap{overflow-x:auto;margin:0 -21px;padding:0 21px}
.wrap::-webkit-scrollbar{height:7px}
.wrap::-webkit-scrollbar-thumb{background:var(--br2);border-radius:9px}

.tag{display:inline-flex;align-items:center;font-size:.59rem;font-weight:800;padding:4px 9px;
  border-radius:6px;letter-spacing:.06em;text-transform:uppercase}
.t-abre{background:rgba(0,214,143,.13);color:var(--up)}
.t-fecha{background:rgba(255,84,112,.13);color:var(--dn)}
.t-funding{background:rgba(77,141,255,.13);color:var(--ac)}
.t-reinveste{background:rgba(255,171,46,.13);color:var(--wa)}
.t-transfere{background:rgba(157,123,255,.13);color:var(--pu)}
.t-semana{background:rgba(255,255,255,.06);color:var(--t2)}
.t-init{background:rgba(255,255,255,.05);color:var(--t3)}
.t-bloqueado{background:rgba(255,84,112,.08);color:#b57080}
.badge{background:rgba(0,214,143,.16);color:var(--up);font-size:.54rem;font-weight:800;
  padding:3px 7px;border-radius:5px;margin-left:8px;letter-spacing:.07em;text-transform:uppercase}

.custBadge{display:inline-flex;align-items:center;gap:5px;font-size:.68rem;font-weight:700;
  padding:4px 10px;margin:0 6px 6px 0;border-radius:99px;background:rgba(255,255,255,.05);
  border:1px solid var(--br);cursor:default}

.meter{height:6px;background:rgba(255,255,255,.055);border-radius:99px;overflow:hidden;margin:11px 0 8px}
.meter>i{display:block;height:100%;border-radius:99px;transition:width .6s cubic-bezier(.4,0,.2,1)}
.gauge{display:flex;align-items:center;gap:15px;margin-bottom:4px}
</style></head><body>

<header>
  <div class="brand">
    <div class="mark">S</div>
    <div>
      <h1>Motor de Spread entre Exchanges</h1>
      <div class="sub" id="sub">carregando…</div>
    </div>
  </div>
  <div class="status"><span class="led"></span><span id="pill">delta-neutro</span></div>
</header>

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
      +'<text x="'+(pl-10)+'" y="'+(y+3.6).toFixed(1)+'" fill="#5f6a82" font-size="10.5" text-anchor="end" class="mono">$'+f(v)+'</text>';
  }
  let mk='';
  for(const e of eventos||[]){
    if((e.evento!=='abre'&&e.evento!=='fecha')||e.ts<t0||e.ts>t1)continue;
    const x=X(e.ts),c=e.evento==='abre'?'#ffab2e':'#ff5470';
    mk+='<line x1="'+x.toFixed(1)+'" y1="'+pt+'" x2="'+x.toFixed(1)+'" y2="'+(H-pb)+'" stroke="'+c+'" stroke-width="1" stroke-dasharray="3,5" opacity=".45"/>'
      +'<circle cx="'+x.toFixed(1)+'" cy="'+pt+'" r="3.6" fill="'+c+'"/>';
  }
  const d=suave(pts);
  const dots=pts.length<=50?pts.map(p=>'<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="2.4" fill="#00d68f" opacity=".9"/>').join(''):'';

  return '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" id="svgCap">'
    +'<defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">'
    +'<stop offset="0" stop-color="#00d68f" stop-opacity=".3"/><stop offset="1" stop-color="#00d68f" stop-opacity="0"/></linearGradient></defs>'
    +g+'<path d="'+d+' L'+pts[pts.length-1][0].toFixed(1)+','+(H-pb)+' L'+pts[0][0].toFixed(1)+','+(H-pb)+' Z" fill="url(#ga)"/>'
    +mk+'<path d="'+d+'" fill="none" stroke="#00d68f" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>'
    +dots+'<line id="cross" x1="0" y1="'+pt+'" x2="0" y2="'+(H-pb)+'" stroke="#4d8dff" stroke-width="1" opacity="0"/>'
    +'<circle id="crossD" r="4.5" fill="#4d8dff" stroke="#070a10" stroke-width="2" opacity="0"/>'
    +'<text x="'+pl+'" y="'+(H-8)+'" fill="#5f6a82" font-size="10.5">'+dm(t0)+' '+hm(t0)+'</text>'
    +'<text x="'+(W-pr)+'" y="'+(H-8)+'" fill="#5f6a82" font-size="10.5" text-anchor="end">'+dm(t1)+' '+hm(t1)+'</text></svg>';
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
      +'<text x="'+(pl-10)+'" y="'+(y+3.6).toFixed(1)+'" fill="#5f6a82" font-size="10" text-anchor="end" class="mono">$'+f(v,4)+'</text>';
  }
  let b='';
  dados.forEach((d,i)=>{
    const cx=pl+faixa*(i+.5),x=cx-bw/2;
    const h=Math.max(3,(H-pt-pb)*(d.total/mx));
    b+='<rect x="'+x.toFixed(1)+'" y="'+(H-pb-h).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="3.5" fill="url(#gb)"/>'
      +'<text x="'+cx.toFixed(1)+'" y="'+(H-pb-h-7).toFixed(1)+'" fill="#97a1b8" font-size="9.5" text-anchor="middle" class="mono">$'+f(d.total,4)+'</text>';
    if(dados.length<=16)b+='<text x="'+cx.toFixed(1)+'" y="'+(H-8)+'" fill="#5f6a82" font-size="9.5" text-anchor="middle">'+d.dia.slice(8)+'/'+d.dia.slice(5,7)+'</text>';
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
  tip.innerHTML='<span style="color:#5f6a82">'+dm(best.ts)+' '+hm(best.ts)+'</span><b class="mono">$'+f(best.v)+'</b>';
});
wrap.addEventListener('mouseleave',()=>{
  tip.style.opacity='0';
  const cl=document.getElementById('cross'),cd=document.getElementById('crossD');
  if(cl)cl.setAttribute('opacity','0'); if(cd)cd.setAttribute('opacity','0');
});

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
  // O motor passou a operar várias posições; posicao é o formato antigo.
  // Sem crases neste comentário: ele vive DENTRO do template literal da página,
  // e uma crase aqui fecha a string e quebra o arquivo inteiro.
  const abertas=(d.posicoes&&d.posicoes.length?d.posicoes:null)||e.posicoes||(e.posicao&&[e.posicao])||[];
  const conc=d.concentracao||{exchange:'—',fracao:0};
  document.getElementById('pill').textContent=abertas.length
    ?abertas.length+(abertas.length>1?' posições':' posição')+' · '
      +abertas.map(p=>p.symbol.replace('/USDT:USDT','')).join(', ')
      +' · máx '+(conc.fracao*100).toFixed(0)+'% em '+conc.exchange
    :'sem posição · exposição zero';

  const pagVals=(d.pagamentosPorDia||[]).map(x=>x.total);
  document.getElementById('kpis').innerHTML=[
    ['Capital','$'+f(e.capital),(lucro>=0?'▲ +':'▼ −')+'$'+f(Math.abs(lucro),3)+' desde o início',lucro>=0?'up':'dn',sparkline(vals,'#00d68f')],
    ['Pagamentos',e.pagamentos,'bruto $'+f(e.fundingTotal,4),'ac',sparkline(pagVals,'#4d8dff')],
    ['Semanas positivas',sem.length?semPos+'/'+sem.length:'—',sem.length?'':'primeira semana em curso','up',''],
    ['Concentração máxima',abertas.length?(conc.fracao*100).toFixed(0)+'%':'—',
      abertas.length?conc.exchange+' · teto '+((d.tetoPorExchange||0.4)*100).toFixed(0)+'%':'sem exposição',
      conc.fracao>(d.tetoPorExchange||0.4)?'dn':conc.fracao>0.35?'wa':'up',''],
  ].map(([l,v,s,c,sk])=>'<div class="card"><div class="lbl">'+l+'</div><div class="kpi"><div>'
    +'<div class="v '+c+'">'+v+'</div><div class="d">'+s+'</div></div>'+sk+'</div></div>').join('');

  document.getElementById('capNota').textContent=curva.length+' leituras';
  document.getElementById('gCap').innerHTML=linha(curva,d.diario);
  document.getElementById('pagNota').textContent=(d.pagamentosPorDia||[]).length+' dias';
  document.getElementById('gPag').innerHTML=barras(d.pagamentosPorDia);

  {
    // contas por exchange — saldo real, não só a margem em uso. É a visão que
    // importa quando o dinheiro está em contas que não se comunicam entre si.
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
    return '<tr class="'+(on?'on':'')+'">'
      +'<td><b>'+s.symbol.replace('/USDT:USDT','')+'</b>'+(on?'<span class="badge">montada</span>':'')+'</td>'
      +'<td class="mut">'+s.exchangeShort+'</td><td class="mut">'+s.exchangeLong+'</td>'
      +'<td class="right mono mut" style="font-size:.72rem">'+precoTxt+'</td>'
      +'<td class="right mono">'+f(s.spread*100,4)+'%</td>'
      +'<td class="right mono">'+f(s.aprSpread*100,1)+'%</td>'
      +'<td class="right mono '+(c>=95?'up':c>=80?'wa':'dn')+'">'+c.toFixed(0)+'%</td>'
      +'<td class="right mono mut">'+(viva<1?(viva*60).toFixed(0)+'min':viva.toFixed(1)+'h')+'</td>'
      +'<td class="right mono mut">'+(pb&&pb<10000?pb.toFixed(0)+'h':'—')+'</td>'
      +'<td class="right mono '+(s.passaPortao?'up':pct>=50?'wa':'dn')+'">'
        +(s.passaPortao?'✓ libera':pct.toFixed(0)+'%')+'</td></tr>';
  }).join(''):'<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--t3)">varrendo exchanges…</td></tr>';

  document.getElementById('log').innerHTML=(d.diario||[]).map(x=>{
    let det='',val='',cls='';const s=(x.symbol||'').replace('/USDT:USDT','');
    if(x.evento==='abre'){det='<b>'+s+'</b> · '+x.short+' → '+x.long+' · consistência '+f((x.consistencia||0)*100,0)+'%';val='$'+f(x.notional,0)}
    else if(x.evento==='fecha'){det='<b>'+s+'</b> · '+(x.motivo||'');val='+$'+f(x.fundingAcumulado,4);cls='up'}
    else if(x.evento==='funding'){det='spread '+f((x.spread||0)*100,4)+'%';val='+$'+f(x.ganho,5);cls='up'}
    else if(x.evento==='reinveste'){det='notional passou para $'+f(x.notionalNovo,0);val='+$'+f(x.notionalExtra,3);cls='wa'}
    else if(x.evento==='transfere'){det='preço '+f((x.variacao||0)*100,1)+'% desde a entrada';val='$'+f(x.transferido,2)}
    else if(x.evento==='semana'){det='semana fechada';val=(x.lucro>=0?'+':'−')+'$'+f(Math.abs(x.lucro),3);cls=x.lucro>=0?'up':'dn'}
    else if(x.evento==='bloqueado'){det=(s?'<b>'+s+'</b> · ':'')+(x.motivo||'')}
    else if(x.evento==='init'){det='motor iniciado com $'+f(x.capital,0)}
    return '<tr><td class="mono mut">'+dm(x.ts)+' '+hm(x.ts)+'</td>'
      +'<td><span class="tag t-'+x.evento+'">'+x.evento+'</span></td>'
      +'<td>'+det+'</td><td class="right mono '+cls+'">'+val+'</td></tr>';
  }).join('');
}

/**
 * Streaming em tempo real via SSE, com fallback para polling se a conexão
 * cair. O servidor observa estado.json, ciclos.json e custodia.json com
 * fs.watch e manda um evento no instante em que qualquer um muda — não até
 * 5 segundos depois — mais um heartbeat de 10s para os campos que dependem
 * só do relógio (idade do dado, horas de posição aberta).
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
