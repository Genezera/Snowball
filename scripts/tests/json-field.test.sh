#!/usr/bin/env bash
# Testes do parser de JSON real — os 8 cenários pedidos explicitamente.
set -u
cd "$(dirname "$0")/../.."
DIR_TESTE=$(mktemp -d)
source scripts/lib/json-field.sh

falhas=0
total=0
afirmar() {
  local descricao="$1" esperado="$2" obtido="$3"
  total=$((total + 1))
  if [ "$esperado" = "$obtido" ]; then echo "  ✔ $descricao"
  else echo "  ✖ $descricao — esperado '$esperado', obtido '$obtido'"; falhas=$((falhas + 1)); fi
}

ARQ="$DIR_TESTE/teste.json"

echo "== JSON compacto: {\"pid\":20908} =="
printf '{"pid":20908}' > "$ARQ"
afirmar "pid compacto" "20908" "$(ler_campo_json "$ARQ" pid)"

echo "== JSON formatado (o caso real que quebrava a regex antiga): espaço depois dos dois-pontos =="
printf '{\n  "pid": 20908,\n  "startedAt": 123\n}\n' > "$ARQ"
afirmar "pid formatado com espaço" "20908" "$(ler_campo_json "$ARQ" pid)"

echo "== espaços extras em vários lugares =="
printf '{ "pid"   :    20908  ,  "x" : 1 }' > "$ARQ"
afirmar "espaços extras" "20908" "$(ler_campo_json "$ARQ" pid)"

echo "== quebras de linha no meio do valor/estrutura =="
printf '{\n\n  "pid":\n    20908\n\n}\n' > "$ARQ"
afirmar "quebras de linha" "20908" "$(ler_campo_json "$ARQ" pid)"

echo "== campo ausente =="
printf '{"outroCampo": 1}' > "$ARQ"
afirmar "campo ausente → vazio" "" "$(ler_campo_json "$ARQ" pid)"

echo "== PID nulo (heartbeat existe mas processo nunca chegou a rodar) =="
printf '{"pid": null}' > "$ARQ"
afirmar "pid null → vazio, nunca a string 'null'" "" "$(ler_campo_json "$ARQ" pid)"

echo "== JSON inválido =="
printf '{"pid": 20908, isto nao fecha' > "$ARQ"
afirmar "JSON inválido → vazio, nunca lança" "" "$(ler_campo_json "$ARQ" pid)"
total=$((total + 1))
if json_valido "$ARQ"; then echo "  ✖ json_valido deveria ter recusado JSON inválido"; falhas=$((falhas+1))
else echo "  ✔ json_valido recusa JSON inválido"; fi

echo "== arquivo parcialmente escrito (motor gravando no meio de um write) =="
printf '{"pid": 20908, "startedAt": 17861' > "$ARQ"
afirmar "arquivo truncado a meio de escrita → vazio, nunca lança" "" "$(ler_campo_json "$ARQ" pid)"

echo "== arquivo inexistente =="
rm -f "$ARQ"
afirmar "arquivo inexistente → vazio" "" "$(ler_campo_json "$ARQ" pid)"

echo "== campo string (não numérico) — confirma que não é só regex de dígito =="
printf '{"motivoUltimoReinicio": "algo aconteceu"}' > "$ARQ"
afirmar "campo string" "algo aconteceu" "$(ler_campo_json "$ARQ" motivoUltimoReinicio)"

echo "== campo boolean =="
printf '{"degradado": true}' > "$ARQ"
afirmar "campo boolean" "true" "$(ler_campo_json "$ARQ" degradado)"

rm -rf "$DIR_TESTE"

echo ""
echo "== resultado: $((total - falhas))/$total passaram =="
[ "$falhas" -eq 0 ] || exit 1
