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
import { avaliarRisco, quantoTransferir, mmrDe, atualizarPico, verificarPiso, LIMIARES_PADRAO, MMR_ALT } from './protecao.ts';
import { posicoesSustentaveis, custoTransferencia, taxaDaOperacao } from './custos-reais.ts';
import { lerSaude, podeOperar, pontuacaoAjustada } from './custodia.ts';
import { avaliarValor, chaveOrdenacao } from './valor.ts';

export interface PosicaoSpread {
  symbol: string;
  exchangeShort: string;
  exchangeLong: string;
  margemShort: number;
  margemLong: number;
  notionalPorPerna: number;
  precoEntrada: number;
  /**
   * Preço lido no ciclo anterior — a base da contabilidade incremental de
   * margem. Diferente de `precoEntrada`, que é histórico e nunca muda.
   */
  precoUltimo?: number;
  abertaEm: number;
  /** último funding coletado NESTA posição — global quebraria com várias */
  ultimoFundingTs?: number;
  /** ciclos seguidos em que o par não apareceu no ranking */
  faltasSeguidas?: number;
  spreadNaEntrada: number;
  fundingAcumulado: number;
  pagamentos: number;
}

export interface EstadoSpread {
  iniciadoEm: number;
  capital: number;
  capitalInicial: number;
  /** legado de quando o motor operava uma posição só; migrado em `carregar()` */
  posicao?: PosicaoSpread | null;
  /** posições simultâneas, em pares de exchanges distintos */
  posicoes?: PosicaoSpread[];
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
  /** maior capital já alcançado — base da catraca do piso móvel */
  pico?: number;
  /** true depois que o piso foi tocado: o motor não abre mais posição */
  parado?: boolean;
  /** quantas vezes fechou por proximidade de liquidação */
  fechamentosEmergencia?: number;
  /** último limite de posições logado, para não repetir a cada ciclo */
  limiteAnterior?: string;
}

export interface OpcoesSpread {
  capital: number;
  alavancagem: number;
  taxaPerp: number;
  /** spread mínimo para manter a posição aberta */
  spreadMinimo: number;
  /** dias mínimos antes de considerar troca */
  diasMinimos: number;
  /** piso absoluto de capital: abaixo disso o motor para de vez */
  pisoAbsoluto: number;
  /** fração do pico que o piso móvel acompanha (catraca) */
  fracaoPico: number;
  /**
   * Margem de segurança no portão de payback.
   *
   * 1,0 exige que o par já tenha vivido exatamente o tempo do próprio payback.
   * 1,5 exige 50% a mais, porque empatar não é o objetivo.
   */
  margemPayback: number;
  /** quantas posições simultâneas, em pares de exchanges distintos */
  maxPosicoes: number;
  /** fração máxima do capital que pode ficar numa única exchange */
  tetoPorExchange: number;
}

export const OPCOES_PADRAO: OpcoesSpread = {
  capital: 100,
  alavancagem: 3,
  taxaPerp: 0.0005,
  spreadMinimo: 0.00002,
  diasMinimos: 3,
  // `gatilhoTransferencia` foi removido: disparava por fração de margem
  // consumida, uma proxy que ignorava a margem de manutenção. Substituído pelos
  // limiares de distância de liquidação em protecao.ts.
  // 80% do capital inicial. Perder 20% numa estrutura que não tem exposição a
  // preço significa que alguma premissa quebrou — não que o mercado andou.
  pisoAbsoluto: 80,
  // aceito devolver 15% do melhor momento antes de parar
  fracaoPico: 0.85,
  margemPayback: 1.5,
  // Três posições é o ponto onde a diluição compensa o custo. Com uma só, 50%
  // do capital fica em cada exchange. Com três e o teto abaixo, a exposição
  // máxima cai para ~33%. Mais que três divide o capital em pedaços pequenos
  // demais para o custo fixo de montagem valer a pena nesta escala.
  maxPosicoes: 3,
  // O teto é o que FORÇA a diluição. Sem ele, três posições poderiam usar as
  // mesmas duas exchanges e a concentração continuaria em 50%.
  tetoPorExchange: 0.40,
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
      // migração do formato de posição única. Descartar o estado antigo seria
      // perder a posição montada; ignorá-lo seria operar duas vezes o mesmo
      // dinheiro. Migrar é a única opção correta.
      if (!s.posicoes) {
        s.posicoes = s.posicao ? [s.posicao] : [];
        delete s.posicao;
      }
      this.log(
        `estado recuperado: US$ ${s.capital.toFixed(2)} · ${s.pagamentos} pagamentos · ` +
        (s.posicoes.length
          ? s.posicoes.map((p) => p.symbol.replace('/USDT:USDT', '')).join(', ')
          : 'sem posição'),
      );
      return s;
    }
    return {
      iniciadoEm: Date.now(), capital: this.o.capital, capitalInicial: this.o.capital,
      posicoes: [], fundingTotal: 0, custosTotal: 0, pagamentos: 0,
      transferencias: 0, trocas: 0, reinvestimentos: 0, caixaOcioso: 0,
      ultimoCicloTs: 0, semanas: [{ inicio: Date.now(), lucro: 0 }],
    };
  }

  private get posicoes(): PosicaoSpread[] {
    if (!this.estado.posicoes) this.estado.posicoes = [];
    return this.estado.posicoes;
  }

  /**
   * Quanto capital está em cada exchange, somando todas as pernas.
   *
   * É a grandeza que o teto controla. Sem medir isto, "três posições" não
   * garante diluição nenhuma: as três poderiam estar nas mesmas duas exchanges.
   */
  private exposicaoPorExchange(): Record<string, number> {
    const e: Record<string, number> = {};
    for (const p of this.posicoes) {
      e[p.exchangeShort] = (e[p.exchangeShort] ?? 0) + p.margemShort;
      e[p.exchangeLong] = (e[p.exchangeLong] ?? 0) + p.margemLong;
    }
    return e;
  }

  /** Fração do capital na exchange mais carregada — a métrica de concentração. */
  private concentracao(): { exchange: string; fracao: number } {
    const e = this.exposicaoPorExchange();
    let pior = { exchange: '—', fracao: 0 };
    for (const [id, v] of Object.entries(e)) {
      const f = v / Math.max(1e-9, this.estado.capital);
      if (f > pior.fracao) pior = { exchange: id, fracao: f };
    }
    return pior;
  }

  private fecharPosicao(pos: PosicaoSpread, motivo: string, rotulo: string) {
    const custoSaida = pos.notionalPorPerna * this.o.taxaPerp * 2;
    this.estado.capital -= custoSaida;
    this.estado.custosTotal += custoSaida;
    this.estado.posicoes = this.posicoes.filter((p) => p !== pos);
    this.log(
      `${rotulo} ${pos.symbol.replace('/USDT:USDT', '')} — ${motivo} · ` +
      `custo US$ ${custoSaida.toFixed(3)} · funding acumulado US$ ${pos.fundingAcumulado.toFixed(3)}`,
    );
    this.diario('fecha', {
      symbol: pos.symbol, motivo, custo: custoSaida,
      fundingAcumulado: pos.fundingAcumulado, capital: this.estado.capital,
    });
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
    // ── piso de capital: a catraca ──────────────────────────────────────
    //
    // Assimétrica de propósito. O piso sobe quando o capital sobe e nunca
    // desce, então travar o lado de baixo não custa nada no lado de cima: o
    // motor segue livre para compor enquanto estiver acima.
    //
    // O gatilho é `parado`, persistido no estado. Uma vez tocado o piso, o
    // motor não volta sozinho — reiniciar o processo não o ressuscita. Isso é
    // deliberado: se ele tocou o piso, alguma premissa quebrou, e a decisão de
    // voltar é humana.
    this.estado.pico = Math.max(this.estado.pico ?? this.estado.capitalInicial, this.estado.capital);
    const pisoEstado = {
      pico: this.estado.pico,
      pisoAbsoluto: this.o.pisoAbsoluto,
      fracaoPico: this.o.fracaoPico,
    };
    const vp = verificarPiso(pisoEstado, this.estado.capital);

    if (this.estado.parado) {
      this.log(`PARADO no piso — ${vp.motivo}. Para retomar, apague 'parado' de spread/estado.json.`);
      return;
    }

    if (vp.parar) {
      this.estado.parado = true;
      // fecha tudo antes de parar: deixar posição montada sem ninguém
      // gerenciando margem é o pior estado possível
      for (const p of [...this.posicoes]) this.fecharPosicao(p, 'piso de capital', 'FECHA');
      this.log(`MOTOR PARADO — ${vp.motivo}`);
      this.diario('piso', { capital: this.estado.capital, piso: vp.piso, pico: this.estado.pico });
      this.salvar();
      return;
    }

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

    // ── risco de custódia ───────────────────────────────────────────────
    //
    // O risco que a estrutura delta-neutra não cobre: metade do capital está em
    // cada exchange, e nenhuma perna protege contra a exchange congelar saque.
    //
    // Duas ações, de peso muito diferente:
    //   BLOQUEAR   exchange com saque suspenso sai do conjunto. Isso remove
    //              oportunidade, e só se justifica porque a alternativa é
    //              mandar dinheiro para dentro de algo que não devolve.
    //   REORDENAR  entre spreads parecidos, prefere exchanges maiores. Não
    //              elimina ninguém — só desempata.
    //
    // `desconhecido` NÃO bloqueia: binance, bybit e okx não expõem o estado do
    // saque sem chave de API, e tratar isso como problema pararia o motor por
    // falta de informação em vez de por presença de risco.
    const saude = lerSaude();
    if (Object.keys(saude).length) {
      const antes = ops.length;
      ops = ops.filter((o) => podeOperar(saude, o.exchangeShort, o.exchangeLong).pode);
      if (ops.length < antes) {
        this.log(`custódia: ${antes - ops.length} de ${antes} oportunidades bloqueadas por saúde de exchange`);
      }
      ops = [...ops].sort((a, b) =>
        pontuacaoAjustada(b.pontuacao, b.exchangeShort, b.exchangeLong) -
        pontuacaoAjustada(a.pontuacao, a.exchangeShort, a.exchangeLong));
      if (!ops.length) { this.log('nenhuma oportunidade em exchange saudável'); return; }
    }

    // evacuação: a exchange onde o dinheiro ESTÁ foi sinalizada
    if (Object.keys(saude).length) {
      for (const p of [...this.posicoes]) {
        const veredicto = podeOperar(saude, p.exchangeShort, p.exchangeLong);
        if (!veredicto.pode) this.fecharPosicao(p, 'custódia: ' + veredicto.motivo, 'EVACUA');
      }
    }

    // ── gerência de cada posição aberta ─────────────────────────────────
    for (const pos of [...this.posicoes]) await this.gerir(pos, ops);

    // Apara antes de abrir. A ordem importa: uma posição acima da cota estoura
    // o teto e barra todas as candidatas, então aparar depois de tentar abrir
    // desperdiçaria um ciclo inteiro a cada vez.
    for (const pos of this.posicoes) this.redimensionar(pos);

    // ── abertura, respeitando o teto por exchange ───────────────────────
    await this.abrir(ops);

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

  /**
   * Abre posições até o limite, respeitando o teto de exposição por exchange.
   *
   * O teto é o que transforma "três posições" em diluição de verdade. Sem ele,
   * as três poderiam usar as mesmas duas exchanges e a concentração continuaria
   * exatamente onde estava.
   *
   * Cada posição recebe capital/maxPosicoes, então cada perna leva
   * capital/(2·maxPosicoes). Com 3 posições e teto de 40%, uma exchange cabe em
   * no máximo 2 pernas — o que dá 33% de exposição máxima, contra os 50% de
   * antes.
   */
  private async abrir(ops: OportunidadeSpread[]) {
    const jaTenho = new Set(this.posicoes.map((p) => p.symbol));

    // O número de posições NÃO é livre: diluir divide a margem por perna, e
    // abaixo de certo tamanho a transferência de margem cai sob o saque mínimo
    // da exchange e deixa de ser possível. Sem transferência, a única defesa é
    // fechar — medido em 42,5 fechamentos por 90 dias e mediana US$ 89,88
    // contra US$ 111,67. Seguro, mas perdendo dinheiro.
    const sust = posicoesSustentaveis(this.estado.capital, this.o.alavancagem, LIMIARES_PADRAO.alerta, MMR_ALT, this.o.maxPosicoes);
    if (this.estado.limiteAnterior !== sust.motivo) {
      this.log(`limite de posições: ${sust.motivo}`);
      this.estado.limiteAnterior = sust.motivo;
    }
    const maxAgora = sust.posicoes;
    const alocacao = this.estado.capital / maxAgora;
    const d = dimensionarSpread(alocacao, this.o.alavancagem, this.o.taxaPerp);

    // Ordena por valor esperado, não pela heurística `spread × consistência²`.
    // Entre candidatas lucrativas, por valor POR HORA de capital ocupado — duas
    // com o mesmo lucro total não são equivalentes se uma leva o dobro do
    // tempo. Entre não-lucrativas, por folga, que responde "qual está mais
    // perto de compensar". Ver `chaveOrdenacao` para por que os dois regimes.
    const entrada = (o: OportunidadeSpread) => ({
      spread: o.spread, consistencia: o.consistencia,
      duracaoHoras: o.duracaoHoras ?? 0,
      notional: d.notionalPorPerna, taxa: this.o.taxaPerp,
    });
    ops = [...ops].sort((a, b) => chaveOrdenacao(entrada(b)) - chaveOrdenacao(entrada(a)));
    const limite = this.estado.capital * this.o.tetoPorExchange;
    let bloqueadasPorTeto = 0;

    let bloqueadasPorPayback = 0;

    for (const melhor of ops) {
      if (this.posicoes.length >= maxAgora) break;
      if (jaTenho.has(melhor.symbol)) continue;
      if (melhor.spread < this.o.spreadMinimo) continue;

      // ── PORTÃO DE VALOR ESPERADO ─────────────────────────────────────
      //
      // O portão que faltava, e cuja ausência custou US$ 2,30 em nove horas.
      //
      //   valor = notional × spread × pagamentos(vida) − notional × taxa × 4
      //
      // O notional multiplica os dois termos, então não muda o sinal — só a
      // escala. Alavancagem e capital não decidem se vale a pena; só taxa,
      // spread e tempo de vida.
      //
      // As 8 posições abertas antes deste portão fecharam TODAS no prejuízo:
      // US$ 0,17 de funding contra US$ 2,48 de custo. Por isso ele remove só
      // perdedoras, e não fere a regra de nunca remover trade lucrativo.
      // Taxa REAL do par de exchanges, não 0,05% uniforme. A bitget cobra
      // 0,06%: 20% a mais de payback, que não é arredondamento numa conta onde
      // o payback é taxa × 4 / spread.
      const taxaReal = taxaDaOperacao(melhor.exchangeShort, melhor.exchangeLong);
      const v = avaliarValor({
        spread: melhor.spread,
        consistencia: melhor.consistencia,
        duracaoHoras: melhor.duracaoHoras ?? 0,
        notional: d.notionalPorPerna,
        taxa: taxaReal,
      });
      if (v.folga < this.o.margemPayback) {
        bloqueadasPorPayback++;
        continue;
      }

      const exp = this.exposicaoPorExchange();
      const estouraria = [melhor.exchangeShort, melhor.exchangeLong]
        .some((id) => (exp[id] ?? 0) + d.margemPorPerna > limite);
      if (estouraria) { bloqueadasPorTeto++; continue; }

      const p = await this.preco(melhor.exchangeShort, melhor.symbol);
      this.posicoes.push({
        symbol: melhor.symbol,
        exchangeShort: melhor.exchangeShort, exchangeLong: melhor.exchangeLong,
        margemShort: d.margemPorPerna, margemLong: d.margemPorPerna,
        notionalPorPerna: d.notionalPorPerna, precoEntrada: p, precoUltimo: p,
        abertaEm: Date.now(), spreadNaEntrada: melhor.spread,
        fundingAcumulado: 0, pagamentos: 0,
      });
      jaTenho.add(melhor.symbol);
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
        spread: melhor.spread, consistencia: melhor.consistencia, apr: melhor.aprSpread,
        notional: d.notionalPorPerna, custo: d.custoMontagem, preco: p,
      });
    }

    if (bloqueadasPorTeto && this.posicoes.length < maxAgora) {
      const c = this.concentracao();
      this.log(
        `teto de exposição barrou ${bloqueadasPorTeto} candidatas · ` +
        `concentração atual ${(c.fracao * 100).toFixed(0)}% em ${c.exchange} · limite ${(this.o.tetoPorExchange * 100).toFixed(0)}%`,
      );
    }

    // Não abrir é um resultado, não uma falha. Enquanto nenhum par tiver
    // vivido o próprio payback, ficar de fora é a decisão que rende mais.
    if (bloqueadasPorPayback && this.posicoes.length < maxAgora) {
      const b = ops.find((o) => !jaTenho.has(o.symbol));
      let detalhe = '';
      if (b) {
        const v = avaliarValor({
          spread: b.spread, consistencia: b.consistencia,
          duracaoHoras: b.duracaoHoras ?? 0, notional: d.notionalPorPerna, taxa: this.o.taxaPerp,
        });
        // Quanto de vida ainda falta para passar no portão. É a informação
        // acionável: "faltam 6h" diz se vale esperar; "valor −US$ 0,15" não.
        const faltamHoras = v.paybackHoras * this.o.margemPayback - v.vidaEsperadaHoras;
        detalhe =
          ` · mais perto: ${b.symbol.replace('/USDT:USDT', '')} · ` +
          `vida ${v.vidaEsperadaHoras.toFixed(1)}h de ${(v.paybackHoras * this.o.margemPayback).toFixed(1)}h exigidas ` +
          `(${(v.folga / this.o.margemPayback * 100).toFixed(0)}% do caminho, faltam ${faltamHoras.toFixed(1)}h)`;
      }
      this.log(`valor esperado barrou ${bloqueadasPorPayback} candidatas${detalhe}`);
    }
  }

  /**
   * Apara uma posição maior que a cota dela.
   *
   * Aparece em dois casos, e o segundo é permanente:
   *
   *   MIGRAÇÃO   uma posição montada quando o motor era de posição única ocupa
   *              o capital inteiro. Sem aparar, ela sozinha estoura o teto e
   *              bloqueia as outras duas para sempre — foi exatamente o que
   *              aconteceu com KAITO: "teto barrou 4 candidatas · concentração
   *              50% em bybit".
   *
   *   COMPOSIÇÃO o reinvestimento engorda a posição que está aberta. Sem aparar,
   *              a mais antiga cresce indefinidamente e reconcentra o que a
   *              diluição tinha resolvido.
   *
   * Aparar custa taxa sobre a parte fechada — US$ 0,17 no caso do KAITO, contra
   * US$ 0,50 de fechar e reabrir. Barato pelo que destrava.
   *
   * A tolerância de 25% evita aparar por ruído: sem ela, cada centavo de funding
   * reinvestido dispararia uma aparada e o custo comeria o ganho.
   */
  private redimensionar(pos: PosicaoSpread) {
    // A cota usa o limite SUSTENTÁVEL, não o configurado: se o capital só
    // sustenta uma posição, a cota é o capital inteiro e não há o que aparar.
    const alvo = this.estado.capital / posicoesSustentaveis(this.estado.capital, this.o.alavancagem, LIMIARES_PADRAO.alerta, MMR_ALT, this.o.maxPosicoes).posicoes;
    const atual = pos.margemShort + pos.margemLong;
    if (atual <= alvo * 1.25) return;

    const fracaoManter = alvo / atual;
    const notionalFechado = pos.notionalPorPerna * (1 - fracaoManter);
    const custo = notionalFechado * this.o.taxaPerp * 2;

    pos.notionalPorPerna *= fracaoManter;
    pos.margemShort *= fracaoManter;
    pos.margemLong *= fracaoManter;
    this.estado.capital -= custo;
    this.estado.custosTotal += custo;

    this.log(
      `APARA ${pos.symbol.replace('/USDT:USDT', '')} — ocupava US$ ${atual.toFixed(2)} de cota ` +
      `US$ ${alvo.toFixed(2)} · notional agora US$ ${pos.notionalPorPerna.toFixed(2)}/perna · ` +
      `custo US$ ${custo.toFixed(3)}`,
    );
    this.diario('apara', {
      symbol: pos.symbol, margemAntes: atual, margemAlvo: alvo,
      notionalNovo: pos.notionalPorPerna, custo,
    });
  }

  /** Gerência de uma posição: funding, margem, composição e troca. */
  private async gerir(pos: PosicaoSpread, ops: OportunidadeSpread[]) {
    const atual = ops.find((o) => o.symbol === pos.symbol);
    const precoAtual = await this.preco(pos.exchangeShort, pos.symbol);
    const variacao = precoAtual / pos.precoEntrada - 1;

    // ── contabilidade INCREMENTAL de margem ────────────────────────────────
    //
    // A margem de cada perna acompanha o preço ciclo a ciclo. A versão anterior
    // reconstruía a margem a partir de `precoEntrada` e RESETAVA essa referência
    // a cada transferência — inclusive quando o valor transferido era zero.
    //
    // O teste de ruína expôs a consequência: a 8x, onde a posição já nasce
    // dentro da faixa de alerta, o motor transferia zero e resetava a
    // referência todo ciclo, apagando a deriva acumulada. No modelo isso
    // aparecia como 8x e 10x sendo MAIS seguros que 5x. Aqui apareceria como
    // uma posição que nunca chega perto da liquidação até chegar de uma vez.
    const delta = pos.precoUltimo ? precoAtual / pos.precoUltimo - 1 : 0;
    pos.margemShort -= pos.notionalPorPerna * delta;
    pos.margemLong += pos.notionalPorPerna * delta;
    pos.precoUltimo = precoAtual;

    // O ativo SUMIU da varredura — significa que o spread inverteu (a varredura
    // só devolve spreads positivos). Sem este bloco o motor ficaria preso numa
    // posição perdedora para sempre: não coletaria funding (porque `atual` é
    // undefined) e nunca avaliaria a troca (mesma razão).
    //
    // Quando o spread inverte, quem estava recebendo passa a PAGAR. Fechar é
    // urgente e não deve esperar os dias mínimos.
    if (!atual) {
      // Segunda linha de defesa contra o mesmo erro que custou US$ 2,30: a
      // vigilância já tolera 3 faltas, mas ela pode reiniciar e perder estado,
      // e aí todo par volta a ter zero observações e some do ranking.
      //
      // Fechar na primeira ausência confunde "não vi" com "acabou". Duas
      // ausências seguidas do motor são 40 minutos — tempo suficiente para
      // distinguir um buraco de leitura de um spread que morreu.
      pos.faltasSeguidas = (pos.faltasSeguidas ?? 0) + 1;
      if (pos.faltasSeguidas < 2) {
        this.log(
          `${pos.symbol.replace('/USDT:USDT', '')} fora do ranking neste ciclo ` +
          `(falta ${pos.faltasSeguidas}/2) — aguardando confirmação antes de fechar`,
        );
        return;
      }
      this.estado.trocas++;
      this.fecharPosicao(pos, 'spread invertido (ausente em 2 ciclos)', 'FECHA');
      return;
    }
    pos.faltasSeguidas = 0;

    // Coleta de funding, 3 vezes ao dia.
    //
    // O carimbo é POR POSIÇÃO, não global. Com posição única dava no mesmo, mas
    // com três o carimbo global faria a primeira posição do ciclo receber e
    // bloquear as outras duas — que só voltariam a receber oito horas depois,
    // se tivessem a sorte de ser a primeira da fila naquele momento.
    //
    // Tolerância de 15 minutos: o ciclo roda a cada 20 min, então exigir 8h
    // exatas faria o pagamento escorregar e acumular atraso ao longo de semanas.
    const agora = Date.now();
    const ultimo = pos.ultimoFundingTs ?? 0;
    if (ultimo === 0 || (agora - ultimo) / 3_600_000 >= 7.75) {
      const ganho = pos.notionalPorPerna * atual.spread;
      pos.fundingAcumulado += ganho;
      pos.pagamentos++;
      pos.ultimoFundingTs = agora;
      this.estado.capital += ganho;
      this.estado.fundingTotal += ganho;
      this.estado.caixaOcioso += ganho;
      this.estado.pagamentos++;
      this.estado.ultimoCicloTs = agora;
      this.log(
        `funding ${pos.symbol.replace('/USDT:USDT', '')} spread ${(atual.spread * 100).toFixed(4)}% → ` +
        `US$ ${ganho.toFixed(4)} · capital US$ ${this.estado.capital.toFixed(2)}`,
      );
      this.diario('funding', { symbol: pos.symbol, spread: atual.spread, ganho, capital: this.estado.capital });
    }

    // ── proteção: distância de liquidação de cada perna ────────────────────
    //
    // A regra antiga disparava por fração de margem consumida (50%), que é uma
    // proxy. A distância de liquidação é a grandeza real, e ela depende da
    // margem de manutenção — que a proxy ignorava.
    //
    // A política é transferir CEDO. A assimetria de custo decide: transferir
    // custa centavos, ser liquidado custa a margem inteira de uma perna. E
    // transferir não remove nenhum trade lucrativo — o dinheiro só muda de
    // exchange, a posição segue montada e o funding segue entrando.
    const mmr = mmrDe(pos.symbol);
    // variação zero: o movimento já foi aplicado à margem lá em cima
    const risco = avaliarRisco(pos.margemShort, pos.margemLong, pos.notionalPorPerna, 0, mmr);

    if (risco.nivel === 'critico') {
      // Não dá tempo de transferir: saque entre exchanges leva minutos e o
      // ciclo é de 20. Fechar custa US$ 0,50 e evita perder ~US$ 50.
      this.estado.fechamentosEmergencia = (this.estado.fechamentosEmergencia ?? 0) + 1;
      this.fecharPosicao(
        pos,
        `EMERGÊNCIA · perna ${risco.pernaEmRisco} a ${(risco.distanciaMinima * 100).toFixed(1)}% ` +
        `da liquidação · preço ${(variacao * 100).toFixed(1)}% desde a entrada`,
        'FECHA',
      );
      return;
    }

    if (risco.nivel === 'alerta') {
      const t = quantoTransferir(pos.margemShort, pos.margemLong);
      // Transferir centavos custa taxa e não move a distância de liquidação. O
      // caso em que isso importa é a posição NASCER dentro da faixa de alerta
      // (acontece de 8x para cima): as margens já estão iguais, o valor a
      // transferir é zero, e sem esta guarda o motor "agiria" todo ciclo sem
      // mudar nada.
      if (t.valor <= pos.notionalPorPerna * 0.001) {
        this.log(
          `ALERTA sem ação em ${pos.symbol.replace('/USDT:USDT', '')} — distância ` +
          `${(risco.distanciaMinima * 100).toFixed(1)}% com as pernas já equilibradas. ` +
          `A alavancagem é alta demais para o limiar.`,
        );
        return;
      }
      // CUSTO REAL DE TRANSFERÊNCIA, não 0,05% do valor.
      //
      // Saque entre exchanges cobra taxa FIXA (US$ 0,15 na rede mais barata da
      // bitget) e tem MÍNIMO (US$ 10). O mínimo é o que importa: abaixo dele a
      // transferência não acontece, por mais que o motor mande.
      //
      // Quando não é possível, esperar o nível crítico seria apostar — não há
      // reequilíbrio a caminho para ganhar tempo. Fecha-se agora, no alerta,
      // que é a política medida em `ruina.ts` como `soFechamento`.
      const ct = custoTransferencia(t.valor);
      if (!ct.possivel) {
        this.estado.fechamentosEmergencia = (this.estado.fechamentosEmergencia ?? 0) + 1;
        this.fecharPosicao(
          pos,
          `ALERTA sem transferência possível — ${ct.motivo} · ` +
          `distância ${(risco.distanciaMinima * 100).toFixed(1)}%`,
          'FECHA',
        );
        return;
      }
      const custo = ct.custo;
      this.estado.capital -= custo;
      this.estado.custosTotal += custo;
      this.estado.transferencias++;
      // depois de igualar, as duas pernas voltam à distância máxima possível
      const media = (pos.margemShort + pos.margemLong) / 2;
      pos.margemShort = media;
      pos.margemLong = media;
      this.log(
        `TRANSFERE US$ ${t.valor.toFixed(2)} da perna ${t.de} · ` +
        `distância de liquidação era ${(risco.distanciaMinima * 100).toFixed(1)}% · ` +
        `preço ${(variacao * 100).toFixed(1)}% desde a entrada · custo US$ ${custo.toFixed(4)}`,
      );
      this.diario('transfere', {
        symbol: pos.symbol, transferido: t.valor, de: t.de,
        distanciaLiquidacao: risco.distanciaMinima, variacao, custo,
      });
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

    // Troca de ativo quando outro spread compensa.
    //
    // O candidato precisa ser um par que eu ainda NÃO tenho — com uma posição
    // só isso era automático, com três é preciso dizer, senão o motor troca
    // uma posição por outra que já está montada e paga o custo por nada.
    const dias = (Date.now() - pos.abertaEm) / 86_400_000;
    const meus = new Set(this.posicoes.map((p) => p.symbol));
    const melhorOutro = ops.find((o) => !meus.has(o.symbol));
    if (dias >= this.o.diasMinimos && melhorOutro) {
      const custoTroca = pos.notionalPorPerna * this.o.taxaPerp * 4;
      const ganhoExtraDia = (melhorOutro.spread - atual.spread) * pos.notionalPorPerna * 3;
      const diasPagar = ganhoExtraDia > 0 ? custoTroca / ganhoExtraDia : Infinity;
      const spreadMorreu = atual.spread < this.o.spreadMinimo;

      if (spreadMorreu || diasPagar < 7) {
        this.estado.trocas++;
        this.fecharPosicao(
          pos,
          spreadMorreu
            ? `spread caiu para ${(atual.spread * 100).toFixed(4)}%`
            : `troca por ${melhorOutro.symbol.replace('/USDT:USDT', '')} se paga em ${diasPagar.toFixed(1)} dias`,
          'FECHA',
        );
      }
    }
  }

  status(): string {
    const e = this.estado;
    const dias = (Date.now() - e.iniciadoEm) / 86_400_000;
    const lucro = e.capital - e.capitalInicial;
    const fechadas = e.semanas.filter((w) => w.lucro !== 0);
    const pos = fechadas.filter((w) => w.lucro > 0).length;
    const abertas = this.posicoes;
    const c = this.concentracao();
    return (
      `dia ${dias.toFixed(1)} · US$ ${e.capital.toFixed(2)} (${lucro >= 0 ? '+' : ''}${lucro.toFixed(3)}) · ` +
      `${e.pagamentos} pag · ${e.reinvestimentos} reinv · ${e.transferencias} transf · ${e.trocas} trocas` +
      (fechadas.length ? ` · semanas + ${pos}/${fechadas.length}` : '') +
      (abertas.length
        ? ` · ${abertas.length}/${posicoesSustentaveis(e.capital, this.o.alavancagem, LIMIARES_PADRAO.alerta, MMR_ALT, this.o.maxPosicoes).posicoes} posições: ` +
          abertas.map((p) => p.symbol.replace('/USDT:USDT', '')).join(', ') +
          ` · concentração ${(c.fracao * 100).toFixed(0)}% em ${c.exchange}`
        : ' · sem posição')
    );
  }

  getEstado() { return { ...this.estado }; }
}
