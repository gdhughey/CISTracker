#!/usr/bin/env bash
set -euo pipefail

# CISTracker Linux VM installer
# Tested target: Ubuntu 22.04/24.04 or Debian 12
#
# What this does:
# - Installs Node.js 20, Git, SQLite, Nginx, and build tools
# - Clones https://github.com/gdhughey/CISTracker
# - Installs npm dependencies
# - Runs database migration/seed scripts if available
# - Creates a systemd service named cistracker
# - Configures Nginx reverse proxy on port 80
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/gdhughey/CISTracker/main/install-cistracker.sh | sudo bash
#
# Or:
#   sudo bash install-cistracker.sh

APP_NAME="cistracker"
REPO_URL="${REPO_URL:-https://github.com/gdhughey/CISTracker.git}"
APP_DIR="${APP_DIR:-/opt/CISTracker}"
APP_USER="${APP_USER:-cistracker}"
APP_PORT="${APP_PORT:-3000}"
NODE_MAJOR="${NODE_MAJOR:-20}"

log() {
  echo
  echo "==> $*"
}

warn() {
  echo
  echo "WARNING: $*" >&2
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
  case "${ID}" in
    ubuntu|debian)
      ;;
    *)
      warn "Detected ${PRETTY_NAME:-unknown OS}. This script is intended for Ubuntu/Debian."
      ;;
  esac
}

install_system_packages() {
  log "Installing system packages"
  apt-get update
  apt-get install -y ca-certificates curl gnupg git sqlite3 nginx build-essential
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    CURRENT_MAJOR="$(node -p 'process.versions.node.split(".")[0]' || echo 0)"
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

  if [[ -d "${APP_DIR}/.git" ]]; then
    log "Existing repository found. Pulling latest main"
    git config --global --add safe.directory "${APP_DIR}" || true
    git -C "${APP_DIR}" fetch origin
    git -C "${APP_DIR}" checkout main
    git -C "${APP_DIR}" pull --ff-only origin main
  else
    rm -rf "${APP_DIR}"
    git clone "${REPO_URL}" "${APP_DIR}"
  fi

  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
}

create_env_file() {
  log "Creating environment file"

  if [[ -f "${APP_DIR}/.env" ]]; then
    log ".env already exists. Leaving it unchanged."
    return
  fi

  cat > "${APP_DIR}/.env" <<EOF
NODE_ENV=production
PORT=${APP_PORT}
EOF

  chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env"
  chmod 640 "${APP_DIR}/.env"
}

install_app_dependencies() {
  log "Installing npm dependencies"
  cd "${APP_DIR}"

  if [[ -f package-lock.json ]]; then
    sudo -u "${APP_USER}" npm ci --omit=dev
  else
    sudo -u "${APP_USER}" npm install --omit=dev
  fi
}

initialize_database() {
  cd "${APP_DIR}"

  if npm run | grep -qE '^[[:space:]]*migrate'; then
    log "Running database migrations"
    sudo -u "${APP_USER}" npm run migrate || warn "Migration command failed. Check app logs after startup."
  fi

  if npm run | grep -qE '^[[:space:]]*seed'; then
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

configure_nginx() {
  log "Configuring Nginx reverse proxy"

  cat > "/etc/nginx/sites-available/${APP_NAME}" <<EOF
server {
    listen 80;
    listen [::]:80;

    server_name _;

    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

  ln -sf "/etc/nginx/sites-available/${APP_NAME}" "/etc/nginx/sites-enabled/${APP_NAME}"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable nginx
  systemctl reload nginx
}

configure_firewall() {
  if command -v ufw >/dev/null 2>&1; then
    log "Configuring UFW firewall if enabled"
    ufw allow OpenSSH >/dev/null || true
    ufw allow 'Nginx Full' >/dev/null || true
  fi
}

print_summary() {
  PUBLIC_IP="$(curl -fsS --max-time 3 https://api.ipify.org || true)"

  log "Installation complete"
  echo "App directory: ${APP_DIR}"
  echo "Service name: ${APP_NAME}"
  echo "Internal app port: ${APP_PORT}"
  echo
  echo "Check service status:"
  echo "  sudo systemctl status ${APP_NAME} --no-pager"
  echo
  echo "View app logs:"
  echo "  sudo journalctl -u ${APP_NAME} -f"
  echo
  echo "Restart app:"
  echo "  sudo systemctl restart ${APP_NAME}"
  echo
  if [[ -n "${PUBLIC_IP}" ]]; then
    echo "Open the website:"
    echo "  http://${PUBLIC_IP}"
  else
    echo "Open the website at your VM public IP:"
    echo "  http://YOUR_VM_PUBLIC_IP"
  fi
  echo
  echo "If you are using a cloud VM, make sure inbound TCP port 80 is allowed in the cloud firewall/security group."
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
  print_summary
}

main "$@"
