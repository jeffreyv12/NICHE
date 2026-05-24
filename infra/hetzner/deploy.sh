#!/usr/bin/env bash
# Deploy scrapers to Hetzner. Invoked by .github/workflows/deploy-hetzner.yml.
# Requires:
#   HETZNER_HOST  – DNS or IP
#   HETZNER_USER  – SSH user with passwordless sudo for systemctl
# SSH key already loaded into ~/.ssh/id_ed25519.

set -euo pipefail

: "${HETZNER_HOST:?HETZNER_HOST required}"
: "${HETZNER_USER:?HETZNER_USER required}"

APP_DIR="/opt/nichefinder"
REMOTE="${HETZNER_USER}@${HETZNER_HOST}"

echo "==> rsync workspace to ${REMOTE}:${APP_DIR}"
# Sync only what scrapers need at runtime: built dist + node_modules + workspace
# package manifests + the systemd units. Source TS is not needed in prod.
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules/.cache' \
  --exclude '**/node_modules/.bin' \
  --exclude 'apps/web' \
  --exclude '**/.next' \
  --exclude '**/.turbo' \
  --exclude 'docs' \
  ./ "${REMOTE}:${APP_DIR}/"

echo "==> remote: pnpm install --prod"
ssh "${REMOTE}" "cd ${APP_DIR} && pnpm install --prod --frozen-lockfile"

echo "==> remote: rsync systemd units + reload"
ssh "${REMOTE}" "sudo rsync -a ${APP_DIR}/infra/hetzner/systemd/ /etc/systemd/system/ && sudo systemctl daemon-reload"

echo "==> remote: restart enabled units (timers + the long-running runner stub)"
ssh "${REMOTE}" "sudo systemctl list-unit-files 'nichefinder-*' --no-legend | awk '{print \$1}' | xargs -r sudo systemctl restart || true"

echo "Deploy OK."
