# Installer Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update `install-cistracker.sh` to support Cloudflare Global API Key auth for certbot, bake in correct network defaults, and show a helpful API key reminder in the install summary.

**Architecture:** Single file edit to `install-cistracker.sh`. Three logical sections change: variable defaults at the top, `setup_letsencrypt_cf()` for auth logic, `configure_static_ip()` for dual DNS, and `print_summary()` for the key reminder.

**Tech Stack:** Bash, certbot, python3-certbot-dns-cloudflare, netplan

---

## Files

- Modify: `install-cistracker.sh`

---

### Task 1: Add CF_EMAIL and CF_GLOBAL_API_KEY variables

**Files:**
- Modify: `install-cistracker.sh` (lines ~53-62, the variable defaults block)

- [ ] **Step 1: Update the variable defaults block**

Find this block (around line 53):
```bash
CF_API_TOKEN="${CF_API_TOKEN:-}"          # Cloudflare API token (Zone:DNS:Edit)
CERT_EMAIL="${CERT_EMAIL:-}"             # Let's Encrypt account email
```

Replace with:
```bash
CF_API_TOKEN="${CF_API_TOKEN:-}"                        # Cloudflare scoped API token (Zone:DNS:Edit)
CF_EMAIL="${CF_EMAIL:-gdhughey0726@gmail.com}"          # Cloudflare account email (used with global key)
CF_GLOBAL_API_KEY="${CF_GLOBAL_API_KEY:-}"              # Cloudflare Global API Key
CERT_EMAIL="${CERT_EMAIL:-}"                            # Let's Encrypt account email (defaults to admin@DOMAIN)
```

- [ ] **Step 2: Update the usage comment at the top of the script**

Find:
```bash
# Usage (with Cloudflare — recommended for cistracker.net):
#   sudo CF_API_TOKEN=<token> STATIC_IP=<server-public-ip> bash install-cistracker.sh
#
#   The Cloudflare API token needs Zone → DNS → Edit permission for cistracker.net.
#   Create one at: https://dash.cloudflare.com/profile/api-tokens
```

Replace with:
```bash
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
```

- [ ] **Step 3: Update the All options comment block**

Find:
```bash
#   CF_API_TOKEN     Cloudflare API token (Zone:DNS:Edit) — enables Let's Encrypt DNS-01
#   CERT_EMAIL       Email for Let's Encrypt account (default: admin@<DOMAIN>)
```

Replace with:
```bash
#   CF_GLOBAL_API_KEY  Cloudflare Global API Key — enables Let's Encrypt DNS-01 (simplest)
#   CF_EMAIL           Cloudflare account email (default: gdhughey0726@gmail.com)
#   CF_API_TOKEN       Cloudflare scoped API token (Zone:DNS:Edit) — alternative to global key
#   CERT_EMAIL         Email for Let's Encrypt account (default: admin@<DOMAIN>)
```

- [ ] **Step 4: Verify the script still parses cleanly**

```bash
bash -n install-cistracker.sh && echo "syntax OK"
```
Expected: `syntax OK`

- [ ] **Step 5: Commit**

```bash
git add install-cistracker.sh
git commit -m "feat(installer): add CF_GLOBAL_API_KEY and CF_EMAIL vars with defaults"
```

---

### Task 2: Update setup_letsencrypt_cf() to support both auth methods

**Files:**
- Modify: `install-cistracker.sh` (`setup_letsencrypt_cf()` function, around lines 372-401)

- [ ] **Step 1: Replace the setup_letsencrypt_cf() function**

Find the entire function:
```bash
setup_letsencrypt_cf() {
  log "Obtaining Let's Encrypt certificate for ${DOMAIN} via Cloudflare DNS-01"

  # Credentials file — readable only by root
  mkdir -p /etc/letsencrypt
  cat > /etc/letsencrypt/cloudflare.ini <<EOF
dns_cloudflare_api_token = ${CF_API_TOKEN}
EOF
  chmod 600 /etc/letsencrypt/cloudflare.ini
```

Replace with:
```bash
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
```

- [ ] **Step 2: Update the setup_tls() dispatcher to check both CF vars**

Find:
```bash
  if [[ -n "${CF_API_TOKEN}" ]]; then
    install_certbot
    setup_letsencrypt_cf
  else
```

Replace with:
```bash
  if [[ -n "${CF_GLOBAL_API_KEY}" ]] || [[ -n "${CF_API_TOKEN}" ]]; then
    install_certbot
    setup_letsencrypt_cf
  else
```

- [ ] **Step 3: Update configure_nginx() cert path detection to match**

Find:
```bash
    if [[ -n "${CF_API_TOKEN}" ]]; then
      cert_pem="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
      key_pem="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"
```

Replace with:
```bash
    if [[ -n "${CF_GLOBAL_API_KEY}" ]] || [[ -n "${CF_API_TOKEN}" ]]; then
      cert_pem="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
      key_pem="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"
```

- [ ] **Step 4: Verify syntax**

```bash
bash -n install-cistracker.sh && echo "syntax OK"
```
Expected: `syntax OK`

- [ ] **Step 5: Commit**

```bash
git add install-cistracker.sh
git commit -m "feat(installer): support Cloudflare Global API Key for certbot DNS-01"
```

---

### Task 3: Update network defaults and dual DNS in configure_static_ip()

**Files:**
- Modify: `install-cistracker.sh` (variable defaults block + `configure_static_ip()`)

- [ ] **Step 1: Update the network variable defaults**

Find:
```bash
STATIC_IP="${STATIC_IP:-}"
STATIC_NETMASK="${STATIC_NETMASK:-16}"   # /16 = 255.255.0.0 — change to 24 for typical /24 LANs
GATEWAY="${GATEWAY:-10.0.255.1}"         # site-specific — set via env var if different
DNS_SERVER="${DNS_SERVER:-10.2.201.4}"   # site-specific — set via env var if different
```

Replace with:
```bash
STATIC_IP="${STATIC_IP:-10.0.2.127}"
STATIC_NETMASK="${STATIC_NETMASK:-24}"
GATEWAY="${GATEWAY:-10.0.255.1}"
DNS_SERVER="${DNS_SERVER:-10.0.2.1}"
DNS_SERVER_2="${DNS_SERVER_2:-10.2.201.4}"
```

- [ ] **Step 2: Add DNS_SERVER_2 to the All options comment**

Find:
```bash
#   DNS_SERVER       LAN DNS server IP (default: 10.2.201.4)
```

Replace with:
```bash
#   DNS_SERVER       Primary DNS server IP (default: 10.0.2.1)
#   DNS_SERVER_2     Secondary DNS server IP (default: 10.2.201.4, set to "" to omit)
```

- [ ] **Step 3: Update configure_static_ip() to support dual DNS**

Find the netplan heredoc inside `configure_static_ip()`:
```bash
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
```

Replace with:
```bash
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
```

- [ ] **Step 4: Verify syntax**

```bash
bash -n install-cistracker.sh && echo "syntax OK"
```
Expected: `syntax OK`

- [ ] **Step 5: Commit**

```bash
git add install-cistracker.sh
git commit -m "feat(installer): bake in network defaults (IP/24/DNS) and support dual DNS"
```

---

### Task 4: Update print_summary() with API key reminder

**Files:**
- Modify: `install-cistracker.sh` (`print_summary()` function)

- [ ] **Step 1: Update the CF_API_TOKEN SSL block in print_summary()**

Find:
```bash
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
```

Replace with:
```bash
    if [[ -n "${CF_GLOBAL_API_KEY}" ]] || [[ -n "${CF_API_TOKEN}" ]]; then
      echo "SSL: Let's Encrypt (trusted everywhere)"
      echo "  Cert: /etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
      echo "  Auto-renewal: systemctl status certbot.timer"
      echo
      echo "Cloudflare SSL mode: set to 'Full (Strict)' in Cloudflare dashboard"
      echo "  https://dash.cloudflare.com → cistracker.net → SSL/TLS → Overview"
      echo
    else
      echo "SSL: mkcert self-signed (LAN-only — not trusted by Cloudflare)"
      echo
      echo "To enable HTTPS with a trusted Let's Encrypt cert, re-run with your"
      echo "Cloudflare Global API Key:"
      echo
      echo "  curl -fsSL https://raw.githubusercontent.com/gdhughey/CISTracker/main/install-cistracker.sh \\"
      echo "    | sudo CF_GLOBAL_API_KEY=<your-key> bash"
      echo
      echo "  Get your key at: https://dash.cloudflare.com/profile/api-tokens"
      echo "  (Global API Key → View)"
      echo
```

- [ ] **Step 2: Verify syntax**

```bash
bash -n install-cistracker.sh && echo "syntax OK"
```
Expected: `syntax OK`

- [ ] **Step 3: Commit**

```bash
git add install-cistracker.sh
git commit -m "feat(installer): show CF_GLOBAL_API_KEY hint in summary when no creds provided"
```

---

### Task 5: Push and verify

- [ ] **Step 1: Do a final full syntax check**

```bash
bash -n install-cistracker.sh && echo "syntax OK"
```
Expected: `syntax OK`

- [ ] **Step 2: Grep to confirm all three CF_API_TOKEN checks were updated**

```bash
grep -n "CF_API_TOKEN\|CF_GLOBAL_API_KEY\|CF_EMAIL" install-cistracker.sh
```

Expected: Every conditional that previously checked only `CF_API_TOKEN` now also checks `CF_GLOBAL_API_KEY`. Variable defaults should show all three vars. No lone `CF_API_TOKEN` conditionals should remain (the variable itself is still valid — just the `if` checks must include both).

- [ ] **Step 3: Push to main**

```bash
git push origin main
```

- [ ] **Step 4: Confirm the raw file is reachable**

```bash
curl -fsSL https://raw.githubusercontent.com/gdhughey/CISTracker/main/install-cistracker.sh | head -5
```
Expected: First 5 lines of the script print cleanly (no 404 error).
