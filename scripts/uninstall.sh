#!/usr/bin/env bash
#
# CyberLab On-Premises uninstaller
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/gdhughey/cyberlab-onprem/main/scripts/uninstall.sh | sudo bash
#
# By default: stops the service and removes system integration.
# Preserves /opt/cyberlab (database, uploads, .env) unless --purge is passed.

set -euo pipefail

INSTALL_DIR="/opt/cyberlab"
APP_USER="cyberlab"
SERVICE_NAME="cyberlab"
PURGE=0

for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=1 ;;
  esac
done

if [[ -t 1 ]]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; NC=''
fi

step() { echo -e "\n${BLUE}==>${NC} ${BOLD}$*${NC}"; }
ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
warn() { echo -e "  ${YELLOW}!${NC} $*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Must run as root. Try: sudo bash $0" >&2
  exit 1
fi

step "Stopping $SERVICE_NAME service"
if systemctl list-unit-files ${SERVICE_NAME}.service >/dev/null 2>&1; then
  systemctl stop ${SERVICE_NAME}.service 2>/dev/null || true
  systemctl disable --quiet ${SERVICE_NAME}.service 2>/dev/null || true
  rm -f /etc/systemd/system/${SERVICE_NAME}.service
  systemctl daemon-reload
  ok "Service removed"
else
  warn "Service was not installed"
fi

step "Removing nginx site"
rm -f /etc/nginx/sites-enabled/cyberlab /etc/nginx/sites-available/cyberlab
if command -v nginx >/dev/null 2>&1; then
  nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
  ok "nginx site removed"
fi

step "Removing firewall rule"
if command -v ufw >/dev/null 2>&1; then
  ufw delete allow 80/tcp >/dev/null 2>&1 || true
  ok "ufw rule removed (SSH rule preserved)"
fi

if [[ "$PURGE" == "1" ]]; then
  step "Purging data (--purge)"
  rm -rf "$INSTALL_DIR"
  if id "$APP_USER" &>/dev/null; then
    userdel "$APP_USER" 2>/dev/null || true
  fi
  rm -f /root/cyberlab-admin-password
  ok "All application data deleted"
else
  step "Preserving data"
  ok "$INSTALL_DIR left intact (database, uploads, .env)"
  warn "Run with --purge to delete everything"
fi

echo
echo -e "${GREEN}${BOLD}CyberLab uninstalled.${NC}"
echo
