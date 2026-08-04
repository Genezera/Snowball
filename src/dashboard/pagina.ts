/**
 * Dashboard — HTML + SVG puro, sem dependência externa. Quarta geração,
 * conceito trocado por completo: GELO/CRISTAL em vez do tema escuro-
 * espacial das três anteriores — o nome do projeto é "Snowball" e nenhuma
 * versão até agora tinha aproveitado isso visualmente. Layout também
 * mudou de estrutura: barra lateral fixa (marca, capital, saúde, ML) mais
 * conteúdo principal que rola por conta própria, em vez de uma página só
 * empilhando tudo. Mesmo contrato de dados do server.ts.
 *
 * Decisões de desenho que valem registrar:
 *
 * · A BOLA DE NEVE É LITERAL. O capital cresce/encolhe como um círculo que
 *   aumenta de raio, com anéis concêntricos girando devagar (textura de
 *   "rolando") — a primeira vez que o nome do projeto vira elemento visual
 *   em vez de só o texto "Snowball" no topo.
 *
 * · FACETAS DE CRISTAL nos elementos de marca (clip-path poligonal) em vez
 *   de círculos/retângulos arredondados em tudo — reservado pra marca e
 *   acentos, não pra cards de conteúdo (tabela dentro de um hexágono não
 *   se lê).
 *
 * · BARRA LATERAL FIXA. O que precisa estar sempre visível (capital, saúde
 *   dos 5 processos, prontidão de ML, status geral) fica fixo; o resto —
 *   curva, varredura, linha do tempo — rola no painel principal. Isto é
 *   estrutural, não só cor: muda como a informação se organiza na tela.
 *
 * · A CONTA FICA VISÍVEL. Clicar uma linha da varredura expande a fórmula
 *   inteira do portão com os números reais daquele candidato — mantido da
 *   geração anterior porque funcionava bem e é o tipo de coisa que o
 *   projeto sempre exigiu (nunca só o veredito, sempre o raciocínio).
 *
 * · ASSINATURA DE CONTEÚDO antes de reconstruir radar/timeline, porque o
 *   preço ao vivo dispara render() a cada ~2,5s e reconstruir tudo sempre
 *   reiniciava as animações contínuas — bug de "piscar" já corrigido numa
 *   geração anterior, mantido aqui.
 *
 * ⚠ Nenhuma crase em comentário dentro do <script>: a página inteira vive
 *   num template literal, e uma crase solta fecha a string e derruba o
 *   arquivo com erro de sintaxe apontando pro lugar errado.
 */
export const PAGINA = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Snowball · Observatório</title>
<style>
:root{
  --bg:#050a14; --s1:#0a1220; --s2:#0e1728; --s3:#13203a;
  --br:#1b2b46; --br2:#2a3f63; --glass:rgba(14,23,40,.6);
  --t1:#eef4fc; --t2:#8ea3c4; --t3:#4c5c7d;
  --ice:#7dd3fc; --ice-dim:rgba(125,211,252,.14);
  --up:#2fe0ac; --up-dim:rgba(47,224,172,.14);
  --dn:#ff5577; --dn-dim:rgba(255,85,119,.14);
  --wa:#ffc857; --wa-dim:rgba(255,200,87,.14);
  --pu:#a5b4fc; --pu-dim:rgba(165,180,252,.14);
  --r:16px; --r2:11px; --sbw:298px;
}
*{box-sizing:border-box;margin:0;padding:0}
::selection{background:rgba(125,211,252,.3)}
html{scroll-behavior:smooth;overflow-x:hidden}
body{
  overflow-x:hidden;max-width:100vw;
  background:
    radial-gradient(900px 560px at -4% -8%, rgba(125,211,252,.10) 0%, transparent 55%),
    radial-gradient(760px 520px at 104% 6%, rgba(165,180,252,.09) 0%, transparent 52%),
    var(--bg);
  color:var(--t1);min-height:100vh;
  font:14px/1.55 ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;display:flex;align-items:flex-start}
.mono{font-variant-numeric:tabular-nums;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;letter-spacing:-.02em}

/* ── flocos de neve flutuando, bem sutis, decorativos ─────────────────── */
.flake{position:fixed;border-radius:50%;background:#fff;opacity:0;pointer-events:none;z-index:0;
  animation:fall linear infinite}
@keyframes fall{0%{transform:translateY(-10vh) translateX(0);opacity:0}5%{opacity:.35}95%{opacity:.2}100%{transform:translateY(110vh) translateX(var(--drift,20px));opacity:0}}

/* ══════════════════════════════ SIDEBAR ═══════════════════════════════ */
.sidebar{width:var(--sbw);flex-shrink:0;position:sticky;top:0;height:100vh;overflow-y:auto;
  padding:24px 20px;border-right:1px solid var(--br);
  background:linear-gradient(180deg,rgba(10,18,32,.9),rgba(5,10,20,.96));
  backdrop-filter:blur(20px);z-index:3;scrollbar-width:thin}
.sidebar::-webkit-scrollbar{width:6px}
.sidebar::-webkit-scrollbar-thumb{background:var(--br2);border-radius:9px}

.brand{display:flex;align-items:center;gap:12px;margin-bottom:20px}
.crystal{width:44px;height:44px;flex-shrink:0;position:relative;
  clip-path:polygon(50% 0%,93% 25%,93% 75%,50% 100%,7% 75%,7% 25%);
  background:linear-gradient(150deg,var(--ice),var(--pu));
  display:grid;place-items:center;font-weight:800;font-size:1.1rem;color:#031320;
  box-shadow:0 8px 26px rgba(125,211,252,.32)}
.crystal::after{content:'';position:absolute;inset:0;
  clip-path:polygon(50% 0%,93% 25%,93% 75%,50% 100%,7% 75%,7% 25%);
  background:linear-gradient(150deg,rgba(255,255,255,.35),transparent 55%)}
.brandName{font-size:1.02rem;font-weight:780;letter-spacing:-.02em;line-height:1.2}
.brandSub{font-size:.68rem;color:var(--t3);margin-top:2px}

.statusPill{display:flex;align-items:center;gap:8px;background:var(--glass);border:1px solid var(--br);
  border-radius:99px;padding:8px 14px;font-size:.72rem;color:var(--t2);margin-bottom:18px}
.led{width:7px;height:7px;border-radius:50%;background:var(--up);flex-shrink:0;
  box-shadow:0 0 0 3px rgba(47,224,172,.22);animation:p 2.2s ease-in-out infinite}
.led.dn{background:var(--dn);box-shadow:0 0 0 3px rgba(255,85,119,.22)}
@keyframes p{0%,100%{opacity:1}50%{opacity:.4}}

/* ── bola de neve (capital) ──────────────────────────────────────────── */
.sbCard{background:var(--glass);border:1px solid var(--br);border-radius:var(--r2);padding:16px;margin-bottom:14px}
.sbLbl{font-size:.6rem;text-transform:uppercase;letter-spacing:.11em;color:var(--t3);font-weight:760;margin-bottom:10px}
.bolaWrap{display:flex;align-items:center;justify-content:center;padding:6px 0 4px;position:relative;height:118px}
.bolaWrap svg{overflow:visible}
.anelRolando{transform-origin:center;animation:spin 14s linear infinite}
.anelRolando2{transform-origin:center;animation:spin 22s linear infinite reverse}
@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
.heroV{font-size:1.7rem;font-weight:820;letter-spacing:-.03em;text-align:center;margin-top:2px;
  text-shadow:0 0 26px rgba(125,211,252,.3)}
.heroD{font-size:.72rem;color:var(--t2);text-align:center;margin-top:4px}
.heroSpark{width:100%;height:34px;margin-top:10px;opacity:.85}

.procList2{display:flex;flex-direction:column;gap:8px}
.procRow2{display:flex;align-items:center;gap:9px;font-size:.75rem}
.procHex{width:9px;height:9px;flex-shrink:0;clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);position:relative}
.procHex.on{background:var(--up);box-shadow:0 0 8px 1px rgba(47,224,172,.6)}
.procHex.off{background:var(--dn);box-shadow:0 0 7px 1px rgba(255,85,119,.55)}
.procRow2 .nm{flex:1;color:var(--t2)}
.procRow2 .val{color:var(--t3);font-size:.66rem}

.mlRing{position:relative;width:78px;height:78px;margin:2px auto 8px}
.mlRing svg{transform:rotate(-90deg)}
.mlCenter{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.mlCenter b{font-size:.98rem;font-weight:800}
.mlCenter span{font-size:.54rem;color:var(--t3);text-transform:uppercase}
.mlTxt{font-size:.68rem;color:var(--t3);text-align:center;line-height:1.5}

.bellRow{display:flex;align-items:center;justify-content:space-between;gap:10px}
.bell{position:relative;width:36px;height:36px;border-radius:10px;background:var(--glass);
  border:1px solid var(--br);display:grid;place-items:center;font-size:1rem}
.bellCount{position:absolute;top:-5px;right:-5px;background:var(--dn);color:#fff;font-size:.58rem;font-weight:800;
  min-width:16px;height:16px;border-radius:99px;display:grid;place-items:center;padding:0 3px;
  box-shadow:0 0 0 2px var(--s1)}

/* ══════════════════════════════ MAIN ═══════════════════════════════════ */
.main{flex:1;min-width:0;position:relative;z-index:1}
.ticker{width:100%;max-width:100%;overflow:hidden;background:linear-gradient(90deg,#000,#070c16 8%,#070c16 92%,#000);
  border-bottom:1px solid var(--br);white-space:nowrap}
.ticker::before,.ticker::after{content:'';position:absolute;top:0;bottom:0;width:60px;z-index:2;pointer-events:none}
.tickerTrack{display:inline-flex;animation:tickerScroll 58s linear infinite;padding:9px 0}
.ticker:hover .tickerTrack{animation-play-state:paused}
@keyframes tickerScroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.tItem{display:inline-flex;align-items:baseline;gap:7px;padding:0 22px;font-size:.78rem;border-right:1px solid var(--br)}
.tItem b{font-weight:750;color:var(--t1)}

.mainInner{padding:22px 28px 50px;max-width:1360px}
.toasts{position:fixed;top:16px;right:22px;z-index:50;display:flex;flex-direction:column;gap:10px;
  width:min(370px,86vw);pointer-events:none}
.toast{background:rgba(8,13,24,.97);backdrop-filter:blur(16px);border:1px solid var(--br2);
  border-left:3px solid var(--ice);border-radius:13px;padding:13px 16px;
  box-shadow:0 18px 44px rgba(0,0,0,.55);animation:toastIn .4s cubic-bezier(.2,.9,.3,1.2),toastOut .4s ease 5.6s forwards;
  font-size:.8rem}
.toast.up{border-left-color:var(--up)}.toast.dn{border-left-color:var(--dn)}.toast.wa{border-left-color:var(--wa)}
.toast .tt{font-weight:760;margin-bottom:2px}
.toast .ts{color:var(--t3);font-size:.7rem}
@keyframes toastIn{from{opacity:0;transform:translateX(34px) scale(.94)}to{opacity:1;transform:translateX(0) scale(1)}}
@keyframes toastOut{to{opacity:0;transform:translateX(34px);height:0;margin:0;padding:0;border:0}}

.row{display:grid;gap:16px;margin-bottom:16px}
.c2{grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)}
.c3{grid-template-columns:repeat(3,minmax(0,1fr))}
@media(max-width:980px){.c2{grid-template-columns:1fr}.c3{grid-template-columns:1fr}}

.card{background:linear-gradient(180deg,rgba(13,20,36,.75),rgba(6,10,18,.85));backdrop-filter:blur(16px);
  border:1px solid var(--br);border-radius:var(--r);padding:20px 22px;min-width:0;position:relative;
  overflow:hidden;transition:border-color .25s}
.card::before{content:'';position:absolute;inset:0 0 auto;height:1px;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.08),transparent)}
.card:hover{border-color:var(--br2)}
.card.flash{animation:flashCard 1s ease}
@keyframes flashCard{0%{box-shadow:0 0 0 1px var(--ice),0 0 28px rgba(125,211,252,.4)}100%{box-shadow:none}}
.hd{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
.lbl{font-size:.65rem;text-transform:uppercase;letter-spacing:.12em;color:var(--t3);font-weight:760}
.note{font-size:.7rem;color:var(--t3)}

.kpi{display:flex;justify-content:space-between;align-items:flex-end;gap:12px}
.kpi .v{font-size:1.56rem;font-weight:770;letter-spacing:-.03em;line-height:1.02;margin-top:3px}
.kpi .d{font-size:.71rem;color:var(--t2);margin-top:7px}
.up{color:var(--up)}.dn{color:var(--dn)}.ac{color:var(--ice)}.wa{color:var(--wa)}.pu{color:var(--pu)}.mut{color:var(--t3)}

.radarWrap{display:flex;align-items:center;justify-content:center;padding:2px 0}
.radar{position:relative;width:196px;height:196px}
.radar svg{width:100%;height:100%}
.radarSweep{transform-origin:98px 98px;animation:spin 4s linear infinite}
.blip{position:absolute;width:7px;height:7px;clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);
  background:var(--up);box-shadow:0 0 8px 2px rgba(47,224,172,.65);animation:blipPulse 2.4s ease-in-out infinite}
@keyframes blipPulse{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:1;transform:scale(1.3)}}
.blip.wa{background:var(--wa);box-shadow:0 0 8px 2px rgba(255,200,87,.6)}
.blip .lbl{position:absolute;top:9px;left:50%;transform:translateX(-50%);font-size:.6rem;color:var(--t2);
  white-space:nowrap;font-weight:700}

.chart{width:100%;height:222px;position:relative}
.chart svg{width:100%;height:100%;display:block;overflow:visible}
.tip{position:absolute;pointer-events:none;opacity:0;transition:opacity .12s;
  background:rgba(6,10,19,.98);backdrop-filter:blur(12px);border:1px solid var(--br2);border-radius:10px;
  padding:8px 11px;font-size:.74rem;white-space:nowrap;z-index:5;
  box-shadow:0 14px 38px rgba(0,0,0,.6);transform:translate(-50%,-118%)}
.tip b{font-size:.86rem;display:block;margin-top:2px}
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;
  gap:7px;color:var(--t3);font-size:.82rem;text-align:center}
.empty .ic{width:36px;height:36px;border-radius:50%;border:1.5px dashed var(--br2);
  display:grid;place-items:center;font-size:1rem;opacity:.6}
.legend{display:flex;gap:18px;font-size:.7rem;color:var(--t3);margin-top:12px;flex-wrap:wrap}
.dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:6px;vertical-align:middle}

.pos{border:1px solid rgba(125,211,252,.28);border-radius:14px;padding:19px 20px;
  background:linear-gradient(155deg,rgba(125,211,252,.09),rgba(165,180,252,.03))}
.tk{font-size:1.5rem;font-weight:810;letter-spacing:-.02em;display:flex;align-items:center;gap:9px}
.stageBadge{font-size:.56rem;font-weight:800;padding:3px 8px;border-radius:99px;letter-spacing:.06em;text-transform:uppercase}
.legs{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:15px 0 4px}
.leg{background:rgba(0,0,0,.32);border:1px solid var(--br);border-radius:var(--r2);padding:11px 13px}
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
tbody tr.principal{transition:background .15s;cursor:pointer}
tbody tr.principal:hover{background:var(--s2)}
tr.on{background:rgba(47,224,172,.08)}
tr.on td:first-child{box-shadow:inset 2.5px 0 0 var(--up)}
tr.detalhe td{background:rgba(255,255,255,.015);white-space:normal;padding:0}
.painelDetalhe{padding:16px 20px 20px;display:grid;grid-template-columns:1fr 1fr;gap:20px;animation:fadeUp .3s ease}
@media(max-width:700px){.painelDetalhe{grid-template-columns:1fr}}
.formula{font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:.78rem;color:var(--t2);
  background:rgba(0,0,0,.28);border:1px solid var(--br);border-radius:10px;padding:12px 14px;line-height:1.9}
.formula .op{color:var(--t3)}
.barraComparacao{margin-top:10px}
.barraComparacao .trilho{height:9px;background:rgba(255,255,255,.06);border-radius:99px;overflow:hidden;position:relative}
.barraComparacao .trilho i{display:block;height:100%;border-radius:99px;transition:width .5s ease}
.barraComparacao .marcas{display:flex;justify-content:space-between;font-size:.66rem;color:var(--t3);margin-top:5px}
.chev{display:inline-block;transition:transform .25s ease;color:var(--t3);font-size:.7rem}
.chev.aberto{transform:rotate(90deg)}
.right{text-align:right}
.wrap{overflow-x:auto;margin:0 -22px;padding:0 22px}
.wrap::-webkit-scrollbar{height:7px}
.wrap::-webkit-scrollbar-thumb{background:var(--br2);border-radius:9px}

.badge{background:var(--up-dim);color:var(--up);font-size:.54rem;font-weight:800;
  padding:3px 7px;border-radius:5px;margin-left:8px;letter-spacing:.07em;text-transform:uppercase}
.meter{height:6px;background:rgba(255,255,255,.055);border-radius:99px;overflow:hidden;margin:11px 0 8px}
.meter>i{display:block;height:100%;border-radius:99px;transition:width .6s cubic-bezier(.4,0,.2,1)}
.custBadge{display:inline-flex;align-items:center;gap:5px;font-size:.68rem;font-weight:700;
  padding:4px 10px;margin:0 6px 6px 0;border-radius:99px;background:rgba(255,255,255,.05);
  border:1px solid var(--br);cursor:default}
.anel{display:inline-flex;align-items:center;gap:7px;vertical-align:middle}
.anel span{font-size:.72rem;font-weight:700}

.statgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
@media(max-width:760px){.statgrid{grid-template-columns:repeat(2,1fr)}}
.stat{text-align:center;padding:13px 8px;background:rgba(255,255,255,.02);border-radius:var(--r2);border:1px solid var(--br);
  transition:transform .2s}
.stat:hover{transform:translateY(-2px)}
.stat .v{font-size:1.32rem;font-weight:770;letter-spacing:-.02em}
.stat .l{font-size:.63rem;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-top:4px}

.timeline{position:relative;padding-left:30px}
.timeline::before{content:'';position:absolute;left:9px;top:6px;bottom:6px;width:1.5px;
  background:linear-gradient(180deg,var(--br2),var(--br) 85%,transparent)}
.tItem2{position:relative;padding:0 0 20px;animation:fadeUp .5s ease}
.tItem2:last-child{padding-bottom:0}
@keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.tDot{position:absolute;left:-30px;top:1px;width:19px;height:19px;border-radius:50%;
  display:grid;place-items:center;font-size:.66rem;border:1px solid var(--br2);background:var(--s2);z-index:1}
.tDot.up{border-color:rgba(47,224,172,.4);color:var(--up)}
.tDot.dn{border-color:rgba(255,85,119,.4);color:var(--dn)}
.tDot.ac{border-color:rgba(125,211,252,.4);color:var(--ice)}
.tDot.wa{border-color:rgba(255,200,87,.4);color:var(--wa)}
.tDot.mut{color:var(--t3)}
.tHead{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
.tWhen{font-size:.68rem;color:var(--t3)}
.tTag{font-size:.58rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;padding:2px 8px;border-radius:6px}
.tDet{font-size:.82rem;color:var(--t2);margin-top:4px;line-height:1.5}
.tVal{font-size:.86rem;font-weight:700;margin-top:2px}

@media(max-width:860px){
  body{flex-direction:column}
  .sidebar{width:100%;height:auto;position:relative;border-right:none;border-bottom:1px solid var(--br)}
}
</style></head><body>

<div id="flakes"></div>

<aside class="sidebar">
  <div class="brand">
    <div class="crystal">S</div>
    <div><div class="brandName">Snowball</div><div class="brandSub" id="sub">carregando…</div></div>
  </div>
  <div class="statusPill"><span class="led" id="ledGeral"></span><span id="pill">delta-neutro</span></div>

  <div class="sbCard">
    <div class="sbLbl">Capital</div>
    <div class="bolaWrap" id="bola"></div>
    <div class="heroV mono" id="kpiCapv">$0,00</div>
    <div class="heroD" id="kpiCapd"></div>
    <div class="heroSpark" id="heroSpark"></div>
  </div>

  <div class="sbCard">
    <div class="sbLbl">Saúde do sistema</div>
    <div class="procList2" id="procList"></div>
  </div>

  <div class="sbCard">
    <div class="sbLbl" style="text-align:center">Prontidão de ML</div>
    <div class="mlRing" id="mlRing"></div>
    <div class="mlTxt" id="mlNota"></div>
  </div>

  <div class="sbCard">
    <div class="bellRow">
      <span class="sbLbl" style="margin:0">Alertas</span>
      <div class="bell">🔔<span class="bellCount" id="bellCount" style="display:none">0</span></div>
    </div>
  </div>
</aside>

<div class="main">
  <div class="ticker"><div class="tickerTrack" id="ticker"></div></div>
  <div class="toasts" id="toasts"></div>

  <div class="mainInner">

    <div class="card" style="margin-bottom:16px">
      <div class="hd"><span class="lbl" id="spotLbl">Radar de oportunidades</span></div>
      <div id="spotBody"></div>
    </div>

    <div class="row c3">
      <div class="card" id="kpiPag"><div class="lbl">Pagamentos</div><div class="kpi"><div>
        <div class="v ac" id="kpiPagv">0</div><div class="d" id="kpiPagd"></div></div></div></div>
      <div class="card" id="kpiSem"><div class="lbl">Semanas positivas</div><div class="kpi"><div>
        <div class="v up" id="kpiSemv">—</div><div class="d" id="kpiSemd"></div></div></div></div>
      <div class="card" id="kpiConc"><div class="lbl">Concentração máxima</div><div class="kpi"><div>
        <div class="v" id="kpiConcv">—</div><div class="d" id="kpiConcd"></div></div></div></div>
    </div>

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
        <div class="hd"><span class="lbl">Contas e custódia</span></div>
        <div id="contasCard"></div>
      </div>
    </div>

    <div class="row c2">
      <div class="card">
        <div class="hd"><span class="lbl">Funding por dia</span><span class="note" id="pagNota"></span></div>
        <div class="chart" style="height:168px" id="gPag"></div>
      </div>
      <div class="card">
        <div class="hd"><span class="lbl">Economia da operação</span></div>
        <div id="eco"></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="hd"><span class="lbl">Varredura ao vivo</span><span class="note" id="scanNota"></span></div>
      <div class="note" style="margin-bottom:10px">Clique numa linha pra ver a conta inteira do portão.</div>
      <div class="wrap"><table><thead><tr>
        <th></th><th>Ativo</th><th>Vendido</th><th>Comprado</th>
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

    <div class="card" style="margin-bottom:16px">
      <div class="hd"><span class="lbl">Basis trade — coleta</span><span class="note" id="basisNota"></span></div>
      <div class="note" style="margin-bottom:10px">Spot + perp na mesma exchange. Só mede quanto tempo o funding se sustenta — o motor não opera isto ainda.</div>
      <div class="statgrid" id="basisStat" style="margin-bottom:14px"></div>
      <div class="wrap"><table><thead><tr>
        <th>Ativo</th><th>Exchange</th><th class="right">APR funding</th>
        <th class="right">Observações</th><th class="right">Vivo há</th><th class="right">Volume médio</th>
      </tr></thead><tbody id="basisBody"></tbody></table></div>
    </div>

    <div class="card">
      <div class="hd"><span class="lbl">Decisões do motor</span><span class="note">o raciocínio, não só o resultado</span></div>
      <div class="timeline" id="log"></div>
    </div>

  </div>
</div>

<script>
const f=(n,d=2)=>Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d});
const hm=t=>new Date(t).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
const dm=t=>new Date(t).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
const vazio=(t,s)=>'<div class="empty"><div class="ic">◷</div><div>'+t+'</div>'+(s?'<div style="font-size:.72rem;opacity:.75">'+s+'</div>':'')+'</div>';

// flocos de neve decorativos, poucos e sutis
(function(){
  const box=document.getElementById('flakes');
  for(let i=0;i<14;i++){
    const el=document.createElement('div');
    const s=2+Math.random()*3;
    el.className='flake';
    el.style.width=s+'px';el.style.height=s+'px';
    el.style.left=(Math.random()*100)+'vw';
    el.style.setProperty('--drift',(Math.random()*60-30)+'px');
    el.style.animationDuration=(14+Math.random()*16)+'s';
    el.style.animationDelay=(-Math.random()*20)+'s';
    box.appendChild(el);
  }
})();

/** Spline monotônica (Fritsch-Carlson) — suaviza sem ultrapassar os valores reais. */
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

function sparkline(vals,cor,W,H){
  W=W||70;H=H||32;
  if(!vals||vals.length<2)return '';
  const p=3;
  let lo=Math.min(...vals),hi=Math.max(...vals);
  if(hi-lo<1e-9){lo-=1;hi+=1}
  const pts=vals.map((v,i)=>[p+(W-2*p)*(i/(vals.length-1)),p+(H-2*p)*(1-(v-lo)/(hi-lo))]);
  return '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" style="width:100%;height:100%">'
    +'<path d="'+suave(pts)+' L'+(W-p)+','+(H-p)+' L'+p+','+(H-p)+' Z" fill="'+cor+'" opacity=".14"/>'
    +'<path d="'+suave(pts)+'" fill="none" stroke="'+cor+'" stroke-width="1.8" stroke-linecap="round"/></svg>';
}

function anel(pct,cor,tam){
  tam=tam||28;
  const r=tam/2-3.2,c=2*Math.PI*r,pctc=Math.max(0,Math.min(100,pct));
  const off=c*(1-pctc/100);
  return '<svg width="'+tam+'" height="'+tam+'" viewBox="0 0 '+tam+' '+tam+'">'
    +'<circle cx="'+(tam/2)+'" cy="'+(tam/2)+'" r="'+r+'" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="3"/>'
    +'<circle cx="'+(tam/2)+'" cy="'+(tam/2)+'" r="'+r+'" fill="none" stroke="'+cor+'" stroke-width="3" '
    +'stroke-dasharray="'+c.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'" stroke-linecap="round" '
    +'transform="rotate(-90 '+(tam/2)+' '+(tam/2)+')" style="transition:stroke-dashoffset .7s cubic-bezier(.4,0,.2,1)"/></svg>';
}

/** A bola de neve — cresce/encolhe de raio conforme o capital muda contra o inicial. */
function bolaDeNeve(capital,capitalInicial){
  const razao=Math.max(.55,Math.min(1.6,capital/Math.max(1,capitalInicial)));
  const r=30*razao;
  const cor=capital>=capitalInicial?'#2fe0ac':'#ff5577';
  return '<svg width="118" height="118" viewBox="0 0 118 118">'
    +'<defs><radialGradient id="bola-g" cx="35%" cy="30%"><stop offset="0%" stop-color="#fff" stop-opacity=".9"/>'
    +'<stop offset="45%" stop-color="'+cor+'" stop-opacity=".55"/><stop offset="100%" stop-color="'+cor+'" stop-opacity=".12"/></radialGradient></defs>'
    +'<g class="anelRolando"><circle cx="59" cy="59" r="'+(r+14)+'" fill="none" stroke="'+cor+'" stroke-opacity=".18" stroke-width="1" stroke-dasharray="2,6"/></g>'
    +'<g class="anelRolando2"><circle cx="59" cy="59" r="'+(r+22)+'" fill="none" stroke="'+cor+'" stroke-opacity=".1" stroke-width="1" stroke-dasharray="1,8"/></g>'
    +'<circle cx="59" cy="59" r="'+r.toFixed(1)+'" fill="url(#bola-g)" stroke="'+cor+'" stroke-width="1.5" stroke-opacity=".55" style="transition:r .8s cubic-bezier(.4,0,.2,1)"/>'
    +'</svg>';
}

let pontosCurva=[];
function linha(serie,eventos){
  if(!serie||serie.length<2)return vazio('aguardando leituras','a curva aparece a partir de 2 pontos');
  const W=800,H=222,pl=58,pr=18,pt=20,pb=30;
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
      +'<text x="'+(pl-10)+'" y="'+(y+3.6).toFixed(1)+'" fill="#4c5c7d" font-size="10.5" text-anchor="end" class="mono">$'+f(v)+'</text>';
  }
  let mk='';
  for(const e of eventos||[]){
    if((e.evento!=='abre'&&e.evento!=='fecha')||e.ts<t0||e.ts>t1)continue;
    const x=X(e.ts),c=e.evento==='abre'?'#ffc857':'#ff5577';
    mk+='<line x1="'+x.toFixed(1)+'" y1="'+pt+'" x2="'+x.toFixed(1)+'" y2="'+(H-pb)+'" stroke="'+c+'" stroke-width="1" stroke-dasharray="3,5" opacity=".45"/>'
      +'<circle cx="'+x.toFixed(1)+'" cy="'+pt+'" r="3.6" fill="'+c+'"/>';
  }
  const d=suave(pts);
  const dots=pts.length<=50?pts.map(p=>'<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="2.4" fill="#7dd3fc" opacity=".9"/>').join(''):'';

  return '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" id="svgCap">'
    +'<defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">'
    +'<stop offset="0" stop-color="#7dd3fc" stop-opacity=".32"/><stop offset="1" stop-color="#7dd3fc" stop-opacity="0"/></linearGradient></defs>'
    +g+'<path d="'+d+' L'+pts[pts.length-1][0].toFixed(1)+','+(H-pb)+' L'+pts[0][0].toFixed(1)+','+(H-pb)+' Z" fill="url(#ga)"/>'
    +mk+'<path d="'+d+'" fill="none" stroke="#7dd3fc" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>'
    +dots+'<line id="cross" x1="0" y1="'+pt+'" x2="0" y2="'+(H-pb)+'" stroke="#a5b4fc" stroke-width="1" opacity="0"/>'
    +'<circle id="crossD" r="4.5" fill="#a5b4fc" stroke="#050a14" stroke-width="2" opacity="0"/>'
    +'<text x="'+pl+'" y="'+(H-8)+'" fill="#4c5c7d" font-size="10.5">'+dm(t0)+' '+hm(t0)+'</text>'
    +'<text x="'+(W-pr)+'" y="'+(H-8)+'" fill="#4c5c7d" font-size="10.5" text-anchor="end">'+dm(t1)+' '+hm(t1)+'</text></svg>';
}

function barras(dados){
  if(!dados||!dados.length)return vazio('nenhum pagamento ainda','o funding chega a cada 8 horas');
  const W=800,H=168,pl=58,pr=18,pt=20,pb=26;
  const mx=Math.max(...dados.map(d=>d.total),1e-9);
  const faixa=(W-pl-pr)/dados.length;
  const bw=Math.min(46,Math.max(9,faixa*.55));
  let g='';
  for(let i=0;i<=2;i++){
    const y=pt+(H-pt-pb)*(i/2),v=mx-mx*(i/2);
    g+='<line x1="'+pl+'" y1="'+y.toFixed(1)+'" x2="'+(W-pr)+'" y2="'+y.toFixed(1)+'" stroke="rgba(255,255,255,.04)"/>'
      +'<text x="'+(pl-10)+'" y="'+(y+3.6).toFixed(1)+'" fill="#4c5c7d" font-size="10" text-anchor="end" class="mono">$'+f(v,4)+'</text>';
  }
  let b='';
  dados.forEach((d,i)=>{
    const cx=pl+faixa*(i+.5),x=cx-bw/2;
    const h=Math.max(3,(H-pt-pb)*(d.total/mx));
    b+='<rect x="'+x.toFixed(1)+'" y="'+(H-pb-h).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="3.5" fill="url(#gb)"/>'
      +'<text x="'+cx.toFixed(1)+'" y="'+(H-pb-h-7).toFixed(1)+'" fill="#8ea3c4" font-size="9.5" text-anchor="middle" class="mono">$'+f(d.total,4)+'</text>';
    if(dados.length<=16)b+='<text x="'+cx.toFixed(1)+'" y="'+(H-8)+'" fill="#4c5c7d" font-size="9.5" text-anchor="middle">'+d.dia.slice(8)+'/'+d.dia.slice(5,7)+'</text>';
  });
  return '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'
    +'<defs><linearGradient id="gb" x1="0" y1="0" x2="0" y2="1">'
    +'<stop offset="0" stop-color="#a5b4fc"/><stop offset="1" stop-color="#a5b4fc" stop-opacity=".45"/></linearGradient></defs>'
    +g+b+'</svg>';
}

const wrapEl=document.getElementById('gCapWrap'),tip=document.getElementById('tip');
wrapEl.addEventListener('mousemove',ev=>{
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
  tip.style.top=((best.y/222)*r.height)+'px';
  tip.innerHTML='<span style="color:#4c5c7d">'+dm(best.ts)+' '+hm(best.ts)+'</span><b class="mono">$'+f(best.v)+'</b>';
});
wrapEl.addEventListener('mouseleave',()=>{
  tip.style.opacity='0';
  const cl=document.getElementById('cross'),cd=document.getElementById('crossD');
  if(cl)cl.setAttribute('opacity','0'); if(cd)cd.setAttribute('opacity','0');
});

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
function flashCard(el){ if(!el)return; el.classList.remove('flash');void el.offsetWidth;el.classList.add('flash'); }

function toast(tipo,titulo,detalhe){
  const box=document.getElementById('toasts');
  const el=document.createElement('div');
  el.className='toast '+tipo;
  el.innerHTML='<div class="tt">'+titulo+'</div><div class="ts">'+(detalhe||'')+'</div>';
  box.appendChild(el);
  setTimeout(()=>el.remove(),6200);
  const bc=document.getElementById('bellCount');
  const n=(Number(bc.textContent)||0)+1;
  bc.textContent=n;bc.style.display='grid';
  clearTimeout(toast._t);
  toast._t=setTimeout(()=>{bc.style.display='none';bc.textContent='0'},20000);
}

let estadoAnterior=null;
function detectarAlertas(d){
  if(!estadoAnterior){estadoAnterior=d;return}
  const procsAntes=estadoAnterior.processos||[],procsAgora=d.processos||[];
  for(const p of procsAgora){
    const antes=procsAntes.find(x=>x.chave===p.chave);
    if(antes&&antes.vivo&&!p.vivo)toast('dn',p.nome+' caiu','o watchdog religa em até 60s');
    if(antes&&!antes.vivo&&p.vivo)toast('up',p.nome+' voltou ao ar','religado automaticamente');
  }
  const posAntes=(estadoAnterior.estado&&estadoAnterior.estado.posicoes)||[];
  const posAgora=(d.estado&&d.estado.posicoes)||[];
  if(posAgora.length>posAntes.length){
    const nova=posAgora.find(p=>!posAntes.some(a=>a.symbol===p.symbol));
    toast('up','posição aberta',nova?nova.symbol.replace('/USDT:USDT',''):'');
  }
  if(posAgora.length<posAntes.length){
    const sumiu=posAntes.find(p=>!posAgora.some(a=>a.symbol===p.symbol));
    toast('ac','posição fechada',sumiu?sumiu.symbol.replace('/USDT:USDT',''):'');
  }
  for(const p of posAgora){
    const antes=posAntes.find(a=>a.symbol===p.symbol);
    if(antes&&antes.estagio===1&&p.estagio===2)toast('up',p.symbol.replace('/USDT:USDT','')+' escalonou','provou 1,5x o payback, foi pro tamanho cheio');
  }
  const scanAntes=estadoAnterior.scan||[],scanAgora=d.scan||[];
  for(const s of scanAgora){
    const antes=scanAntes.find(x=>x.symbol===s.symbol);
    const pctA=antes?(antes.pctDoCaminho||0):0,pctN=s.pctDoCaminho||0;
    if(pctA<90&&pctN>=90&&!s.passaPortao)toast('wa',s.symbol.replace('/USDT:USDT','')+' quase no portão',pctN.toFixed(0)+'% do caminho provado');
  }
  estadoAnterior=d;
}

let linhaAberta=null;

function render(d){
  detectarAlertas(d);
  const e=d.estado;
  if(!e){document.getElementById('sub').textContent='aguardando 1º ciclo';return}

  const dias=(Date.now()-e.iniciadoEm)/864e5, lucro=e.capital-e.capitalInicial;
  const sem=(e.semanas||[]).filter(w=>w.lucro!==0), semPos=sem.filter(w=>w.lucro>0).length;
  const curva=d.curva||[], vals=curva.map(x=>x.capital);
  const vg=d.vigilancia||{};

  document.getElementById('sub').textContent='dia '+dias.toFixed(1)+' · '+hm(d.atualizadoEm);

  const procs=d.processos||[];
  const todosVivos=procs.length&&procs.every(p=>p.vivo);
  document.getElementById('ledGeral').className='led'+(todosVivos?'':' dn');

  const abertas=(d.posicoes&&d.posicoes.length?d.posicoes:null)||e.posicoes||(e.posicao&&[e.posicao])||[];
  const conc=d.concentracao||{exchange:'—',fracao:0};
  document.getElementById('pill').textContent=(todosVivos?'':'⚠ ')+(abertas.length
    ?abertas.length+(abertas.length>1?' posições':' posição')
    :'sem posição · varrendo');

  document.getElementById('procList').innerHTML=procs.map(p=>{
    const horas=p.vivo&&p.desde?((Date.now()-p.desde)/3.6e6):0;
    const upTxt=p.vivo?(horas<1?(horas*60).toFixed(0)+'min':horas.toFixed(1)+'h'):'fora do ar';
    return '<div class="procRow2"><span class="procHex '+(p.vivo?'on':'off')+'"></span>'
      +'<span class="nm">'+p.nome+'</span><span class="val mono">'+upTxt+'</span></div>';
  }).join('');

  const ml=d.ml||{confiaveis:0,positivos:0,minimoNecessario:30};
  const pctML=Math.min(100,(ml.positivos/Math.max(1,ml.minimoNecessario))*100);
  const rMl=31,cMl=2*Math.PI*rMl,offMl=cMl*(1-pctML/100);
  document.getElementById('mlRing').innerHTML=
    '<svg width="78" height="78" viewBox="0 0 78 78">'
    +'<circle cx="39" cy="39" r="'+rMl+'" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="5"/>'
    +'<circle cx="39" cy="39" r="'+rMl+'" fill="none" stroke="#a5b4fc" stroke-width="5" stroke-linecap="round" '
    +'stroke-dasharray="'+cMl.toFixed(1)+'" stroke-dashoffset="'+offMl.toFixed(1)+'" style="transition:stroke-dashoffset .7s ease"/></svg>'
    +'<div class="mlCenter"><b class="pu">'+ml.positivos+'/'+ml.minimoNecessario+'</b><span>positivos</span></div>';
  document.getElementById('mlNota').textContent=ml.positivos<ml.minimoNecessario
    ?ml.confiaveis+' ciclos · amostra pequena decoraria, não aprenderia'
    :'amostra suficiente pra tentar, com walk-forward';

  const sc=d.scan||[];
  if(sc.length){
    const itens=sc.filter(s=>s.precoShortAoVivo).map(s=>
      '<span class="tItem"><b>'+s.symbol.replace('/USDT:USDT','')+'</b>'
      +'<span class="mono">$'+f(s.precoLongAoVivo,s.precoLongAoVivo<1?6:2)+'</span>'
      +'<span class="'+(s.aprSpread>=0?'up':'dn')+'">'+f(s.aprSpread*100,1)+'% APR</span></span>');
    const html=itens.join('');
    document.getElementById('ticker').innerHTML=html+html;
  }

  document.getElementById('bola').innerHTML=bolaDeNeve(e.capital,e.capitalInicial);
  animarNumero('kpiCapv',e.capital,v=>'$'+f(v));
  document.getElementById('kpiCapd').innerHTML=(lucro>=0?'<span class="up">▲ +$':'<span class="dn">▼ −$')+f(Math.abs(lucro),3)+'</span>';
  document.getElementById('heroSpark').innerHTML=sparkline(vals,'#7dd3fc',260,34);
  const kpiCapEl=document.querySelector('.sidebar .sbCard');
  if(window._capAnt!=null&&Math.abs(window._capAnt-e.capital)>1e-9)flashCard(kpiCapEl);
  window._capAnt=e.capital;

  animarNumero('kpiPagv',e.pagamentos,v=>Math.round(v).toString());
  document.getElementById('kpiPagd').textContent='bruto $'+f(e.fundingTotal,4);
  document.getElementById('kpiSemv').textContent=sem.length?semPos+'/'+sem.length:'—';
  document.getElementById('kpiSemd').textContent=sem.length?'':'primeira semana em curso';
  document.getElementById('kpiConcv').textContent=abertas.length?(conc.fracao*100).toFixed(0)+'%':'—';
  document.getElementById('kpiConcv').className='v '+(conc.fracao>(d.tetoPorExchange||0.4)?'dn':conc.fracao>0.35?'wa':'up');
  document.getElementById('kpiConcd').textContent=abertas.length?conc.exchange+' · teto '+((d.tetoPorExchange||0.4)*100).toFixed(0)+'%':'sem exposição';

  document.getElementById('capNota').textContent=curva.length+' leituras';
  document.getElementById('gCap').innerHTML=linha(curva,d.diario);
  document.getElementById('pagNota').textContent=(d.pagamentosPorDia||[]).length+' dias';
  document.getElementById('gPag').innerHTML=barras(d.pagamentosPorDia);

  const spotLbl=document.getElementById('spotLbl'),spotBody=document.getElementById('spotBody');
  const top7=sc.slice(0,7);
  const novaAssinaturaSpot=abertas.length
    ? 'pos:'+abertas[0].symbol+':'+(abertas[0].estagio||2)+':'+Math.round((abertas[0].fundingAcumulado||0)*1e4)+':'+Math.round((abertas[0].distanciaMinima||0)*1e3)
    : 'radar:'+top7.map(s=>s.symbol+':'+Math.round(s.pctDoCaminho||0)+':'+(s.passaPortao?1:0)).join(',');

  if(novaAssinaturaSpot!==window._assinaturaSpot){
    window._assinaturaSpot=novaAssinaturaSpot;
    if(abertas.length){
      spotLbl.textContent='Posição em destaque';
      const p=abertas[0];
      const h=typeof p.horasAberta==='number'?p.horasAberta:(Date.now()-p.abertaEm)/36e5;
      const dmin=typeof p.distanciaMinima==='number'?p.distanciaMinima:null;
      const estagioTag=p.estagio===1
        ?'<span class="stageBadge" style="background:var(--wa-dim);color:var(--wa)">fatia inicial</span>'
        :'<span class="stageBadge" style="background:var(--up-dim);color:var(--up)">tamanho cheio</span>';
      spotBody.innerHTML='<div class="pos"><div class="tk">'+p.symbol.replace('/USDT:USDT','')+estagioTag+'</div>'
        +'<div class="kv"><span>notional</span><b class="mono">$'+f(p.notionalPorPerna)+'</b></div>'
        +'<div class="kv"><span>funding acumulado</span><b class="mono up">+$'+f(p.fundingAcumulado,4)+'</b></div>'
        +(dmin!=null?'<div class="kv"><span>distância liquidação</span><b class="mono '+(dmin<0.03?'dn':dmin<0.06?'wa':'up')+'">'+(dmin*100).toFixed(1)+'%</b></div>':'')
        +'<div class="kv"><span>aberta há</span><b class="mono">'+h.toFixed(1)+'h</b></div></div>';
    }else{
      spotLbl.textContent='Radar de candidatos';
      if(!top7.length){
        spotBody.innerHTML=vazio('varrendo…','o radar aparece com o 1º candidato');
      }else{
        const raio=80,cx=98,cy=98;
        const blips=top7.map((s,i)=>{
          const ang=(360/top7.length)*i+30;
          const r=26+((s.pctDoCaminho||0)/100)*(raio-26);
          const x=cx+Math.cos(ang*Math.PI/180)*r, y=cy+Math.sin(ang*Math.PI/180)*r;
          const cls=s.passaPortao?'':((s.pctDoCaminho||0)>=50?'wa':'');
          return '<div class="blip '+cls+'" style="left:'+x.toFixed(0)+'px;top:'+y.toFixed(0)+'px;animation-delay:'+(i*.2)+'s">'
            +'<span class="lbl">'+s.symbol.replace('/USDT:USDT','')+'</span></div>';
        }).join('');
        spotBody.innerHTML='<div class="radarWrap"><div class="radar">'
          +'<svg viewBox="0 0 196 196">'
          +'<circle cx="98" cy="98" r="80" fill="none" stroke="rgba(255,255,255,.08)"/>'
          +'<circle cx="98" cy="98" r="53" fill="none" stroke="rgba(255,255,255,.06)"/>'
          +'<circle cx="98" cy="98" r="26" fill="none" stroke="rgba(255,255,255,.05)"/>'
          +'<g class="radarSweep"><path d="M98,98 L98,18 A80,80 0 0,1 166,58 Z" fill="url(#sweepGrad)"/></g>'
          +'<defs><linearGradient id="sweepGrad" x1="0" y1="1" x2="1" y2="0">'
          +'<stop offset="0" stop-color="#7dd3fc" stop-opacity="0"/><stop offset="1" stop-color="#7dd3fc" stop-opacity=".28"/></linearGradient></defs>'
          +'</svg>'+blips+'</div></div>'
          +'<div class="note" style="text-align:center;margin-top:4px">'+top7.length+' candidatos</div>';
      }
    }
  }

  {
    const contas=(d.contas||[]).slice().sort((a,b)=>b.saldo-a.saldo);
    const teto=(d.tetoPorExchange||0.4);
    const cst=d.custodia||{saude:{}};
    const nivelInfo={ok:['●','up','saudável'],degradado:['▲','wa','degradado'],evacuar:['✕','dn','evacuar'],desconhecido:['?','mut','sem verificação']};
    const badges=contas.map(c=>{
      const s=(cst.saude||{})[c.exchange];
      const nivel=s?s.nivel:'desconhecido';
      const info=nivelInfo[nivel]||nivelInfo.desconhecido;
      const titulo=(s&&s.detalhe?s.detalhe:'sem verificação ainda').replace(/"/g,'&quot;');
      return '<span class="custBadge" title="'+titulo+'"><b class="'+info[1]+'">'+info[0]+'</b> '+c.exchange+' · '+info[2]+'</span>';
    }).join('');
    const linhas=contas.map(c=>{
      const pct=(c.fracaoUsada||0)*100, cor=pct>teto*100?'dn':pct>35?'wa':'up';
      return '<div class="kv"><span>'+c.exchange+'</span><b class="mono '+cor+'">$'+f(c.livre,2)+' livre de $'+f(c.saldo,2)+' · '+pct.toFixed(0)+'%</b></div>';
    }).join('');
    document.getElementById('contasCard').innerHTML=(badges?'<div style="margin-bottom:12px">'+badges+'</div>':'')+linhas
      +'<div class="note" style="margin-top:14px;line-height:1.55">Metade do capital em cada exchange — o teto por exchange e a distância '
      +'de liquidação são as travas contra o risco que a estrutura delta-neutra <b>não</b> cobre.</div>';
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

  const passou=sc.filter(s=>s.passaPortao).length;
  document.getElementById('scanNota').textContent=sc.length
    ?sc.length+' pares · '+(passou?passou+' passam no portão':'nenhum passa no portão ainda')+' · '+(vg.fonte||'')
    :(vg.motivo||(d.varrendo?'varrendo exchanges…':'aguardando varredura'));

  window._ultimoScan=sc;
  document.getElementById('scan').innerHTML=sc.length?sc.map((s,idx)=>{
    const on=abertas.some(p=>p.symbol===s.symbol), c=s.consistencia*100;
    const pb=s.paybackHoras, viva=s.duracaoHoras||0, pct2=s.pctDoCaminho||0;
    const casas=v=>v<1?6:2;
    const precoTxt=(s.precoShortAoVivo&&s.precoLongAoVivo)
      ?'$'+f(s.precoShortAoVivo,casas(s.precoShortAoVivo))+' / $'+f(s.precoLongAoVivo,casas(s.precoLongAoVivo))
      :'—';
    const corAnel=s.passaPortao?'#2fe0ac':pct2>=50?'#ffc857':'#ff5577';
    const aberta=linhaAberta===idx;
    let html='<tr class="principal '+(on?'on':'')+'" data-idx="'+idx+'">'
      +'<td><span class="chev'+(aberta?' aberto':'')+'">▶</span></td>'
      +'<td><b>'+s.symbol.replace('/USDT:USDT','')+'</b>'+(on?'<span class="badge">montada</span>':'')+'</td>'
      +'<td class="mut">'+s.exchangeShort+'</td><td class="mut">'+s.exchangeLong+'</td>'
      +'<td class="right mono mut" style="font-size:.72rem">'+precoTxt+'</td>'
      +'<td class="right mono">'+f(s.spread*100,4)+'%</td>'
      +'<td class="right mono">'+f(s.aprSpread*100,1)+'%</td>'
      +'<td class="right mono '+(c>=95?'up':c>=80?'wa':'dn')+'">'+c.toFixed(0)+'%</td>'
      +'<td class="right mono mut">'+(viva<1?(viva*60).toFixed(0)+'min':viva.toFixed(1)+'h')+'</td>'
      +'<td class="right mono mut">'+(pb&&pb<10000?pb.toFixed(0)+'h':'—')+'</td>'
      +'<td class="right"><span class="anel">'+anel(pct2,corAnel,28)+'<span class="'+(s.passaPortao?'up':pct2>=50?'wa':'dn')+'">'
        +(s.passaPortao?'✓':pct2.toFixed(0)+'%')+'</span></span></td></tr>';
    if(aberta){
      const vidaTxt=viva<1?(viva*60).toFixed(0)+'min':viva.toFixed(1)+'h';
      const pctBar=Math.min(100,pct2);
      html+='<tr class="detalhe"><td colspan="10"><div class="painelDetalhe">'
        +'<div><div class="lbl" style="margin-bottom:8px">A conta do portão</div>'
        +'<div class="formula">vida esperada <span class="op">=</span> duração × consistência<br>'
        +'&nbsp;&nbsp;= '+vidaTxt+' × '+c.toFixed(0)+'%<br><br>'
        +'payback <span class="op">=</span> custo / (notional × spread × pagamentos/h)<br>'
        +'&nbsp;&nbsp;= '+(pb&&pb<10000?pb.toFixed(1)+'h':'—')+'<br><br>'
        +'portão exige <span class="op">=</span> payback × 1,5<br>'
        +'&nbsp;&nbsp;= '+(pb&&pb<10000?(pb*1.5).toFixed(1)+'h':'—')+'</div></div>'
        +'<div><div class="lbl" style="margin-bottom:8px">Progresso até o portão</div>'
        +'<div class="barraComparacao"><div class="trilho"><i style="width:'+pctBar+'%;background:'+corAnel+'"></i></div>'
        +'<div class="marcas"><span>0%</span><span>'+pct2.toFixed(0)+'% provado</span><span>150% abre</span></div></div>'
        +'<div class="note" style="margin-top:14px;line-height:1.6">'+(s.passaPortao
          ?'Já passou — o motor pode montar esta posição no próximo ciclo se ela continuar sendo a melhor.'
          :'Faltam '+Math.max(0,(150-pct2)).toFixed(0)+' pontos percentuais. Volume mínimo nesta ponta: US$ '+f((s.volumeMinimo||0)/1e6,2)+'M.')+'</div>'
        +'</div></div></td></tr>';
    }
    return html;
  }).join(''):'<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--t3)">varrendo exchanges…</td></tr>';

  document.querySelectorAll('#scan tr.principal').forEach(tr=>{
    tr.onclick=()=>{
      const idx=Number(tr.dataset.idx);
      linhaAberta=linhaAberta===idx?null:idx;
      render({...d,scan:window._ultimoScan});
    };
  });

  const cl=d.coleta;
  if(cl){
    const diasColeta=cl.coletandoDesde?(Date.now()-cl.coletandoDesde)/864e5:0;
    document.getElementById('coletaNota').textContent=diasColeta.toFixed(1)+' dias coletando';
    document.getElementById('coleta').innerHTML=[
      [cl.totalObservacoes,'observações'],[cl.totalCiclos,'ciclos fechados'],
      [cl.totalCustodia,'amostras de custódia'],[diasColeta.toFixed(1),'dias acumulando'],
    ].map(([v,l])=>'<div class="stat"><div class="v mono ac">'+v+'</div><div class="l">'+l+'</div></div>').join('');
  }else{
    document.getElementById('coletaNota').textContent='';
    document.getElementById('coleta').innerHTML='<div class="note" style="grid-column:1/-1">coletor ainda não gravou nada</div>';
  }

  const wd=d.watchdog||[];
  const wdQuedas=wd.filter(l=>l.includes('CAIU')).length;
  document.getElementById('wdNota').textContent=wd.length
    ?(wdQuedas?wdQuedas+' queda(s) real(is)':'sem quedas — só atualizações')
    :'';
  document.getElementById('watchdog').innerHTML=wd.length
    ?wd.slice(0,8).map(l=>{
        const caiu=l.includes('CAIU');
        const atualizacao=l.includes('atualização de código');
        const cor=caiu?'var(--dn)':atualizacao?'var(--ice)':'var(--t2)';
        return '<div class="mono" style="font-size:.76rem;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04);color:'+cor+'">'+l.replace(/</g,'&lt;')+'</div>';
      }).join('')
    :vazio('nenhuma queda registrada','o watchdog religa sozinho em até 30-60s se algo cair');

  const bs=d.basis||{vivas:0,fechadas:0,duracaoMedianaHoras:0,duracaoMaximaHoras:0,top:[]};
  document.getElementById('basisNota').textContent=bs.vivas+bs.fechadas
    ?bs.vivas+' vivos · '+bs.fechadas+' fechados':'';
  document.getElementById('basisStat').innerHTML=[
    [bs.vivas,'candidatos vivos'],[bs.fechadas,'ciclos fechados'],
    [bs.fechadas?bs.duracaoMedianaHoras.toFixed(1)+'h':'—','duração mediana'],
    [bs.fechadas?bs.duracaoMaximaHoras.toFixed(1)+'h':'—','duração máxima'],
  ].map(([v,l])=>'<div class="stat"><div class="v mono ac">'+v+'</div><div class="l">'+l+'</div></div>').join('');
  document.getElementById('basisBody').innerHTML=bs.top.length
    ?bs.top.map(c=>'<tr>'
      +'<td><b>'+c.symbol.replace('/USDT:USDT','')+'</b></td>'
      +'<td>'+c.exchange+'</td>'
      +'<td class="right mono ac">'+f(c.apr*100,1)+'%</td>'
      +'<td class="right mono">'+c.observacoes+'</td>'
      +'<td class="right mono">'+(c.horasVivo<1?(c.horasVivo*60).toFixed(0)+'min':c.horasVivo.toFixed(1)+'h')+'</td>'
      +'<td class="right mono">$'+f(c.volumeMedio/1e6,1)+'M</td></tr>').join('')
    :'<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--t3)">coletando…</td></tr>';

  const diarioLista=d.diario||[];
  const novaAssinaturaLog=diarioLista.length+'|'+(diarioLista[0]?diarioLista[0].ts+':'+diarioLista[0].evento:'');
  if(novaAssinaturaLog!==window._assinaturaLog){
    window._assinaturaLog=novaAssinaturaLog;
    const iconePorEvento={
      abre:['▲','up'],fecha:['●','dn'],funding:['$','up'],reinveste:['+','wa'],
      transfere:['⇄','pu'],apara:['✂','wa'],escalona:['⤴','up'],socorre:['⛑','pu'],piso:['■','dn'],
      semana:['W','mut'],bloqueado:['⏳','mut'],init:['●','mut'],
    };
    document.getElementById('log').innerHTML=diarioLista.map(x=>{
      let det='',val='',cls='';const s=(x.symbol||'').replace('/USDT:USDT','');
      if(x.evento==='abre'){det='<b>'+s+'</b> · '+x.short+' → '+x.long+' · consistência '+f((x.consistencia||0)*100,0)+'%'+(x.estagio===1?' · <span class="wa">fatia inicial</span>':'');val='$'+f(x.notional,0)}
      else if(x.evento==='fecha'){det='<b>'+s+'</b> · '+(x.motivo||'');val='+$'+f(x.fundingAcumulado,4);cls='up'}
      else if(x.evento==='funding'){det='spread '+f((x.spread||0)*100,4)+'%';val='+$'+f(x.ganho,5);cls='up'}
      else if(x.evento==='reinveste'){det='notional passou para $'+f(x.notionalNovo,0);val='+$'+f(x.notionalExtra,3);cls='wa'}
      else if(x.evento==='transfere'){det='preço '+f((x.variacao||0)*100,1)+'% desde a entrada';val='$'+f(x.transferido,2)}
      else if(x.evento==='apara'){det='<b>'+s+'</b> · posição aparada pra caber na cota'}
      else if(x.evento==='escalona'){det='<b>'+s+'</b> · provou 1,5x o payback, foi pro tamanho cheio';val='$'+f(x.notionalNovo,0);cls='up'}
      else if(x.evento==='socorre'){det='<b>'+s+'</b> · socorro de margem entre exchanges'}
      else if(x.evento==='piso'){det='motor parado — piso de capital atingido'}
      else if(x.evento==='semana'){det='semana fechada';val=(x.lucro>=0?'+':'−')+'$'+f(Math.abs(x.lucro),3);cls=x.lucro>=0?'up':'dn'}
      else if(x.evento==='bloqueado'){det=(s?'<b>'+s+'</b> · ':'')+(x.motivo||'')}
      else if(x.evento==='init'){det='motor iniciado com $'+f(x.capital,0)}
      const ic=iconePorEvento[x.evento]||['•','mut'];
      return '<div class="tItem2"><div class="tDot '+ic[1]+'">'+ic[0]+'</div>'
        +'<div class="tHead"><span class="tWhen mono">'+dm(x.ts)+' '+hm(x.ts)+'</span>'
        +'<span class="tTag" style="background:var(--'+ic[1]+'-dim,rgba(255,255,255,.06));color:var(--'+ic[1]+',var(--t2))">'+x.evento+'</span></div>'
        +'<div class="tDet">'+det+'</div>'
        +(val?'<div class="tVal mono '+cls+'">'+val+'</div>':'')+'</div>';
    }).join('');
  }
}

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
