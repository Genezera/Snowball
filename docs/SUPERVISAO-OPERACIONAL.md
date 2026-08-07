# Supervisão operacional do Snowball

## Supervisores existentes

| Supervisor | Script | Controla | Lock/mutex |
|---|---|---|---|
| Principal (champion) | `scripts/supervisor.sh` | 8 processos: vigilância, custódia, motor, dashboard antigo, coletor, momentum, preenchimento, pares | `vigilancia/locks/supervisor-principal.lock` + `.lockdir` |
| Paper Profit Lab | `scripts/supervisor-profit-lab` | `src/cli/paper-profit-lab.ts` | `vigilancia/locks/supervisor-profit-lab.lock` + `.lockdir` |
| Dashboard 2.0 API | `scripts/supervisor-dashboard-v2-api` | `dashboard-v2/api/server.ts` (porta 5184) | `dashboard-v2/api/logs/supervisor-api.lock` + `.lockdir` |
| Dashboard 2.0 frontend | `scripts/supervisor-dashboard-v2-frontend` | Vite dev (porta 5183) | `dashboard-v2/logs/supervisor-frontend.lock` + `.lockdir` |

Cada supervisor tem lock e mutex **próprios, nunca compartilhados**. Nenhum supervisor toca processo, arquivo, configuração ou log de outro.

**O Dashboard 2.0 possui isolamento operacional e de processo. Ele continua compartilhando o repositório e os arquivos de dados read-only do Snowball.**

## Processos supervisionados

Ver `scripts/process-manifest.json` — fonte única de verdade dos entrypoints, consultada pelo supervisor principal pra detecção por caminho normalizado (nunca mais por nome de arquivo isolado).

## Locks

Formato (`scripts/lib/supervisor-lock.sh`):
```json
{
  "pid": 74975, "pidMsys": 74975, "pidWindows": null, "pidNamespace": "msys",
  "startedAt": 1786118272631, "hostname": "...", "workingDirectory": "...",
  "scriptHash": "...", "heartbeat": 1786118274693
}
```
- Mutex atômico (`mkdir`) evita a corrida do check-then-write.
- `pidWindows: null` quando o PID MSYS não pode ser resolvido com segurança via WMI — nunca um palpite.
- Recuperação de lock stale: PID morto, PID reciclado por outro processo, ou heartbeat mais velho que 90s.

## Heartbeats

- Cada supervisor grava heartbeat próprio comprovando que **completa ciclos**, não só que está vivo (`lastLoopStarted`/`lastLoopCompleted`/`loopDurationMs`/`processesChecked`/`processesMissing`/`processesRestarted`).
- Supervisor principal: `vigilancia/supervisor-heartbeat.json`.
- Lab: `inteligencia/supervisor-status.json` (+ heartbeat do próprio Lab em `inteligencia/heartbeat.json`, separado).
- V2 API/frontend: `dashboard-v2/api/logs/supervisor-*-status.json`.

## Portas

| Processo | Porta |
|---|---|
| Dashboard antigo | 8787 |
| Dashboard 2.0 API | 5184 |
| Dashboard 2.0 frontend | 5183 |

## PID namespace (MSYS vs Windows)

O `bash.exe` do Git for Windows tem numeração de PID própria (MSYS), separada da que o WMI/Windows enxerga. Achado ao vivo: `$$` de um processo bash **nunca** aparece pro WMI. Regra fixada nesta etapa:
- `kill -0 <pid>` — única forma confiável de checar existência de um PID MSYS.
- `Get-CimInstance -Filter "ProcessId=<pid>"` (WMI/CIM) — só funciona pra PIDs nativos do Windows (ex.: `node.exe`).
- Nunca misturados silenciosamente: todo lock grava `pidMsys`, `pidWindows` (nullable) e `pidNamespace` separados.

## Circuit breakers

Todos os 4 supervisores: 5 restarts/15min OU 10/24h → `degradado` — para de tentar reiniciar sozinho, preserva o erro, não cria nenhum processo novo. Validado ao vivo na API V2 (etapa anterior): disparou de verdade, zero processo novo criado enquanto degradado.

### Procedimento de reset manual

1. Confirmar a causa raiz antes de resetar (nunca resetar sem entender por quê degradou).
2. Arquivar o log de reinícios (`mv supervisor-log.jsonl supervisor-log-arquivado-<timestamp>.jsonl`) — nunca apagar evidência.
3. Registrar o reset como evento auditável (quem, quando, por quê) antes de reiniciar o supervisor.
4. Reiniciar o supervisor — `falhas_consecutivas` reseta, janela de reinícios recomeça vazia.

## Manutenção por processo

`vigilancia/manutencao-<nome>.json` (target/startedAt/expiresAt/reason/requestedBy), janela de 90s. Documentado explicitamente:
- **Muda o log**: sim (rótulo "religado — atualização de código" em vez de "CAIU").
- **Impede restart**: não — o processo é religado de qualquer jeito.
- **Atrasa restart**: não — mesma volta do laço.
- **Silencia alerta**: sim — sem notificação no Telegram.

Manutenção de UM processo nunca mascara falha de outro — cada arquivo é específico a um nome.

## Timeouts em comandos externos

| Comando | Onde | timeoutMs | Resultado em timeout | Impacto no loop |
|---|---|---|---|---|
| `powershell` (Get-CimInstance) | todos os 4 supervisores | 8000 | `?` (desconhecido) ou string vazia | Nunca reinicia num caso ambíguo; pula a checagem desta volta pro processo afetado |
| `node -e` (parser JSON) | `scripts/lib/json-field.sh`, `process-manifest.sh` | 5000–8000 | string vazia | Campo tratado como ausente, nunca como zero fabricado |
| `curl` (Telegram, HTTP-check do frontend) | `notificar_telegram`, `http_vivo` | 8000 / 3000 | falha silenciosa (Telegram) / falso (`http_vivo`) | Notificação nunca trava o loop (roda em `&`); frontend tratado como não respondendo |
| `Stop-Process` (via powershell) | reinício de processo caído | 8000 | comando não executa, próximo `nohup` ainda tenta subir | Pode deixar um processo residual — próximo ciclo detecta e tenta de novo |

**`tasklist`, `netstat`, `find`, `stat`, `start`**: não usados diretamente por nenhum supervisor nesta versão (a detecção é 100% via WMI/PowerShell e o parser JSON via `node`). Se algum vier a ser usado no futuro, deve seguir o mesmo padrão (`timeout <segundos> <comando>`).

**Regra geral**: timeout nunca vira "processo morto" automaticamente — sempre um estado `unknown`/`?` distinto, tratado como "não sei" pelo chamador (nunca reinicia, nunca declara saudável, registra e segue pra próxima volta).

## Procedimento de diagnóstico

1. Checar o lock (`*.lock`) do supervisor relevante — PID, heartbeat, se está saudável.
2. Checar o heartbeat do supervisor (`*-heartbeat.json`/`*-status.json`) — ciclos completando? Quantos processos faltando?
3. Checar `*-command-timeouts.jsonl` — algum comando externo travando?
4. Checar `*-crash-diagnostics.jsonl` do processo supervisionado (quando existir) — exitCode/signal/stack/motivoClassificado.
5. Checar o log humano (`*-watchdog.log`) — sequência de eventos em linguagem natural.
6. Nunca inventar uma causa quando a evidência é insuficiente — registrar "causa indeterminada, evidência insuficiente" explicitamente (ver `docs/DIAGNOSTICO-QUEDA-08-28-40.md` como precedente).
