#!/usr/bin/env bash
# FOrdre — arrencar el servidor del taller a mà (Linux o macOS)
#   bash servidor/inicia.sh            (per aturar-lo: Ctrl+C)
cd "$(dirname "$0")/.."
if ! command -v node >/dev/null 2>&1; then
    echo "Cal Node.js 18 o superior: https://nodejs.org"; exit 1
fi
exec node servidor/fordre-servidor.js "$@"
