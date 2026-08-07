#!/usr/bin/env bash
# DETECÇÃO EXATA DE PROCESSOS (Parte 4) — substitui o reconhecimento
# genérico por basename ("server.ts" + exceção manual "não contém
# dashboard-v2") por comparação de CAMINHO NORMALIZADO contra
# scripts/process-manifest.json. Isso é o que fecha de vez a classe
# inteira de bug que causou o falso-negativo original (dashboard antigo
# nunca detectado como caído enquanto a API V2 também rodava "server.ts").
set -u

MANIFEST_FILE="${MANIFEST_FILE:-scripts/process-manifest.json}"

# processo_vivo_por_entrypoint <entrypointRelativo>
# Conta processos node.exe cuja CommandLine, depois de normalizada
# (barra invertida→normal, aspas removidas, minúsculas), contém o
# entrypoint como um COMPONENTE DE CAMINHO — não uma substring solta em
# qualquer posição. Trata `/` e `\`, aspas, caminho relativo/absoluto,
# diferença de maiúsculas do Windows, e argumentos adicionais do node
# (o entrypoint pode vir seguido de --flags, nunca exige fim de linha).
processo_vivo_por_entrypoint() {
  local entrypoint="$1"
  local saida rc
  saida=$(timeout 8 powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object -ExpandProperty CommandLine" 2>/dev/null)
  rc=$?
  if [ "$rc" -eq 124 ]; then echo "?"; return; fi
  printf '%s' "$saida" | timeout 8 node -e '
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
        // O entrypoint aparece como um ARGUMENTO separado na linha de
        // comando (separado por espaço do "node.exe" e de outras flags),
        // nunca embutido dentro de outro token maior -- por isso quebra em
        // tokens e compara cada um inteiro, não uma busca de substring na
        // linha toda (que é exatamente o que causava o bug original:
        // "server.ts" substring batendo em QUALQUER caminho que terminasse
        // assim). Um token bate se for IGUAL ao alvo (caminho relativo
        // exato) ou terminar em "/" + alvo (mesmo caminho relativo, só que
        // prefixado por um caminho absoluto até a raiz do repo).
        const tokens = norm.split(/\s+/).filter(Boolean);
        const bate = tokens.some((tok) => tok === alvo || tok.endsWith("/" + alvo));
        if (bate) n++;
      }
      process.stdout.write(String(n));
    });
  ' "$entrypoint" 2>/dev/null
}

# entrypoint_do_manifesto <chave> -- entrypoint é um campo ANINHADO
# (manifesto[chave].entrypoint), então usa node direto em vez de
# ler_campo_json (que só lê campos de topo).
entrypoint_do_manifesto() {
  local chave="$1"
  [ -f "$MANIFEST_FILE" ] || { echo ""; return; }
  timeout 5 node -e '
    const fs = require("fs");
    try {
      const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const entrada = m[process.argv[2]];
      process.stdout.write(entrada && entrada.entrypoint ? entrada.entrypoint : "");
    } catch (e) { process.stdout.write(""); }
  ' "$MANIFEST_FILE" "$chave" 2>/dev/null
}
