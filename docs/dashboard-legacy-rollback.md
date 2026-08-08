# Rollback do dashboard legado (:8787)

O dashboard legado (`src/dashboard/server.ts`, porta **8787**) foi **arquivado**
na unificação. O dashboard oficial passou a ser o **Snowball Dashboard** —
frontend V2 em **:5183** + API V2 em **:5184**.

O legado **não é iniciado automaticamente** por nada: nem `iniciar.ps1`/`.cmd`,
nem `supervisor.sh`, nem reboot, nem restart dos supervisores. Ele existe no Git
apenas como **artefato arquivado**, para rollback de emergência.

## Quando usar

Só em emergência — por exemplo, se o V2 ficar indisponível e for preciso
recuperar rapidamente alguma visão ou controle que ainda **só** exista no
legado (ver a auditoria de controles em `docs/paridade-legado-v2.md`).

Não é para uso rotineiro. Manter os dois dashboards no ar ao mesmo tempo é
exatamente a confusão que a unificação eliminou.

## Como iniciar (manual, temporário)

```bash
bash scripts/dashboard-legacy-start.sh
```

- Sobe `node src/dashboard/server.ts` em background, log em `spread/dashboard-legacy.log`.
- Se já estiver rodando, não duplica.
- Abre em `http://localhost:8787`.

## Como parar

```bash
bash scripts/dashboard-legacy-stop.sh
```

- Mata **apenas** o legado (filtro `*dashboard*server.ts*` **excluindo**
  `*dashboard-v2*` — a API V2 em :5184 nunca é tocada).
- A porta 8787 volta a ficar desligada.

## Garantias

- **Não sobe sozinho:** nenhum supervisor supervisiona o legado. `supervisor.sh`
  teve a entrada `[dashboard]` removida do bloco de processos observados. Ele
  não religa o 8787 se ele cair, e não o inicia no boot.
- **Não é confundido com a V2:** a detecção de processo do sistema usa
  `scripts/process-manifest.json` com casamento por componente de caminho
  (nunca substring solta), e o filtro do stop exclui `dashboard-v2`. O antigo
  bug em que `server.ts` casava os dois servidores está fechado
  (ver `scripts/tests/process-manifest.test.sh`).
- **Não vira segundo produto:** depois de usar, pare com o stop. O estado normal
  do sistema é: 8787 desligado, 5183/5184 no ar.

## Verificação rápida

```bash
# 8787 deve estar desligado no estado normal:
curl -s -o /dev/null -w '%{http_code}' http://localhost:8787/api/dados   # espera 000 (recusado)
# canônico no ar:
curl -s -o /dev/null -w '%{http_code}' http://localhost:5184/api/v2/champion  # 200
curl -s -o /dev/null -w '%{http_code}' http://localhost:5183/                 # 200
```
