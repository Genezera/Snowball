#!/usr/bin/env node
'use strict';
/**
 * PARTE 7 — Reinvestimento e progressão. Compara políticas A/B/C mantendo 100% do
 * lucro DENTRO do sistema. Replay da série real de capital. Honestidade central:
 * como 100% do lucro permanece, as três políticas atingem o MESMO capital no MESMO
 * tempo — o que muda é EXPOSIÇÃO / capital ocioso / risco, não a velocidade de
 * crescimento nem o capital final. Emite reinvestment-policies.json.
 */
const L = require('./lib-progression.cjs');

function build() {
  const { estado, asOf } = L.loadChampion();
  const { capSeries } = L.serieEconomica();
  const niveis = L.derivarNiveis();
  const capital = estado.capital || 0;

  // série de capital realizado (sem a injeção, que não é lucro) para medir utilização
  const serie = capSeries.map((e) => ({ ts: e.ts, capital: e.capital }));
  const capInicialBase = estado.capitalInicial || 600;

  // degraus úteis (Parte 7 política B): capital que habilita algo economicamente útil
  const degraus = niveis.filter((n) => n.capitalMinimo > 0).map((n) => ({ nivel: n.levelId, capital: n.capitalMinimo, motivo: n.nome }));

  // política A: expõe todo o excedente acima da reserva. B: só sobe exposição ao cruzar um degrau.
  // C: reserva parte do lucro num fundo de desbloqueio até o próximo módulo.
  function perfil(politica) {
    let exposicaoAcum = 0, ocioAcum = 0, n = 0, maxExposicao = 0;
    let ultimoDegrau = capInicialBase;
    for (const e of serie) {
      const excedente = Math.max(0, e.capital - capInicialBase); // lucro acumulado até aqui
      const reserva = e.capital * L.RESERVA;
      let exposto;
      if (politica === 'A') exposto = e.capital - reserva;                        // expõe tudo acima da reserva
      else if (politica === 'B') { if (e.capital >= (degraus.find((d) => d.capital > ultimoDegrau) || {}).capital) ultimoDegrau = (degraus.find((d) => d.capital > ultimoDegrau) || { capital: ultimoDegrau }).capital; exposto = ultimoDegrau - reserva; } // sobe por degrau
      else exposto = e.capital - reserva - excedente * 0.5;                        // C: 50% do lucro vai p/ fundo de desbloqueio (ocioso)
      exposto = Math.max(0, Math.min(exposto, e.capital - reserva));
      const ocioso = e.capital - reserva - exposto;
      exposicaoAcum += exposto; ocioAcum += Math.max(0, ocioso); maxExposicao = Math.max(maxExposicao, exposto); n++;
    }
    const utilMedia = n ? exposicaoAcum / n : 0;
    const ocioMedio = n ? ocioAcum / n : 0;
    const base = capital * (1 - L.RESERVA);
    return { utilizacaoMediaUSD: L.r2(utilMedia), utilizacaoMediaPct: L.r2(base ? (utilMedia / (capital)) * 100 : 0), capitalOciosoMedioUSD: L.r2(ocioMedio), exposicaoMaxUSD: L.r2(maxExposicao) };
  }

  const politicas = {
    A: { nome: 'Reinvestimento contínuo', descricao: 'Todo lucro líquido aumenta imediatamente a base operacional, respeitando reserva/limites/ordem mínima.', ...perfil('A') },
    B: { nome: 'Reinvestimento por degraus', descricao: 'A base operacional só sobe ao atingir um degrau economicamente útil (min notional, 2ª posição, novo motor, nova exchange).', ...perfil('B') },
    C: { nome: 'Fundo de desbloqueio', descricao: 'Parte do lucro fica em reserva interna até atingir o capital mínimo de um novo módulo. Todo o dinheiro permanece no Snowball.', ...perfil('C') },
  };

  // como 100% do lucro permanece, capital final e tempo-para-nível são IGUAIS entre políticas.
  const mdd = L.maxDrawdown(capSeries);
  const out = {
    schema: 'snowball.reinvestment-policies.v1', geradoEm: new Date(asOf || 0).toISOString(), asOfMs: asOf,
    invariante: {
      capitalFinal: L.r4(capital), tempoParaNivelIdenticoEntrePoliticas: true,
      explicacao: 'Com 100% do lucro retido, A/B/C atingem o mesmo capital no mesmo tempo. A escolha NÃO acelera o crescimento — muda apenas exposição/ocioso/risco.',
    },
    metricasComparadas: {
      crescimentoCapital: 'idêntico entre políticas (100% retido)',
      drawdownObservadoPct: mdd.pct,
      tempoParaDesbloquear: 'idêntico (função do capital total, não da política)',
      utilizacao: { A: politicas.A.utilizacaoMediaPct + '%', B: politicas.B.utilizacaoMediaPct + '%', C: politicas.C.utilizacaoMediaPct + '%' },
      capitalParado: { A: politicas.A.capitalOciosoMedioUSD, B: politicas.B.capitalOciosoMedioUSD, C: politicas.C.capitalOciosoMedioUSD },
      risco: { A: 'maior exposição', B: 'exposição em degraus', C: 'menor exposição / mais buffer' },
      concentracao: 'ver bosses.json (não muda por política de reinvestimento)',
      custo: 'ordens mínimas penalizam capital pequeno igualmente nas 3; B/C podem evitar ordens sub-mínimas ao esperar degrau',
      sobrevivencia: 'C > B > A em piso de segurança (mais capital ocioso = mais buffer)',
    },
    politicas,
    limitacao: 'Sem um modelo de capacidade por oportunidade, NÃO se afirma que qualquer política aumenta o lucro. O landscape mostra oportunidades de EV positivo ESCASSAS (13 na janela) — o crescimento é limitado pela OFERTA de oportunidades, não pela política de reinvestimento. Escolha por risco/utilização, não por promessa de lucro.',
    stress: 'aplicar os cenários de growth-scenarios.json sobre cada política antes de qualquer decisão real.',
    recomendacao: 'Nenhuma política vencedora declarada sem replay cronológico + stress em ≥2 janelas/regimes (Parte 15).',
  };
  const p = L.writeJSON('reinvestment-policies.json', out);
  console.log(JSON.stringify({ saida: p, util: out.metricasComparadas.utilizacao, ocioso: out.metricasComparadas.capitalParado, invariante: out.invariante.tempoParaNivelIdenticoEntrePoliticas }, null, 2));
}
build();
