/**
 * Executor delta-neutro 24h.
 *
 * Roda continuamente: monitora funding, mantém a posição neutra, coleta o
 * pagamento a cada 8 horas, rebalanceia a margem quando o preço se move, e
 * troca de ativo quando o funding atual deixa de compensar.
 *
 * NENHUMA ORDEM É ENVIADA. Este arquivo não importa nada capaz de assinar
 * requisição autenticada — a exchange é usada apenas para leitura de preço e
 * de funding.
 *
 * A disciplina de medição é a mesma do resto do projeto: tudo vai para um
 * diário append-only, e o preço de referência é gravado junto do preço de
 * execução simulado, para que a diferença possa ser medida depois.
 */
import fs from 'node:fs';
import path from 'node:path';
import ccxt from 'ccxt';
import { ROOT } from '../data/store.ts';
import {
  abrir, aplicarFunding, saude, rebalancearMargem, fechar, valeTrocar,
  dimensionar, CONFIG_PADRAO, type ConfigMotor, type Posicao,
} from './engine.ts';
import { valeReinvestir } from './compound.ts';

export interface EstadoRenda {
  iniciadoEm: number;
  capital: number;
  capitalInicial: number;
  posicao: Posicao | null;
  fundingRecebidoTotal: number;
  custosTotal: number;
  pagamentos: number;
  rebalanceamentos: number;
  trocas: number;
  ultimoFundingTs: number;
  /** lucro por semana, para provar a renda semanal */
  semanas: { inicio: number; lucro: number }[];
  /** funding recebido ainda não convertido em notional novo */
  caixaOcioso: number;
  reinvestimentos: number;
}

export interface OpcoesRenda {
  candidatos: string[];
  capital: number;
  cfg?: ConfigMotor;
  intervaloMs?: number;
  stateFile?: string;
  journalFile?: string;
}

export class MotorRenda {
  private ex: any;
  private o: OpcoesRenda;
  private cfg: ConfigMotor;
  private estado: EstadoRenda;
  private stateFile: string;
  private journalFile: string;

  constructor(o: OpcoesRenda) {
    this.o = o;
    this.cfg = o.cfg ?? CONFIG_PADRAO;
    const dir = path.join(ROOT, 'renda');
    fs.mkdirSync(dir, { recursive: true });
    this.stateFile = o.stateFile ?? path.join(dir, 'estado.json');
    this.journalFile = o.journalFile ?? path.join(dir, 'diario.jsonl');
    this.estado = this.carregar();
  }

  private carregar(): EstadoRenda {
    if (fs.existsSync(this.stateFile)) {
      const s = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as EstadoRenda;
      this.log(`estado recuperado: US$ ${s.capital.toFixed(2)} · ${s.pagamentos} pagamentos · posição ${s.posicao?.symbol ?? 'nenhuma'}`);
      return s;
    }
    return {
      iniciadoEm: Date.now(), capital: this.o.capital, capitalInicial: this.o.capital,
      posicao: null, fundingRecebidoTotal: 0, custosTotal: 0,
      pagamentos: 0, rebalanceamentos: 0, trocas: 0, ultimoFundingTs: 0,
      semanas: [{ inicio: Date.now(), lucro: 0 }],
      caixaOcioso: 0, reinvestimentos: 0,
    };
  }

  private salvar() { fs.writeFileSync(this.stateFile, JSON.stringify(this.estado, null, 2)); }
  private diario(evento: string, dados: Record<string, unknown>) {
    fs.appendFileSync(this.journalFile, JSON.stringify({ ts: Date.now(), evento, ...dados }) + '\n');
  }
  private log(m: string) { console.log(`[${new Date().toISOString().slice(0, 19)}] ${m}`); }

  async init() {
    this.ex = new (ccxt as any).binanceusdm({ enableRateLimit: true });
    await this.ex.loadMarkets();
    const d = dimensionar(this.estado.capital, this.cfg);
    this.log(
      `motor pronto · spot US$ ${d.spot.toFixed(2)} + margem US$ ${d.margem.toFixed(2)} ` +
      `= notional neutro US$ ${d.notional.toFixed(2)} (${this.cfg.alavancagemShort}x)`,
    );
    if (!fs.existsSync(this.journalFile)) {
      this.diario('init', { capital: this.estado.capital, candidatos: this.o.candidatos, cfg: this.cfg });
    }
  }

  /** Funding médio recente de cada candidato, para escolher e para trocar. */
  private async lerFunding(): Promise<Map<string, { media: number; atual: number; positivos: number }>> {
    const m = new Map<string, { media: number; atual: number; positivos: number }>();
    for (const sym of this.o.candidatos) {
      try {
        const h = await this.ex.fetchFundingRateHistory(sym, Date.now() - 21 * 86_400_000, 100);
        if (h.length < 10) continue;
        const taxas = h.map((f: any) => f.fundingRate as number);
        m.set(sym, {
          media: taxas.reduce((x: number, y: number) => x + y, 0) / taxas.length,
          atual: taxas[taxas.length - 1],
          positivos: taxas.filter((t: number) => t > 0).length / taxas.length,
        });
      } catch { /* segue */ }
    }
    return m;
  }

  private async preco(sym: string): Promise<number> {
    const t = await this.ex.fetchTicker(sym);
    return t.last ?? t.close;
  }

  async ciclo() {
    const fundings = await this.lerFunding();
    if (!fundings.size) { this.log('sem dados de funding neste ciclo'); return; }

    // ── sem posição: abre na melhor oportunidade ─────────────────────────
    if (!this.estado.posicao) {
      const ranking = [...fundings.entries()]
        .filter(([, f]) => f.media > this.cfg.fundingMinimoParaManter && f.positivos >= 0.8)
        .sort((x, y) => y[1].media - x[1].media);
      if (!ranking.length) { this.log('nenhum candidato com funding aceitável agora'); return; }

      const [sym, f] = ranking[0];
      const p = await this.preco(sym);
      const { posicao, custo } = abrir(sym, this.estado.capital, p, this.cfg);
      this.estado.posicao = posicao;
      this.estado.capital -= custo;
      this.estado.custosTotal += custo;

      this.log(
        `ABRE ${sym.replace('/USDT:USDT', '')} @ ${p} · spot US$ ${posicao.spot.toFixed(2)} + ` +
        `short US$ ${posicao.notionalShort.toFixed(2)} · funding médio ${(f.media * 100).toFixed(4)}%/8h · custo US$ ${custo.toFixed(3)}`,
      );
      this.diario('abre', { symbol: sym, preco: p, spot: posicao.spot, notional: posicao.notionalShort, fundingMedio: f.media, custo });
      this.salvar();
      return;
    }

    // ── com posição: coleta funding, cuida da margem, avalia troca ───────
    const pos = this.estado.posicao;
    const precoAtual = await this.preco(pos.symbol);
    const f = fundings.get(pos.symbol);

    // coleta apenas pagamentos novos (a cada 8h)
    try {
      const h = await this.ex.fetchFundingRateHistory(pos.symbol, Math.max(pos.abertaEm, this.estado.ultimoFundingTs), 20);
      for (const item of h) {
        if (item.timestamp <= this.estado.ultimoFundingTs) continue;
        const antes = pos.fundingAcumulado;
        this.estado.posicao = aplicarFunding(this.estado.posicao!, item.fundingRate);
        const ganho = this.estado.posicao.fundingAcumulado - antes;
        this.estado.capital += ganho;
        this.estado.fundingRecebidoTotal += ganho;
        this.estado.pagamentos++;
        this.estado.caixaOcioso += ganho;
        this.estado.ultimoFundingTs = item.timestamp;
        this.log(`funding ${(item.fundingRate * 100).toFixed(4)}% → US$ ${ganho.toFixed(4)} · capital US$ ${this.estado.capital.toFixed(2)}`);
        this.diario('funding', { symbol: pos.symbol, taxa: item.fundingRate, ganho, capital: this.estado.capital });
      }
    } catch { /* segue */ }

    // ── COMPOSIÇÃO: o lucro vira notional novo ──────────────────────────
    // Só reinveste quando o acréscimo se paga rápido. Reinvestir a cada
    // pagamento gastaria mais em taxa do que o pagamento vale.
    if (f && this.estado.caixaOcioso > 0) {
      const v = valeReinvestir(this.estado.caixaOcioso, f.media, this.cfg);
      if (v.reinvestir) {
        this.estado.posicao = {
          ...this.estado.posicao!,
          spot: this.estado.posicao!.spot + v.notionalExtra,
          notionalShort: this.estado.posicao!.notionalShort + v.notionalExtra,
        };
        this.estado.capital -= v.custo;
        this.estado.custosTotal += v.custo;
        this.estado.caixaOcioso = 0;
        this.estado.reinvestimentos++;
        this.log(
          `REINVESTE +US$ ${v.notionalExtra.toFixed(3)} de notional · custo US$ ${v.custo.toFixed(4)} · ` +
          `notional agora US$ ${this.estado.posicao.notionalShort.toFixed(2)}`,
        );
        this.diario('reinveste', {
          notionalExtra: v.notionalExtra, custo: v.custo,
          notionalNovo: this.estado.posicao.notionalShort, diasParaPagar: v.diasParaPagar,
        });
      }
    }

    // saúde da posição: a alta consome a margem da perna vendida
    const s = saude(this.estado.posicao!, precoAtual, this.cfg);
    if (s.precisaRebalancear) {
      const r = rebalancearMargem(this.estado.posicao!, precoAtual, this.cfg);
      if (r.transferido > 0) {
        this.estado.posicao = r.posicao;
        this.estado.capital -= r.custo;
        this.estado.custosTotal += r.custo;
        this.estado.rebalanceamentos++;
        this.log(`REBALANCEIA margem: US$ ${r.transferido.toFixed(2)} · custo US$ ${r.custo.toFixed(4)} · preço ${(s.variacao * 100).toFixed(1)}% desde a entrada`);
        this.diario('rebalanceia', { symbol: pos.symbol, transferido: r.transferido, custo: r.custo, variacao: s.variacao });
      }
    }

    // troca de ativo, se compensar
    const diasAberta = (Date.now() - this.estado.posicao!.abertaEm) / 86_400_000;
    const melhores = [...fundings.entries()]
      .filter(([sym, x]) => sym !== pos.symbol && x.positivos >= 0.8)
      .sort((x, y) => y[1].media - x[1].media);
    if (melhores.length && f) {
      const v = valeTrocar(
        { funding: f.media, diasAberta },
        { funding: melhores[0][1].media },
        this.estado.posicao!.notionalShort, this.cfg,
      );
      if (v.trocar) {
        const fecha = fechar(this.estado.posicao!, precoAtual, this.cfg);
        this.estado.capital -= fecha.custo;
        this.estado.custosTotal += fecha.custo;
        this.estado.trocas++;
        this.log(`FECHA ${pos.symbol.replace('/USDT:USDT', '')} — ${v.motivo} · custo US$ ${fecha.custo.toFixed(3)}`);
        this.diario('fecha', { symbol: pos.symbol, motivo: v.motivo, custo: fecha.custo, fundingAcumulado: this.estado.posicao!.fundingAcumulado });
        this.estado.posicao = null;
      }
    }

    // fecha a semana
    const semanaAtual = this.estado.semanas[this.estado.semanas.length - 1];
    if (Date.now() - semanaAtual.inicio >= 7 * 86_400_000) {
      const lucroSemana = this.estado.capital - this.estado.capitalInicial -
        this.estado.semanas.reduce((x, w) => x + w.lucro, 0);
      semanaAtual.lucro = lucroSemana;
      this.estado.semanas.push({ inicio: Date.now(), lucro: 0 });
      this.log(`=== semana fechada: ${lucroSemana >= 0 ? '+' : ''}US$ ${lucroSemana.toFixed(3)} ===`);
      this.diario('semana', { lucro: lucroSemana, capital: this.estado.capital });
    }

    this.salvar();
  }

  status(): string {
    const e = this.estado;
    const dias = (Date.now() - e.iniciadoEm) / 86_400_000;
    const lucro = e.capital - e.capitalInicial;
    const fechadas = e.semanas.filter((w) => w.lucro !== 0);
    const positivas = fechadas.filter((w) => w.lucro > 0).length;
    return (
      `dia ${dias.toFixed(1)} · capital US$ ${e.capital.toFixed(2)} (${lucro >= 0 ? '+' : ''}${lucro.toFixed(3)}) · ` +
      `${e.pagamentos} pagamentos · ${e.reinvestimentos} reinvest · ${e.rebalanceamentos} rebal · ${e.trocas} trocas` +
      (e.posicao ? ` · notional US$ ${e.posicao.notionalShort.toFixed(2)}` : '') +
      (fechadas.length ? ` · semanas positivas ${positivas}/${fechadas.length}` : '') +
      (e.posicao ? ` · em ${e.posicao.symbol.replace('/USDT:USDT', '')}` : ' · sem posição')
    );
  }

  getEstado() { return { ...this.estado }; }
}
