#!/bin/bash
# CISTracker server hardening script
# Based on Lynis 3.0.9 audit results
# Run as root: sudo bash scripts/harden.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
info() { echo -e "${YELLOW}[..] $1${NC}"; }
err()  { echo -e "${RED}[ERR]${NC} $1"; }

if [ "$EUID" -ne 0 ]; then
  err "Please run as root: sudo bash scripts/harden.sh"
  exit 1
fi

echo "================================================"
echo "  CISTracker Server Hardening"
echo "================================================"
echo ""

# ── 1. Update packages ────────────────────────────────────────────────────────
info "Updating system packages..."
apt-get update -qq
apt-get upgrade -y
ok "Packages updated"

# ── 2. Install security tools ─────────────────────────────────────────────────
info "Installing fail2ban and rkhunter..."
apt-get install -y fail2ban rkhunter
ok "Security tools installed"

# ── 3. Enable fail2ban ────────────────────────────────────────────────────────
info "Enabling fail2ban..."
systemctl enable fail2ban
systemctl restart fail2ban
ok "fail2ban running"

# ── 4. Harden SSH ─────────────────────────────────────────────────────────────
info "Hardening SSH configuration..."
SSHD=/etc/ssh/sshd_config

set_ssh() {
  local key="$1" val="$2"
  if grep -qE "^#?${key}" "$SSHD"; then
    sed -i "s|^#\?${key}.*|${key} ${val}|" "$SSHD"
  else
    echo "${key} ${val}" >> "$SSHD"
  fi
}

set_ssh AllowTcpForwarding   no
set_ssh X11Forwarding        no
set_ssh AllowAgentForwarding no
set_ssh MaxAuthTries         3
set_ssh MaxSessions          2
set_ssh ClientAliveCountMax  2
set_ssh TCPKeepAlive         no
set_ssh LogLevel             VERBOSE

sshd -t && systemctl restart ssh
ok "SSH hardened and restarted"

# ── 5. Harden nginx TLS ───────────────────────────────────────────────────────
info "Hardening nginx TLS configuration..."
NGINX_SITE=/etc/nginx/sites-enabled/cistracker

if [ -f "$NGINX_SITE" ]; then
  # Replace ssl_protocols line if present, otherwise append inside server block
  if grep -q "ssl_protocols" "$NGINX_SITE"; then
    sed -i 's|ssl_protocols.*|ssl_protocols TLSv1.2 TLSv1.3;|' "$NGINX_SITE"
  else
    sed -i '/listen 443/a\    ssl_protocols TLSv1.2 TLSv1.3;' "$NGINX_SITE"
  fi

  if grep -q "ssl_ciphers" "$NGINX_SITE"; then
    sed -i 's|ssl_ciphers.*|ssl_ciphers HIGH:!aNULL:!MD5;|' "$NGINX_SITE"
  else
    sed -i '/ssl_protocols/a\    ssl_ciphers HIGH:!aNULL:!MD5;' "$NGINX_SITE"
  fi

  if ! grep -q "ssl_prefer_server_ciphers" "$NGINX_SITE"; then
    sed -i '/ssl_ciphers/a\    ssl_prefer_server_ciphers on;' "$NGINX_SITE"
  fi

  nginx -t && systemctl reload nginx
  ok "nginx TLS hardened"
else
  err "nginx site config not found at $NGINX_SITE — skipping TLS hardening"
fi

# ── 6. Kernel sysctl hardening ────────────────────────────────────────────────
info "Applying kernel sysctl hardening..."
cat > /etc/sysctl.d/99-hardening.conf << 'EOF'
fs.protected_fifos = 2
fs.suid_dumpable = 0
kernel.core_uses_pid = 1
kernel.kptr_restrict = 2
kernel.sysrq = 0
kernel.unprivileged_bpf_disabled = 1
net.core.bpf_jit_harden = 2
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv4.conf.default.log_martians = 1
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
EOF
sysctl -p /etc/sysctl.d/99-hardening.conf > /dev/null
ok "Kernel parameters applied"

# ── 7. Run rkhunter baseline ──────────────────────────────────────────────────
info "Updating rkhunter database..."
rkhunter --update > /dev/null 2>&1 || true
rkhunter --propupd > /dev/null 2>&1 || true
ok "rkhunter database initialized"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "================================================"
echo "  Hardening complete"
echo "================================================"
echo ""
echo "  Next steps:"
echo "  - Run 'sudo lynis audit system' to verify score"
echo "  - Run 'sudo rkhunter --check' for malware scan"
echo "  - Run 'sudo fail2ban-client status' to check bans"
echo ""
