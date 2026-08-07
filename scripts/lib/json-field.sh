#!/usr/bin/env bash
# LEITURA DE JSON POR PARSER REAL — substitui a regex frágil que todos os
# supervisores usavam (`grep -o "\"campo\":[0-9]*"`), que falhava sempre
# que o JSON tinha espaço depois dos dois-pontos — o formato padrão de
# `JSON.stringify(obj, null, 2)`, usado em TODO heartbeat/lock deste
# projeto. Achado ao vivo: isso já tinha causado 9 disparos de falso
# positivo em `scripts/supervisor-profit-lab` antes de ser corrigido aqui.
#
# Usa `node -e` com `JSON.parse` de verdade — nunca regex pra campo JSON.
set -u

TIMEOUT_JSON_FIELD_S="${TIMEOUT_JSON_FIELD_S:-5}"

# ler_campo_json <arquivo> <campo>
# Devolve o valor do campo (número/string/bool como texto), string vazia
# se o campo não existir, for null, o arquivo não existir, ou o JSON for
# inválido/parcialmente escrito. NUNCA lança, nunca imprime um valor
# fabricado.
ler_campo_json() {
  local arquivo="$1" campo="$2"
  [ -f "$arquivo" ] || { echo ""; return; }
  timeout "$TIMEOUT_JSON_FIELD_S" node -e '
    const fs = require("fs");
    try {
      const bruto = fs.readFileSync(process.argv[1], "utf8");
      const obj = JSON.parse(bruto);
      const campo = process.argv[2];
      const valor = obj == null ? undefined : obj[campo];
      if (valor === undefined || valor === null) process.stdout.write("");
      else process.stdout.write(String(valor));
    } catch (e) {
      process.stdout.write("");
    }
  ' "$arquivo" "$campo" 2>/dev/null
}

# json_valido <arquivo> — 0 se o arquivo parseia como JSON válido, 1 caso
# contrário (inclui ausente, vazio, parcialmente escrito).
json_valido() {
  local arquivo="$1"
  [ -f "$arquivo" ] || return 1
  timeout "$TIMEOUT_JSON_FIELD_S" node -e '
    const fs = require("fs");
    try { JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.exit(0); }
    catch (e) { process.exit(1); }
  ' "$arquivo" 2>/dev/null
}
