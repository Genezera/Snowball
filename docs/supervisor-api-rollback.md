# Rollback do supervisor da API V2 (blindado → anterior)

Permite voltar imediatamente ao supervisor da API **anterior** à blindagem, sem
tocar nos motores e sem restaurar o dashboard legado (:8787 continua arquivado).

## Baseline preservado

- **Tag:** `supervisor-api-pre-hardening` → commit `4ace181` (estado da
  unificação, supervisor original intacto).
- **Backup do arquivo:** `scripts/supervisor-dashboard-v2-api.pre-hardening.bak`
  (cópia byte-a-byte do supervisor original).
- **Evidência do incidente preservada** (nunca apagada):
  `docs/incidents/api-supervisor-restart-storm.md`,
  `.../api-supervisor-test-resultado.md`, e os backups `*.storm-*.bak` em
  `dashboard-v2/api/logs/`.

## Como reverter (imediato)

```bash
# 1. parar SÓ o supervisor da API (a API em si continua viva)
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='bash.exe'\" | Where-Object { \$_.CommandLine -like '*supervisor-dashboard-v2-api*' } | ForEach-Object { taskkill /PID \$_.ProcessId /F /T }"

# 2. restaurar o supervisor anterior (do backup OU do git)
cp scripts/supervisor-dashboard-v2-api.pre-hardening.bak scripts/supervisor-dashboard-v2-api
#   ou:  git checkout supervisor-api-pre-hardening -- scripts/supervisor-dashboard-v2-api

# 3. subir de novo (WMI, destacado do terminal)
powershell -NoProfile -Command "Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine='\"C:\Program Files\Git\bin\bash.exe\" \"'+(Resolve-Path scripts/supervisor-dashboard-v2-api)+'\"'; CurrentDirectory=(Get-Location).Path }"
```

## Garantias do rollback

- **Não toca motores/estratégias:** só o supervisor da API é parado/substituído.
- **Não restaura o legado:** o :8787 permanece arquivado (a unificação não é
  reaberta).
- **API continua viva:** parar o supervisor não derruba a API — só deixa de
  supervisioná-la até o supervisor voltar.
- **Reversível de volta:** para retomar o blindado,
  `git checkout snowball-supervisor-api-resiliente -- scripts/supervisor-dashboard-v2-api`
  (tag da blindagem) e subir de novo.
