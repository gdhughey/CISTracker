#!/usr/bin/env bash
set -euo pipefail

# CISTracker Linux VM installer
# Tested target: Ubuntu 22.04/24.04 or Debian 12
#
# What this does:
# - Installs Node.js 20, Git, SQLite, Nginx, and build tools
# - Clones https://github.com/gdhughey/CISTracker into /opt/CISTracker
# - Creates a system user, .env with a generated SESSION_SECRET
# - Installs npm dependencies (with mirror fallback for restricted networks)
# - Runs database migration/seed scripts
# - Creates a systemd service named cistracker
# - Configures Nginx HTTPS reverse proxy on port 443
#     • With CF_API_TOKEN: real Let's Encrypt cert via Cloudflare DNS-01 challenge
#       (works behind Cloudflare proxy; no port 80 exposure needed)
#     • Without CF_API_TOKEN but with STATIC_IP: mkcert self-signed cert (LAN-only)
#     • Neither: HTTP on port 80 only
# - Adds SSH on port 2222 for Tailscale remote access
# - (Optional) Installs Tailscale for remote SSH maintenance
#
# This script is idempotent. It is safe to re-run on a partially installed host.
#
# Usage (with Cloudflare Global API Key — simplest):
#   sudo CF_GLOBAL_API_KEY=<key> bash install-cistracker.sh
#
#   Find your Global API Key at: https://dash.cloudflare.com/profile/api-tokens
#   → "Global API Key" → View
#
# Usage (with scoped API token — more secure):
#   sudo CF_API_TOKEN=<token> bash install-cistracker.sh
#
#   Scoped token needs Zone → DNS → Edit permission for cistracker.net.
#   Create one at: https://dash.cloudflare.com/profile/api-tokens
#
# Usage (LAN-only, no Cloudflare):
#   sudo STATIC_IP=10.0.2.10 bash install-cistracker.sh
#
# All options (pass as env vars):
#   CF_GLOBAL_API_KEY  Cloudflare Global API Key — enables Let's Encrypt DNS-01 (simplest)
#   CF_EMAIL           Cloudflare account email (default: gdhughey0726@gmail.com)
#   CF_API_TOKEN       Cloudflare scoped API token (Zone:DNS:Edit) — alternative to global key
#   CERT_EMAIL         Email for Let's Encrypt account (default: admin@<DOMAIN>)
#   STATIC_IP        Server's IP address (public or LAN, required for HTTPS)
#   STATIC_NETMASK   CIDR prefix length (default: 16)
#   GATEWAY          LAN default gateway (default: 10.0.255.1)
#   DNS_SERVER       Primary DNS server IP (default: 10.0.2.1)
#   DNS_SERVER_2     Secondary DNS server IP (default: 10.2.201.4, set to "" to omit)
#   DOMAIN           App domain name (default: cistracker.net)
#   SSH_EXTRA_PORT   Extra SSH port for Tailscale access (default: 2222)
#   SKIP_TAILSCALE   Set to 1 to skip Tailscale install (default: 0)
#   MKCERT_VERSION   mkcert binary version used for LAN-only fallback (default: v1.4.4)

APP_NAME="cistracker"
REPO_URL="${REPO_URL:-https://github.com/gdhughey/CISTracker.git}"
APP_DIR="${APP_DIR:-/opt/CISTracker}"
APP_USER="${APP_USER:-cistracker}"
APP_PORT="${APP_PORT:-3000}"
NODE_MAJOR="${NODE_MAJOR:-20}"
NPM_PRIMARY_REGISTRY="${NPM_PRIMARY_REGISTRY:-https://registry.npmjs.org/}"
NPM_FALLBACK_REGISTRY="${NPM_FALLBACK_REGISTRY:-https://registry.npmmirror.com}"
CF_API_TOKEN="${CF_API_TOKEN:-}"                        # Cloudflare scoped API token (Zone:DNS:Edit)
CF_EMAIL="${CF_EMAIL:-gdhughey0726@gmail.com}"          # Cloudflare account email (used with global key)
CF_GLOBAL_API_KEY="${CF_GLOBAL_API_KEY:-}"              # Cloudflare Global API Key
CERT_EMAIL="${CERT_EMAIL:-}"                            # Let's Encrypt account email (defaults to admin@DOMAIN)
STATIC_IP="${STATIC_IP:-10.0.2.127}"
STATIC_NETMASK="${STATIC_NETMASK:-24}"
GATEWAY="${GATEWAY:-10.0.255.1}"
DNS_SERVER="${DNS_SERVER:-10.0.2.1}"
DNS_SERVER_2="${DNS_SERVER_2:-10.2.201.4}"
DOMAIN="${DOMAIN:-cistracker.net}"
SSH_EXTRA_PORT="${SSH_EXTRA_PORT:-2222}"
SKIP_TAILSCALE="${SKIP_TAILSCALE:-0}"
MKCERT_VERSION="${MKCERT_VERSION:-v1.4.4}"  # used only when CF_API_TOKEN is absent

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

  local iface
  iface="$(ip -o link show | awk '$2 != "lo:" {print $2}' | head -1 | tr -d ':')"

  mkdir -p /etc/netplan
  local dns_list="${DNS_SERVER}"
  [[ -n "${DNS_SERVER_2}" ]] && dns_list="${DNS_SERVER}, ${DNS_SERVER_2}"

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
        addresses: [${dns_list}]
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

  git config --global --add safe.directory "${APP_DIR}" || true

  if [[ -d "${APP_DIR}/.git" ]]; then
    log "Existing repository found. Pulling latest main"
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
  if [[ -n "${STATIC_IP}" ]]; then
    echo "https://${DOMAIN}"
    return
  fi
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
SEED_ADMIN_PASSWORD=
EOF
    log "Wrote new ${env_path}"
  else
    log "${env_path} already exists. Ensuring required keys are present."
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
    log "Running database seed (admin user)"
    sudo -u "${APP_USER}" npm run seed || warn "Seed command failed or data already exists. Continuing."
  fi

  log "Running inventory seed v1 (Northeast closet)"
  sudo -u "${APP_USER}" node scripts/seed-inventory.js \
    || warn "seed-inventory.js failed or data already exists. Continuing."

  log "Running inventory seed v2 (motherboards, GPUs, CPUs, RAM, storage, HP Compaqs)"
  sudo -u "${APP_USER}" node scripts/seed-inventory-v2.js \
    || warn "seed-inventory-v2.js failed or data already exists. Continuing."

  log "Running inventory seed v3 (location backfill)"
  sudo -u "${APP_USER}" node scripts/seed-inventory-v3.js \
    || warn "seed-inventory-v3.js failed or data already exists. Continuing."

  log "Running inventory seed v4 (Cisco 2600/2950, networking closet)"
  sudo -u "${APP_USER}" node scripts/seed-inventory-v4.js \
    || warn "seed-inventory-v4.js failed or data already exists. Continuing."
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

# ── TLS: Let's Encrypt via Cloudflare DNS-01 (primary) ──────────────────────

install_certbot() {
  log "Installing certbot and Cloudflare DNS plugin"
  apt-get install -y certbot python3-certbot-dns-cloudflare
}

setup_letsencrypt_cf() {
  log "Obtaining Let's Encrypt certificate for ${DOMAIN} via Cloudflare DNS-01"

  # Credentials file — readable only by root
  mkdir -p /etc/letsencrypt

  if [[ -n "${CF_GLOBAL_API_KEY}" ]]; then
    cat > /etc/letsencrypt/cloudflare.ini <<EOF
dns_cloudflare_email = ${CF_EMAIL}
dns_cloudflare_api_key = ${CF_GLOBAL_API_KEY}
EOF
    log "Using Cloudflare Global API Key for DNS-01 challenge"
  else
    cat > /etc/letsencrypt/cloudflare.ini <<EOF
dns_cloudflare_api_token = ${CF_API_TOKEN}
EOF
    log "Using Cloudflare scoped API token for DNS-01 challenge"
  fi

  chmod 600 /etc/letsencrypt/cloudflare.ini

  local email="${CERT_EMAIL:-admin@${DOMAIN}}"

  # --keep-until-expiring makes this idempotent — skips renewal if cert is
  # still valid, re-issues if it's within 30 days of expiry.
  certbot certonly \
    --dns-cloudflare \
    --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
    --dns-cloudflare-propagation-seconds 30 \
    --domain "${DOMAIN}" \
    --email "${email}" \
    --agree-tos \
    --non-interactive \
    --keep-until-expiring

  log "Certificate issued:"
  log "  Chain:  /etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
  log "  Key:    /etc/letsencrypt/live/${DOMAIN}/privkey.pem"
  log "Auto-renewal: certbot installs a systemd timer (certbot.timer) — verify with:"
  log "  systemctl status certbot.timer"
}

# ── TLS: mkcert self-signed fallback (LAN-only, no Cloudflare token) ────────

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

setup_mkcert_cert() {
  log "Generating mkcert certificate for ${DOMAIN} (LAN-only — not trusted by Cloudflare)"

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

  log "Cert:    /etc/ssl/cistracker/cert.pem"
  log "Key:     /etc/ssl/cistracker/key.pem"
  log "CA root: /etc/ssl/cistracker/rootCA.crt  (distribute via Group Policy for LAN trust)"
}

# ── Dispatcher ───────────────────────────────────────────────────────────────

setup_tls() {
  if [[ -z "${STATIC_IP}" ]]; then
    log "No STATIC_IP set — skipping TLS setup"
    return
  fi

  if [[ -n "${CF_GLOBAL_API_KEY}" ]] || [[ -n "${CF_API_TOKEN}" ]]; then
    install_certbot
    setup_letsencrypt_cf
  else
    warn "CF_GLOBAL_API_KEY and CF_API_TOKEN not set — falling back to mkcert self-signed cert (LAN-only)."
    warn "Cloudflare proxy requires a real cert. Set CF_GLOBAL_API_KEY (or CF_API_TOKEN) to fix this."
    install_mkcert
    setup_mkcert_cert
  fi
}

# ── Nginx ────────────────────────────────────────────────────────────────────

# Cloudflare publishes its full IP list at:
#   https://www.cloudflare.com/ips-v4  /  https://www.cloudflare.com/ips-v6
# nginx's real_ip module uses these to restore the original visitor IP from the
# CF-Connecting-IP header, so the app sees real client IPs (not Cloudflare's).
CF_IPV4_RANGES="
    set_real_ip_from 103.21.244.0/22;
    set_real_ip_from 103.22.200.0/22;
    set_real_ip_from 103.31.4.0/22;
    set_real_ip_from 104.16.0.0/13;
    set_real_ip_from 104.24.0.0/14;
    set_real_ip_from 108.162.192.0/18;
    set_real_ip_from 131.0.72.0/22;
    set_real_ip_from 141.101.64.0/18;
    set_real_ip_from 162.158.0.0/15;
    set_real_ip_from 172.64.0.0/13;
    set_real_ip_from 173.245.48.0/20;
    set_real_ip_from 188.114.96.0/20;
    set_real_ip_from 190.93.240.0/20;
    set_real_ip_from 197.234.240.0/22;
    set_real_ip_from 198.41.128.0/17;"

CF_IPV6_RANGES="
    set_real_ip_from 2400:cb00::/32;
    set_real_ip_from 2606:4700::/32;
    set_real_ip_from 2803:f800::/32;
    set_real_ip_from 2405:b500::/32;
    set_real_ip_from 2405:8100::/32;
    set_real_ip_from 2a06:98c0::/29;
    set_real_ip_from 2c0f:f248::/32;"

configure_nginx() {
  log "Configuring Nginx reverse proxy"

  if [[ -n "${STATIC_IP}" ]]; then
    # Decide cert paths based on which TLS path ran
    local cert_pem key_pem
    if [[ -n "${CF_GLOBAL_API_KEY}" ]] || [[ -n "${CF_API_TOKEN}" ]]; then
      cert_pem="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
      key_pem="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"
    else
      cert_pem="/etc/ssl/cistracker/cert.pem"
      key_pem="/etc/ssl/cistracker/key.pem"
    fi

    cat > "/etc/nginx/sites-available/${APP_NAME}" <<EOF
# Restore real visitor IP when traffic arrives through Cloudflare proxy
${CF_IPV4_RANGES}
${CF_IPV6_RANGES}
    real_ip_header CF-Connecting-IP;

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    # Cloudflare handles the browser→CF leg; this redirects CF→origin on port 80
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${DOMAIN};

    ssl_certificate     ${cert_pem};
    ssl_certificate_key ${key_pem};

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
    # HTTP only
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
    log "Configuring UFW firewall rules"
    ufw allow 'Nginx Full' >/dev/null 2>&1 || true
    ufw deny 3000/tcp >/dev/null 2>&1 || true
  fi
}

install_tailscale() {
  if [[ "${SKIP_TAILSCALE}" == "1" ]]; then
    log "Skipping Tailscale install (SKIP_TAILSCALE=1)"
    return
  fi

  if command -v tailscale >/dev/null 2>&1; then
    log "Tailscale already installed ($(tailscale version 2>/dev/null | head -1))"
    return
  fi

  log "Installing Tailscale"
  curl -fsSL https://tailscale.com/install.sh | sh
  log "Tailscale installed — authenticate it after the installer finishes:"
  log "  sudo tailscale up"
  log "  tailscale ip -4   # note this IP for remote SSH"
}

configure_ssh_port() {
  if [[ -z "${SSH_EXTRA_PORT}" ]]; then
    return
  fi

  log "Adding SSH port ${SSH_EXTRA_PORT}"

  local sshd_config="/etc/ssh/sshd_config"
  sed -i '/^Port /d' "${sshd_config}"
  echo "Port ${SSH_EXTRA_PORT}" >> "${sshd_config}"

  if command -v ufw >/dev/null 2>&1; then
    ufw allow "${SSH_EXTRA_PORT}/tcp" >/dev/null 2>&1 || true
  fi

  systemctl restart ssh
  log "sshd listening on port ${SSH_EXTRA_PORT} only (port 22 removed)"
}

print_summary() {
  local lan_ip
  lan_ip="${STATIC_IP:-$(hostname -I 2>/dev/null | awk '{print $1}')}"

  log "Installation complete"
  echo "App directory: ${APP_DIR}"
  echo "Service name:  ${APP_NAME}"
  echo "App port:      ${APP_PORT} (proxied behind Nginx)"
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

  if [[ -n "${STATIC_IP}" ]]; then
    echo "Website:"
    echo "  https://${DOMAIN}"
    echo

    if [[ -n "${CF_API_TOKEN}" ]]; then
      echo "SSL: Let's Encrypt (trusted everywhere)"
      echo "  Cert: /etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
      echo "  Auto-renewal: systemctl status certbot.timer"
      echo
      echo "Cloudflare SSL mode: set to 'Full (Strict)' in Cloudflare dashboard"
      echo "  https://dash.cloudflare.com → cistracker.net → SSL/TLS → Overview"
      echo
    else
      echo "SSL: mkcert self-signed (LAN-only — not trusted by Cloudflare)"
      echo "  CA root: /etc/ssl/cistracker/rootCA.crt"
      echo "  Distribute via Group Policy to trust on LAN machines."
      echo
      echo "  From a Windows machine:"
      echo "    scp ${SUDO_USER:-root}@${lan_ip}:/etc/ssl/cistracker/rootCA.crt ."
      echo "  Then import into:"
      echo "    Computer Configuration → Policies → Windows Settings → Security Settings"
      echo "    → Public Key Policies → Trusted Root Certification Authorities → Import"
      echo
    fi
  else
    echo "Website (HTTP only — no STATIC_IP was provided):"
    echo "  http://${lan_ip}"
    echo
  fi

  if command -v tailscale >/dev/null 2>&1; then
    echo "Tailscale remote access:"
    echo "  1. sudo tailscale up                         (authenticate once in browser)"
    echo "  2. tailscale ip -4                           (note your Tailscale IP)"
    echo "  3. ssh -p ${SSH_EXTRA_PORT} ${SUDO_USER:-root}@<tailscale-ip>  (from anywhere with Tailscale)"
    echo
  fi
}

main() {
  require_root
  detect_os
  configure_static_ip
  install_system_packages
  install_node
  setup_tls
  create_app_user
  clone_or_update_repo
  create_env_file
  install_app_dependencies
  initialize_database
  create_systemd_service
  configure_nginx
  configure_firewall
  configure_ssh_port
  install_tailscale
  print_summary
}

main "$@"
