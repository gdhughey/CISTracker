#!/bin/bash
# CISTracker server hardening script
# Based on Lynis 3.0.9 audit results
# Run as root: sudo bash scripts/harden.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
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

# ── 1. SSH key setup (MUST happen before locking down passwords) ──────────────
echo -e "${CYAN}Step 1 of 7: SSH Key Setup${NC}"
echo ""

SSH_USER="${SUDO_USER:-cisadmin}"
SSH_HOME=$(eval echo "~$SSH_USER")
AUTH_KEYS="$SSH_HOME/.ssh/authorized_keys"

mkdir -p "$SSH_HOME/.ssh"
chmod 700 "$SSH_HOME/.ssh"

if [ -s "$AUTH_KEYS" ]; then
  echo "  Existing authorized_keys found:"
  echo ""
  cat "$AUTH_KEYS" | while read -r line; do
    echo "    ${line:0:60}..."
  done
  echo ""
  read -rp "  Add another key? (y/N): " ADD_KEY
else
  echo "  No SSH keys found. You MUST add one now or you will be locked out."
  ADD_KEY="y"
fi

if [[ "$ADD_KEY" =~ ^[Yy]$ ]]; then
  echo ""
  echo -e "${CYAN}  Paste your PUBLIC key below (starts with ssh-rsa, ssh-ed25519, etc.)${NC}"
  echo -e "${CYAN}  then press Enter twice:${NC}"
  echo ""
  read -rp "  > " PUBKEY
  if [ -z "$PUBKEY" ]; then
    err "No key entered — aborting to avoid lockout"
    exit 1
  fi
  echo "$PUBKEY" >> "$AUTH_KEYS"
  chown -R "$SSH_USER:$SSH_USER" "$SSH_HOME/.ssh"
  chmod 600 "$AUTH_KEYS"
  ok "SSH key added to $AUTH_KEYS"
fi

echo ""
echo -e "${YELLOW}  IMPORTANT: Open a second terminal NOW and verify you can SSH in with your key:${NC}"
echo -e "${YELLOW}  ssh -p 2222 ${SSH_USER}@<tailscale-ip>${NC}"
echo ""
read -rp "  Can you log in with your SSH key? (yes/no): " KEY_WORKS

if [[ "$KEY_WORKS" != "yes" ]]; then
  err "Key login not confirmed — skipping password lockdown to avoid lockout"
  err "Fix your key first, then re-run this script"
  LOCKDOWN=false
else
  ok "Key login confirmed — will lock SSH to keys only"
  LOCKDOWN=true
fi

# ── 2. Update packages ────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}Step 2 of 7: System package updates${NC}"
info "Updating system packages..."
apt-get update -qq
apt-get upgrade -y
ok "Packages updated"

# ── 3. Install security tools ─────────────────────────────────────────────────
echo ""
echo -e "${CYAN}Step 3 of 7: Security tools${NC}"
info "Installing fail2ban and rkhunter..."
apt-get install -y fail2ban rkhunter
systemctl enable fail2ban
systemctl restart fail2ban
ok "fail2ban installed and running"

# ── 4. Harden SSH ─────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}Step 4 of 7: SSH hardening${NC}"
info "Hardening SSH configuration..."
SSHD=/etc/ssh/sshd_config

set_ssh() {
  local key="$1" val="$2"
  if grep -qE "^#?\s*${key}\b" "$SSHD"; then
    sed -i -E "s|^#?\s*${key}\b.*|${key} ${val}|" "$SSHD"
  else
    echo "${key} ${val}" >> "$SSHD"
  fi
}

set_ssh Port                 2222
set_ssh AllowTcpForwarding   no
set_ssh X11Forwarding        no
set_ssh AllowAgentForwarding no
set_ssh MaxAuthTries         3
set_ssh MaxSessions          2
set_ssh ClientAliveCountMax  2
set_ssh TCPKeepAlive         no
set_ssh LogLevel             VERBOSE

if [ "$LOCKDOWN" = true ]; then
  set_ssh PasswordAuthentication no
  set_ssh PubkeyAuthentication   yes
  set_ssh AuthorizedKeysFile     .ssh/authorized_keys
  set_ssh PermitEmptyPasswords   no
  ok "Password authentication DISABLED — keys only"
else
  info "Skipped password lockdown (key not verified)"
fi

sshd -t && systemctl restart ssh
ok "SSH restarted on port 2222"

# ── 5. Harden nginx TLS ───────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}Step 5 of 7: nginx TLS hardening${NC}"
NGINX_SITE=/etc/nginx/sites-enabled/cistracker

if [ -f "$NGINX_SITE" ]; then
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
  ok "nginx TLS hardened (TLSv1.2/1.3 only)"
else
  err "nginx site config not found at $NGINX_SITE — skipping"
fi

# ── 6. Kernel sysctl hardening ────────────────────────────────────────────────
echo ""
echo -e "${CYAN}Step 6 of 7: Kernel hardening${NC}"
info "Applying sysctl parameters..."
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

# ── 7. rkhunter baseline ──────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}Step 7 of 7: rkhunter baseline${NC}"
info "Building rkhunter file database..."
rkhunter --update > /dev/null 2>&1 || true
rkhunter --propupd > /dev/null 2>&1 || true
ok "rkhunter database initialized"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "================================================"
echo "  Hardening complete"
echo "================================================"
echo ""
if [ "$LOCKDOWN" = true ]; then
  echo -e "${GREEN}  SSH: port 2222, keys only, passwords blocked${NC}"
else
  echo -e "${YELLOW}  SSH: port 2222 set — passwords still enabled (key not verified)${NC}"
  echo -e "${YELLOW}  Re-run after confirming key login to finish lockdown${NC}"
fi
echo ""
echo "  Verify:"
echo "    sudo lynis audit system          # new hardening score"
echo "    sudo rkhunter --check            # malware scan"
echo "    sudo fail2ban-client status      # check bans"
echo ""
