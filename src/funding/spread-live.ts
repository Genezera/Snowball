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
import { taxaEfetiva, posicoesSustentaveis } from './custos-reais.ts';
import { dimensionar, socorrer, usoPorExchange, RESERVA_PADRAO } from './tesouraria.ts';
import { lerSaude, podeOperar, pontuacaoAjustada } from './custodia.ts';
import { avaliarValor, chaveOrdenacao } from './valor.ts';
import { bonusEquilibrio, piorDreno } from './equilibrio.ts';
import { enviarTelegram } from './telegram.ts';

/**
 * Notifica só o que é raro e importa — dinheiro mudando de mãos ou o motor
 * parando sozinho. 'bloqueado' (o caso mais comum, a cada 5min) fica de
 * fora de propósito, senão vira ruído. Se o Telegram não estiver
 * configurado, `enviarTelegram` não faz nada — isto nunca derruba o motor.
 */
function notificarTelegram(evento: string, dados: Record<string, unknown>) {
  const s = String(dados.symbol ?? '').replace('/USDT:USDT', '');
  if (evento === 'abre') {
    void enviarTelegram(
      `🟢 <b>Posição aberta</b> — ${s}\n` +
      `${dados.short} → ${dados.long} · notional US$ ${Number(dados.notional ?? 0).toFixed(0)}\n` +
      `consistência ${(Number(dados.consistencia ?? 0) * 100).toFixed(0)}%`,
    );
  } else if (evento === 'fecha') {
    const funding = Number(dados.fundingAcumulado ?? 0), custo = Number(dados.custo ?? 0);
    const resultado = funding - custo;
    void enviarTelegram(
      `🔴 <b>Posição fechada</b> — ${s}\n` +
      `motivo: ${dados.motivo}\n` +
      `funding recebido US$ ${funding.toFixed(4)} · custo US$ ${custo.toFixed(3)} · ` +
      `resultado ${resultado >= 0 ? '+' : '−'}US$ ${Math.abs(resultado).toFixed(4)}`,
    );
  } else if (evento === 'piso') {
    void enviarTelegram(
      `🛑 <b>MOTOR PARADO</b> — piso de capital atingido\n` +
      `capital US$ ${Number(dados.capital ?? 0).toFixed(2)} · piso US$ ${Number(dados.piso ?? 0).toFixed(2)}\n` +
      `Precisa de decisão manual pra retomar (apagar 'parado' de spread/estado.json).`,
    );
  }
}

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
  /** último limite logado, para não repetir a cada ciclo */
  limiteAnterior?: string;
  /** dinheiro por exchange: a verdade sobre onde o capital está */
  saldos?: Record<string, number>;
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
  /** fração do saldo de cada exchange que fica livre, como reserva de socorro */
  reserva: number;
  /** onde o dinheiro está, quando ainda não há posição para inferir */
  exchanges: string[];
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
  // Ótimo medido em 20 mil simulações: a curva é plana entre 15% e 35%, com
  // pico em 25%. 30% fica perto do ótimo e do lado seguro dele.
  reserva: RESERVA_PADRAO,
  exchanges: ['binanceusdm', 'bybit'],
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
   * O dinheiro, exchange por exchange.
   *
   * É a mudança de modelo mais importante desta versão: capital deixou de ser
   * um número único e passou a ser o que ele é de fato — contas separadas que
   * não se comunicam sem saque on-chain.
   */
  private saldos(): Record<string, number> {
    if (!this.estado.saldos) {
      // migração: distribui o capital antigo igualmente pelas exchanges onde
      // ele efetivamente estaria, ou pelas configuradas se não houver posição
      const exs = this.posicoes.length
        ? [...new Set(this.posicoes.flatMap((p) => [p.exchangeShort, p.exchangeLong]))]
        : this.o.exchanges;
      const porEx = this.estado.capital / exs.length;
      this.estado.saldos = Object.fromEntries(exs.map((e) => [e, porEx]));
    }
    return this.estado.saldos;
  }

  private debitar(exchange: string, valor: number) {
    const s = this.saldos();
    s[exchange] = (s[exchange] ?? 0) - valor;
    this.estado.capital = Object.values(s).reduce((a, b) => a + b, 0);
  }

  private creditar(exchange: string, valor: number) {
    this.debitar(exchange, -valor);
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
    if (evento === 'abre' || evento === 'fecha' || evento === 'piso') notificarTelegram(evento, dados);
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
    const s = this.saldos();
    const r = riscoDesbalanceamento(this.o.alavancagem);
    const primeira = dimensionar(
      s, {}, this.o.exchanges[0], this.o.exchanges[1] ?? this.o.exchanges[0],
      this.o.alavancagem, this.o.reserva,
    );
    this.log(
      `motor pronto · ` +
      Object.entries(s).map(([e, v]) => `${e} US$ ${v.toFixed(2)}`).join(' · ') +
      ` · reserva ${(this.o.reserva * 100).toFixed(0)}%`,
    );
    this.log(
      primeira.possivel
        ? `primeira posição: margem US$ ${primeira.margemPorPerna.toFixed(2)}/perna · notional US$ ${primeira.notionalPorPerna.toFixed(2)}/perna · ${this.o.alavancagem}x`
        : `sem dimensionamento possível: ${primeira.motivo}`,
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
    // ── leitura periódica: um ponto na curva mesmo sem evento nenhum ──────
    //
    // Sem isto, a curva de capital só ganhava ponto novo em abertura,
    // fechamento, funding, semana ou piso — nada disso acontece enquanto o
    // portão de valor esperado barra tudo, então a curva ficava travada num
    // ponto só por horas, mesmo com o motor vivo e decidindo a cada ciclo.
    // Vai pro diário (pra alimentar a curva) mas o dashboard filtra
    // 'leitura' da tabela de decisões — não é uma decisão, é um heartbeat.
    this.diario('leitura', { capital: this.estado.capital });

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

    // O dinheiro vive em contas separadas e NÃO cruza entre elas. O tamanho de
    // cada posição sai do que há livre nas duas exchanges dela, acima da
    // reserva de socorro. Ver tesouraria.ts para por que o teto global e a
    // transferência entre exchanges saíram do desenho.
    const maxAgora = this.o.maxPosicoes;

    // Ordena por valor esperado, não pela heurística `spread × consistência²`.
    // Entre candidatas lucrativas, por valor POR HORA de capital ocupado — duas
    // com o mesmo lucro total não são equivalentes se uma leva o dobro do
    // tempo. Entre não-lucrativas, por folga, que responde "qual está mais
    // perto de compensar". Ver `chaveOrdenacao` para por que os dois regimes.
    const entrada = (o: OportunidadeSpread, notional: number) => ({
      spread: o.spread, consistencia: o.consistencia,
      duracaoHoras: o.duracaoHoras ?? 0,
      notional, taxa: taxaEfetiva(o.exchangeShort, o.exchangeLong),
    });
    // notional de referência só para ordenar; o real sai do dimensionamento
    const notionalRef = (this.estado.capital / 2 / maxAgora) * this.o.alavancagem;
    // Desempate por EQUILÍBRIO DE DIREÇÃO. Duas posições vendidas na mesma
    // exchange drenam essa exchange ao dobro num movimento correlacionado —
    // e cripto é altamente correlacionada. Uma vendida em cada corta o dreno de
    // pico pela metade, sem mudar notional nem renda. Ver equilibrio.ts.
    const comBonus = (o: OportunidadeSpread) => {
      const k = chaveOrdenacao(entrada(o, notionalRef));
      const b = bonusEquilibrio(this.posicoes, {
        exchangeShort: o.exchangeShort, exchangeLong: o.exchangeLong,
        notionalPorPerna: notionalRef,
      });
      // o bônus é multiplicativo sobre o valor, mas a chave pode ser negativa
      // (candidata não lucrativa); somar mantém a ordem correta nos dois casos
      return k + Math.abs(k) * b;
    };
    ops = [...ops].sort((a, b) => comBonus(b) - comBonus(a));

    let bloqueadasPorSaldo = 0;
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
      const taxaReal = taxaEfetiva(melhor.exchangeShort, melhor.exchangeLong);

      // O tamanho sai do saldo REAL das duas exchanges, acima da reserva.
      // Precisa vir antes do portão porque o valor esperado depende do notional
      // — e o notional depende de quanto sobrou em cada conta.
      const d = dimensionar(
        this.saldos(), this.exposicaoPorExchange(),
        melhor.exchangeShort, melhor.exchangeLong,
        this.o.alavancagem, this.o.reserva,
      );
      if (!d.possivel) { bloqueadasPorSaldo++; continue; }

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

      const custoMontagem = d.notionalPorPerna * taxaReal * 2;
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
      this.debitar(melhor.exchangeShort, custoMontagem / 2);
      this.debitar(melhor.exchangeLong, custoMontagem / 2);
      this.estado.custosTotal += custoMontagem;

      this.log(
        `ABRE ${melhor.symbol.replace('/USDT:USDT', '')} · vendido ${melhor.exchangeShort} / comprado ${melhor.exchangeLong} · ` +
        `spread médio ${(melhor.spread * 100).toFixed(4)}% (${(melhor.aprSpread * 100).toFixed(1)}% APR) · ` +
        `consistência ${(melhor.consistencia * 100).toFixed(0)}% · ` +
        `notional US$ ${d.notionalPorPerna.toFixed(2)}/perna · ${d.motivo} · custo US$ ${custoMontagem.toFixed(3)}`,
      );
      this.diario('abre', {
        symbol: melhor.symbol, short: melhor.exchangeShort, long: melhor.exchangeLong,
        spread: melhor.spread, consistencia: melhor.consistencia, apr: melhor.aprSpread,
        notional: d.notionalPorPerna, custo: custoMontagem, preco: p,
      });
    }

    if (bloqueadasPorSaldo && this.posicoes.length < maxAgora) {
      const u = usoPorExchange(this.saldos(), this.exposicaoPorExchange());
      const resumo = Object.entries(u)
        .map(([ex, x]) => `${ex} US$ ${x.livre.toFixed(2)} livre de ${x.saldo.toFixed(2)}`)
        .join(' · ');
      this.log(`saldo barrou ${bloqueadasPorSaldo} candidatas · ${resumo}`);
      // Sem isto o painel "Decisões do motor" ficava mudo entre uma abertura e
      // outra — o motor decide a cada ciclo, mas só a decisão de MONTAR era
      // gravada. "Não abrir" também é uma decisão, e é a mais frequente das
      // duas.
      this.diario('bloqueado', { motivo: `saldo insuficiente · ${resumo}` });
    }

    // Não abrir é um resultado, não uma falha. Enquanto nenhum par tiver
    // vivido o próprio payback, ficar de fora é a decisão que rende mais.
    if (bloqueadasPorPayback && this.posicoes.length < maxAgora) {
      const b = ops.find((o) => !jaTenho.has(o.symbol));
      let detalhe = '';
      // campos numéricos, não só o texto — pra quem for analisar o diário
      // depois não precisar re-parsear a frase pra recuperar os números
      let camposNumericos: Record<string, unknown> = {};
      if (b) {
        // notional de referência: o dimensionamento real só existe dentro do
        // laço, e aqui o que importa é o payback, que não depende do notional
        const v = avaliarValor({
          spread: b.spread, consistencia: b.consistencia,
          duracaoHoras: b.duracaoHoras ?? 0, notional: notionalRef,
          taxa: taxaEfetiva(b.exchangeShort, b.exchangeLong),
        });
        const paybackExigidoHoras = v.paybackHoras * this.o.margemPayback;
        // Quanto de vida ainda falta para passar no portão. É a informação
        // acionável: "faltam 6h" diz se vale esperar; "valor −US$ 0,15" não.
        const faltamHoras = paybackExigidoHoras - v.vidaEsperadaHoras;
        const pctDoCaminho = v.folga / this.o.margemPayback * 100;
        detalhe =
          ` · mais perto: ${b.symbol.replace('/USDT:USDT', '')} · ` +
          `vida ${v.vidaEsperadaHoras.toFixed(1)}h de ${paybackExigidoHoras.toFixed(1)}h exigidas ` +
          `(${pctDoCaminho.toFixed(0)}% do caminho, faltam ${faltamHoras.toFixed(1)}h)`;
        camposNumericos = {
          exchangeShort: b.exchangeShort, exchangeLong: b.exchangeLong,
          spread: b.spread, apr: b.aprSpread, consistencia: b.consistencia,
          vidaEsperadaHoras: v.vidaEsperadaHoras, paybackExigidoHoras, faltamHoras, pctDoCaminho,
        };
      }
      this.log(`valor esperado barrou ${bloqueadasPorPayback} candidatas${detalhe}`);
      this.diario('bloqueado', {
        symbol: b?.symbol,
        motivo: `valor esperado barrou ${bloqueadasPorPayback} candidata${bloqueadasPorPayback > 1 ? 's' : ''}${detalhe}`,
        candidatasBarradas: bloqueadasPorPayback,
        ...camposNumericos,
      });
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
      // ── SOCORRO INTERNO, não transferência entre exchanges ─────────────
      //
      // A perna apertada é reforçada com o saldo livre da PRÓPRIA exchange.
      // É um movimento de spot para futuros: instantâneo, sem taxa, sem valor
      // mínimo, e imune à trava de 24h, à whitelist e ao limite de saque.
      //
      // A versão anterior buscava margem na outra exchange, o que exigia saque
      // on-chain de no mínimo US$ 10 — valor que, a US$ 100 de capital, a
      // transferência necessária nem alcançava. Metade da proteção era ficção.
      //
      // Medido em 20 mil simulações de 90 dias, com reserva de 30%: ruína de
      // 0,01% e mediana de US$ 214, contra US$ 203 sem reserva nenhuma.
      const exApertada = risco.pernaEmRisco === 'short' ? pos.exchangeShort : pos.exchangeLong;
      const margemAtual = risco.pernaEmRisco === 'short' ? pos.margemShort : pos.margemLong;
      const alvo = pos.notionalPorPerna / this.o.alavancagem;
      const faltando = Math.max(0, alvo - margemAtual);

      const s = socorrer(this.saldos(), this.exposicaoPorExchange(), exApertada, faltando);
      if (!s.possivel) {
        // reserva esgotada NAQUELA exchange: não há mais o que fazer além de
        // sair, e sair agora custa menos que ser liquidado
        this.estado.fechamentosEmergencia = (this.estado.fechamentosEmergencia ?? 0) + 1;
        this.fecharPosicao(
          pos,
          `ALERTA e ${s.motivo} · distância ${(risco.distanciaMinima * 100).toFixed(1)}%`,
          'FECHA',
        );
        return;
      }

      if (risco.pernaEmRisco === 'short') pos.margemShort += s.valor;
      else pos.margemLong += s.valor;
      this.estado.transferencias++;
      this.log(
        `SOCORRE ${pos.symbol.replace('/USDT:USDT', '')} · ${s.motivo} · ` +
        `distância era ${(risco.distanciaMinima * 100).toFixed(1)}% · ` +
        `preço ${(variacao * 100).toFixed(1)}% desde a entrada · sem custo`,
      );
      this.diario('socorre', {
        symbol: pos.symbol, exchange: exApertada, valor: s.valor,
        distanciaLiquidacao: risco.distanciaMinima, variacao,
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
