#!/usr/bin/env node
/**
 * LISTING OPPORTUNITY LAB — COLETOR (PLACEHOLDER).  .cjs porque o repo é ESM.
 *
 * ESTADO: placeholder. NÃO conecta a lugar nenhum, NÃO usa credencial, NÃO
 * envia ordem. Rodar este arquivo hoje só imprime que é placeholder e sai(0).
 *
 * O coletor REAL, quando existir, é APENAS leitura de dados PÚBLICOS de mercado
 * (WebSocket de trades/orderbook) para gravar amostras append-only sob
 * auditoria/listings/*.jsonl com provenance + rawHash. Ele:
 *   - NÃO abre stream autenticado, NÃO lê saldo, NÃO toca em execução;
 *   - NÃO altera Champion/motores/risco;
 *   - só pode rodar ISOLADO e SEM credenciais de execução no ambiente.
 *
 * Ver docs/LISTING-OPPORTUNITY-LAB.md e auditoria/listings/listing-schema.json.
 */
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// GUARD DE SEGURANÇA — precede QUALQUER import de rede ou lógica de coleta.
// Só passa se o operador setou explicitamente a flag E declarou ambiente
// isolado. Na falta de qualquer uma, imprime o aviso e sai limpo (exit 0).
// ─────────────────────────────────────────────────────────────────────────────
const ENABLED = process.env.LISTING_COLLECTOR_ENABLE === '1';
const ISOLATED = process.env.LISTING_COLLECTOR_ISOLATED === '1';

// Sanidade adicional: se houver QUALQUER credencial de execução no ambiente,
// este coletor se recusa a rodar — coleta de mercado não precisa de chave.
const CRED_HINTS = ['API_KEY', 'API_SECRET', 'SECRET', 'PRIVATE_KEY', 'PASSPHRASE', 'TOKEN'];
const hasExecCreds = Object.keys(process.env).some((k) =>
  CRED_HINTS.some((h) => k.toUpperCase().includes(h))
);

if (!ENABLED || !ISOLATED || hasExecCreds) {
  console.log('┌─ Listing Opportunity Lab · coletor (PLACEHOLDER) ─────────────');
  console.log('│ Este arquivo é um PLACEHOLDER. Não conecta, não coleta, não');
  console.log('│ envia ordem e não usa credenciais. Nada aconteceu.');
  console.log('│');
  console.log('│ Para a implementação REAL rodar (quando existir), exige-se:');
  console.log('│   LISTING_COLLECTOR_ENABLE=1     (flag explícita do operador)');
  console.log('│   LISTING_COLLECTOR_ISOLATED=1   (ambiente isolado declarado)');
  console.log('│   e NENHUMA credencial de execução no ambiente.');
  console.log('│');
  console.log(`│ enable=${ENABLED} isolated=${ISOLATED} credenciaisDetectadas=${hasExecCreds}`);
  console.log('│ Só leitura de dados públicos de mercado. Zero execução real.');
  console.log('└───────────────────────────────────────────────────────────────');
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// A PARTIR DAQUI: esqueleto do coletor REAL, DELIBERADAMENTE COMENTADO.
// Nenhuma linha abaixo executa enquanto for placeholder — mesmo com as flags,
// o corpo permanece comentado até a implementação isolada ser autorizada.
// O código está aqui como CONTRATO de arquitetura, não como algo operável.
// ─────────────────────────────────────────────────────────────────────────────

/*
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// const WebSocket = require('ws'); // dependência de leitura pública, sem auth

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'auditoria', 'listings');
fs.mkdirSync(OUT_DIR, { recursive: true });

const COLLECTOR_ID = 'listing-ws@0.0.0-placeholder';

// rawHash: integridade do payload bruto exatamente como recebido.
function rawHash(payload) {
  return 'sha256:' + crypto.createHash('sha256').update(payload).digest('hex');
}

// Grava append-only. NUNCA reescreve; cada observação é uma linha imutável.
function appendJsonl(nome, obj) {
  fs.appendFileSync(path.join(OUT_DIR, nome), JSON.stringify(obj) + '\n');
}

// Toda linha carrega provenance conforme listing-schema.json.
// evidence = 'observed' para dado bruto de mercado; NUNCA 'real'.
function withProvenance(source, rawPayload, body) {
  return {
    ...body,
    provenance: {
      source,
      observedAt: Date.now(),      // carimbo LOCAL de observação, ms
      collector: COLLECTOR_ID,
      rawHash: rawHash(rawPayload),
      evidence: 'observed',
    },
  };
}

// Assinaria SOMENTE streams públicos de mercado da exchange NOVA (e das
// exchangesExistentes[] para o estudo de Cross-Exchange Lead/Lag):
//   - <exchange>/trades   → fluxo de trades
//   - <exchange>/orderbook (depth/deltas) → book
// Sem canal autenticado, sem canal de ordem, sem saldo.
function subscribeMarketStreams(exchange, symbol) {
  // const wsUrl = PUBLIC_MARKET_WS[exchange]; // apenas endpoints públicos
  // const ws = new WebSocket(wsUrl);
  // ws.on('message', (raw) => {
  //   const msg = JSON.parse(raw);
  //   if (msg.tipo === 'trade') {
  //     appendJsonl(`${symbol}.trades.jsonl`, withProvenance(
  //       `ws:${exchange}:trades`, raw,
  //       { symbol, ts: msg.ts, preco: msg.preco, tamanho: msg.tamanho, lado: msg.lado }
  //     ));
  //   } else if (msg.tipo === 'orderbook') {
  //     appendJsonl(`${symbol}.orderbook.jsonl`, withProvenance(
  //       `ws:${exchange}:orderbook`, raw,
  //       { symbol, orderBook: { ts: msg.ts, bids: msg.bids, asks: msg.asks } }
  //     ));
  //   }
  //   // NENHUMA decisão de execução aqui. Só carimbar e gravar.
  // });
  void exchange; void symbol;
}

// Deriva o episódio (schema listing) a partir dos .jsonl brutos coletados —
// isto é 'replayed', pós-coleta, determinístico. NÃO é execução.
//   negociacaoTs, primeiroPreco, maxima/minima, tempoAteMaximaMs,
//   tempoAteQuedaMs, spread, profundidade, volume, volatilidade,
//   slippage (contra o book observed, tamanhos-alvo hipotéticos),
//   preco_1min/5min/15min/1h/8h/24h.
function buildEpisodeFromRaw(symbol) {
  void symbol;
  // Lê *.jsonl brutos → calcula campos → appendJsonl('episodes.jsonl', episodio)
  // com provenance.evidence = 'replayed'. Nunca envia ordem.
}

// Encerramento limpo — fecha sockets de leitura, nada a reverter no mercado.
function shutdown() { process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// (corpo real permanece comentado até autorização de execução isolada)
*/

// Se, por engano, o fluxo chegar até aqui com o corpo real ainda comentado,
// não há coleta implementada: sai limpo para não dar falsa impressão de coleta.
console.log('[listing-collector] flags setadas, mas corpo real ainda não implementado. Nada coletado.');
process.exit(0);
