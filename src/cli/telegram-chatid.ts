/**
 * Descobre o chat_id a partir das mensagens recentes que o bot recebeu.
 *
 * Uso: mande QUALQUER mensagem pro seu bot no Telegram primeiro (ex.: "oi"),
 * depois rode este comando. Só lê TELEGRAM_BOT_TOKEN do ambiente — nunca
 * pede o token como argumento, pra não sobrar em histórico de shell.
 */
import process from 'node:process';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.log('\nTELEGRAM_BOT_TOKEN não está definido.');
  console.log('Copie .env.example para .env e preencha o token antes de rodar isto.\n');
  process.exit(1);
}

const resp = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates`);
const dados = await resp.json();

if (!dados.ok) {
  console.log('\nO Telegram recusou o token. Confira se copiou certo do @BotFather.\n');
  console.log(JSON.stringify(dados, null, 2));
  process.exit(1);
}

const chats = new Map<number, string>();
for (const u of dados.result ?? []) {
  const chat = u.message?.chat ?? u.channel_post?.chat;
  if (chat) chats.set(chat.id, chat.username ?? chat.first_name ?? chat.title ?? '(sem nome)');
}

if (!chats.size) {
  console.log('\nNenhuma mensagem encontrada ainda.');
  console.log('Abra o Telegram, procure seu bot e mande qualquer mensagem (ex.: "oi").');
  console.log('Depois rode este comando de novo.\n');
} else {
  console.log('\nChats encontrados:\n');
  for (const [id, nome] of chats) {
    console.log(`  chat_id: ${id}   (${nome})`);
  }
  console.log('\nCole o chat_id certo em TELEGRAM_CHAT_ID no seu .env.\n');
}
