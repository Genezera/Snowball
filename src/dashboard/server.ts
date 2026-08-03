/**
 * Dashboard do motor de spread.
 *
 * Serve uma página local que lê o estado e o diário em tempo real. Sem
 * dependência externa: os gráficos são SVG gerados em JavaScript puro, para
 * funcionar offline e não depender de CDN.
 *
 * O que ele mostra, e por quê:
 *
 *   · POSIÇÃO ATUAL — o que está montado, onde, e com que tamanho
 *   · DECISÕES — cada abertura, fechamento, transferência e reinvestimento,
 *     com o motivo. É o log de raciocínio do motor, não só o resultado.
 *   · CURVA DE CAPITAL — o que interessa no fim
 *   · PAGAMENTOS — cada funding recebido, para ver a frequência
 *   · VARREDURA — o ranking ao vivo dos spreads, com consistência
 *
 * A varredura roda no servidor a cada 10 minutos e é cacheada, para a página
 * poder atualizar de segundo em segundo sem martelar as exchanges.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../data/store.ts';
import { varrerSpreads, type OportunidadeSpread } from '../funding/spread.ts';
import { lerVigilancia, saudeVigilancia } from '../funding/ponte.ts';
import { avaliarValor } from '../funding/valor.ts';
import { posicoesSustentaveis, taxaEfetiva } from '../funding/custos-reais.ts';
import { PAGINA } from './pagina.ts';

const PORTA = Number(process.env.PORTA ?? 8787);
const DIR = path.join(ROOT, 'spread');

/**
 * A varredura roda em BACKGROUND, nunca no caminho da requisição.
 *
 * A primeira versão chamava `varrerSpreads()` dentro do handler. Como a
 * varredura consulta 10 exchanges e 32 ativos com histórico, ela leva minutos —
 * e travava o carregamento da página inteira. A API dava timeout enquanto o
 * HTML servia normalmente, o que é o pior dos dois mundos.
 *
 * Agora a página responde na hora com o que houver em cache (vazio no primeiro
 * minuto), e a varredura se atualiza sozinha em paralelo.
 */
let cacheVarredura: { ts: number; dados: OportunidadeSpread[]; rodando: boolean } =
  { ts: 0, dados: [], rodando: false };

async function atualizarVarredura() {
  if (cacheVarredura.rodando) return;
  // Se a vigilância está viva, esta varredura é redundante — e cara: carrega os
  // mercados de 10 exchanges só para produzir uma segunda opinião que a página
  // nem mostra. Ela existe apenas como rede de segurança para quando a
  // vigilância cair.
  if (saudeVigilancia().viva) return;
  cacheVarredura.rodando = true;
  try {
    const dados = await varrerSpreads();
    cacheVarredura = { ts: Date.now(), dados, rodando: false };
    console.log(`[${new Date().toISOString().slice(11, 19)}] varredura atualizada: ${dados.length} oportunidades`);
  } catch (e) {
    cacheVarredura.rodando = false;
    console.log(`[varredura] falhou: ${(e as Error).message.slice(0, 60)}`);
  }
}

function lerEstado() {
  const p = path.join(DIR, 'estado.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

function lerDiario(limite = 400) {
  const p = path.join(DIR, 'diario.jsonl');
  if (!fs.existsSync(p)) return [];
  const linhas = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
  return linhas.slice(-limite).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/**
 * Monta o retrato completo do sistema. Usado tanto pela rota REST quanto pelo
 * stream — uma função só, para que os dois nunca divirjam.
 */
function retrato() {
  return montarDados();
}

/**
 * Streaming de verdade, em vez de a página perguntar de 5 em 5 segundos.
 *
 * O motor escreve `spread/estado.json` quando decide, a vigilância escreve
 * `vigilancia/ciclos.json` quando varre, a custódia escreve o dela. Observando
 * os três arquivos, o painel recebe o evento no instante em que ele acontece —
 * não até 5 segundos depois.
 *
 * O heartbeat de 10 s existe por dois motivos: mantém a conexão viva contra
 * proxies que matam conexão ociosa, e atualiza os campos que dependem do tempo
 * (idade do dado, horas de vida de cada par) mesmo quando nada mudou em disco.
 */
const clientes = new Set<http.ServerResponse>();

function transmitir() {
  if (!clientes.size) return;
  const payload = `data: ${JSON.stringify(retrato())}\n\n`;
  for (const c of clientes) {
    try { c.write(payload); } catch { clientes.delete(c); }
  }
}

function observar(arquivo: string) {
  try {
    if (!fs.existsSync(arquivo)) return;
    // `fs.watch` dispara várias vezes por gravação em alguns sistemas de
    // arquivos do Windows. O debounce evita mandar cinco eventos idênticos.
    let pendente: NodeJS.Timeout | null = null;
    fs.watch(arquivo, () => {
      if (pendente) clearTimeout(pendente);
      pendente = setTimeout(() => { pendente = null; transmitir(); }, 250);
    });
  } catch { /* arquivo ainda não existe; o heartbeat cobre */ }
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORTA}`);

  if (url.pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(retrato())}\n\n`);
    clientes.add(res);
    req.on('close', () => clientes.delete(res));
    return;
  }

  if (url.pathname === '/api/dados') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(retrato()));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(PAGINA);
});

function montarDados() {
    const estado = lerEstado();
    const diario = lerDiario();
    // Mesma regra do motor: o ranking da vigilância manda, a varredura própria
    // é só rede de segurança. Assim o painel mostra exatamente o que o motor
    // está vendo, em vez de uma segunda opinião que confundiria.
    const vig = lerVigilancia(3);
    const saudeVig = saudeVigilancia();
    // exposição por exchange — a métrica de concentração, que só existe agora
    // que o motor opera várias posições
    const abertas: any[] = estado?.posicoes ?? (estado?.posicao ? [estado.posicao] : []);
    const exposicao: Record<string, number> = {};
    for (const p of abertas) {
      exposicao[p.exchangeShort] = (exposicao[p.exchangeShort] ?? 0) + p.margemShort;
      exposicao[p.exchangeLong] = (exposicao[p.exchangeLong] ?? 0) + p.margemLong;
    }
    let concentracao = { exchange: '—', fracao: 0 };
    for (const [id, v] of Object.entries(exposicao)) {
      const fr = v / Math.max(1e-9, estado?.capital ?? 1);
      if (fr > concentracao.fracao) concentracao = { exchange: id, fracao: fr };
    }

    const usandoVigilancia = vig.disponivel && vig.oportunidades.length > 0;
    const scanBruto = usandoVigilancia ? vig.oportunidades : cacheVarredura.dados;

    // O painel precisa mostrar o VEREDICTO do portão, não só o spread. Sem
    // isso, a tabela lista candidatas que o motor jamais vai montar como se
    // fossem oportunidades — que é como ela ficou depois do portão entrar.
    const capital = estado?.capital ?? 100;
    const alavancagem = 5, margemPayback = 1.5;
    const sust = posicoesSustentaveis(capital, alavancagem, 0.12, 0.01, 3);
    const notionalPorPerna = (sust.capitalPorPosicao / 2) * alavancagem;
    const scan = scanBruto.map((o) => {
      const taxa = taxaEfetiva(o.exchangeShort, o.exchangeLong);
      const v = avaliarValor({
        spread: o.spread, consistencia: o.consistencia,
        duracaoHoras: o.duracaoHoras ?? 0, notional: notionalPorPerna, taxa,
      });
      return {
        ...o,
        paybackHoras: v.paybackHoras,
        vidaEsperadaHoras: v.vidaEsperadaHoras,
        valorEsperado: v.valorEsperado,
        pctDoCaminho: Math.min(100, (v.folga / margemPayback) * 100),
        passaPortao: v.folga >= margemPayback,
      };
    });

    // série de capital ao longo do tempo, montada a partir do diário
    const curva: { ts: number; capital: number }[] = [];
    for (const e of diario) {
      if (e.capital != null) curva.push({ ts: e.ts, capital: e.capital });
    }

    // agrupa pagamentos por dia, para o gráfico de barras
    const porDia = new Map<string, number>();
    for (const e of diario) {
      if (e.evento !== 'funding') continue;
      const d = new Date(e.ts).toISOString().slice(0, 10);
      porDia.set(d, (porDia.get(d) ?? 0) + (e.ganho ?? 0));
    }

    // ── saldos por exchange: margem em uso, reserva livre ──────────────────
    //
    // É a visão que o modelo novo pede. "Capital total" não diz nada quando o
    // dinheiro está em contas que não se comunicam.
    const saldos: Record<string, number> = estado?.saldos ?? {};
    const contas = Object.entries(saldos).map(([ex, saldo]) => {
      const usada = exposicao[ex] ?? 0;
      return {
        exchange: ex, saldo, margemUsada: usada,
        livre: Math.max(0, saldo - usada),
        fracaoUsada: saldo > 0 ? usada / saldo : 0,
        alvoReserva: saldo * reservaConfig,
      };
    });

    // ── equilíbrio de direção: quanto cada exchange drena numa alta ─────────
    const dreno: Record<string, number> = {};
    for (const p of abertas) {
      dreno[p.exchangeShort] = (dreno[p.exchangeShort] ?? 0) + p.notionalPorPerna;
      dreno[p.exchangeLong] = (dreno[p.exchangeLong] ?? 0) - p.notionalPorPerna;
    }
    const piorDrenoVal = Object.values(dreno).length ? Math.max(...Object.values(dreno).map(Math.abs)) : 0;

    // ── distância até a liquidação, por posição ────────────────────────────
    const posicoes = abertas.map((p) => {
      const mmr = 0.01;
      const dShort = p.margemShort / p.notionalPorPerna - mmr;
      const dLong = p.margemLong / p.notionalPorPerna - mmr;
      const livreShort = Math.max(0, (saldos[p.exchangeShort] ?? 0) - (exposicao[p.exchangeShort] ?? 0));
      const livreLong = Math.max(0, (saldos[p.exchangeLong] ?? 0) - (exposicao[p.exchangeLong] ?? 0));
      return {
        ...p,
        distanciaShort: dShort, distanciaLong: dLong,
        distanciaMinima: Math.min(dShort, dLong),
        pernaEmRisco: dShort <= dLong ? 'short' : 'long',
        // com a reserva desta exchange somada — o fôlego real
        distanciaComReserva: Math.min(
          (p.margemShort + livreShort) / p.notionalPorPerna - mmr,
          (p.margemLong + livreLong) / p.notionalPorPerna - mmr,
        ),
        horasAberta: (Date.now() - p.abertaEm) / 3_600_000,
      };
    });

    return {
      estado, posicoes, contas, diario: diario.slice(-80).reverse(), curva,
      pagamentosPorDia: [...porDia].map(([dia, total]) => ({ dia, total })),
      scan: scan.slice(0, 15),
      atualizadoEm: Date.now(),
      idadeVarreduraMin: usandoVigilancia
        ? Math.round(vig.idadeMinutos)
        : (cacheVarredura.ts ? Math.round((Date.now() - cacheVarredura.ts) / 60000) : -1),
      varrendo: cacheVarredura.rodando,
      exposicao, concentracao, dreno, piorDreno: piorDrenoVal, tetoPorExchange: 0.40,
      config: { alavancagem, reserva: reservaConfig, margemPayback, maxPosicoes: 3, tetoPorExchange: 0.40 },
      custodia: lerCustodia(),
      vigilancia: {
        ...saudeVig,
        fonte: usandoVigilancia ? 'vigilância · mercado inteiro' : 'varredura própria · 32 ativos',
        motivo: vig.motivo,
        candidatos: vig.oportunidades.length,
      },
    };
}

const reservaConfig = 0.30;

function lerCustodia() {
  try {
    const p = path.join(ROOT, 'vigilancia', 'custodia.json');
    if (!fs.existsSync(p)) return { verificadoEm: 0, saude: {} };
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return { verificadoEm: 0, saude: {} }; }
}

servidor.listen(PORTA, () => {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`DASHBOARD NO AR`);
  console.log(`${'='.repeat(70)}\n`);
  console.log(`  Abra no navegador:  http://localhost:${PORTA}\n`);
  console.log(`  Atualização em TEMPO REAL: a página recebe um evento no instante`);
  console.log(`  em que o motor, a vigilância ou a custódia gravam em disco.\n`);

  observar(path.join(DIR, 'estado.json'));
  observar(path.join(ROOT, 'vigilancia', 'ciclos.json'));
  observar(path.join(ROOT, 'vigilancia', 'custodia.json'));
  // heartbeat: mantém a conexão viva e atualiza os campos que dependem do
  // relógio (idade do dado, horas de vida) mesmo sem mudança em disco
  setInterval(transmitir, 10_000);

  void atualizarVarredura();
  setInterval(() => void atualizarVarredura(), 10 * 60_000);
});
