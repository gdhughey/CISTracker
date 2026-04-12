#!/usr/bin/env bash
#
# CyberLab On-Premises installer
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/gdhughey/cyberlab-onprem/main/install.sh | sudo bash
#
# Safe to re-run: updates in-place, preserves existing database and .env.

set -euo pipefail

# ------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------
REPO_URL="https://github.com/gdhughey/cyberlab-onprem.git"
BRANCH="${CYBERLAB_BRANCH:-main}"
INSTALL_DIR="/opt/cyberlab"
APP_DIR="$INSTALL_DIR/app"
DATA_DIR="$INSTALL_DIR/data"
UPLOADS_DIR="$INSTALL_DIR/uploads"
LOGS_DIR="$INSTALL_DIR/logs"
APP_USER="cyberlab"
SERVICE_NAME="cyberlab"
APP_PORT=3000
NODE_MAJOR=20
OLLAMA_MODEL="${CYBERLAB_OLLAMA_MODEL:-qwen2.5vl:7b}"
SKIP_OLLAMA="${CYBERLAB_SKIP_OLLAMA:-0}"

# ------------------------------------------------------------------
# Pretty output
# ------------------------------------------------------------------
if [[ -t 1 ]]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  BLUE='\033[0;34m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; DIM=''; NC=''
fi

step()  { echo -e "\n${BLUE}==>${NC} ${BOLD}$*${NC}"; }
ok()    { echo -e "  ${GREEN}✓${NC} $*"; }
warn()  { echo -e "  ${YELLOW}!${NC} $*"; }
err()   { echo -e "  ${RED}✗${NC} $*" >&2; }
info()  { echo -e "  ${DIM}$*${NC}"; }

banner() {
  echo
  echo -e "${BOLD}${BLUE}┌────────────────────────────────────────────────┐${NC}"
  echo -e "${BOLD}${BLUE}│${NC}  ${BOLD}CIS Tracker Installer${NC}                ${BOLD}${BLUE}│${NC}"
  echo -e "${BOLD}${BLUE}│${NC}  ${DIM}Inventory & checkout tracker${NC}                  ${BOLD}${BLUE}│${NC}"
  echo -e "${BOLD}${BLUE}└────────────────────────────────────────────────┘${NC}"
  echo
}

trap 'err "Installation failed on line $LINENO"; exit 1' ERR

# ------------------------------------------------------------------
# Preflight checks
# ------------------------------------------------------------------
banner

if [[ $EUID -ne 0 ]]; then
  err "This installer must run as root."
  err "Try: curl -fsSL https://raw.githubusercontent.com/gdhughey/cyberlab-onprem/main/install.sh | sudo bash"
  exit 1
fi

if [[ -r /etc/os-release ]]; then
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" && "${ID_LIKE:-}" != *"debian"* ]]; then
    warn "This installer is tested on Ubuntu. Detected: ${PRETTY_NAME:-unknown}"
    warn "Continuing anyway..."
  else
    info "Detected: ${PRETTY_NAME:-Ubuntu}"
  fi
fi

ARCH=$(dpkg --print-architecture 2>/dev/null || uname -m)
info "Architecture: $ARCH"
info "Install dir:  $INSTALL_DIR"
info "Service:      $SERVICE_NAME.service"
info "App port:     $APP_PORT (nginx proxies :80 → :$APP_PORT)"

# ------------------------------------------------------------------
# 1. Base packages
# ------------------------------------------------------------------
step "Installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  curl wget git ca-certificates gnupg ufw \
  build-essential python3 sqlite3
ok "apt packages installed"

# ------------------------------------------------------------------
# 2. Node.js 20 LTS
# ------------------------------------------------------------------
step "Installing Node.js $NODE_MAJOR"
if command -v node >/dev/null 2>&1 && node -v | grep -q "^v$NODE_MAJOR\."; then
  ok "Node.js $(node -v) already installed"
else
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs
  ok "Node.js $(node -v) installed"
fi

# ------------------------------------------------------------------
# 3. nginx
# ------------------------------------------------------------------
step "Installing nginx"
if command -v nginx >/dev/null 2>&1; then
  ok "nginx already installed"
else
  apt-get install -y -qq nginx
  ok "nginx installed"
fi

# ------------------------------------------------------------------
# 4. Ollama
# ------------------------------------------------------------------
if [[ "$SKIP_OLLAMA" != "1" ]]; then
  step "Installing Ollama"
  if command -v ollama >/dev/null 2>&1; then
    ok "Ollama already installed ($(ollama --version 2>/dev/null || echo 'version unknown'))"
  else
    curl -fsSL https://ollama.com/install.sh | sh >/dev/null 2>&1 || {
      warn "Ollama install failed — continuing without vision support"
      SKIP_OLLAMA=1
    }
    [[ "$SKIP_OLLAMA" != "1" ]] && ok "Ollama installed"
  fi
fi

# ------------------------------------------------------------------
# 5. Pull vision model (can take several minutes)
# ------------------------------------------------------------------
if [[ "$SKIP_OLLAMA" != "1" ]] && command -v ollama >/dev/null 2>&1; then
  step "Pulling vision model $OLLAMA_MODEL"
  if ollama list 2>/dev/null | grep -q "^${OLLAMA_MODEL%%:*}"; then
    ok "$OLLAMA_MODEL already pulled"
  else
    info "This downloads ~6 GB and takes several minutes..."
    if ! ollama pull "$OLLAMA_MODEL"; then
      warn "Model pull failed — vision scanning will be disabled"
      warn "You can pull it later with: ollama pull $OLLAMA_MODEL"
    else
      ok "$OLLAMA_MODEL ready"
    fi
  fi
fi

# ------------------------------------------------------------------
# 6. System user
# ------------------------------------------------------------------
step "Creating system user $APP_USER"
if id "$APP_USER" &>/dev/null; then
  ok "User $APP_USER already exists"
else
  useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$APP_USER"
  ok "User $APP_USER created"
fi

# ------------------------------------------------------------------
# 7. Directory layout
# ------------------------------------------------------------------
step "Preparing $INSTALL_DIR"
mkdir -p "$INSTALL_DIR" "$DATA_DIR" "$UPLOADS_DIR" "$LOGS_DIR"
chown -R "$APP_USER:$APP_USER" "$INSTALL_DIR"
ok "Directories ready"

# ------------------------------------------------------------------
# 8. Clone or update the repo
# ------------------------------------------------------------------
step "Fetching application code"
if [[ -d "$APP_DIR/.git" ]]; then
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch --quiet --all
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --quiet --hard "origin/$BRANCH"
  ok "Updated from origin/$BRANCH"
else
  rm -rf "$APP_DIR"
  sudo -u "$APP_USER" git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  ok "Cloned branch $BRANCH"
fi

# ------------------------------------------------------------------
# 9. npm install
# ------------------------------------------------------------------
step "Installing Node dependencies"
info "This takes a minute — better-sqlite3 and bcrypt compile native code"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm install --omit=dev --silent --no-audit --no-fund"
ok "Dependencies installed"

# ------------------------------------------------------------------
# 10. Generate .env (first install only — we preserve existing)
# ------------------------------------------------------------------
FIRST_INSTALL=0
if [[ ! -f "$APP_DIR/.env" ]]; then
  step "Generating .env"
  FIRST_INSTALL=1

  SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
  ADMIN_PASSWORD="Aa1!$(node -e "console.log(require('crypto').randomBytes(8).toString('hex'))")"
  SERVER_IP=$(hostname -I | awk '{print $1}')

  sudo -u "$APP_USER" tee "$APP_DIR/.env" >/dev/null <<EOF
# Generated by install.sh on $(date -Iseconds)
NODE_ENV=production
PORT=$APP_PORT
TRUST_PROXY=true

SESSION_SECRET=$SESSION_SECRET
SESSION_IDLE_MINUTES=15
SESSION_ABSOLUTE_HOURS=8

DB_PATH=$DATA_DIR/cyberlab.db
UPLOAD_DIR=$UPLOADS_DIR
UPLOAD_MAX_MB=10

ALLOW_REGISTRATION=false

MAX_FAILED_LOGINS=5
LOCKOUT_MINUTES=15
PASSWORD_MIN_LENGTH=10
BCRYPT_COST=12

OLLAMA_ENABLED=true
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=$OLLAMA_MODEL
OLLAMA_TIMEOUT_MS=180000

# Gmail SMTP — use an App Password, not your regular password.
# 1. Enable 2FA on the Google account: myaccount.google.com/security
# 2. Create an App Password: myaccount.google.com/apppasswords
# 3. Paste the 16-char app password below (no spaces).
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

REMINDER_DAYS=3
ALERT_DAYS=5
REMINDER_CRON=0 9 * * *

APP_URL=http://$SERVER_IP

SEED_ADMIN_USERNAME=admin
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=$ADMIN_PASSWORD
EOF
  chmod 600 "$APP_DIR/.env"
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  echo "$ADMIN_PASSWORD" > /root/cyberlab-admin-password
  chmod 600 /root/cyberlab-admin-password
  ok ".env generated with fresh SESSION_SECRET"
else
  step "Using existing .env"
  ok "Preserving /opt/cyberlab/app/.env"
fi

# ------------------------------------------------------------------
# 11. Migrate + seed
# ------------------------------------------------------------------
step "Running database migrations"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && node src/db/migrate.js" | sed 's/^/  /'
ok "Migrations applied"

if [[ "$FIRST_INSTALL" == "1" ]]; then
  step "Seeding initial admin user"
  sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && node scripts/seed.js" | sed 's/^/  /'
  ok "Admin user seeded"
fi

# ------------------------------------------------------------------
# 12. systemd unit
# ------------------------------------------------------------------
step "Installing systemd service"

OLLAMA_DEP=""
if [[ "$SKIP_OLLAMA" != "1" ]] && systemctl list-unit-files ollama.service >/dev/null 2>&1; then
  OLLAMA_DEP="ollama.service"
fi

cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=CIS Tracker
Documentation=https://github.com/gdhughey/cyberlab-onprem
After=network.target $OLLAMA_DEP
Wants=network.target $OLLAMA_DEP

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node $APP_DIR/server.js
Restart=on-failure
RestartSec=5
StandardOutput=append:$LOGS_DIR/out.log
StandardError=append:$LOGS_DIR/error.log
Environment=NODE_ENV=production

# Sandboxing
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$INSTALL_DIR
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictNamespaces=true
LockPersonality=true
MemoryDenyWriteExecute=false

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --quiet ${SERVICE_NAME}.service
systemctl restart ${SERVICE_NAME}.service

# Give it a moment to boot
sleep 3
if systemctl is-active --quiet ${SERVICE_NAME}.service; then
  ok "Service running"
else
  err "Service failed to start. Recent logs:"
  journalctl -u ${SERVICE_NAME} -n 30 --no-pager | sed 's/^/    /' >&2
  exit 1
fi

# ------------------------------------------------------------------
# 13. nginx reverse proxy
# ------------------------------------------------------------------
step "Configuring nginx"
cat > /etc/nginx/sites-available/cyberlab <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    client_max_body_size 15M;

    access_log /var/log/nginx/cyberlab-access.log;
    error_log  /var/log/nginx/cyberlab-error.log;

    # Health
    location = /healthz {
        proxy_pass http://127.0.0.1:3000/healthz;
        access_log off;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/cyberlab /etc/nginx/sites-enabled/cyberlab
rm -f /etc/nginx/sites-enabled/default
nginx -t 2>/dev/null
systemctl restart nginx
ok "nginx reverse proxy live on :80"

# ------------------------------------------------------------------
# 14. Firewall
# ------------------------------------------------------------------
step "Configuring firewall"
if ! ufw status | grep -q "Status: active"; then
  ufw --force enable >/dev/null
fi
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 80/tcp >/dev/null 2>&1 || true
ok "ufw: SSH + 80/tcp allowed"

# ------------------------------------------------------------------
# 15. Summary
# ------------------------------------------------------------------
SERVER_IP=$(hostname -I | awk '{print $1}')
echo
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  CyberLab is running${NC}"
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo
echo -e "  URL:       ${BOLD}http://$SERVER_IP${NC}"
if [[ "$FIRST_INSTALL" == "1" ]]; then
  echo -e "  Username:  ${BOLD}admin${NC}"
  echo -e "  Password:  ${BOLD}$(cat /root/cyberlab-admin-password)${NC}"
  echo
  echo -e "  ${YELLOW}You will be forced to change the password on first login.${NC}"
  echo -e "  ${DIM}(Also saved to /root/cyberlab-admin-password)${NC}"
fi
echo
echo -e "  ${DIM}Service:${NC}   systemctl status $SERVICE_NAME"
echo -e "  ${DIM}Logs:${NC}      journalctl -u $SERVICE_NAME -f"
echo -e "  ${DIM}Restart:${NC}   systemctl restart $SERVICE_NAME"
echo -e "  ${DIM}Update:${NC}    curl -fsSL https://raw.githubusercontent.com/gdhughey/cyberlab-onprem/main/install.sh | sudo bash"
echo -e "  ${DIM}Uninstall:${NC} curl -fsSL https://raw.githubusercontent.com/gdhughey/cyberlab-onprem/main/scripts/uninstall.sh | sudo bash"
echo
