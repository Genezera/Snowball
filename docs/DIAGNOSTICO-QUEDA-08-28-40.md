# Diagnóstico da queda do dashboard antigo às 08:28:40

**Conclusão oficial: causa histórica indeterminada, evidência insuficiente.**

## O que se sabe

- O log do watchdog (`vigilancia/supervisor-watchdog.log`) registrou `[08:28:40] dashboard CAIU` numa sessão anterior a esta etapa de trabalho.
- Na época, `src/dashboard/server.ts` não tinha nenhuma captura de diagnóstico de queda — só o próprio watchdog registrava a hora e religava, sem PID, exitCode, signal, stack trace, ou últimas linhas de stdout/stderr do processo que caiu.
- O log do processo (`spread/dashboard.log`) é sobrescrito por append contínuo do processo seguinte — na hora em que essa investigação foi feita, o trecho correspondente ao momento exato da queda já não estava mais recuperável de forma confiável.

## Por que não se tenta adivinhar uma causa

Reconstruir uma causa a partir de indícios fracos (padrão de outras quedas, hipótese de bug já corrigido depois, etc.) seria fabricar uma explicação para preencher uma lacuna de dado — exatamente o que este projeto trata como erro grave em qualquer contexto (financeiro, técnico ou de auditoria). Sem stack trace, exitCode ou log do momento exato, qualquer causa apontada seria especulação vestida de diagnóstico.

## O que muda daqui pra frente

Tanto a API V2 (`dashboard-v2/api/server.ts`) quanto — a partir da reaplicação da reversão seletiva desta etapa — o dashboard antigo (`src/dashboard/server.ts`) passam a registrar, em cada saída do processo (limpa ou não), um diagnóstico persistente append-only:

```jsonc
{
  "timestamp": 1786107287190,
  "timestampLegivel": "2026-08-07T12:54:47.190Z",
  "processo": "dashboard-v2-api",
  "pid": 15592,
  "exitCode": null,
  "signal": null,
  "stderrFinal": null,
  "stdoutFinal": null,
  "stack": null,
  "memoriaRssMB": 156,
  "porta": 5184,
  "ultimoRequest": null,
  "motivoClassificado": "startup"
}
```

Classificações possíveis: `startup`, `shutdown_limpo`, `maintenance`, `crash`, `watchdog_restart`, `porta_ocupada`, `erro_de_build`, `erro_nao_tratado`.

Uma futura queda — do dashboard antigo ou da API V2 — terá exitCode, signal, stack (quando aplicável), memória no momento, porta e a última rota servida, tudo persistido antes do processo sair, não dependente do processo continuar vivo para ser lido depois.

## Achado colateral desta investigação

Ao verificar o watchdog (`scripts/supervisor.sh`) durante o Teste de Independência A desta etapa, observou-se que ele não religou o dashboard antigo dentro do ciclo esperado de 30s depois de ele ser parado deliberadamente sob marcador de manutenção — o log ficou sem nenhuma entrada nova por mais de uma hora, apesar de dois processos `supervisor.sh` aparentemente rodando (`PID`s distintos). O dashboard foi religado manualmente para não ficar fora do ar. Isto **não foi investigado a fundo nesta etapa** — está fora do escopo do Dashboard 2.0 — mas fica registrado aqui como um problema operacional real encontrado, não uma suposição.
