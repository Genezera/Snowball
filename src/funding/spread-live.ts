/**
 * Motor de spread entre exchanges, rodando 24h.
 *
 * Estrutura: duas pernas de perpétuo do mesmo ativo, em exchanges diferentes.
 * Vendido onde o funding é alto, comprado onde é baixo. Captura a diferença.
 *
 * Vantagem sobre spot+perp: nenhum capital fica parado. As duas pernas são
 * margem, então o capital inteiro sustenta notional — e funciona em BTC e DOGE
 * em vez de altcoin obscura.
 *
 * O risco desta estrutura NÃO é de preço. As duas pernas se cancelam. O risco
 * é de DESBALANCEAMENTO: um movimento forte consome a margem de um lado e
 * sobra no outro, e transferir entre exchanges leva minutos. É por isso que a
 * alavancagem é limitada e o monitoramento é contínuo.
 *
 * NENHUMA ORDEM É ENVIADA. As exchanges são apenas lidas.
 */
import fs from 'node:fs';
import path from 'node:path';
import ccxt from 'ccxt';
import { ROOT } from '../data/store.ts';
import { varrerSpreads, dimensionarSpread, riscoDesbalanceamento, type OportunidadeSpread } from './spread.ts';
import { lerVigilancia } from './ponte.ts';

export interface PosicaoSpread {
  symbol: string;
  exchangeShort: string;
  exchangeLong: string;
  margemShort: number;
  margemLong: number;
  notionalPorPerna: number;
  precoEntrada: number;
  abertaEm: number;
  spreadNaEntrada: number;
  fundingAcumulado: number;
  pagamentos: number;
}

export interface EstadoSpread {
  iniciadoEm: number;
  capital: number;
  capitalInicial: number;
  posicao: PosicaoSpread | null;
  fundingTotal: number;
  custosTotal: number;
  pagamentos: number;
  transferencias: number;
  trocas: number;
  reinvestimentos: number;
  caixaOcioso: number;
  ultimoCicloTs: number;
  semanas: { inicio: number; lucro: number }[];
  /** de onde veio a informação no último ciclo, para não repetir o log */
  fonteAnterior?: string;
}

export interface OpcoesSpread {
  capital: number;
  alavancagem: number;
  taxaPerp: number;
  /** spread mínimo para manter a posição aberta */
  spreadMinimo: number;
  /** dias mínimos antes de considerar troca */
  diasMinimos: number;
  /** fração da margem que dispara transferência entre exchanges */
  gatilhoTransferencia: number;
}

export const OPCOES_PADRAO: OpcoesSpread = {
  capital: 100,
  alavancagem: 3,
  taxaPerp: 0.0005,
  spreadMinimo: 0.00002,
  diasMinimos: 3,
  gatilhoTransferencia: 0.5,
};

export class MotorSpread {
  private o: OpcoesSpread;
  private estado: EstadoSpread;
  private stateFile: string;
  private journalFile: string;
  private exs = new Map<string, any>();

  constructor(o: Partial<OpcoesSpread> = {}) {
    this.o = { ...OPCOES_PADRAO, ...o };
    const dir = path.join(ROOT, 'spread');
    fs.mkdirSync(dir, { recursive: true });
    this.stateFile = path.join(dir, 'estado.json');
    this.journalFile = path.join(dir, 'diario.jsonl');
    this.estado = this.carregar();
  }

  private carregar(): EstadoSpread {
    if (fs.existsSync(this.stateFile)) {
      const s = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as EstadoSpread;
      this.log(`estado recuperado: US$ ${s.capital.toFixed(2)} · ${s.pagamentos} pagamentos · ${s.posicao?.symbol ?? 'sem posição'}`);
      return s;
    }
    return {
      iniciadoEm: Date.now(), capital: this.o.capital, capitalInicial: this.o.capital,
      posicao: null, fundingTotal: 0, custosTotal: 0, pagamentos: 0,
      transferencias: 0, trocas: 0, reinvestimentos: 0, caixaOcioso: 0,
      ultimoCicloTs: 0, semanas: [{ inicio: Date.now(), lucro: 0 }],
    };
  }

  private salvar() { fs.writeFileSync(this.stateFile, JSON.stringify(this.estado, null, 2)); }
  private diario(evento: string, dados: Record<string, unknown>) {
    fs.appendFileSync(this.journalFile, JSON.stringify({ ts: Date.now(), evento, ...dados }) + '\n');
  }
  private log(m: string) { console.log(`[${new Date().toISOString().slice(0, 19)}] ${m}`); }

  private async ex(id: string) {
    if (!this.exs.has(id)) {
      const e = new (ccxt as any)[id]({ enableRateLimit: true });
      await e.loadMarkets();
      this.exs.set(id, e);
    }
    return this.exs.get(id);
  }

  async init() {
    const d = dimensionarSpread(this.estado.capital, this.o.alavancagem, this.o.taxaPerp);
    const r = riscoDesbalanceamento(this.o.alavancagem);
    this.log(
      `motor pronto · margem US$ ${d.margemPorPerna.toFixed(2)}/perna · ` +
      `notional US$ ${d.notionalPorPerna.toFixed(2)}/perna · ${this.o.alavancagem}x`,
    );
    this.log(`desbalanceia com movimento de ${(r.variacaoQueDesbalanceia * 100).toFixed(1)}%`);
    if (!fs.existsSync(this.journalFile)) this.diario('init', { capital: this.estado.capital, opcoes: this.o });
  }

  private async preco(exId: string, sym: string): Promise<number> {
    const e = await this.ex(exId);
    const t = await e.fetchTicker(sym);
    return t.last ?? t.close;
  }

  async ciclo() {
    // ── de onde vem a informação ────────────────────────────────────────
    //
    // A vigilância enxerga 3.492 pares do mercado inteiro e conhece o
    // histórico de cada oportunidade. A varredura própria do motor vê 32
    // ativos escolhidos à mão e só o instante. Sempre que a vigilância estiver
    // viva, ela manda — foi ela que encontrou KAITO a 36,2% enquanto o motor
    // operava SEI a 19,5% sem ter como saber.
    //
    // Quando a vigilância morre, o motor NÃO cai para o dado velho dela — cai
    // para a própria varredura, que é estreita mas fresca. Decidir com
    // informação de meia hora atrás é pior que decidir com informação limitada.
    const v = lerVigilancia(3);
    let ops: OportunidadeSpread[];
    let fonte: string;

    if (v.disponivel && v.oportunidades.length) {
      ops = v.oportunidades;
      fonte = `vigilância · ${v.varreduras} varreduras · dado de ${v.idadeMinutos.toFixed(0)} min · ${v.oportunidades.length} candidatos`;
    } else {
      ops = await varrerSpreads();
      fonte = v.disponivel
        ? `varredura própria · vigilância viva mas sem candidato firme (${v.motivo})`
        : `varredura própria · ${v.motivo}`;
    }

    if (this.estado.fonteAnterior !== fonte) {
      this.log(`fonte: ${fonte}`);
      this.estado.fonteAnterior = fonte;
    }
    if (!ops.length) { this.log('nenhuma oportunidade agora'); return; }

    // ── sem posição: abre na melhor ─────────────────────────────────────
    if (!this.estado.posicao) {
      const melhor = ops[0];
      if (melhor.spread < this.o.spreadMinimo) {
        this.log(`melhor spread ${(melhor.spread * 100).toFixed(4)}% abaixo do mínimo — aguardando`);
        return;
      }
      const d = dimensionarSpread(this.estado.capital, this.o.alavancagem, this.o.taxaPerp);
      const p = await this.preco(melhor.exchangeShort, melhor.symbol);

      this.estado.posicao = {
        symbol: melhor.symbol,
        exchangeShort: melhor.exchangeShort, exchangeLong: melhor.exchangeLong,
        margemShort: d.margemPorPerna, margemLong: d.margemPorPerna,
        notionalPorPerna: d.notionalPorPerna, precoEntrada: p,
        abertaEm: Date.now(), spreadNaEntrada: melhor.spread,
        fundingAcumulado: 0, pagamentos: 0,
      };
      this.estado.capital -= d.custoMontagem;
      this.estado.custosTotal += d.custoMontagem;

      this.log(
        `ABRE ${melhor.symbol.replace('/USDT:USDT', '')} · vendido ${melhor.exchangeShort} / comprado ${melhor.exchangeLong} · ` +
        `spread médio ${(melhor.spread * 100).toFixed(4)}% (${(melhor.aprSpread * 100).toFixed(1)}% APR) · ` +
        `consistência ${(melhor.consistencia * 100).toFixed(0)}% · ` +
        `notional US$ ${d.notionalPorPerna.toFixed(2)}/perna · custo US$ ${d.custoMontagem.toFixed(3)}`,
      );
      this.diario('abre', {
        symbol: melhor.symbol, short: melhor.exchangeShort, long: melhor.exchangeLong,
        spread: melhor.spread, spreadInstantaneo: melhor.spreadInstantaneo,
        consistencia: melhor.consistencia, apr: melhor.aprSpread,
        notional: d.notionalPorPerna, custo: d.custoMontagem, preco: p,
      });
      this.salvar();
      return;
    }

    // ── com posição ─────────────────────────────────────────────────────
    const pos = this.estado.posicao;
    const atual = ops.find((o) => o.symbol === pos.symbol);
    const precoAtual = await this.preco(pos.exchangeShort, pos.symbol);
    const variacao = precoAtual / pos.precoEntrada - 1;

    // O ativo SUMIU da varredura — significa que o spread inverteu (a varredura
    // só devolve spreads positivos). Sem este bloco o motor ficaria preso numa
    // posição perdedora para sempre: não coletaria funding (porque `atual` é
    // undefined) e nunca avaliaria a troca (mesma razão).
    //
    // Quando o spread inverte, quem estava recebendo passa a PAGAR. Fechar é
    // urgente e não deve esperar os dias mínimos.
    if (!atual) {
      const custoSaida = pos.notionalPorPerna * this.o.taxaPerp * 2;
      this.estado.capital -= custoSaida;
      this.estado.custosTotal += custoSaida;
      this.estado.trocas++;
      this.log(
        `FECHA ${pos.symbol.replace('/USDT:USDT', '')} — spread INVERTEU (sumiu da varredura) · ` +
        `custo US$ ${custoSaida.toFixed(3)} · funding acumulado US$ ${pos.fundingAcumulado.toFixed(3)}`,
      );
      this.diario('fecha', {
        symbol: pos.symbol, motivo: 'spread invertido',
        custo: custoSaida, fundingAcumulado: pos.fundingAcumulado, capital: this.estado.capital,
      });
      this.estado.posicao = null;
      this.salvar();
      return;
    }

    // coleta funding — 3 vezes ao dia, nas horas 0, 8 e 16 UTC
    const agora = Date.now();
    const horasDesdeUltimo = (agora - this.estado.ultimoCicloTs) / 3_600_000;
    // Tolerância de 15 minutos: o ciclo roda a cada 20 min, então exigir 8h
    // exatas faria o pagamento escorregar para o ciclo seguinte e acumular
    // atraso ao longo de semanas.
    if (this.estado.ultimoCicloTs === 0 || horasDesdeUltimo >= 7.75) {
      const ganho = pos.notionalPorPerna * atual.spread;
      pos.fundingAcumulado += ganho;
      pos.pagamentos++;
      this.estado.capital += ganho;
      this.estado.fundingTotal += ganho;
      this.estado.caixaOcioso += ganho;
      this.estado.pagamentos++;
      this.estado.ultimoCicloTs = agora;
      this.log(`funding spread ${(atual.spread * 100).toFixed(4)}% → US$ ${ganho.toFixed(4)} · capital US$ ${this.estado.capital.toFixed(2)}`);
      this.diario('funding', { symbol: pos.symbol, spread: atual.spread, ganho, capital: this.estado.capital });
    }

    // desbalanceamento: o movimento consome margem de um lado
    const perdaShort = pos.notionalPorPerna * variacao;
    const margemShortRestante = pos.margemShort - perdaShort;
    const fracao = margemShortRestante / pos.margemShort;
    if (fracao < this.o.gatilhoTransferencia || fracao > 2 - this.o.gatilhoTransferencia) {
      const transferir = Math.abs(perdaShort) / 2;
      const custo = transferir * 0.0005;
      this.estado.capital -= custo;
      this.estado.custosTotal += custo;
      this.estado.transferencias++;
      pos.margemShort = pos.margemShort - perdaShort + transferir;
      pos.margemLong = pos.margemLong + perdaShort - transferir;
      pos.precoEntrada = precoAtual;
      this.log(
        `TRANSFERE margem US$ ${transferir.toFixed(2)} entre exchanges · ` +
        `preço ${(variacao * 100).toFixed(1)}% desde a entrada · custo US$ ${custo.toFixed(4)}`,
      );
      this.diario('transfere', { symbol: pos.symbol, transferido: transferir, variacao, custo });
    }

    // composição: o lucro vira notional novo
    if (this.estado.caixaOcioso > 0) {
      const extra = dimensionarSpread(this.estado.caixaOcioso, this.o.alavancagem, this.o.taxaPerp);
      const ganhoDia = extra.notionalPorPerna * atual.spread * 3;
      const diasPagar = ganhoDia > 0 ? extra.custoMontagem / ganhoDia : Infinity;
      if (diasPagar <= 3) {
        pos.notionalPorPerna += extra.notionalPorPerna;
        pos.margemShort += extra.margemPorPerna;
        pos.margemLong += extra.margemPorPerna;
        this.estado.capital -= extra.custoMontagem;
        this.estado.custosTotal += extra.custoMontagem;
        this.estado.caixaOcioso = 0;
        this.estado.reinvestimentos++;
        this.log(
          `REINVESTE +US$ ${extra.notionalPorPerna.toFixed(3)}/perna · ` +
          `notional agora US$ ${pos.notionalPorPerna.toFixed(2)} · se paga em ${diasPagar.toFixed(1)} dias`,
        );
        this.diario('reinveste', { notionalExtra: extra.notionalPorPerna, notionalNovo: pos.notionalPorPerna, custo: extra.custoMontagem });
      }
    }

    // troca de ativo quando outro spread compensa
    const dias = (Date.now() - pos.abertaEm) / 86_400_000;
    const melhorOutro = ops.find((o) => o.symbol !== pos.symbol);
    if (dias >= this.o.diasMinimos && atual && melhorOutro) {
      const custoTroca = pos.notionalPorPerna * this.o.taxaPerp * 4;
      const ganhoExtraDia = (melhorOutro.spread - atual.spread) * pos.notionalPorPerna * 3;
      const diasPagar = ganhoExtraDia > 0 ? custoTroca / ganhoExtraDia : Infinity;
      const spreadMorreu = atual.spread < this.o.spreadMinimo;

      if (spreadMorreu || diasPagar < 7) {
        this.estado.capital -= custoTroca / 2;
        this.estado.custosTotal += custoTroca / 2;
        this.estado.trocas++;
        this.log(
          `FECHA ${pos.symbol.replace('/USDT:USDT', '')} — ` +
          (spreadMorreu ? `spread caiu para ${(atual.spread * 100).toFixed(4)}%` : `troca se paga em ${diasPagar.toFixed(1)} dias`),
        );
        this.diario('fecha', { symbol: pos.symbol, motivo: spreadMorreu ? 'spread morreu' : 'troca vantajosa', fundingAcumulado: pos.fundingAcumulado });
        this.estado.posicao = null;
      }
    }

    // fecha a semana
    const sem = this.estado.semanas[this.estado.semanas.length - 1];
    if (Date.now() - sem.inicio >= 7 * 86_400_000) {
      const jaContado = this.estado.semanas.reduce((x, w) => x + w.lucro, 0);
      sem.lucro = this.estado.capital - this.estado.capitalInicial - jaContado;
      this.estado.semanas.push({ inicio: Date.now(), lucro: 0 });
      this.log(`=== semana fechada: ${sem.lucro >= 0 ? '+' : ''}US$ ${sem.lucro.toFixed(3)} ===`);
      this.diario('semana', { lucro: sem.lucro, capital: this.estado.capital });
    }

    this.salvar();
  }

  status(): string {
    const e = this.estado;
    const dias = (Date.now() - e.iniciadoEm) / 86_400_000;
    const lucro = e.capital - e.capitalInicial;
    const fechadas = e.semanas.filter((w) => w.lucro !== 0);
    const pos = fechadas.filter((w) => w.lucro > 0).length;
    return (
      `dia ${dias.toFixed(1)} · US$ ${e.capital.toFixed(2)} (${lucro >= 0 ? '+' : ''}${lucro.toFixed(3)}) · ` +
      `${e.pagamentos} pag · ${e.reinvestimentos} reinv · ${e.transferencias} transf · ${e.trocas} trocas` +
      (fechadas.length ? ` · semanas + ${pos}/${fechadas.length}` : '') +
      (e.posicao ? ` · ${e.posicao.symbol.replace('/USDT:USDT', '')} US$ ${e.posicao.notionalPorPerna.toFixed(0)}/perna` : ' · sem posição')
    );
  }

  getEstado() { return { ...this.estado }; }
}
