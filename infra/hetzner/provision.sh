#!/usr/bin/env bash
# Hetzner CX22 (Ubuntu 24 LTS) one-shot provisioning script.
# Run as root on a fresh box: bash provision.sh
#
# Installs: Node 22, pnpm 9, sudo user `nichefinder`, /opt/nichefinder app
# directory, systemd templates, fail2ban, ufw firewall.

set -euo pipefail

if [ "$EUID" -ne 0 ]; then
  echo "Run as root (sudo bash provision.sh)" >&2
  exit 1
fi

APP_USER="nichefinder"
APP_DIR="/opt/nichefinder"
ENV_FILE="/etc/nichefinder/env"

echo "==> apt update + base packages"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  curl ca-certificates gnupg lsb-release git rsync ufw fail2ban tzdata jq \
  build-essential python3

echo "==> timezone Europe/Amsterdam"
timedatectl set-timezone Europe/Amsterdam

echo "==> Node 22 (NodeSource)"
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

echo "==> pnpm 9 (corepack)"
corepack enable
corepack prepare pnpm@9.12.0 --activate

echo "==> app user + directories"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$APP_DIR"
install -d -o root -g "$APP_USER" -m 750 /etc/nichefinder
[ -f "$ENV_FILE" ] || install -o root -g "$APP_USER" -m 640 /dev/null "$ENV_FILE"

echo "==> ufw firewall: SSH only"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw --force enable

echo "==> fail2ban"
systemctl enable --now fail2ban

echo "==> systemd unit templates"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rsync -a "$SCRIPT_DIR/systemd/" /etc/systemd/system/
systemctl daemon-reload

echo
echo "Provisioning done."
echo "Next steps:"
echo "  1. Populate $ENV_FILE (mode 640, root:nichefinder). See env.example."
echo "  2. Run infra/hetzner/deploy.sh from CI (or manually with rsync)."
echo "  3. systemctl enable --now nichefinder-discovery.timer (etc) once jobs exist."
