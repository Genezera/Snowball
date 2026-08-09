#!/usr/bin/env node
'use strict';
/**
 * TESTE do Telegram — envia TODAS as versões de mensagem (abre / fecha-lucro / fecha-prejuízo /
 * reinvestimento / resumo / piso) com dados de EXEMPLO, no formato exato do motor real.
 * Lê TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID do .env. Só envia; não opera nada.
 */
const fs = require('node:fs');
const path = require('node:path');

// ── carregar token/chat do .env ──
const env = {};
try { fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n').forEach((l) => { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }); } catch {}
const TOKEN = env.TELEGRAM_BOT_TOKEN, CHAT = env.TELEGRAM_CHAT_ID;
if (!TOKEN || !CHAT) { console.error('FALTA TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID no .env'); process.exit(1); }

async function enviar(texto) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text: texto, parse_mode: 'HTML' }), signal: AbortSignal.timeout(8000),
  });
  return r.ok;
}

const LINHA = '━━━━━━━━━━━━━━━━━━━';
const usd = (n, casas = 2) => 'US$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

const mensagens = [
  // cabeçalho de teste
  `🧪 <b>TESTE — mensagens de exemplo</b>\n${LINHA}\nAs próximas 6 mensagens são <b>exemplos</b> de como o robô vai te avisar. Nenhuma operação real aconteceu. 👇`,

  // 1) ABRE
  `🟢 <b>NOVA OPERAÇÃO ABERTA</b>\n${LINHA}\n` +
  `🪙 <b>Moeda:</b> KAITO\n🔄 <b>Comprado em:</b> bybit\n🔄 <b>Vendido em:</b> bitget\n` +
  `💵 <b>Valor operado:</b> ${usd(100, 0)}\n📊 <b>Qualidade do sinal:</b> 87%\n${LINHA}\n` +
  `ℹ️ O robô abriu uma operação <b>neutra</b>: comprou numa corretora e vendeu na outra ao mesmo tempo. ` +
  `Assim, <b>não importa se o preço sobe ou cai</b> — o lucro vem da <b>taxa de funding</b> que uma corretora paga à outra. Sem aposta em direção. 🛡️`,

  // 2) FECHA — LUCRO
  `✅ <b>OPERAÇÃO FECHADA — LUCRO</b>\n${LINHA}\n` +
  `🪙 <b>Moeda:</b> KAITO\n💰 <b>Recebido (funding):</b> +${usd(1.1535, 4)}\n💸 <b>Custo (taxas):</b> −${usd(0.10, 4)}\n` +
  `📈 <b>Resultado:</b> +${usd(1.0535, 4)}\n📝 <b>Por que fechou:</b> a taxa caiu muito\n${LINHA}\n` +
  `ℹ️ A taxa de funding caiu bastante e não valia mais a pena manter a operação aberta. O robô saiu pra guardar o lucro.`,

  // 3) FECHA — PREJUÍZO
  `⚠️ <b>OPERAÇÃO FECHADA — PREJUÍZO</b>\n${LINHA}\n` +
  `🪙 <b>Moeda:</b> SIREN\n💰 <b>Recebido (funding):</b> +${usd(0.0220, 4)}\n💸 <b>Custo (taxas):</b> −${usd(0.10, 4)}\n` +
  `📉 <b>Resultado:</b> −${usd(0.0780, 4)}\n📝 <b>Por que fechou:</b> a taxa virou contra\n${LINHA}\n` +
  `ℹ️ A taxa de funding, que estava pagando a favor, virou. O robô fechou pra não começar a pagar em vez de receber.`,

  // 4) REINVESTIMENTO
  `🔁 <b>LUCRO REINVESTIDO — BOLA DE NEVE</b> ⛄\n${LINHA}\n` +
  `💰 <b>Reinvestido agora:</b> ${usd(2.50, 2)}\n📈 <b>Capital total:</b> ${usd(202.50, 2)}\n${LINHA}\n` +
  `ℹ️ O robô juntou lucro suficiente e <b>aumentou o tamanho das próximas operações</b>. ` +
  `Cada lucro faz o próximo ser maior — é o efeito bola de neve trabalhando pra você. 🚀`,

  // 5) RESUMO
  `📊 <b>RESUMO DO DIA</b>\n${LINHA}\n` +
  `💼 <b>Capital:</b> ${usd(203.45, 2)}\n🟢 <b>Lucro no período:</b> +${usd(3.45, 2)}\n` +
  `💰 <b>Funding recebido:</b> +${usd(4.10, 2)}\n💸 <b>Custos:</b> −${usd(0.65, 2)}\n🔓 <b>Operações abertas agora:</b> 2\n${LINHA}\n` +
  `ℹ️ Tudo no automático. O robô segue operando e te avisa quando abrir ou fechar posição. 😴`,

  // 6) PISO
  `🛑 <b>ROBÔ PAUSADO — PRECISA DE VOCÊ</b> 🚨\n${LINHA}\n` +
  `💼 <b>Capital atual:</b> ${usd(180.00, 2)}\n🔻 <b>Limite de segurança:</b> ${usd(180.00, 2)}\n${LINHA}\n` +
  `⚠️ O robô <b>parou sozinho por segurança</b>: o capital chegou no limite mínimo. Nenhuma operação nova será aberta até você liberar manualmente.\n` +
  `👉 <b>O que fazer:</b> revisar a situação e retomar quando decidir.`,
];

(async () => {
  let ok = 0;
  for (let i = 0; i < mensagens.length; i++) {
    const enviado = await enviar(mensagens[i]);
    console.log(`  mensagem ${i}/${mensagens.length - 1}: ${enviado ? 'ENVIADA ✓' : 'FALHOU ✗'}`);
    if (enviado) ok++;
    await new Promise((r) => setTimeout(r, 900)); // espaçar pra não tomar rate-limit
  }
  console.log(`\n${ok}/${mensagens.length} mensagens enviadas ao Telegram.`);
})();
