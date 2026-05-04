#!/usr/bin/env bash
set -euo pipefail

# install-from-here.sh — install CISTracker from a locally-extracted source
# tree, when the target server can't reach GitHub but CAN reach npm/apt.
#
# Drop the unzipped source folder anywhere on the server and run this from
# inside that folder. It does everything install-cistracker.sh does EXCEPT
# the git clone step (the source is already here).
#
# Usage:
#   sudo STATIC_IP=10.0.2.10 bash scripts/install-from-here.sh
#
# All env vars from install-cistracker.sh are honored. See the top of that
# script for the full list.

# ── Resolve "this script's source root" — the dir containing server.js ───
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ ! -f "${SOURCE_ROOT}/server.js" ]] || [[ ! -f "${SOURCE_ROOT}/package.json" ]]; then
  echo "ERROR: cannot find server.js + package.json above this script." >&2
  echo "       Make sure you extracted the full repo and are running this" >&2
  echo "       script from inside the extracted folder." >&2
  exit 1
fi

# ── Config (same defaults as install-cistracker.sh) ──────────────────────
APP_NAME="cistracker"
APP_DIR="${APP_DIR:-/opt/CISTracker}"
APP_USER="${APP_USER:-cistracker}"
APP_PORT="${APP_PORT:-3000}"
NODE_MAJOR="${NODE_MAJOR:-20}"
NPM_PRIMARY_REGISTRY="${NPM_PRIMARY_REGISTRY:-https://registry.npmjs.org/}"
NPM_FALLBACK_REGISTRY="${NPM_FALLBACK_REGISTRY:-https://registry.npmmirror.com}"
STATIC_IP="${STATIC_IP:-}"
STATIC_NETMASK="${STATIC_NETMASK:-16}"
GATEWAY="${GATEWAY:-10.0.255.1}"
DNS_SERVER="${DNS_SERVER:-10.2.201.4}"
DOMAIN="${DOMAIN:-cistracker.net}"
SSH_EXTRA_PORT="${SSH_EXTRA_PORT:-2222}"
SKIP_TAILSCALE="${SKIP_TAILSCALE:-0}"
MKCERT_VERSION="${MKCERT_VERSION:-v1.4.4}"

log()  { echo; echo "==> $*"; }
warn() { echo; echo "WARNING: $*" >&2; }
die()  { echo "ERROR: $*" >&2; exit 1; }

require_root() { [[ "${EUID}" -eq 0 ]] || die "Run with sudo or as root."; }

detect_os() {
  [[ -f /etc/os-release ]] || die "Cannot detect OS — expected Ubuntu/Debian."
  # shellcheck disable=SC1091
  source /etc/os-release
  case "${ID:-}" in
    ubuntu|debian) ;;
    *) warn "Detected ${PRETTY_NAME:-?}. This script is for Ubuntu/Debian." ;;
  esac
}

configure_static_ip() {
  if [[ -z "${STATIC_IP}" ]]; then
    log "No STATIC_IP set — leaving DHCP alone"
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
}

install_system_packages() {
  log "Installing system packages from apt"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y \
    ca-certificates curl gnupg git sqlite3 nginx build-essential openssl rsync
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    local cur
    cur="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [[ "${cur}" -ge "${NODE_MAJOR}" ]]; then
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
}

create_app_user() {
  if id "${APP_USER}" >/dev/null 2>&1; then
    log "User ${APP_USER} already exists"
  else
    log "Creating system user ${APP_USER}"
    useradd --system --create-home --shell /usr/sbin/nologin "${APP_USER}"
  fi
}

copy_source() {
  log "Copying source from ${SOURCE_ROOT} to ${APP_DIR}"
  mkdir -p "${APP_DIR}"
  # Preserve any existing data/, uploads/, .env on the target
  rsync -a \
    --exclude='/.git' \
    --exclude='/node_modules' \
    --exclude='/data' \
    --exclude='/uploads' \
    --exclude='/.env' \
    --exclude='/.superpowers' \
    --exclude='/.claude' \
    --exclude='/.agents' \
    --exclude='/.worktrees' \
    --exclude='/dist' \
    --delete --delete-excluded \
    "${SOURCE_ROOT}/" "${APP_DIR}/"
  install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_DIR}/data" "${APP_DIR}/uploads"
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
}

detect_app_url() {
  if [[ -n "${STATIC_IP}" ]]; then
    echo "https://${DOMAIN}"
    return
  fi
  local ip=""
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo "${ip:+http://${ip}}${ip:-http://localhost}"
}

ensure_env_kv() {
  local file="$1" key="$2" value="$3"
  grep -qE "^${key}=" "${file}" || printf '%s=%s\n' "${key}" "${value}" >> "${file}"
}

create_env_file() {
  log "Creating .env"
  local env_path="${APP_DIR}/.env"
  local app_url tls_enabled="false"
  app_url="$(detect_app_url)"
  [[ -n "${STATIC_IP}" ]] && tls_enabled="true"

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
  else
    log ".env already exists — keeping its values, only ensuring required keys are present"
    ensure_env_kv "${env_path}" NODE_ENV production
    ensure_env_kv "${env_path}" PORT "${APP_PORT}"
    ensure_env_kv "${env_path}" DB_PATH "./data/cyberlab.db"
    grep -qE '^SESSION_SECRET=' "${env_path}" \
      || printf 'SESSION_SECRET=%s\n' "$(openssl rand -hex 48)" >> "${env_path}"
    ensure_env_kv "${env_path}" TLS_ENABLED "${tls_enabled}"
    ensure_env_kv "${env_path}" APP_URL "${app_url}"
  fi
  chown "${APP_USER}:${APP_USER}" "${env_path}"
  chmod 640 "${env_path}"
}

run_npm_install() {
  cd "${APP_DIR}"
  local cmd="install"
  [[ -f package-lock.json ]] && cmd="ci"
  sudo -u "${APP_USER}" npm config set registry "${NPM_PRIMARY_REGISTRY}" >/dev/null 2>&1 || true
  if sudo -u "${APP_USER}" npm "${cmd}" --omit=dev; then
    log "npm ${cmd} succeeded against ${NPM_PRIMARY_REGISTRY}"
    return
  fi
  warn "npm ${cmd} failed against ${NPM_PRIMARY_REGISTRY}. Retrying via mirror."
  sudo -u "${APP_USER}" npm config set registry "${NPM_FALLBACK_REGISTRY}" >/dev/null 2>&1 || true
  if sudo -u "${APP_USER}" npm "${cmd}" --omit=dev; then
    sudo -u "${APP_USER}" npm config set registry "${NPM_PRIMARY_REGISTRY}" >/dev/null 2>&1 || true
    log "npm ${cmd} succeeded against ${NPM_FALLBACK_REGISTRY}"
  else
    sudo -u "${APP_USER}" npm config set registry "${NPM_PRIMARY_REGISTRY}" >/dev/null 2>&1 || true
    die "npm ${cmd} failed against both registries."
  fi
}

run_migrations_and_seed() {
  cd "${APP_DIR}"
  log "Running migrations"
  sudo -u "${APP_USER}" npm run migrate || warn "Migration failed — will retry on app boot"
  log "Seeding admin (random password if SEED_ADMIN_PASSWORD is empty)"
  sudo -u "${APP_USER}" npm run seed || warn "Admin seed skipped (already exists or failed)"
  for v in seed-inventory.js seed-inventory-v2.js seed-inventory-v3.js seed-inventory-v4.js; do
    if [[ -f "scripts/${v}" ]]; then
      log "Running scripts/${v}"
      sudo -u "${APP_USER}" node "scripts/${v}" || warn "${v} skipped or already applied"
    fi
  done
}

install_mkcert() {
  if command -v mkcert >/dev/null 2>&1; then
    log "mkcert already installed"
  else
    log "Installing mkcert ${MKCERT_VERSION}"
    curl -fsSL \
      "https://github.com/FiloSottile/mkcert/releases/download/${MKCERT_VERSION}/mkcert-${MKCERT_VERSION}-linux-amd64" \
      -o /usr/local/bin/mkcert \
      || die "Failed to download mkcert. If GitHub is blocked, place a copy of the mkcert binary at ${SOURCE_ROOT}/scripts/mkcert and re-run."
    chmod +x /usr/local/bin/mkcert
  fi
  mkcert -install
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
    cat > "/etc/nginx/sites-available/${APP_NAME}" <<EOF
server {
    listen 80; listen [::]:80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl; listen [::]:443 ssl;
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
    cat > "/etc/nginx/sites-available/${APP_NAME}" <<EOF
server {
    listen 80; listen [::]:80;
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

install_tailscale() {
  if [[ "${SKIP_TAILSCALE}" == "1" ]]; then
    log "Skipping Tailscale (SKIP_TAILSCALE=1)"
    return
  fi
  if command -v tailscale >/dev/null 2>&1; then
    log "Tailscale already installed"
    return
  fi
  log "Installing Tailscale"
  curl -fsSL https://tailscale.com/install.sh | sh \
    || warn "Tailscale install failed — install manually later if you want remote SSH"
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
  Install complete
═══════════════════════════════════════════════════════════════════════
  App dir : ${APP_DIR}
  Service : ${APP_NAME}.service  (sudo systemctl status ${APP_NAME})
  Logs    : sudo journalctl -u ${APP_NAME} -f

EOF
  if [[ -n "${STATIC_IP}" ]]; then
    cat <<EOF
  Website (LAN, HTTPS):  https://${DOMAIN}
  Static IP:             ${STATIC_IP}
  Distribute the mkcert root CA to client devices once:
    /etc/ssl/cistracker/rootCA.crt
EOF
  else
    cat <<EOF
  Website (LAN, HTTP):  http://${lan_ip}
EOF
  fi
  if command -v tailscale >/dev/null 2>&1; then
    cat <<EOF

  Remote SSH via Tailscale (after running: sudo tailscale up):
    ssh -p ${SSH_EXTRA_PORT} ${SUDO_USER:-root}@<tailscale-ip>
EOF
  fi
  echo "═══════════════════════════════════════════════════════════════════════"
}

main() {
  require_root
  detect_os
  configure_static_ip
  install_system_packages
  install_node
  install_mkcert
  create_app_user
  copy_source
  create_env_file
  run_npm_install
  setup_tls
  run_migrations_and_seed
  configure_nginx
  configure_ssh_port
  create_systemd_service
  install_tailscale
  print_summary
}

main "$@"
