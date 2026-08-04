/** Manda uma mensagem de teste, pra confirmar que TOKEN e CHAT_ID estão certos. */
import { enviarTelegram, TELEGRAM_CONFIGURADO } from '../funding/telegram.ts';

if (!TELEGRAM_CONFIGURADO) {
  console.log('\nTELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID não estão definidos no .env.');
  console.log('Veja .env.example. Depois de preencher TELEGRAM_CHAT_ID, rode:');
  console.log('  npm run telegram:chatid   (se ainda não souber o chat_id)\n');
  process.exit(1);
}

const ok = await enviarTelegram(
  '🧪 <b>Teste do Snowball</b>\n\nSe você recebeu isto, as notificações estão configuradas certo.',
);
console.log(ok ? '\nEnviado. Confira o Telegram.\n' : '\nFalhou — confira token e chat_id no .env.\n');
process.exit(ok ? 0 : 1);
