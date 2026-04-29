#!/usr/bin/env bash
set -euo pipefail

# CISTracker Linux VM installer
# Tested target: Ubuntu 22.04/24.04 or Debian 12
#
# What this does:
# - Installs Node.js 20, Git, SQLite, Nginx, OpenSSL, mkcert, and build tools
# - Clones https://github.com/gdhughey/CISTracker into /opt/CISTracker
# - Creates a system user, .env with a generated SESSION_SECRET
# - Installs npm dependencies (with mirror fallback for restricted networks)
# - Runs database migration/seed scripts
# - Creates a systemd service named cistracker
# - Configures Nginx HTTPS reverse proxy on port 443 (with mkcert local CA)
#   when STATIC_IP is provided; falls back to HTTP on port 80 otherwise
# - Adds SSH on port 2222 for Tailscale remote access
# - (Optional) Installs Tailscale for remote SSH maintenance
#
# This script is idempotent. It is safe to re-run on a partially installed host.
#
# Usage:
#   sudo STATIC_IP=10.0.2.10 bash install-cistracker.sh
#
# If your LAN uses different gateway/DNS, override them:
#   sudo STATIC_IP=10.0.2.10 GATEWAY=192.168.1.1 DNS_SERVER=192.168.1.1 bash install-cistracker.sh
#
# All options (pass as env vars):
#   STATIC_IP        LAN IP to assign to this server (required for HTTPS)
#   STATIC_NETMASK   CIDR prefix length (default: 16)
#   GATEWAY          LAN default gateway (default: 10.0.255.1)
#   DNS_SERVER       LAN DNS server IP (default: 10.2.201.4)
#   DOMAIN           App domain name (default: cistracker.net)
#   SSH_EXTRA_PORT   Extra SSH port for Tailscale access (default: 2222)
#   SKIP_TAILSCALE   Set to 1 to skip Tailscale install (default: 0)
#   MKCERT_VERSION   mkcert binary version (default: v1.4.4)
#
# To skip Tailscale:
#   sudo STATIC_IP=10.0.2.10 SKIP_TAILSCALE=1 bash install-cistracker.sh

APP_NAME="cistracker"
REPO_URL="${REPO_URL:-https://github.com/gdhughey/CISTracker.git}"
APP_DIR="${APP_DIR:-/opt/CISTracker}"
APP_USER="${APP_USER:-cistracker}"
APP_PORT="${APP_PORT:-3000}"
NODE_MAJOR="${NODE_MAJOR:-20}"
NPM_PRIMARY_REGISTRY="${NPM_PRIMARY_REGISTRY:-https://registry.npmjs.org/}"
NPM_FALLBACK_REGISTRY="${NPM_FALLBACK_REGISTRY:-https://registry.npmmirror.com}"
STATIC_IP="${STATIC_IP:-}"
STATIC_NETMASK="${STATIC_NETMASK:-16}"        # /16 = 255.255.0.0 — change to 24 for typical /24 LANs
GATEWAY="${GATEWAY:-10.0.255.1}"               # site-specific — set via env var if different
DNS_SERVER="${DNS_SERVER:-10.2.201.4}"         # site-specific — set via env var if different
DOMAIN="${DOMAIN:-cistracker.net}"             # must resolve to STATIC_IP on client machines
SSH_EXTRA_PORT="${SSH_EXTRA_PORT:-2222}"
SKIP_TAILSCALE="${SKIP_TAILSCALE:-0}"
MKCERT_VERSION="${MKCERT_VERSION:-v1.4.4}"

log() {
  echo
  echo "==> $*"
}

warn() {
  echo
  echo "WARNING: $*" >&2
}

configure_static_ip() {
  if [[ -z "${STATIC_IP}" ]]; then
    log "No STATIC_IP set — skipping static IP configuration (server will use DHCP)"
    return
  fi

  log "Configuring static IP ${STATIC_IP}/${STATIC_NETMASK}"

  # Detect primary non-loopback interface
  local iface
  iface="$(ip -o link show | awk '$2 != "lo:" {print $2}' | head -1 | tr -d ':')"

  mkdir -p /etc/netplan
  # Write config; this overwrites any existing 00-installer-config.yaml
  cat > /etc/netplan/00-installer-config.yaml <<NETPLAN
network:
  version: 2
  ethernets:
    ${iface}:
      dhcp4: false
      addresses: [${STATIC_IP}/${STATIC_NETMASK}]
      routes:
        - to: default
          via: ${GATEWAY}
      nameservers:
        addresses: [${DNS_SERVER}]
NETPLAN

  netplan apply
  log "Static IP ${STATIC_IP} applied on ${iface}"
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "Please run this installer with sudo or as root." >&2
    exit 1
  fi
}

detect_os() {
  if [[ ! -f /etc/os-release ]]; then
    echo "Could not detect OS. This script expects Ubuntu/Debian." >&2
    exit 1
  fi

  # shellcheck disable=SC1091
  source /etc/os-release
  case "${ID:-}" in
    ubuntu|debian)
      ;;
    *)
      warn "Detected ${PRETTY_NAME:-unknown OS}. This script is intended for Ubuntu/Debian."
      ;;
  esac
}

install_system_packages() {
  log "Installing system packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    git \
    sqlite3 \
    nginx \
    build-essential \
    openssl
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    CURRENT_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [[ "${CURRENT_MAJOR}" -ge "${NODE_MAJOR}" ]]; then
      log "Node.js $(node --version) already installed"
      return
    fi
  fi

  log "Installing Node.js ${NODE_MAJOR}"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs

  log "Installed Node.js $(node --version) and npm $(npm --version)"
}

create_app_user() {
  if id "${APP_USER}" >/dev/null 2>&1; then
    log "User ${APP_USER} already exists"
  else
    log "Creating system user ${APP_USER}"
    useradd --system --create-home --shell /usr/sbin/nologin "${APP_USER}"
  fi
}

clone_or_update_repo() {
  log "Installing app into ${APP_DIR}"

  # Avoid git "dubious ownership" / safe.directory failures regardless of
  # who previously owned APP_DIR.
  git config --global --add safe.directory "${APP_DIR}" || true

  if [[ -d "${APP_DIR}/.git" ]]; then
    log "Existing repository found. Pulling latest main"
    # Fix ownership before any git ops so fetch/pull succeed cleanly.
    chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
    sudo -u "${APP_USER}" git -C "${APP_DIR}" fetch origin
    sudo -u "${APP_USER}" git -C "${APP_DIR}" checkout main
    sudo -u "${APP_USER}" git -C "${APP_DIR}" pull --ff-only origin main
  elif [[ -d "${APP_DIR}" ]] && [[ -n "$(ls -A "${APP_DIR}" 2>/dev/null || true)" ]]; then
    warn "${APP_DIR} exists but is not a git repo. Backing up to ${APP_DIR}.bak.$$ and re-cloning."
    mv "${APP_DIR}" "${APP_DIR}.bak.$$"
    git clone "${REPO_URL}" "${APP_DIR}"
  else
    rm -rf "${APP_DIR}"
    git clone "${REPO_URL}" "${APP_DIR}"
  fi

  install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_DIR}/data" "${APP_DIR}/uploads"
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
}

detect_app_url() {
  # If a static IP and domain are configured, the app is served over HTTPS.
  if [[ -n "${STATIC_IP}" ]]; then
    echo "https://${DOMAIN}"
    return
  fi
  # Otherwise use the LAN IP (no outbound internet call).
  local ip=""
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  if [[ -n "${ip}" ]]; then
    echo "http://${ip}"
  else
    echo "http://localhost"
  fi
}

create_env_file() {
  log "Creating environment file"

  local env_path="${APP_DIR}/.env"
  local app_url
  app_url="$(detect_app_url)"

  if [[ ! -f "${env_path}" ]]; then
    local secret
    secret="$(openssl rand -hex 48)"
    local tls_enabled="false"
    [[ -n "${STATIC_IP}" ]] && tls_enabled="true"
    cat > "${env_path}" <<EOF
NODE_ENV=production
PORT=${APP_PORT}
DB_PATH=./data/cyberlab.db
SESSION_SECRET=${secret}
TLS_ENABLED=${tls_enabled}
APP_URL=${app_url}
EOF
    log "Wrote new ${env_path}"
  else
    log "${env_path} already exists. Ensuring required keys are present."
    # Ensure each key exists; do not overwrite existing values.
    ensure_env_kv "${env_path}" NODE_ENV production
    ensure_env_kv "${env_path}" PORT "${APP_PORT}"
    ensure_env_kv "${env_path}" DB_PATH "./data/cyberlab.db"
    if ! grep -qE '^SESSION_SECRET=' "${env_path}"; then
      local secret
      secret="$(openssl rand -hex 48)"
      printf 'SESSION_SECRET=%s\n' "${secret}" >> "${env_path}"
    fi
    local tls_enabled="false"
    [[ -n "${STATIC_IP}" ]] && tls_enabled="true"
    ensure_env_kv "${env_path}" TLS_ENABLED "${tls_enabled}"
    ensure_env_kv "${env_path}" APP_URL "${app_url}"
  fi

  chown "${APP_USER}:${APP_USER}" "${env_path}"
  chmod 640 "${env_path}"
}

ensure_env_kv() {
  local file="$1" key="$2" value="$3"
  if ! grep -qE "^${key}=" "${file}"; then
    printf '%s=%s\n' "${key}" "${value}" >> "${file}"
  fi
}

run_npm_install() {
  # Run an npm install/ci command as APP_USER. Returns its exit code.
  local cmd="$1"
  if [[ "${cmd}" == "ci" ]]; then
    sudo -u "${APP_USER}" npm ci --omit=dev
  else
    sudo -u "${APP_USER}" npm install --omit=dev
  fi
}

install_app_dependencies() {
  log "Installing npm dependencies"
  cd "${APP_DIR}"

  local cmd="install"
  if [[ -f package-lock.json ]]; then
    cmd="ci"
  fi

  # Ensure the user-level npm config starts on the canonical registry.
  sudo -u "${APP_USER}" npm config set registry "${NPM_PRIMARY_REGISTRY}" >/dev/null 2>&1 || true

  if run_npm_install "${cmd}"; then
    log "npm ${cmd} succeeded against ${NPM_PRIMARY_REGISTRY}"
  else
    warn "npm ${cmd} failed against ${NPM_PRIMARY_REGISTRY}. Retrying via mirror ${NPM_FALLBACK_REGISTRY} (common on networks with TLS interception)."
    sudo -u "${APP_USER}" npm config set registry "${NPM_FALLBACK_REGISTRY}" >/dev/null 2>&1 || true
    if run_npm_install "${cmd}"; then
      log "npm ${cmd} succeeded against ${NPM_FALLBACK_REGISTRY}"
    else
      sudo -u "${APP_USER}" npm config set registry "${NPM_PRIMARY_REGISTRY}" >/dev/null 2>&1 || true
      echo "npm ${cmd} failed against both ${NPM_PRIMARY_REGISTRY} and ${NPM_FALLBACK_REGISTRY}." >&2
      exit 1
    fi
    # Restore the canonical registry once the install succeeded so future
    # operations on this host hit npmjs by default.
    sudo -u "${APP_USER}" npm config set registry "${NPM_PRIMARY_REGISTRY}" >/dev/null 2>&1 || true
  fi
}

has_npm_script() {
  local script="$1"
  node -e "
    const p = require('${APP_DIR}/package.json');
    process.exit(p.scripts && p.scripts['${script}'] ? 0 : 1);
  " >/dev/null 2>&1
}

initialize_database() {
  cd "${APP_DIR}"

  if has_npm_script migrate; then
    log "Running database migrations"
    sudo -u "${APP_USER}" npm run migrate || warn "Migration command failed. Check app logs after startup."
  else
    warn "No 'migrate' script found in package.json. Skipping migrations."
  fi

  if has_npm_script seed; then
    log "Running database seed"
    sudo -u "${APP_USER}" npm run seed || warn "Seed command failed or data already exists. Continuing."
  fi
}

create_systemd_service() {
  log "Creating systemd service"

  cat > "/etc/systemd/system/${APP_NAME}.service" <<EOF
[Unit]
Description=CISTracker inventory app
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "${APP_NAME}"
  systemctl restart "${APP_NAME}"
}

install_mkcert() {
  if command -v mkcert >/dev/null 2>&1; then
    log "mkcert already installed ($(mkcert --version 2>/dev/null || echo unknown))"
  else
    log "Installing mkcert ${MKCERT_VERSION}"
    curl -fsSL \
      "https://github.com/FiloSottile/mkcert/releases/download/${MKCERT_VERSION}/mkcert-${MKCERT_VERSION}-linux-amd64" \
      -o /usr/local/bin/mkcert
    chmod +x /usr/local/bin/mkcert
  fi

  log "Creating local CA (if not already created)"
  mkcert -install
}

setup_tls() {
  if [[ -z "${STATIC_IP}" ]]; then
    log "No STATIC_IP set — skipping TLS cert generation"
    return
  fi

  log "Generating TLS certificate for ${DOMAIN}"

  mkdir -p /etc/ssl/cistracker

  mkcert \
    -cert-file /etc/ssl/cistracker/cert.pem \
    -key-file  /etc/ssl/cistracker/key.pem \
    "${DOMAIN}"

  # Export CA root so the operator can distribute it via Group Policy
  local caroot
  caroot="$(mkcert -CAROOT)"
  cp "${caroot}/rootCA.pem" /etc/ssl/cistracker/rootCA.crt

  chmod 644 /etc/ssl/cistracker/cert.pem /etc/ssl/cistracker/rootCA.crt
  chmod 640 /etc/ssl/cistracker/key.pem

  log "Cert:    /etc/ssl/cistracker/cert.pem"
  log "Key:     /etc/ssl/cistracker/key.pem"
  log "CA root: /etc/ssl/cistracker/rootCA.crt  (copy to Windows Server for Group Policy)"
}

configure_nginx() {
  log "Configuring Nginx reverse proxy"

  if [[ -n "${STATIC_IP}" ]]; then
    # HTTPS — port 80 redirects to 443; TLS terminates here with mkcert cert.
    cat > "/etc/nginx/sites-available/${APP_NAME}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${DOMAIN};

    ssl_certificate     /etc/ssl/cistracker/cert.pem;
    ssl_certificate_key /etc/ssl/cistracker/key.pem;

    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers off;

    client_max_body_size 25m;

    location / {
        proxy_pass         http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF
  else
    # HTTP only — no static IP means no TLS cert available.
    cat > "/etc/nginx/sites-available/${APP_NAME}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name _;
    client_max_body_size 25m;
    location / {
        proxy_pass         http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF
  fi

  ln -sf "/etc/nginx/sites-available/${APP_NAME}" "/etc/nginx/sites-enabled/${APP_NAME}"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable nginx
  systemctl reload nginx
}

configure_firewall() {
  if command -v ufw >/dev/null 2>&1; then
    log "Configuring UFW firewall rules (only takes effect if ufw is enabled)"
    ufw allow OpenSSH >/dev/null 2>&1 || true
    ufw allow 'Nginx Full' >/dev/null 2>&1 || true
  fi
}

# ────────────────────────────────────────────────────────────────────────────
# Cloudflare Tunnel — exposes the app over HTTPS via Cloudflare's edge and
# also lets you SSH into this box from anywhere without opening router ports.
#
# Setup flow on the Cloudflare side (one-time, in the dashboard):
#   1. Go to Cloudflare Zero Trust → Networks → Tunnels → Create a tunnel.
#   2. Choose "Cloudflared", give it a name (e.g. "cistracker-school").
#   3. Cloudflare shows you an install command containing a token starting
#      with "eyJ...". Copy that token.
#   4. Re-run this installer with the token, e.g.
#        sudo CLOUDFLARED_TOKEN="eyJ..." bash install-cistracker.sh
#   5. Back in the Cloudflare dashboard → Public Hostnames, add:
#        - Subdomain: (blank)        Domain: cistracker.net
#          Service:  HTTP            URL: localhost:80
#        - Subdomain: ssh            Domain: cistracker.net
#          Service:  SSH             URL: localhost:22
#
# To SSH into the box from your laptop later:
#   1. Install cloudflared on your laptop (`brew install cloudflared` or grab
#      the .msi/.pkg from Cloudflare).
#   2. Add this to ~/.ssh/config:
#        Host cistracker
#          HostName ssh.cistracker.net
#          ProxyCommand /usr/local/bin/cloudflared access ssh --hostname %h
#          User cistracker-admin
#   3. Run `ssh cistracker`.
# ────────────────────────────────────────────────────────────────────────────
install_cloudflared() {
  if [[ "${SKIP_CLOUDFLARED}" == "1" ]]; then
    log "Skipping Cloudflare Tunnel install (SKIP_CLOUDFLARED=1)"
    return
  fi

  log "Installing cloudflared (Cloudflare Tunnel client)"

  # Install cloudflared from Cloudflare's apt repo so it stays updated
  if ! command -v cloudflared >/dev/null 2>&1; then
    install -d -m 0755 /usr/share/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
      | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs 2>/dev/null || echo bookworm) main" \
      > /etc/apt/sources.list.d/cloudflared.list
    apt-get update
    apt-get install -y cloudflared
  else
    log "cloudflared already installed ($(cloudflared --version 2>/dev/null | head -1))"
  fi

  if [[ -z "${CLOUDFLARED_TOKEN}" ]]; then
    warn "No CLOUDFLARED_TOKEN provided — cloudflared installed but not registered."
    warn "Create a tunnel in Cloudflare Zero Trust → Tunnels, copy the token, then run:"
    warn "  sudo cloudflared service install <YOUR_TOKEN>"
    return
  fi

  # If a previous tunnel service is registered, remove it before reinstalling
  if systemctl list-unit-files cloudflared.service >/dev/null 2>&1; then
    log "Reinstalling cloudflared tunnel service with the provided token"
    systemctl stop cloudflared 2>/dev/null || true
    cloudflared service uninstall 2>/dev/null || true
  fi

  cloudflared service install "${CLOUDFLARED_TOKEN}"
  systemctl enable --now cloudflared

  if systemctl is-active --quiet cloudflared; then
    log "cloudflared tunnel is active"
    log "Now finish setup in Cloudflare Zero Trust → Tunnels → (your tunnel) → Public Hostnames:"
    log "  - cistracker.net           → HTTP localhost:80"
    log "  - ssh.cistracker.net       → SSH  localhost:22  (for remote maintenance)"
  else
    warn "cloudflared service did not start. Check: journalctl -u cloudflared -n 50"
  fi
}

print_summary() {
  local public_ip lan_ip url
  lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  public_ip="$(curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null || true)"

  if [[ -n "${public_ip}" ]]; then
    url="http://${public_ip}"
  elif [[ -n "${lan_ip}" ]]; then
    url="http://${lan_ip}"
  else
    url="http://YOUR_VM_IP"
  fi

  log "Installation complete"
  echo "App directory: ${APP_DIR}"
  echo "Service name:  ${APP_NAME}"
  echo "App port:      ${APP_PORT} (proxied behind Nginx on port 80)"
  echo
  echo "Service status:"
  echo "  sudo systemctl status ${APP_NAME} --no-pager"
  echo
  echo "Live logs:"
  echo "  sudo journalctl -u ${APP_NAME} -f"
  echo
  echo "Restart app:"
  echo "  sudo systemctl restart ${APP_NAME}"
  echo
  echo "Open the website (LAN):"
  echo "  ${url}"
  echo

  # Cloudflare Tunnel status
  if systemctl is-active --quiet cloudflared 2>/dev/null; then
    echo "Cloudflare Tunnel: ACTIVE"
    echo "  Public URL:  https://cistracker.net (after adding the public hostname in Cloudflare)"
    echo "  Tunnel logs: sudo journalctl -u cloudflared -f"
    echo
    echo "  Remote SSH (from your laptop, requires cloudflared installed locally):"
    echo "    ssh -o ProxyCommand='cloudflared access ssh --hostname ssh.cistracker.net' \\\\"
    echo "        ${SUDO_USER:-$USER}@ssh.cistracker.net"
  elif command -v cloudflared >/dev/null 2>&1; then
    echo "Cloudflare Tunnel: installed but NOT registered"
    echo "  1. Create a tunnel in Cloudflare Zero Trust → Tunnels"
    echo "  2. Copy the token, then run:"
    echo "       sudo cloudflared service install <YOUR_TOKEN>"
    echo "  3. Add public hostnames in the tunnel dashboard:"
    echo "       cistracker.net          → HTTP localhost:80"
    echo "       ssh.cistracker.net      → SSH  localhost:22"
  fi
  echo
  echo "If this is a cloud VM with no tunnel, allow inbound TCP port 80 in the cloud firewall."
}

main() {
  require_root
  detect_os
  install_system_packages
  install_node
  create_app_user
  clone_or_update_repo
  create_env_file
  install_app_dependencies
  initialize_database
  create_systemd_service
  configure_nginx
  configure_firewall
  install_cloudflared
  print_summary
}

main "$@"
