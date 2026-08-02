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

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORTA}`);

  if (url.pathname === '/api/dados') {
    const estado = lerEstado();
    const diario = lerDiario();
    // Mesma regra do motor: o ranking da vigilância manda, a varredura própria
    // é só rede de segurança. Assim o painel mostra exatamente o que o motor
    // está vendo, em vez de uma segunda opinião que confundiria.
    const vig = lerVigilancia(3);
    const saudeVig = saudeVigilancia();
    const usandoVigilancia = vig.disponivel && vig.oportunidades.length > 0;
    const scan = usandoVigilancia ? vig.oportunidades : cacheVarredura.dados;

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

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      estado, diario: diario.slice(-60).reverse(), curva,
      pagamentosPorDia: [...porDia].map(([dia, total]) => ({ dia, total })),
      scan: scan.slice(0, 15),
      atualizadoEm: Date.now(),
      idadeVarreduraMin: usandoVigilancia
        ? Math.round(vig.idadeMinutos)
        : (cacheVarredura.ts ? Math.round((Date.now() - cacheVarredura.ts) / 60000) : -1),
      varrendo: cacheVarredura.rodando,
      vigilancia: {
        ...saudeVig,
        fonte: usandoVigilancia ? 'vigilância · mercado inteiro' : 'varredura própria · 32 ativos',
        motivo: vig.motivo,
        candidatos: vig.oportunidades.length,
      },
    }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(PAGINA);
});

servidor.listen(PORTA, () => {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`DASHBOARD NO AR`);
  console.log(`${'='.repeat(70)}\n`);
  console.log(`  Abra no navegador:  http://localhost:${PORTA}\n`);
  console.log(`  A página atualiza sozinha a cada 5 segundos.`);
  console.log(`  A vigilância é a fonte. A varredura própria só roda se ela cair.\n`);
  // dispara a primeira varredura sem bloquear ninguém
  void atualizarVarredura();
  setInterval(() => void atualizarVarredura(), 10 * 60_000);
});
