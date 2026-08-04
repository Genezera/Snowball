/**
 * NOTIFICAÇÕES TELEGRAM — best-effort, nunca derruba quem chamou.
 *
 * Token e chat id vêm SÓ de variáveis de ambiente (TELEGRAM_BOT_TOKEN,
 * TELEGRAM_CHAT_ID) — nunca de arquivo versionado, nunca hardcoded. Se não
 * estiverem configuradas, `enviarTelegram` não faz nada: retorna `false`
 * silenciosamente, sem lançar erro. O motor não pode parar de operar porque
 * uma notificação falhou.
 *
 * O que dispara notificação, por design — só o que é raro e importa:
 *   abre / fecha posição      é dinheiro de verdade mudando de mãos
 *   motor parado (piso)       precisa de decisão humana pra retomar
 *   processo caiu             o watchdog religa sozinho, mas vale saber
 *
 * O que NÃO dispara — aconteceria a cada 5 minutos e viraria ruído:
 *   'bloqueado' (o motor decide não abrir, o caso mais comum de longe)
 *   'leitura' (heartbeat da curva de capital)
 */
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export const TELEGRAM_CONFIGURADO = Boolean(TOKEN && CHAT_ID);

export async function enviarTelegram(mensagem: string): Promise<boolean> {
  if (!TOKEN || !CHAT_ID) return false;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: mensagem, parse_mode: 'HTML' }),
      signal: AbortSignal.timeout(8000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}
