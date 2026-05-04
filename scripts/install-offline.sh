#!/usr/bin/env bash
set -euo pipefail

# install-offline.sh — Air-gapped CISTracker installer.
#
# Run this from the extracted offline bundle (created by bundle-offline.sh)
# on a Proxmox/Ubuntu 24.04 host that CANNOT reach the internet. Makes zero
# outbound network calls; everything is sourced from the bundle directory.
#
# Usage:
#   sudo STATIC_IP=10.0.2.10 bash install-offline.sh
#
# Honors all the same env vars as install-cistracker.sh:
#   STATIC_IP, STATIC_NETMASK, GATEWAY, DNS_SERVER, DOMAIN,
#   SSH_EXTRA_PORT, SKIP_TAILSCALE
#
# Bundle layout expected (sibling to this script):
#   ./repo/                 the CISTracker source + node_modules
#   ./nodejs/*.deb          Node.js 20 .deb
#   ./mkcert/mkcert         mkcert binary
#   ./tailscale/*.deb       Tailscale .deb (optional)

APP_NAME="cistracker"
APP_DIR="${APP_DIR:-/opt/CISTracker}"
APP_USER="${APP_USER:-cistracker}"
APP_PORT="${APP_PORT:-3000}"
STATIC_IP="${STATIC_IP:-}"
STATIC_NETMASK="${STATIC_NETMASK:-16}"
GATEWAY="${GATEWAY:-10.0.255.1}"
DNS_SERVER="${DNS_SERVER:-10.2.201.4}"
DOMAIN="${DOMAIN:-cistracker.net}"
SSH_EXTRA_PORT="${SSH_EXTRA_PORT:-2222}"
SKIP_TAILSCALE="${SKIP_TAILSCALE:-0}"

BUNDLE_DIR="$(cd "$(dirname "$0")" && pwd)"

log()  { echo; echo "==> $*"; }
warn() { echo; echo "WARNING: $*" >&2; }
die()  { echo "ERROR: $*" >&2; exit 1; }

require_root() {
  [[ "${EUID}" -eq 0 ]] || die "Run with sudo or as root."
}

verify_bundle() {
  log "Verifying offline bundle"
  [[ -d "${BUNDLE_DIR}/repo"        ]] || die "Missing ${BUNDLE_DIR}/repo"
  [[ -d "${BUNDLE_DIR}/repo/node_modules" ]] || die "Missing ${BUNDLE_DIR}/repo/node_modules — re-run bundle-offline.sh"
  [[ -f "${BUNDLE_DIR}/repo/server.js" ]] || die "Missing ${BUNDLE_DIR}/repo/server.js"
  [[ -f "${BUNDLE_DIR}/mkcert/mkcert" ]] || die "Missing ${BUNDLE_DIR}/mkcert/mkcert"

  local node_deb
  node_deb="$(find "${BUNDLE_DIR}/nodejs" -name 'nodejs_*.deb' 2>/dev/null | head -1)"
  [[ -n "${node_deb}" ]] || die "Missing nodejs_*.deb in ${BUNDLE_DIR}/nodejs"
  log "Bundle OK"
}

configure_static_ip() {
  if [[ -z "${STATIC_IP}" ]]; then
    log "No STATIC_IP set — skipping static IP configuration (DHCP will be used)"
    return
  fi

  log "Configuring static IP ${STATIC_IP}/${STATIC_NETMASK}"
  local iface
  iface="$(ip -o link show | awk '$2 != "lo:" {print $2}' | head -1 | tr -d ':')"
  mkdir -p /etc/netplan
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
  log "Static IP applied on ${iface}"
}

install_system_packages_offline() {
  log "Installing system packages (apt — uses local cache only)"
  export DEBIAN_FRONTEND=noninteractive
  # NOTE: we do NOT run `apt-get update` here because that requires internet.
  # On a fresh Ubuntu 24.04 install, sqlite3, nginx, openssl, build-essential
  # are typically already either installed or available in the local cache.
  # If any are missing, the operator must add them via offline .deb (or
  # extend this bundle).
  if ! apt-get install -y --no-download --ignore-missing \
       ca-certificates curl git sqlite3 nginx openssl build-essential 2>&1; then
    warn "Some apt packages were unavailable offline. Continuing — only nginx + sqlite are strictly required."
    apt-get install -y --no-download --ignore-missing nginx sqlite3 || \
      die "nginx and sqlite3 must be available locally. Add their .deb to the bundle or pre-install on the VM."
  fi
}

install_node_offline() {
  if command -v node >/dev/null 2>&1; then
    local cur
    cur="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [[ "${cur}" -ge 20 ]]; then
      log "Node.js $(node --version) already installed"
      return
    fi
  fi
  log "Installing Node.js from bundle"
  local node_deb
  node_deb="$(find "${BUNDLE_DIR}/nodejs" -name 'nodejs_*.deb' | head -1)"
  dpkg -i "${node_deb}" || apt-get install -fy --no-download
  log "Installed Node.js $(node --version)"
}

install_mkcert_offline() {
  if command -v mkcert >/dev/null 2>&1; then
    log "mkcert already installed"
  else
    log "Installing mkcert from bundle"
    cp "${BUNDLE_DIR}/mkcert/mkcert" /usr/local/bin/mkcert
    chmod +x /usr/local/bin/mkcert
  fi
  log "Creating local CA (idempotent)"
  mkcert -install
}

install_tailscale_offline() {
  if [[ "${SKIP_TAILSCALE}" == "1" ]]; then
    log "Skipping Tailscale install (SKIP_TAILSCALE=1)"
    return
  fi
  if command -v tailscale >/dev/null 2>&1; then
    log "Tailscale already installed"
    return
  fi
  local ts_deb
  ts_deb="$(find "${BUNDLE_DIR}/tailscale" -name 'tailscale_*.deb' 2>/dev/null | head -1 || true)"
  if [[ -z "${ts_deb}" ]]; then
    warn "No Tailscale .deb in bundle. Skipping. (Re-run bundle-offline.sh without --no-tailscale to include it.)"
    return
  fi
  log "Installing Tailscale from bundle"
  dpkg -i "${ts_deb}" || apt-get install -fy --no-download
  log "Tailscale installed — authenticate later from a network with internet:"
  log "  sudo tailscale up"
}

create_app_user() {
  if id "${APP_USER}" >/dev/null 2>&1; then
    log "User ${APP_USER} already exists"
  else
    log "Creating system user ${APP_USER}"
    useradd --system --create-home --shell /usr/sbin/nologin "${APP_USER}"
  fi
}

install_app_files() {
  log "Installing app into ${APP_DIR}"
  mkdir -p "${APP_DIR}"
  # Copy everything in repo/ to APP_DIR. Use rsync to skip the existing data/
  # and uploads/ if upgrading in place.
  rsync -a --delete \
    --exclude='/data/' \
    --exclude='/uploads/' \
    --exclude='/.env' \
    "${BUNDLE_DIR}/repo/" "${APP_DIR}/"
  install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_DIR}/data" "${APP_DIR}/uploads"
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
}

create_env_file() {
  log "Creating environment file"
  local env_path="${APP_DIR}/.env"
  local app_url tls_enabled="false"
  if [[ -n "${STATIC_IP}" ]]; then
    app_url="https://${DOMAIN}"
    tls_enabled="true"
  else
    local ip
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    app_url="http://${ip:-localhost}"
  fi

  if [[ ! -f "${env_path}" ]]; then
    local secret
    secret="$(openssl rand -hex 48)"
    cat > "${env_path}" <<EOF
NODE_ENV=production
PORT=${APP_PORT}
DB_PATH=./data/cyberlab.db
SESSION_SECRET=${secret}
TLS_ENABLED=${tls_enabled}
APP_URL=${app_url}
SEED_ADMIN_PASSWORD=
EOF
    log "Wrote new ${env_path} (admin password will be auto-generated)"
  else
    log "${env_path} already exists — leaving as-is"
  fi
  chown "${APP_USER}:${APP_USER}" "${env_path}"
  chmod 640 "${env_path}"
}

run_migrations_and_seed() {
  cd "${APP_DIR}"
  log "Running migrations"
  sudo -u "${APP_USER}" npm run migrate || warn "Migration failed (will retry on app boot)"
  log "Seeding admin user"
  sudo -u "${APP_USER}" npm run seed || warn "Admin seed skipped (already exists or failed — check logs)"

  for v in seed-inventory.js seed-inventory-v2.js seed-inventory-v3.js seed-inventory-v4.js; do
    if [[ -f "scripts/${v}" ]]; then
      log "Running scripts/${v}"
      sudo -u "${APP_USER}" node "scripts/${v}" || warn "${v} failed or already applied"
    fi
  done
}

setup_tls() {
  [[ -n "${STATIC_IP}" ]] || { log "No STATIC_IP — skipping TLS"; return; }
  log "Generating TLS cert for ${DOMAIN}"
  mkdir -p /etc/ssl/cistracker
  mkcert \
    -cert-file /etc/ssl/cistracker/cert.pem \
    -key-file  /etc/ssl/cistracker/key.pem \
    "${DOMAIN}"
  local caroot
  caroot="$(mkcert -CAROOT)"
  cp "${caroot}/rootCA.pem" /etc/ssl/cistracker/rootCA.crt
  chmod 644 /etc/ssl/cistracker/cert.pem /etc/ssl/cistracker/rootCA.crt
  chmod 640 /etc/ssl/cistracker/key.pem
}

configure_nginx() {
  log "Configuring nginx"
  if [[ -n "${STATIC_IP}" ]]; then
    cat > /etc/nginx/sites-available/${APP_NAME} <<EOF
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
    cat > /etc/nginx/sites-available/${APP_NAME} <<EOF
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
  ln -sf /etc/nginx/sites-available/${APP_NAME} /etc/nginx/sites-enabled/${APP_NAME}
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable nginx
  systemctl reload nginx
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

configure_ssh_port() {
  [[ -n "${SSH_EXTRA_PORT}" ]] || return
  log "Setting SSH port to ${SSH_EXTRA_PORT}"
  local sshd_config="/etc/ssh/sshd_config"
  sed -i '/^Port /d' "${sshd_config}"
  echo "Port ${SSH_EXTRA_PORT}" >> "${sshd_config}"
  systemctl restart ssh
}

print_summary() {
  local lan_ip="${STATIC_IP:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
  cat <<EOF

═══════════════════════════════════════════════════════════════════════
  Offline install complete
═══════════════════════════════════════════════════════════════════════
  App directory : ${APP_DIR}
  Service       : ${APP_NAME}.service
  App port      : ${APP_PORT}  (proxied behind nginx)

  Status: sudo systemctl status ${APP_NAME} --no-pager
  Logs:   sudo journalctl -u ${APP_NAME} -f
  Restart: sudo systemctl restart ${APP_NAME}

EOF
  if [[ -n "${STATIC_IP}" ]]; then
    cat <<EOF
  Website (LAN):  https://${DOMAIN}
  Static IP:      ${STATIC_IP}

  Distribute the mkcert root CA to client devices once:
    /etc/ssl/cistracker/rootCA.crt
EOF
  else
    cat <<EOF
  Website (LAN):  http://${lan_ip}
EOF
  fi
  if command -v tailscale >/dev/null 2>&1; then
    cat <<EOF

  Tailscale: when you next have an internet-connected uplink, run:
    sudo tailscale up
    tailscale ip -4
    ssh -p ${SSH_EXTRA_PORT} ${SUDO_USER:-root}@<tailscale-ip>
EOF
  fi
  echo "═══════════════════════════════════════════════════════════════════════"
}

main() {
  require_root
  verify_bundle
  configure_static_ip
  install_system_packages_offline
  install_node_offline
  install_mkcert_offline
  install_tailscale_offline
  create_app_user
  install_app_files
  create_env_file
  setup_tls
  run_migrations_and_seed
  configure_nginx
  configure_ssh_port
  create_systemd_service
  print_summary
}

main "$@"
