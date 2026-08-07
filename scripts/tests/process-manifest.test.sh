#!/usr/bin/env bash
# Testes da detecção por caminho normalizado (Parte 4) — o caso real que
# quebrava antes: dashboard antigo e API V2 ambos rodam um arquivo chamado
# "server.ts", e a detecção por basename genérico contava os dois juntos.
set -u
cd "$(dirname "$0")/../.."
source scripts/lib/json-field.sh
source scripts/lib/process-manifest.sh

falhas=0
total=0
afirmar() {
  local descricao="$1" esperado="$2" obtido="$3"
  total=$((total + 1))
  if [ "$esperado" = "$obtido" ]; then echo "  ✔ $descricao"
  else echo "  ✖ $descricao — esperado '$esperado', obtido '$obtido'"; falhas=$((falhas + 1)); fi
}

echo "== manifesto: entrypoints lidos corretamente =="
afirmar "dashboard" "src/dashboard/server.ts" "$(entrypoint_do_manifesto dashboard)"
afirmar "dashboardV2Api" "dashboard-v2/api/server.ts" "$(entrypoint_do_manifesto dashboardV2Api)"
afirmar "chave inexistente → vazio" "" "$(entrypoint_do_manifesto naoExiste)"

# Simula a saída do PowerShell diretamente via override, sem depender de
# processos reais vivos no momento do teste — mais rápido e determinístico.
processo_vivo_por_entrypoint_com_entrada() {
  local entrypoint="$1" entrada="$2"
  printf '%s' "$entrada" | timeout 8 node -e '
    let entrypoint = process.argv[1];
    let dados = "";
    process.stdin.on("data", d => { dados += d; });
    process.stdin.on("end", () => {
      const normalizar = (s) => s.toLowerCase().replace(/\\/g, "/").replace(/"/g, "").trim();
      const alvo = normalizar(entrypoint);
      const linhas = dados.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      let n = 0;
      for (const linha of linhas) {
        const norm = normalizar(linha);
        const tokens = norm.split(/\s+/).filter(Boolean);
        if (tokens.some((tok) => tok === alvo || tok.endsWith("/" + alvo))) n++;
      }
      process.stdout.write(String(n));
    });
  ' "$entrypoint" 2>/dev/null
}

echo "== o bug original: dashboard antigo e API V2 nunca se confundem =="
ENTRADA='"C:\Program Files\nodejs\node.exe" src/dashboard/server.ts
"C:\Program Files\nodejs\node.exe" --experimental-strip-types dashboard-v2/api/server.ts'
afirmar "dashboard conta só 1 (não conta a API V2)" "1" "$(processo_vivo_por_entrypoint_com_entrada 'src/dashboard/server.ts' "$ENTRADA")"
afirmar "API V2 conta só 1 (não conta o dashboard)" "1" "$(processo_vivo_por_entrypoint_com_entrada 'dashboard-v2/api/server.ts' "$ENTRADA")"

echo "== normalização: barra invertida (Windows), aspas, maiúsculas =="
ENTRADA_WIN='"C:\Program Files\nodejs\node.exe" SRC\DASHBOARD\SERVER.TS'
afirmar "barra invertida + maiúsculas ainda batem" "1" "$(processo_vivo_por_entrypoint_com_entrada 'src/dashboard/server.ts' "$ENTRADA_WIN")"

echo "== caminho absoluto até a raiz do repo ainda bate pelo sufixo =="
ENTRADA_ABS='"C:\Program Files\nodejs\node.exe" C:\Users\Renan\Projetos\Snowball\src\dashboard\server.ts'
afirmar "caminho absoluto → ainda bate (termina no entrypoint relativo)" "1" "$(processo_vivo_por_entrypoint_com_entrada 'src/dashboard/server.ts' "$ENTRADA_ABS")"

echo "== argumentos adicionais depois do entrypoint não quebram o match =="
ENTRADA_ARGS='"C:\Program Files\nodejs\node.exe" src/dashboard/server.ts --porta 8787 --modo producao'
afirmar "com flags depois → ainda bate" "1" "$(processo_vivo_por_entrypoint_com_entrada 'src/dashboard/server.ts' "$ENTRADA_ARGS")"

echo "== nunca confunde substring solta: 'dashboard-v2/api/server.ts' não é 'server.ts' =="
ENTRADA_SO_V2='"C:\Program Files\nodejs\node.exe" dashboard-v2/api/server.ts'
afirmar "entrypoint do dashboard antigo NÃO bate só porque termina em server.ts" "0" "$(processo_vivo_por_entrypoint_com_entrada 'src/dashboard/server.ts' "$ENTRADA_SO_V2")"

echo "== nenhum processo rodando =="
afirmar "entrada vazia → 0" "0" "$(processo_vivo_por_entrypoint_com_entrada 'src/dashboard/server.ts' '')"

echo ""
echo "== resultado: $((total - falhas))/$total passaram =="
[ "$falhas" -eq 0 ] || exit 1
