/**
 * Dashboard — sétima geração, reconstruída do zero a pedido explícito do
 * usuário: a geração anterior (papel claro, "livro-caixa") ficou "estranha".
 * Esta é outra virada de conceito — terminal de trading moderno de verdade:
 * abas clicáveis, fita de preços ao vivo rolando, gráfico de candles real
 * por trás de cada posição aberta com a ENTRADA desenhada em cima, tudo
 * animado com propósito. Mesmo contrato de dados do server.ts
 * (retrato() via /api/stream e /api/dados), mais uma rota nova só pra
 * candles (/api/candles?exchange=&symbol=&timeframe=).
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
 * 4. Os gráficos de candle têm o PRÓPRIO ciclo de atualização (poll a cada
 *    ~20s, independente do SSE) porque candle fechado não muda a cada
 *    evento de disco — só quando a exchange fecha uma vela nova.
 */
export const PAGINA = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Snowball · Terminal</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>
:root{
  --bg:#070910; --bg2:#0c0f1a; --panel:#10141f; --panel-hi:#141926;
  --border:rgba(255,255,255,.07); --border-hi:rgba(255,255,255,.16);
  --text:#eef1f8; --dim:#8991a8; --faint:#565e75;
  --mint:#38bdf8; --mint-glow:rgba(56,189,248,.45);
  --coral:#ff5470; --coral-glow:rgba(255,84,112,.4);
  --violet:#8b6cf2; --violet-glow:rgba(139,108,242,.4);
  --amber:#ffb84d; --blue:#4d9fff;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Consolas,monospace;
  --radius:18px;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;scroll-behavior:smooth}
body{
  background:
    radial-gradient(1200px 700px at 15% -10%, rgba(56,189,248,.09), transparent 60%),
    radial-gradient(1000px 800px at 100% 0%, rgba(139,108,242,.10), transparent 55%),
    radial-gradient(900px 600px at 50% 110%, rgba(77,159,255,.07), transparent 55%),
    var(--bg);
  color:var(--text); font-family:var(--sans); min-height:100vh;
  -webkit-font-smoothing:antialiased; overflow-x:hidden;
}
::-webkit-scrollbar{width:9px;height:9px}
::-webkit-scrollbar-thumb{background:var(--border-hi);border-radius:99px}
::-webkit-scrollbar-track{background:transparent}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums}
.up{color:var(--mint)} .down{color:var(--coral)} .neu{color:var(--dim)}

/* ---- topo ---- */
.topbar{position:sticky;top:0;z-index:50;backdrop-filter:blur(18px);background:rgba(7,9,16,.78);border-bottom:1px solid var(--border)}
.topbar-in{max-width:1480px;margin:0 auto;padding:12px 22px;display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;margin-right:6px}
.brand-logo{height:52px;width:auto;display:block;filter:drop-shadow(0 0 10px var(--mint-glow))}
.brand h1{font-size:1.02rem;font-weight:800;margin:0;letter-spacing:-.01em}
.tabs{display:flex;gap:2px;flex:1;overflow-x:auto}
.tab{position:relative;padding:9px 15px;border-radius:10px;font-size:.82rem;font-weight:700;color:var(--dim);cursor:pointer;white-space:nowrap;transition:color .2s,background-color .2s;border:1px solid transparent;user-select:none}
.tab:hover{color:var(--text);background:rgba(255,255,255,.04)}
.tab.active{color:var(--text);background:rgba(255,255,255,.06);border-color:var(--border-hi)}
.tab.active::after{content:'';position:absolute;left:14%;right:14%;bottom:-1px;height:2px;border-radius:2px;background:linear-gradient(90deg,var(--mint),var(--violet));box-shadow:0 0 8px var(--mint-glow)}
.tab .dot-mini{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:6px;vertical-align:middle}
.topmeta{display:flex;align-items:center;gap:8px}
.pill{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:999px;padding:6px 11px;font-size:.72rem;color:var(--dim)}
.led{width:7px;height:7px;border-radius:50%;flex:none}
.led.on{background:var(--mint);box-shadow:0 0 0 0 var(--mint-glow);animation:pulse 1.8s infinite}
.led.off{background:var(--coral)}
.led.mid{background:var(--amber)}
@keyframes pulse{0%{box-shadow:0 0 0 0 var(--mint-glow)}70%{box-shadow:0 0 0 8px rgba(56,189,248,0)}100%{box-shadow:0 0 0 0 rgba(56,189,248,0)}}
#clock{font-family:var(--mono);font-size:.72rem;color:var(--dim)}

/* ---- fita de preços ---- */
.ticker-wrap{border-bottom:1px solid var(--border);background:rgba(255,255,255,.015);overflow:hidden;white-space:nowrap;position:relative}
.ticker-wrap::before,.ticker-wrap::after{content:'';position:absolute;top:0;bottom:0;width:60px;z-index:2;pointer-events:none}
.ticker-wrap::before{left:0;background:linear-gradient(90deg,var(--bg),transparent)}
.ticker-wrap::after{right:0;background:linear-gradient(270deg,var(--bg),transparent)}
.ticker-track{display:inline-flex;gap:0;animation:ticker-scroll 55s linear infinite;padding:7px 0}
.ticker-wrap:hover .ticker-track{animation-play-state:paused}
@keyframes ticker-scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.tick-item{display:inline-flex;align-items:baseline;gap:7px;padding:0 18px;border-right:1px solid var(--border);font-size:.78rem}
.tick-item .sym{font-weight:800}
.tick-item .px{font-family:var(--mono)}
.tick-item .chg{font-family:var(--mono);font-size:.7rem}

.wrap{max-width:1480px;margin:0 auto;padding:20px 22px 90px}
.tabpanel{display:none;animation:fadeUp .38s ease both}
.tabpanel.active{display:block}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}

section{margin-bottom:18px}
.card{background:linear-gradient(180deg,var(--panel),var(--panel-hi));border:1px solid var(--border);border-radius:var(--radius);padding:18px 20px;transition:border-color .25s,transform .25s,box-shadow .25s}
.card:hover{border-color:var(--border-hi)}
.card h2{margin:0 0 3px;font-size:.92rem;font-weight:800;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.card .caption{font-size:.72rem;color:var(--faint);margin:0 0 14px;line-height:1.5}
.card .note{font-size:.68rem;color:var(--dim);font-weight:500}

.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:12px}
@media(max-width:1100px){.kpis{grid-template-columns:repeat(3,1fr)}}
@media(max-width:640px){.kpis{grid-template-columns:repeat(2,1fr)}}
.kpi{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:14px 16px;transition:transform .2s,border-color .2s}
.kpi:hover{transform:translateY(-2px);border-color:var(--border-hi)}
.kpi .lbl{font-size:.62rem;text-transform:uppercase;letter-spacing:.08em;color:var(--faint);font-weight:800}
.kpi .val{font-family:var(--mono);font-size:1.35rem;font-weight:800;margin-top:5px;letter-spacing:-.01em}
.kpi .sub{font-size:.68rem;color:var(--dim);margin-top:3px}

.grid2{display:grid;grid-template-columns:1.3fr 1fr;gap:16px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
@media(max-width:980px){.grid2,.grid3{grid-template-columns:1fr}}

.chart-wrap{width:100%;height:210px}
.chart-wrap svg{width:100%;height:100%;overflow:visible}
.eqline{fill:none;stroke:url(#gradline);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.eqarea{fill:url(#gradfill)}

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

.procgrid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}
@media(max-width:900px){.procgrid{grid-template-columns:repeat(2,1fr)}}
.proc{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:12px 14px;transition:border-color .25s}
.proc.vivo{border-color:rgba(56,189,248,.28)}
.proc.morto{border-color:rgba(255,84,112,.4)}
.proc .row{display:flex;align-items:center;gap:8px}
.proc .nome{font-weight:700;font-size:.84rem}
.proc .info{font-family:var(--mono);font-size:.7rem;color:var(--dim);margin-top:6px}

.wdlog{max-height:160px;overflow-y:auto;font-family:var(--mono);font-size:.7rem;color:var(--dim);line-height:1.65;margin-top:12px;border-top:1px solid var(--border);padding-top:10px}
.wdlog div{white-space:pre-wrap;word-break:break-word}

.poscards{display:flex;flex-direction:column;gap:14px}
.poscard{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:16px}
.poscard .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.poscard .sym{font-weight:900;font-size:1.05rem}
.badge{font-size:.64rem;font-weight:800;padding:3px 9px;border-radius:999px;text-transform:uppercase;letter-spacing:.04em}
.badge.ok{background:rgba(56,189,248,.14);color:var(--mint)}
.badge.warn{background:rgba(255,184,77,.14);color:var(--amber)}
.badge.bad{background:rgba(255,84,112,.14);color:var(--coral)}
.legs{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}
.leg{background:rgba(255,255,255,.03);border-radius:10px;padding:8px 10px;border:1px solid var(--border)}
.leg .exid{font-size:.64rem;color:var(--faint);text-transform:uppercase;letter-spacing:.04em}
.leg .price{font-family:var(--mono);font-size:.94rem;font-weight:800;margin-top:3px;transition:color .35s}
.flash-up{color:var(--mint)!important;text-shadow:0 0 10px var(--mint-glow)}
.flash-down{color:var(--coral)!important;text-shadow:0 0 10px var(--coral-glow)}
.gauge{height:6px;border-radius:99px;background:rgba(255,255,255,.06);overflow:hidden;margin-top:10px}
.gauge i{display:block;height:100%;border-radius:99px;transition:width .6s ease}
.poscard .meta{display:flex;justify-content:space-between;font-size:.7rem;color:var(--dim);margin-top:8px;font-family:var(--mono)}
.empty{color:var(--dim);font-size:.85rem;padding:24px;text-align:center;border:1px dashed var(--border);border-radius:14px}

table{width:100%;border-collapse:collapse;font-size:.78rem}
th{text-align:left;color:var(--faint);font-weight:800;font-size:.62rem;text-transform:uppercase;letter-spacing:.05em;padding:9px 10px;border-bottom:1px solid var(--border)}
td{padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.035);font-family:var(--mono)}
tbody tr{transition:background-color .15s}
tbody tr:hover{background:rgba(255,255,255,.03)}
.mini-bar{width:64px;height:5px;border-radius:99px;background:rgba(255,255,255,.07);display:inline-block;overflow:hidden;vertical-align:middle;margin-left:6px}
.mini-bar i{display:block;height:100%;transition:width .5s ease}

.acct{display:flex;flex-direction:column;gap:12px}
.acctrow .head{display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:6px}
.acctrow .head b{text-transform:uppercase;letter-spacing:.03em;font-size:.72rem;color:var(--dim)}
.barmeter{position:relative;height:9px;border-radius:99px;background:rgba(255,255,255,.06);overflow:hidden}
.barmeter i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--mint),var(--violet))}
.barmeter .mark{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--amber)}

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

.op-badge{display:inline-block;font-size:.63rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:999px}
.op-det{color:var(--dim);font-size:.76rem}

.progress-readiness{height:8px;border-radius:99px;background:rgba(255,255,255,.06);overflow:hidden;margin-top:10px}
.progress-readiness i{display:block;height:100%;background:linear-gradient(90deg,var(--blue),var(--mint))}

.aviso-agressivo{font-size:.76rem;color:var(--dim);background:rgba(255,184,77,.07);border:1px solid rgba(255,184,77,.35);border-radius:14px;padding:12px 16px;margin-bottom:16px;line-height:1.55}
.aviso-agressivo b{color:var(--amber)}

footer.foot{text-align:center;color:var(--faint);font-size:.7rem;padding:30px 0 0;font-family:var(--mono)}
code{background:rgba(255,255,255,.06);padding:1px 5px;border-radius:5px;font-size:.9em}
</style></head>
<body>

  <div class="topbar"><div class="topbar-in">
    <div class="brand">
      <img src="/logo.png" alt="Snowball" class="brand-logo">
    </div>
    <div class="tabs" id="tabs">
      <div class="tab active" data-tab="visao">Visão geral</div>
      <div class="tab" data-tab="normal"><span class="dot-mini" style="background:var(--mint)"></span>Modo normal</div>
      <div class="tab" data-tab="agressivo"><span class="dot-mini" style="background:var(--violet)"></span>Modo agressivo</div>
      <div class="tab" data-tab="mercado">Mercado</div>
      <div class="tab" data-tab="sistema">Sistema</div>
    </div>
    <div class="topmeta">
      <span class="pill"><span class="led" id="led-vig"></span><span id="txt-vig">carregando</span></span>
      <span class="pill"><span class="led" id="led-stream"></span><span id="txt-stream">carregando</span></span>
      <span class="pill" id="clock">--:--:--</span>
    </div>
  </div></div>

  <div class="ticker-wrap"><div class="ticker-track" id="ticker-track"></div></div>

  <div class="wrap">

    <!-- ============ VISÃO GERAL ============ -->
    <div class="tabpanel active" id="panel-visao">
      <section class="kpis" id="kpis-geral"></section>

      <section class="grid2">
        <div class="card">
          <h2>Curva de capital — modo normal</h2>
          <p class="caption">Capital total das 6 exchanges financiadas, ao longo do tempo.</p>
          <div class="chart-wrap"><svg id="svg-curva" viewBox="0 0 1000 190" preserveAspectRatio="none"></svg></div>
        </div>
        <div class="card">
          <h2>Curva de capital — modo agressivo</h2>
          <p class="caption">ts-momentum multi-ativo, experimental, em papel.</p>
          <div class="chart-wrap"><svg id="svg-curva-mom-mini" viewBox="0 0 1000 190" preserveAspectRatio="none"></svg></div>
        </div>
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
        <h2>Ordem limite vs. mercado — mede se maker preenche rápido o bastante <span class="note" id="preench-tag"></span></h2>
        <p class="caption">Ordem a mercado (taker) custa 0,05-0,06%; ordem limite (maker) custa ~0,02% — mas só preenche se o preço tocar nela, e o toque costuma vir acompanhado de movimento contra quem forneceu a liquidez. Isto simula uma ordem limite "no toque" nas duas pernas dos melhores candidatos da vigilância, sem enviar ordem nenhuma, e mede as duas coisas: preenche rápido? o preço se move contra depois?</p>
        <div id="preench-box"></div>
      </section>

      <section class="card">
        <h2>Processos <span class="note">watchdog verifica a cada 30s</span></h2>
        <div class="procgrid" id="procgrid"></div>
      </section>
    </div>

    <!-- ============ MODO NORMAL ============ -->
    <div class="tabpanel" id="panel-normal">
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
        <h2>Posições abertas <span class="note" id="pos-tag"></span></h2>
        <p class="caption">Cada posição é DUAS pernas — vendida numa exchange, comprada em outra, mesmo ativo. O gráfico mostra o candle real do mercado com a entrada marcada.</p>
        <div class="poscards" id="poscards"></div>
      </section>

      <section class="grid2">
        <div class="card">
          <h2>Contas por exchange</h2>
          <div class="acct" id="acct"></div>
        </div>
        <div class="card">
          <h2>Exposição &amp; direção</h2>
          <p class="caption">Concentração é o risco de custódia; dreno é o quanto uma alta forte do mercado desequilibraria as contas.</p>
          <div id="exposure"></div>
        </div>
      </section>

      <section class="card">
        <h2>Varredura — ranking ao vivo <span class="note" id="scan-tag"></span></h2>
        <p class="caption">Candidatas ordenadas por quanto já cruzaram o portão de valor esperado (coluna "Caminho"). "Passa" = o motor pode abrir; "Barra" = ainda não vale o custo.</p>
        <div style="overflow-x:auto"><table id="scan-table">
          <thead><tr>
            <th>Par</th><th>Rota</th><th>Spread</th><th>APR</th><th>Consist.</th>
            <th>Vida esp.</th><th>Payback</th><th>Caminho</th><th>Portão</th>
          </tr></thead>
          <tbody id="scan-body"></tbody>
        </table></div>
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

      <section class="card">
        <h2>Histórico de operações <span class="note" id="ops-tag">tudo que foi de fato executado, sem os bloqueios</span></h2>
        <div style="overflow-x:auto"><table id="ops-table">
          <thead><tr><th>Quando</th><th>Tipo</th><th>Ativo</th><th>Detalhes</th></tr></thead>
          <tbody id="ops-body"></tbody>
        </table></div>
      </section>

      <section class="card">
        <h2>Decisões do motor</h2>
        <p class="caption">Cada avaliação de cada ciclo, inclusive os bloqueios — é o log de raciocínio completo, não só o resultado.</p>
        <div class="timeline" id="timeline"></div>
      </section>
    </div>

    <!-- ============ MODO AGRESSIVO ============ -->
    <div class="tabpanel" id="panel-agressivo">
      <div class="aviso-agressivo">
        <b>Experimental — sem garantia de lucro em nenhum prazo.</b> ts-momentum multi-ativo é a única, de 7
        famílias de estratégia testadas neste projeto, que sobreviveu a holdout cego (p=0,008 — ver Resultado
        6/10 em <code>docs/RESULTADOS.md</code>). Bootstrap por blocos mede ~9-13% de chance de bater a meta em
        anos, ~15-45% de chance de perder o capital. Roda em paralelo ao Modo Normal, só em papel.
      </div>

      <section class="kpis" id="kpis-mom"></section>

      <section class="card">
        <h2>Curva de capital</h2>
        <div class="chart-wrap"><svg id="svg-curva-mom" viewBox="0 0 1000 190" preserveAspectRatio="none"></svg></div>
      </section>

      <section class="card">
        <h2>Posições abertas <span class="note" id="pos-mom-tag"></span></h2>
        <p class="caption">Barras diárias — o gráfico mostra o candle diário real com a entrada marcada.</p>
        <div class="poscards" id="poscards-mom"></div>
      </section>

      <section class="card">
        <h2>De onde veio o dinheiro</h2>
        <p class="caption">Aqui não tem funding nem socorro — só entrada e saída de posição. Verde é trade fechado no lucro, vermelho é trade fechado no prejuízo.</p>
        <div class="chart-wrap" style="height:260px"><svg id="svg-fluxo-mom" viewBox="0 0 1000 260" preserveAspectRatio="none"></svg></div>
        <div class="kpis" style="grid-template-columns:repeat(2,1fr);margin-top:14px" id="fluxo-mom-kpis"></div>
        <div class="timeline" id="fluxo-mom-lista" style="margin-top:14px"></div>
      </section>

      <section class="card">
        <h2>Histórico de operações</h2>
        <div style="overflow-x:auto"><table id="ops-mom-table">
          <thead><tr><th>Quando</th><th>Tipo</th><th>Ativo</th><th>Detalhes</th></tr></thead>
          <tbody id="ops-mom-body"></tbody>
        </table></div>
      </section>

      <section class="card">
        <h2>Decisões do modo agressivo</h2>
        <div class="timeline" id="timeline-mom"></div>
      </section>
    </div>

    <!-- ============ MERCADO ============ -->
    <div class="tabpanel" id="panel-mercado">
      <section class="card">
        <h2>Preços ao vivo <span class="note">pernas de posições abertas + melhores candidatas da varredura</span></h2>
        <div id="mercado-grid" class="procgrid" style="grid-template-columns:repeat(4,1fr)"></div>
      </section>
      <section class="grid2">
        <div class="card">
          <h2>Saúde das exchanges</h2>
          <div class="healthgrid" id="custodia-grid"></div>
        </div>
        <div class="card">
          <h2>Basis trade <span class="note">spot+perp, coleta — não opera</span></h2>
          <div id="basis-box"></div>
        </div>
      </section>
    </div>

    <!-- ============ SISTEMA ============ -->
    <div class="tabpanel" id="panel-sistema">
      <section class="card">
        <h2>Processos <span class="note">watchdog verifica a cada 30s</span></h2>
        <div class="procgrid" id="procgrid-2"></div>
        <div class="wdlog" id="wdlog"></div>
      </section>
      <section class="grid3">
        <div class="card">
          <h2>Coleta de longo prazo</h2>
          <div id="coleta-box"></div>
        </div>
        <div class="card">
          <h2>Prontidão de ML</h2>
          <div id="ml-box"></div>
        </div>
        <div class="card">
          <h2>Saúde do dashboard <span class="note">memória, achado depois de quedas sem erro</span></h2>
          <div id="diag-box"></div>
        </div>
      </section>
      <section class="card">
        <h2>Sobre este painel</h2>
        <p class="caption" style="margin:0">HTML + CSS + SVG + JS puro, sem dependência externa, servido pelo próprio motor. Nenhuma ordem é enviada de nenhum modo — os dois motores só leem as exchanges e simulam.</p>
      </section>
    </div>

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

// ---- abas ----
(function(){
  var tabs=document.querySelectorAll('.tab');
  tabs.forEach(function(t){
    t.addEventListener('click',function(){
      var alvo=t.getAttribute('data-tab');
      document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('active')});
      document.querySelectorAll('.tabpanel').forEach(function(x){x.classList.remove('active')});
      t.classList.add('active');
      el('panel-'+alvo).classList.add('active');
      try{localStorage.setItem('snowball-aba',alvo)}catch(e){}
    });
  });
  var salva=null;
  try{salva=localStorage.getItem('snowball-aba')}catch(e){}
  if(salva){var tabSalva=document.querySelector('.tab[data-tab="'+salva+'"]'); if(tabSalva) tabSalva.click();}
})();

// ---- anti-flicker ----
var lastHash={};
function renderIfChanged(key,data,fn){
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

// ---- KPIs (visão geral + normal) ----
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
function montarKpisMom(d){
  var m=d.modoAgressivo;
  if(!m)return null;
  var e=m.estado||{};
  var cap=e.capital!=null?e.capital:0;
  var capIni=e.capitalInicial||cap||1;
  var variacao=(cap-capIni)/capIni;
  return [
    {id:'km-capital',lbl:'Capital atual · agressivo',val:cap,fmt:fmtUsd,sub:(variacao>=0?'+':'')+fmtPct(variacao,2)+' desde o início',cls:variacao>=0?'up':'down'},
    {id:'km-pico',lbl:'Pico',val:e.pico||cap,fmt:fmtUsd,sub:'capital inicial '+fmtUsd(capIni)},
    {id:'km-trades',lbl:'Trades fechados',val:e.fechados||0,fmt:function(n){return fmtNum(Math.round(n))},sub:m.taxaVitoria!=null?fmtPct(m.taxaVitoria,0)+' de vitórias':'sem trades ainda'},
    {id:'km-pos',lbl:'Posições abertas',val:(e.posicoes||[]).length,fmt:function(n){return fmtNum(Math.round(n))},sub:'de 57 ativos monitorados'},
    {id:'km-custos',lbl:'Custos pagos',val:e.custosTotal||0,fmt:fmtUsd,sub:'taxas + slippage acumulados'}
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
  var itensMom=montarKpisMom(d);
  if(itensMom) aplicarFiguras(el('kpis-mom'),itensMom);
  // visão geral: junta as duas listas de figuras, prefixando IDs pra não colidir
  var geral=el('kpis-geral');
  var itensGeral=montarKpisNormal(d).slice(0,3).map(function(it){return {id:'g-'+it.id,lbl:it.lbl,val:it.val,fmt:it.fmt,sub:it.sub,cls:it.cls,raw:it.raw}});
  if(itensMom) itensGeral=itensGeral.concat(itensMom.slice(0,3).map(function(it){return {id:'g-'+it.id,lbl:it.lbl,val:it.val,fmt:it.fmt,sub:it.sub,cls:it.cls,raw:it.raw}}));
  aplicarFiguras(geral,itensGeral);
}

// ---- curva de capital (genérica — usada 3x: normal, mini geral, agressivo) ----
function desenharCurva(svgId, pts, corStroke){
  var svg=el(svgId);
  if(!svg)return;
  if(pts.length<2){svg.innerHTML=pts.length?'':'';return}
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
    desenharCurva('svg-curva',pts,'#38bdf8');
    desenharCurva('svg-curva-2',pts,'#38bdf8');
  });
}
function renderCurvaMom(d){
  var m=d.modoAgressivo;
  var pts=((m&&m.curva)||[]).filter(function(p){return isFinite(p.capital)});
  renderIfChanged('curva-mom',pts,function(){
    desenharCurva('svg-curva-mom',pts,'#8b6cf2');
    desenharCurva('svg-curva-mom-mini',pts,'#8b6cf2');
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
      var cor=neg?'#ff5470':'#38bdf8';
      out.push('<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="3" fill="'+cor+'"><title>'+esc(l.dia)+': '+fmtUsd(l.total)+'</title></rect>');
      out.push('<text x="'+(x+bw/2).toFixed(1)+'" y="'+(H-8)+'" font-size="13" fill="#565e75" text-anchor="middle" font-family="ui-monospace,monospace">'+esc(l.dia.slice(5))+'</text>');
    });
    svg.innerHTML=out.join('');
  });
}

// ---- gráfico de candles (com a entrada da posição marcada) ----
var GRAFICOS={};
// Carregamento preguiçoso dos candles: com até 40+ posições no modo agressivo,
// buscar o gráfico de todas de uma vez na hora de abrir a aba disparava 40
// fetches simultâneos, cada um batendo numa chamada de exchange ao vivo no
// servidor (mesmo limite de taxa da binanceusdm pra todas) — é isso que
// deixava a aba muito lenta pra abrir. Só busca o candle quando o card entra
// de fato na tela.
var CANDLE_OBSERVER=null;
function elementPertoDaTela(box){
  var r=box.getBoundingClientRect();
  var folga=400;
  return r.bottom>-folga&&r.top<(window.innerHeight||800)+folga;
}
function observarCandle(box,cb){
  // checagem síncrona primeiro: cobre o caso comum (card já visível) sem
  // depender do IntersectionObserver dar o primeiro retrato a tempo.
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
  // seguro contra ambientes onde o IntersectionObserver não dispara (ex.:
  // aba sem compositor ativo) — sem isto, o card nunca carregaria o gráfico.
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
function corEventoBadge(ev){
  var m={abre:'#38bdf8',fecha:'#ff5470',funding:'#4d9fff',reinveste:'#ffb84d',escalona:'#8b6cf2',socorre:'#ffb84d'};
  return m[ev]||'#8991a8';
}
function desenharCandles(svgEl, candles, entryPrice, side){
  if(!candles||candles.length<2){svgEl.innerHTML='<text x="500" y="130" text-anchor="middle" fill="#565e75" font-size="14">sem dado de candle ainda</text>';return}
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
  // grade horizontal + rótulos de preço
  for(var g=0;g<=3;g++){
    var v=lo+(hi-lo)*(g/3), y=Y(v).toFixed(1);
    out.push('<line x1="'+padL+'" y1="'+y+'" x2="'+(W-padR)+'" y2="'+y+'" stroke="rgba(255,255,255,.05)"/>');
    out.push('<text x="'+(W-padR+6)+'" y="'+(Number(y)+3)+'" font-size="12" fill="#565e75" font-family="ui-monospace,monospace">'+v.toFixed(v<1?5:2)+'</text>');
  }
  candles.forEach(function(c,i){
    var o=c[1],h=c[2],l=c[3],cl=c[4];
    var alta=cl>=o;
    var cor=alta?'#38bdf8':'#ff5470';
    var x=X(i);
    out.push('<line x1="'+x.toFixed(1)+'" y1="'+Y(h).toFixed(1)+'" x2="'+x.toFixed(1)+'" y2="'+Y(l).toFixed(1)+'" stroke="'+cor+'" stroke-width="1.2"/>');
    var yo=Y(o),yc=Y(cl);
    var top=Math.min(yo,yc), hgt=Math.max(1.4,Math.abs(yc-yo));
    out.push('<rect x="'+(x-cw/2).toFixed(1)+'" y="'+top.toFixed(1)+'" width="'+cw.toFixed(1)+'" height="'+hgt.toFixed(1)+'" fill="'+cor+'" style="animation:candleIn .4s ease both;animation-delay:'+(i*4)+'ms;transform-origin:'+x.toFixed(1)+'px '+Y((o+cl)/2).toFixed(1)+'px"><title>O '+o.toFixed(4)+' · H '+h.toFixed(4)+' · L '+l.toFixed(4)+' · C '+cl.toFixed(4)+'</title></rect>');
  });
  if(entryPrice){
    var ye=Y(entryPrice).toFixed(1);
    var corEntrada=side==='short'?'#ff5470':'#38bdf8';
    out.push('<line x1="'+padL+'" y1="'+ye+'" x2="'+(W-padR)+'" y2="'+ye+'" stroke="'+corEntrada+'" stroke-width="1.4" stroke-dasharray="5,4"/>');
    out.push('<rect x="'+(W-padR+2)+'" y="'+(Number(ye)-9)+'" width="50" height="18" rx="4" fill="'+corEntrada+'"/>');
    out.push('<text x="'+(W-padR+27)+'" y="'+(Number(ye)+4)+'" font-size="11" fill="#070910" font-weight="700" text-anchor="middle" font-family="ui-monospace,monospace">'+entryPrice.toFixed(entryPrice<1?5:2)+'</text>');
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
      '<div class="candle-legend"><span><i class="leg-dot" style="background:#38bdf8"></i>alta</span><span><i class="leg-dot" style="background:#ff5470"></i>baixa</span>'+
      '<span><i class="leg-dot" style="background:'+(side==='short'?'#ff5470':'#38bdf8')+'"></i>preço de entrada</span></div>';
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
    // O registro em GRAFICOS já existia, mas se o DOM precisou ser recriado
    // (ex.: card reconstruído porque o número de posições mudou), o SVG novo
    // está vazio e só seria pintado de novo daqui a até 20s (o intervalo do
    // poll). Repinta na hora com o último candle já em cache, sem esperar.
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
    el('wdlog').innerHTML=wd.length ? wd.map(function(l){return '<div>'+esc(l)+'</div>'}).join('') : '<div style="color:#565e75">sem eventos registrados ainda</div>';
  });
}

// ---- posições abertas (modo normal) — com gráfico de candle ----
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

function renderPosicoes(d){
  var pos=d.posicoes||[];
  el('pos-tag').textContent=pos.length?(pos.length+' aberta'+(pos.length>1?'s':'')):'nenhuma';
  var host=el('poscards');
  if(!pos.length){
    host.innerHTML='<div class="empty">Nenhuma posição aberta agora — o portão de valor esperado ainda não achou nada que pague o próprio custo. Isso é o resultado correto quando o mercado não oferece spread suficiente.</div>';
    host.dataset.count='0';
    limparGraficosOrfaos(Object.keys(GRAFICOS).filter(function(k){return k.indexOf('m-')===0}));
    return;
  }
  if(host.dataset.count!==String(pos.length)){
    host.innerHTML=pos.map(function(p,idx){return '<div class="poscard" id="poscard-'+idx+'"></div>'}).join('');
    host.dataset.count=String(pos.length);
  }
  var chaves=[];
  pos.forEach(function(p,idx){
    var distMin=p.distanciaMinima;
    var corGauge=distMin>0.08?'#38bdf8':(distMin>0.03?'#ffb84d':'#ff5470');
    var pctGauge=Math.max(2,Math.min(100,(distMin/0.15)*100));
    var badge=distMin>0.08?'ok':(distMin>0.03?'warn':'bad');
    var keyS='p'+idx+'s', keyL='p'+idx+'l';
    var card=el('poscard-'+idx);
    // O ESQUELETO só é escrito UMA VEZ por card. Escrever de novo a cada
    // render (mesmo com o mesmo conteúdo) apagava o <div class="candle-slot">
    // e, com ele, o SVG do candle que garantirGrafico tinha desenhado lá
    // dentro — o gráfico "aparecia e sumia" porque cada tick de preço (a
    // cada ~2,5s) recriava o slot vazio de novo. Agora só o que muda de
    // verdade (preço, gauge, meta) é atualizado depois da primeira escrita.
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
  limparGraficosOrfaos(chaves.concat(Object.keys(GRAFICOS).filter(function(k){return k.indexOf('m-')===0})));
}

function renderPosicoesMom(d){
  var m=d.modoAgressivo;
  var pos=(m&&m.posicoes)||[];
  el('pos-mom-tag').textContent=pos.length?(pos.length+' aberta'+(pos.length>1?'s':'')):'nenhuma';
  var host=el('poscards-mom');
  if(!pos.length){
    host.innerHTML='<div class="empty">Nenhuma posição aberta agora no modo agressivo.</div>';
    host.dataset.count='0';
    limparGraficosOrfaos(Object.keys(GRAFICOS).filter(function(k){return k.indexOf('n-')===0}));
    return;
  }
  if(host.dataset.count!==String(pos.length)){
    host.innerHTML=pos.map(function(p,idx){return '<div class="poscard" id="poscard-mom-'+idx+'"></div>'}).join('');
    host.dataset.count=String(pos.length);
  }
  var chavesMom=[];
  pos.forEach(function(p,idx){
    var card=el('poscard-mom-'+idx);
    // mesma regra do modo normal: esqueleto uma vez só, senão o candle-slot
    // (e o SVG dentro dele) é destruído a cada render e o gráfico pisca.
    if(!card.dataset.built){
      card.innerHTML=
        '<div class="top"><span class="sym"></span><span class="badge"></span></div>'+
        '<div class="meta"><span class="m-entrada"></span><span class="m-stop"></span><span class="m-alvo"></span></div>'+
        '<div class="meta"><span class="m-aberta"></span></div>'+
        '<div class="candle-slot" id="candle-slot-mom-'+idx+'"></div>';
      card.dataset.built='1';
    }
    card.querySelector('.sym').textContent=(p.symbol||'').replace('/USDT:USDT','');
    var badgeEl=card.querySelector('.badge'); badgeEl.className='badge '+(p.side==='long'?'ok':'bad'); badgeEl.textContent=p.side;
    card.querySelector('.m-entrada').textContent='entrada '+fmtUsd(p.entryPrice);
    card.querySelector('.m-stop').textContent='stop '+fmtUsd(p.stopPrice);
    card.querySelector('.m-alvo').textContent='alvo '+fmtUsd(p.takePrice);
    card.querySelector('.m-aberta').textContent='aberta há '+fmtHoras(p.horasAberta);

    var chave='m-'+p.symbol;
    chavesMom.push(chave);
    garantirGrafico(el('candle-slot-mom-'+idx), chave, 'binanceusdm', p.symbol, '4h', p.entryPrice, p.side);
  });
  limparGraficosOrfaos(chavesMom.concat(Object.keys(GRAFICOS).filter(function(k){return k.indexOf('n-')===0})));
}

// ---- ranking de exchanges ----
var rankAnterior={};
function renderRanking(d){
  var r=d.rankingExchanges||[];
  renderIfChanged('ranking',r,function(){
    var host=el('ranking-box');
    if(!r.length){host.innerHTML='<div class="empty">sem exchanges configuradas ainda</div>';return}
    var maxAbs=Math.max.apply(null,r.map(function(x){return Math.abs(x.lucro)}).concat([0.01]));
    host.innerHTML='<table><tbody>'+r.map(function(x){
      var pctBar=Math.max(2,Math.min(100,(Math.abs(x.lucro)/maxAbs)*100));
      var cor=x.lucro>=0?'#38bdf8':'#ff5470';
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
      var cor=idx===0?'#38bdf8':(x.folga>=0.05?'#ffb84d':'#8991a8');
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
        '<div class="head"><b>'+esc(c.exchange)+'</b><span class="num">'+fmtUsd(c.saldo)+'</span></div>'+
        '<div class="barmeter"><i style="width:'+pct+'%"></i><span class="mark" style="left:'+(100-markPct)+'%"></span></div>'+
        '<div style="display:flex;justify-content:space-between;font-size:.7rem;color:var(--dim);margin-top:5px" class="num">'+
          '<span>margem usada '+fmtUsd(c.margemUsada)+'</span><span>livre '+fmtUsd(c.livre)+'</span></div>'+
        '</div>';
    }).join('');
  });
}

// ---- exposição ----
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

// ---- varredura ----
function renderScan(d){
  var scan=(d.scan||[]).slice().sort(function(a,b){return (b.pctDoCaminho||0)-(a.pctDoCaminho||0)});
  el('scan-tag').textContent=(d.vigilancia?d.vigilancia.fonte:'') + (d.idadeVarreduraMin!=null&&d.idadeVarreduraMin>=0?' · dado de '+d.idadeVarreduraMin+' min':'');
  renderIfChanged('scan',scan,function(){
    var body=el('scan-body');
    if(!scan.length){body.innerHTML='<tr><td colspan="9" style="color:var(--faint);text-align:center;padding:20px">sem candidatos no momento</td></tr>';return}
    body.innerHTML=scan.map(function(o){
      var pct=Math.max(0,Math.min(100,o.pctDoCaminho||0));
      var corBar=o.passaPortao?'#38bdf8':(pct>60?'#ffb84d':'#ff5470');
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
    var corNivel={ok:'#38bdf8',atencao:'#ffb84d',alerta:'#ff5470',critico:'#ff5470',desconhecido:'#565e75'};
    host.innerHTML=ids.map(function(id){
      var s=c.saude[id];
      var cor=corNivel[s.nivel]||'#565e75';
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

// ---- saúde do dashboard: memória e caches, achado depois de quedas sem erro ----
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
  abertura:'#38bdf8','abre':'#38bdf8', fechamento:'#ff5470','fecha':'#ff5470',
  bloqueado:'#565e75', funding:'#4d9fff', transferencia:'#4d9fff', reinvestimento:'#ffb84d', socorre:'#ffb84d', escalona:'#8b6cf2'
};
function renderTimeline(d){
  var itens=(d.diario||[]).slice(0,60);
  renderIfChanged('timeline',itens,function(){
    var host=el('timeline');
    if(!itens.length){host.innerHTML='<div class="empty">sem eventos ainda</div>';return}
    host.innerHTML=itens.map(function(e){
      var cor=corEvento[e.evento]||'#565e75';
      var titulo=(e.evento||'evento')+(e.symbol?' · '+e.symbol.replace('/USDT:USDT',''):'');
      return '<div class="tl-item"><span class="tl-dot" style="background:'+cor+'"></span>'+
        '<div class="tl-body"><b>'+esc(titulo)+'</b><div class="motivo">'+esc(e.motivo||'')+'</div></div>'+
        '<div class="tl-time">'+timeAgo(e.ts)+'</div></div>';
    }).join('');
  });
}
function renderTimelineMom(d){
  var m=d.modoAgressivo;
  var itens=(m&&m.diario)||[];
  renderIfChanged('timeline-mom',itens,function(){
    var host=el('timeline-mom');
    if(!itens.length){host.innerHTML='<div class="empty">sem eventos ainda — o modo agressivo só age em fechamento de barra diária</div>';return}
    host.innerHTML=itens.map(function(e){
      var cor=corEvento[e.evento]||'#565e75';
      var titulo=(e.evento||'evento')+(e.symbol?' · '+e.symbol.replace('/USDT:USDT',''):'');
      var motivo=e.motivo||(e.pnl!=null?('pnl '+fmtUsd(e.pnl)+(e.reason?' · '+e.reason:'')):'');
      return '<div class="tl-item"><span class="tl-dot" style="background:'+cor+'"></span>'+
        '<div class="tl-body"><b>'+esc(titulo)+'</b><div class="motivo">'+esc(motivo)+'</div></div>'+
        '<div class="tl-time">'+timeAgo(e.ts)+'</div></div>';
    }).join('');
  });
}

// ---- de onde veio o dinheiro (ponte/waterfall) ----
//
// Cada evento do histórico de operações vira uma de quatro categorias:
//   GANHOU (verde)    — dinheiro que ENTROU (funding recebido)
//   INVESTIU (azul)   — dinheiro que SAIU pra montar/escalonar posição
//   PERDEU (vermelho) — dinheiro que SAIU pra fechar posição
//   SOCORREU (laranja)— não entra nem sai do total: só muda de saldo livre
//                       pra margem, dentro da MESMA exchange
//
// A soma ganhou-investiu-perdeu bate exatamente com a variação real do
// capital (é a mesma conta que o motor faz internamente) — por isso dá pra
// desenhar como ponte: capital inicial + ganhou - investiu - perdeu =
// capital atual, sem sobra nem falta.
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
  ganhou:{cor:'#38bdf8',label:'Ganhou'},
  investiu:{cor:'#4d9fff',label:'Investiu'},
  perdeu:{cor:'#ff5470',label:'Perdeu'},
  socorreu:{cor:'#ffb84d',label:'Socorreu'}
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

// gráfico de ponte genérico: passos absolutos (tipo 'total', desenha do
// fundo do gráfico até o valor) ou relativos (tipo 'delta', desenha entre
// dois valores, com linha pontilhada ligando ao próximo)
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
  out.push('<line x1="'+padX+'" y1="'+baseY.toFixed(1)+'" x2="'+(W-padX)+'" y2="'+baseY.toFixed(1)+'" stroke="rgba(255,255,255,.08)"/>');
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
    out.push('<text x="'+(x+bw/2).toFixed(1)+'" y="'+(H-padB+18)+'" text-anchor="middle" font-size="12" fill="#8991a8">'+esc(p.label)+'</text>');
    if(idx<n-1){
      var nx=padX+(idx+1)*colW+colW*0.16;
      out.push('<line x1="'+(x+bw).toFixed(1)+'" y1="'+y2.toFixed(1)+'" x2="'+nx.toFixed(1)+'" y2="'+y2.toFixed(1)+'" stroke="rgba(255,255,255,.22)" stroke-dasharray="4,4"/>');
    }
  });
  svgEl.innerHTML=out.join('');
}

// ---- o mesmo fluxo, quebrado por exchange ----
//
// Cada trade tem DUAS pernas (short numa exchange, long em outra) — ganho e
// custo são divididos meio a meio entre as duas, porque é literalmente
// assim que o dinheiro se move (repartir() no motor faz a mesma divisão).
// Eventos antigos (de antes desta seção existir) podem não ter as exchanges
// gravadas no próprio evento — nesse caso, busca no evento "abre" mais
// recente daquele ativo, que sempre tem.
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
    if(!exs)return; // sem como saber a exchange (ativo nunca visto num "abre"), fica de fora
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
      {tipo:'total',label:'Capital inicial',valor:capIni,cor:'#8991a8'},
      {tipo:'delta',label:'Ganhou',de:capIni,para:capIni+f.tot.ganhou,cor:CAT_INFO.ganhou.cor},
      {tipo:'delta',label:'Investiu',de:capIni+f.tot.ganhou,para:capIni+f.tot.ganhou-f.tot.investiu,cor:CAT_INFO.investiu.cor},
      {tipo:'delta',label:'Perdeu',de:capIni+f.tot.ganhou-f.tot.investiu,para:capIni+f.tot.ganhou-f.tot.investiu-f.tot.perdeu,cor:CAT_INFO.perdeu.cor},
      {tipo:'total',label:'Capital atual',valor:capAtual,cor:'#8991a8'}
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
    // ops já vem do servidor mais recente primeiro — sem reverter de novo aqui
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

function renderFluxoMom(d){
  var m=d.modoAgressivo;
  var ops=(m&&m.operacoes)||[];
  var e=(m&&m.estado)||{};
  var capIni=e.capitalInicial||0;
  var capAtual=e.capital!=null?e.capital:capIni;
  renderIfChanged('fluxo-mom',ops,function(){
    var ganhou=0,perdeu=0,itens=[];
    ops.forEach(function(ev){
      if(ev.evento!=='fecha'||ev.pnl==null)return;
      if(ev.pnl>=0){ganhou+=ev.pnl}else{perdeu+=Math.abs(ev.pnl)}
      itens.push(ev);
    });
    var passos=[
      {tipo:'total',label:'Capital inicial',valor:capIni,cor:'#8991a8'},
      {tipo:'delta',label:'Ganhou',de:capIni,para:capIni+ganhou,cor:CAT_INFO.ganhou.cor},
      {tipo:'delta',label:'Perdeu',de:capIni+ganhou,para:capIni+ganhou-perdeu,cor:CAT_INFO.perdeu.cor},
      {tipo:'total',label:'Capital atual',valor:capAtual,cor:'#8991a8'}
    ];
    desenharPonte(el('svg-fluxo-mom'),passos);

    var kHost=el('fluxo-mom-kpis');
    kHost.innerHTML=
      '<div class="kpi"><div class="lbl">Ganhou · trades no lucro</div><div class="val num" style="color:'+CAT_INFO.ganhou.cor+'">'+fmtUsd(ganhou)+'</div></div>'+
      '<div class="kpi"><div class="lbl">Perdeu · trades no prejuízo</div><div class="val num" style="color:'+CAT_INFO.perdeu.cor+'">'+fmtUsd(perdeu)+'</div></div>';

    var lHost=el('fluxo-mom-lista');
    if(!itens.length){lHost.innerHTML='<div class="empty">sem trade fechado ainda</div>';return}
    // ops já vem do servidor mais recente primeiro — sem reverter de novo aqui
    lHost.innerHTML=itens.slice(0,40).map(function(ev){
      var ganhouEste=ev.pnl>=0;
      var cor=ganhouEste?CAT_INFO.ganhou.cor:CAT_INFO.perdeu.cor;
      var at=(ev.symbol||'').replace('/USDT:USDT','');
      return '<div class="tl-item"><span class="tl-dot" style="background:'+cor+'"></span>'+
        '<div class="tl-body"><b style="color:'+cor+'">'+(ganhouEste?'Ganhou ':'Perdeu ')+(ganhouEste?'+':'−')+fmtUsd(Math.abs(ev.pnl))+'</b>'+
        '<div class="motivo">'+esc(at)+' · '+esc(ev.side)+' · saiu por '+esc(ev.reason||'—')+' @ '+fmtUsd(ev.exitPrice)+'</div></div>'+
        '<div class="tl-time">'+timeAgo(ev.ts)+'</div></div>';
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
      var cor=corEvento[e.evento]||'#565e75';
      return '<tr>'+
        '<td class="num" style="font-size:.72rem;white-space:nowrap">'+timeAgo(e.ts)+'</td>'+
        '<td><span class="op-badge" style="color:'+cor+';border:1px solid '+cor+'">'+esc(TIPO_LABEL[e.evento]||e.evento)+'</span></td>'+
        '<td style="font-weight:800">'+esc((e.symbol||'').replace('/USDT:USDT',''))+'</td>'+
        '<td class="op-det">'+detalheOperacaoNormal(e)+'</td>'+
        '</tr>';
    }).join('');
  });
}
function detalheOperacaoMom(e){
  if(e.evento==='abre'){return esc(e.side)+' @ '+fmtUsd(e.entryPrice)+' · notional '+fmtUsd(e.notional)+' · stop '+fmtUsd(e.stopPrice)+' · alvo '+fmtUsd(e.takePrice)}
  if(e.evento==='fecha'){
    var cls=e.pnl>=0?'up':'down';
    return '('+esc(e.reason||'—')+') @ '+fmtUsd(e.exitPrice)+' · pnl <span class="'+cls+'">'+(e.pnl>=0?'+':'')+fmtUsd(e.pnl)+'</span> · capital '+fmtUsd(e.capital);
  }
  return '';
}
function renderOperacoesMom(d){
  var m=d.modoAgressivo;
  var ops=(m&&m.operacoes)||[];
  renderIfChanged('ops-mom',ops,function(){
    var body=el('ops-mom-body');
    if(!ops.length){body.innerHTML='<tr><td colspan="4" style="color:var(--faint);text-align:center;padding:20px">nenhuma operação ainda</td></tr>';return}
    body.innerHTML=ops.map(function(e){
      var cor=corEvento[e.evento]||'#565e75';
      return '<tr>'+
        '<td class="num" style="font-size:.72rem;white-space:nowrap">'+timeAgo(e.ts)+'</td>'+
        '<td><span class="op-badge" style="color:'+cor+';border:1px solid '+cor+'">'+esc(TIPO_LABEL[e.evento]||e.evento)+'</span></td>'+
        '<td style="font-weight:800">'+esc((e.symbol||'').replace('/USDT:USDT',''))+'</td>'+
        '<td class="op-det">'+detalheOperacaoMom(e)+'</td>'+
        '</tr>';
    }).join('');
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
  renderCurvaMom(d);
  renderBarras(d);
  renderRanking(d);
  renderRankingPares(d);
  renderPreenchimento(d);
  renderProcessos(d);
  renderPosicoes(d);
  renderPosicoesMom(d);
  renderContas(d);
  renderExposicao(d);
  renderScan(d);
  renderMercado(d);
  renderCustodia(d);
  renderColeta(d);
  renderMl(d);
  renderDiag(d);
  renderBasis(d);
  renderTimeline(d);
  renderTimelineMom(d);
  renderOperacoes(d);
  renderOperacoesMom(d);
  renderFluxo(d);
  renderFluxoPorExchange(d);
  renderFluxoMom(d);
  renderStatus(d);
}

// ---- relógio ----
setInterval(function(){el('clock').textContent=new Date().toLocaleTimeString('pt-BR')},1000);

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
  es.onopen=function(){el('led-stream').className='led on';el('txt-stream').textContent='ao vivo'};
  es.onmessage=function(ev){pararPolling();try{render(JSON.parse(ev.data))}catch(e){}};
  es.onerror=function(){es.close();iniciarPolling();setTimeout(conectar,4000)};
}
conectar();
</script>
</body></html>`;
