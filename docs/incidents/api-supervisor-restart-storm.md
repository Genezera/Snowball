# Incidente — tempestade de reinícios do supervisor da API V2

**Data:** 2026-08-08 · **Componente:** `scripts/supervisor-dashboard-v2-api`
(watchdog da API V2, porta 5184) · **Severidade:** dashboard indisponível por
tempo prolongado; **nenhum** impacto em motor, estratégia ou capital.

Registro de evidência bruta. **Não** foi apagado nem redefinido para declarar o
incidente "resolvido" — a mitigação (reset do supervisor) e a evidência
convivem aqui. Conclusões vêm com suas limitações.

## Carga presente no momento

Execução do gate das cinco páginas rodando **tudo ao mesmo tempo**:

- 2 suítes Playwright consolidadas (chromium-desktop, ~15 min cada) — suite1
  06:43–06:59Z, suite2 06:59–07:14Z;
- sessão de 30 min em build de produção (Playwright headless + `vite preview`) —
  07:14–07:44Z, que **mata a API de propósito** em t≈15min (~07:29Z);
- os 8 processos de trading + 4 supervisores;
- checagens de processo por `Get-CimInstance` (PowerShell) de vários supervisores
  a cada 15–30s.

Ou seja: CPU saturada por navegadores headless + type-stripping + WMI/CIM
concorrentes.

## Horário e quantidade de restarts

- Último start bem-sucedido da API antes do incidente: **06:40:40Z** (PID 18060),
  em `dashboard-v2/api/logs/api.log`.
- A sessão matou a API em ~07:29Z. **Depois disso não há nenhuma linha
  "Dashboard 2.0 API no ar" nova** no api.log — nenhum respawn chegou a logar
  um servidor no ar.
- `supervisor-watchdog.log` (API V2): sequência repetida
  `API V2 degradada — 52 reinícios em 15min / 67 em 24h — parando de tentar
  reiniciar sozinho` (janela ~07:40–07:46Z).
- `supervisor-status.json` no fim: `statusSupervisor: "degradado"`,
  `reinicios24h: 70`, `falhasConsecutivas: 61`,
  `motivoUltimoReinicio: "PID 18060 do heartbeat não está mais vivo (crash provável)"`.

## Entrada em modo degradado (circuit breaker)

O supervisor tem limites: `MAX_REINICIOS_15MIN=5`, `MAX_REINICIOS_24H=10`. Ao
ultrapassá-los, entra em **degradado** e **para de reiniciar** (é o
circuit-breaker por design). Foi o que aconteceu: os 70 restarts em 24h
estouraram o teto e o supervisor parou — deixando a API **caída** e sem
auto-recuperação.

## Heartbeat de 30 segundos

Parâmetros do watchdog: `INTERVALO_CHECAGEM_S=15`, `IDADE_MAXIMA_HEARTBEAT_S=30`.
Se a API não escreve heartbeat em 30s, o supervisor a considera morta e
reinicia. Sob a carga acima, um cold-start pode passar de 30s (ver abaixo),
fazendo o supervisor matar uma API **ainda subindo** e respawnar — laço.

## Cold-start com type stripping

A API sobe via `node --experimental-strip-types dashboard-v2/api/server.ts` — o
type-stripping ocorre no cold-start. Com CPU saturada, esse cold-start pode
exceder o teto de 30s de heartbeat, disparando o kill-mid-boot descrito.

## Comportamento de backoff

**Não há backoff exponencial.** O supervisor tenta a cada 15s até bater o teto
e então **para** (degradado). Não há espera crescente entre tentativas — o que
acelera o acúmulo de restarts sob carga.

## Estado das locks

Locks próprios do supervisor: `supervisor-api.lock` / `supervisor-api.lockdir`.
Não houve evidência de lock preso do supervisor. O lock do **processo** da API é
o próprio bind da porta (ver adiante).

## Tempo de liberação da porta

A API trata `EADDRINUSE` explicitamente (`api/server.ts`: "porta já está em uso
— não sobe uma segunda") — loga e sai, **não** entra em crash-loop por porta.
Após um kill abrupto, a porta 5184 pode ficar brevemente em TIME_WAIT; um
respawn imediato nessa janela sairia por porta ocupada. **Não medi** o tempo
exato de liberação neste incidente (limitação).

## Hipótese de causa

Sob **carga extrema concorrente**, o cold-start com type-stripping da API
excedeu o teto de heartbeat de 30s; o supervisor matou a API ainda subindo e
respawnou repetidamente (possivelmente com respawns também saindo por porta em
TIME_WAIT), sem backoff, acumulando restarts até o teto de 24h → **degradado**
→ parou de reiniciar → API ficou caída.

## Evidência observada (resumo)

- api.log: sem "API no ar" após 06:40 apesar de dezenas de restarts registrados.
- supervisor-watchdog.log: dezenas de linhas "degradada … parando de reiniciar".
- supervisor-status.json: degradado, 70 restarts/24h, 61 falhas consecutivas.
- **Contraprova de que o servidor está íntegro:** start manual da API
  (`node --experimental-strip-types api/server.ts`) subiu e serviu **200 em ~4s**
  fora da carga. O defeito é do **supervisor sob carga**, não do servidor.
- **Recuperação após reset:** com um supervisor único e saudável em carga baixa,
  a sessão de 30 min re-executada matou a API 1× e ela **recuperou em ~13s**
  (`API recuperou=true`), sessão aprovada.

## Mitigação aplicada (não é "resolução")

Rotacionei `supervisor-log.jsonl` (que alimenta a contagem de restarts) para
`.storm-*.bak`, removi `supervisor-status.json`/`heartbeat.json`/lock, e subi
**um** supervisor limpo. A API voltou estável (`saudavel`, `degradado:false`).
A evidência da tempestade foi **preservada** no `.bak`.

## Limitações da conclusão

- O modo exato de falha de cada respawn **não** está diretamente evidenciado
  (os respawns morreram antes de logar): kill-mid-boot vs EADDRINUSE é
  **inferido**, não medido linha a linha.
- O tempo de liberação da porta 5184 não foi medido no incidente.
- A hipótese "cold-start > 30s sob carga" é plausível e consistente com a
  evidência, mas não foi cronometrada sob a carga exata do incidente.
- Houve **um** supervisor da API no incidente (cadeia bash aninhada), não
  múltiplos — descartada a hipótese de supervisores duplicados brigando.

## Proposta de blindagem (NÃO aplicada — gate anterior proíbe mudar esta camada sem aprovação)

Registrada como proposta, para diagnóstico + decisão antes de qualquer mudança:

1. **Heartbeat tolerante a cold-start:** primeira janela de graça maior (ex.:
   60–90s) só para o primeiro heartbeat após um (re)start, separando
   "demorou pra subir" de "morreu".
2. **Backoff exponencial** entre respawns (ex.: 2s, 4s, 8s…) para não acumular
   restarts sob carga.
3. **Espera de liberação de porta** antes do respawn (probe TCP a 5184 até
   liberar, com teto).
4. **Auto-heal do degradado:** sair do modo degradado após N minutos sem
   incidentes, em vez de exigir intervenção manual.
5. **Pré-build/cache** do type-stripping para encurtar o cold-start.

Ver o teste operacional isolado em `scripts/tests/api-supervisor-recovery-test.sh`
e seus resultados em `docs/incidents/api-supervisor-test-resultado.md`.
