/**
 * Cliente MCP minimo para o trader.dev, via transporte SSE.
 *
 * Existe porque servidores MCP so sao conectados na inicializacao do Claude
 * Code. Este script fala o protocolo direto, entao da para usar o trader.dev
 * sem reiniciar nada -- e tambem serve de ferramenta de linha de comando
 * permanente para consultar a base de 87 mil backtests.
 *
 * Uso:
 *   node tools/traderdev.mjs tools
 *   node tools/traderdev.mjs call <nome_da_ferramenta> '<json de argumentos>'
 *
 * A chave vem de TRADERDEV_API_KEY. Nunca deixe a chave neste arquivo.
 */
const KEY = process.env.TRADERDEV_API_KEY ?? '';
const BASE = 'https://mcp.trader.dev';

const headers = {
  ...(KEY ? { Authorization: `Bearer ${KEY}`, 'X-API-Key': KEY } : {}),
};

/** Abre o SSE, captura o endpoint de mensagens e roteia as respostas por id. */
async function connect() {
  const ac = new AbortController();
  const res = await fetch(`${BASE}/sse`, {
    headers: { ...headers, Accept: 'text/event-stream' },
    signal: ac.signal,
  });
  if (!res.ok) throw new Error(`SSE falhou: HTTP ${res.status}`);

  const pending = new Map();
  let endpointResolve;
  const endpointReady = new Promise((r) => (endpointResolve = r));
  let messagesPath = null;

  (async () => {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        // eventos SSE sao separados por linha em branco
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const evt = {};
          for (const line of raw.split('\n')) {
            const c = line.indexOf(':');
            if (c < 0) continue;
            evt[line.slice(0, c).trim()] = line.slice(c + 1).trim();
          }
          if (evt.event === 'endpoint' && evt.data) {
            messagesPath = evt.data;
            endpointResolve();
          } else if (evt.data) {
            try {
              const msg = JSON.parse(evt.data);
              if (msg.id != null && pending.has(msg.id)) {
                pending.get(msg.id)(msg);
                pending.delete(msg.id);
              }
            } catch {
              /* keep-alive ou evento nao-JSON */
            }
          }
        }
      }
    } catch {
      /* stream encerrado */
    }
  })();

  await endpointReady;

  let nextId = 1;
  async function rpc(method, params, timeoutMs = 90_000) {
    const id = nextId++;
    const wait = new Promise((resolve, reject) => {
      pending.set(id, resolve);
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`timeout em ${method}`));
        }
      }, timeoutMs);
    });
    const r = await fetch(`${BASE}${messagesPath}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    if (!r.ok) throw new Error(`POST ${method}: HTTP ${r.status} ${await r.text()}`);
    return wait;
  }

  async function notify(method, params) {
    await fetch(`${BASE}${messagesPath}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
    });
  }

  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'snowball', version: '0.1.0' },
  });
  await notify('notifications/initialized', {});

  return { rpc, init, close: () => ac.abort() };
}

const [cmd, ...rest] = process.argv.slice(2);
const c = await connect();

try {
  if (cmd === 'tools') {
    const r = await c.rpc('tools/list', {});
    const tools = r.result?.tools ?? [];
    console.log(`servidor: ${JSON.stringify(c.init.result?.serverInfo)}`);
    console.log(`${tools.length} ferramentas:\n`);
    for (const t of tools) {
      console.log(`### ${t.name}`);
      console.log(`${(t.description ?? '').slice(0, 400)}`);
      console.log(`args: ${JSON.stringify(t.inputSchema?.properties ?? {})}`);
      if (t.inputSchema?.required) console.log(`obrigatorios: ${t.inputSchema.required.join(', ')}`);
      console.log();
    }
  } else if (cmd === 'call') {
    const name = rest[0];
    const args = rest[1] ? JSON.parse(rest[1]) : {};
    const r = await c.rpc('tools/call', { name, arguments: args });
    if (r.error) console.log('ERRO:', JSON.stringify(r.error, null, 2));
    else for (const item of r.result?.content ?? []) console.log(item.text ?? JSON.stringify(item));
  } else {
    console.log('uso: node tools/traderdev.mjs tools | call <ferramenta> \'<json>\'');
  }
} finally {
  c.close();
}
process.exit(0);
