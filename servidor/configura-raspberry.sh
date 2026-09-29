#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# FOrdre — instal·lació del servidor del taller en una Raspberry Pi
# (o qualsevol Linux amb systemd: Debian, Ubuntu, Raspberry Pi OS…)
#
#   cd FOrdre && sudo bash servidor/configura-raspberry.sh
#
# Instal·la Node.js si cal i crea el servei «fordre», que arrenca sol
# cada cop que s'encén la màquina. Opcions (variables d'entorn):
#   FORDRE_PORT=8443 FORDRE_PORT_HTTP=8080 FORDRE_CLAU=1234 sudo -E bash …
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Executa-ho amb sudo: sudo bash $0"; exit 1; fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USUARI="${SUDO_USER:-$(logname 2>/dev/null || echo pi)}"
PORT="${FORDRE_PORT:-8443}"
PORT_HTTP="${FORDRE_PORT_HTTP:-8080}"
CLAU="${FORDRE_CLAU:-}"

echo "▶ Carpeta de FOrdre: $DIR"
echo "▶ Usuari del servei: $USUARI"

# 1. Node.js (18 o superior)
versio_node() { node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0; }
if [ "$(versio_node)" -lt 18 ]; then
    echo "▶ Instal·lant Node.js…"
    apt-get update -y
    apt-get install -y nodejs
fi
if [ "$(versio_node)" -lt 18 ]; then
    echo "❌ Cal Node.js 18 o superior (ara: $(node -v 2>/dev/null || echo cap))."
    echo "   Instal·la'l des de https://nodejs.org o amb: curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs"
    exit 1
fi
echo "▶ Node.js $(node -v)"

# 2. Permís per obrir ports < 1024 no cal: fem servir 8443 i 8080
# 3. Nom de xarxa .local (avahi): ja ve a Raspberry Pi OS
if ! command -v avahi-daemon >/dev/null 2>&1; then
    apt-get install -y avahi-daemon || true
fi

# 4. Servei systemd
cat > /etc/systemd/system/fordre.service <<EOF
[Unit]
Description=FOrdre - servidor del taller
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USUARI
WorkingDirectory=$DIR
Environment=FORDRE_PORT=$PORT
Environment=FORDRE_PORT_HTTP=$PORT_HTTP
Environment=FORDRE_CLAU=$CLAU
ExecStart=$(command -v node) $DIR/servidor/fordre-servidor.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

mkdir -p "$DIR/servidor/dades"
chown -R "$USUARI" "$DIR/servidor/dades"
systemctl daemon-reload
systemctl enable --now fordre.service
sleep 3

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "✅ FOrdre està en marxa i arrencarà sol cada cop que s'encengui."
echo "   App de muntatge:  https://$IP:$PORT/muntatge.html"
echo "   App de disseny:   https://$IP:$PORT/index.html"
echo "   Nom de xarxa:     https://$(hostname).local:$PORT/muntatge.html"
echo "   Primer cop:       http://$IP:$PORT_HTTP/   (certificat i ajuda)"
echo
echo "   Veure el QR i el registre:  journalctl -u fordre -f"
echo "   Aturar / reiniciar:         sudo systemctl stop|restart fordre"
echo "   Actualitzar FOrdre:         cd $DIR && git pull && sudo systemctl restart fordre"
