# CISTracker: LAN-Only HTTPS + Remote Access Design

**Date:** 2026-04-29
**Status:** Approved
**Scope:** Single PR — remove Cloudflare Tunnel, add nginx TLS, mkcert local CA, Tailscale SSH

---

## Problem

CISTracker currently uses Cloudflare Tunnel (`cloudflared`) to provide HTTPS and remote SSH access. This requires:
- Outbound internet from the server to Cloudflare's edge at all times
- A Cloudflare account and tunnel token

Teacher requirement: the app must work entirely on the school LAN with no outbound internet traffic. Cloudflare Tunnel is incompatible with this requirement.

---

## School Network

| Property | Value |
|---|---|
| Domain | `ERCIS.local` |
| DNS Server | `10.2.201.4` (Windows Server) |
| DHCP Server | `10.0.2.1` |
| Gateway | `10.0.255.1` |
| Ubuntu server IP | Static — chosen by operator before install (e.g. `10.0.2.10`) |
| Public app URL | `https://cistracker.net` (resolved locally via DNS override) |

---

## Approach

Replace Cloudflare Tunnel with:
1. **Windows DNS override** — `cistracker.net` resolves to the server's LAN IP on the school network
2. **mkcert local CA** — generates a trusted TLS cert for `cistracker.net`; no internet required after initial install
3. **nginx HTTPS** — terminates TLS on port 443, proxies to Node on port 3000
4. **Group Policy cert deployment** — pushes the mkcert CA root to all `ERCIS.local` domain machines silently
5. **Tailscale** — replaces Cloudflare SSH tunnel for remote maintenance access
6. **SSH on port 2222** — sshd listens on 2222 in addition to 22; teacher SSHs in via Tailscale IP

---

## Section 1: Static IP

Before running the installer, the Ubuntu server must have a static IP so the DNS A record never breaks.

**Method:** Configure via `netplan` during or after Ubuntu install.

Example `/etc/netplan/00-installer-config.yaml`:
```yaml
network:
  version: 2
  ethernets:
    ens3:
      dhcp4: false
      addresses: [10.0.2.10/16]
      routes:
        - to: default
          via: 10.0.255.1
      nameservers:
        addresses: [10.2.201.4]
```

Replace `ens3` with the actual interface name (`ip link` to find it), and `10.0.2.10` with the chosen static IP. Apply with `sudo netplan apply`.

---

## Section 2: Windows DNS Override

On the Windows DNS Server (`10.2.201.4`):

1. Open **DNS Manager**
2. Right-click **Forward Lookup Zones** → **New Zone** → Primary zone, zone name: `cistracker.net`
3. Inside the new zone, add an **A record**:
   - Name: `@` (or leave blank — represents the zone apex)
   - IP: `10.0.2.10` (the server's static IP)
4. Optionally add a second A record for `www` pointing to the same IP

All domain-joined machines resolve `cistracker.net` to the local server. Cloudflare's public DNS continues to serve external queries (irrelevant — the server won't be reachable externally).

---

## Section 3: mkcert Local CA + Certificate

**What mkcert does:** Creates a private CA, signs a cert for `cistracker.net` with it. When the CA root is trusted by browsers, there are no warnings.

**Install location:** `/usr/local/bin/mkcert` (single static binary, ~7 MB)

**CAROOT on Linux (run as root):** `/root/.local/share/mkcert/`

**Steps (run on Ubuntu server as root):**

```bash
# Download mkcert binary
curl -fsSL https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-linux-amd64 \
  -o /usr/local/bin/mkcert
chmod +x /usr/local/bin/mkcert

# Create the local CA and register it with Ubuntu's system trust store
mkcert -install

# Create cert directory
mkdir -p /etc/ssl/cistracker

# Generate cert + key for cistracker.net
mkcert \
  -cert-file /etc/ssl/cistracker/cert.pem \
  -key-file  /etc/ssl/cistracker/key.pem \
  cistracker.net

# Export CA root for Group Policy distribution
cp /root/.local/share/mkcert/rootCA.pem /etc/ssl/cistracker/rootCA.crt
chmod 644 /etc/ssl/cistracker/rootCA.crt
chmod 640 /etc/ssl/cistracker/key.pem
```

The cert is valid for ~2 years. Renewal: re-run the `mkcert` cert generation command (takes 5 seconds, then `sudo nginx -s reload`).

---

## Section 4: nginx HTTPS Configuration

nginx is already installed by `install-cistracker.sh`. The config is updated from HTTP-only to full TLS.

**File:** `/etc/nginx/sites-available/cistracker`

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name cistracker.net;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name cistracker.net;

    ssl_certificate     /etc/ssl/cistracker/cert.pem;
    ssl_certificate_key /etc/ssl/cistracker/key.pem;

    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers off;

    client_max_body_size 25m;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### App .env changes

| Key | Old value | New value |
|---|---|---|
| `TLS_ENABLED` | `false` | `true` |
| `APP_URL` | `http://<ip>` | `https://cistracker.net` |

`TRUST_PROXY` defaults to `true` — no change needed.
`CLOUDFLARED_TOKEN` — removed from `.env.example` (already removed in previous PR).

---

## Section 5: Group Policy CA Cert Deployment

Copy `/etc/ssl/cistracker/rootCA.crt` from the Ubuntu server to a Windows machine (SCP, USB, or shared folder), then:

1. Open **Group Policy Management** on the Windows Server
2. Create or edit a GPO linked to the OU containing student computers
3. Navigate: `Computer Configuration → Policies → Windows Settings → Security Settings → Public Key Policies → Trusted Root Certification Authorities`
4. Right-click → **Import** → select `rootCA.crt`
5. Close GPMC

On next login or `gpupdate /force`, every domain machine silently trusts the mkcert CA. Chrome, Edge, and Firefox (with Windows cert store integration) will show no warnings. No student interaction required.

**Note:** iOS/Android personal devices are not domain-joined and will still get the "Not Secure" warning. Students can manually install the CA cert on personal devices if needed (Settings → General → VPN & Device Management on iOS). School-managed devices via ERCIS.local get it automatically.

---

## Section 6: Remove cloudflared

```bash
sudo systemctl stop cloudflared
sudo systemctl disable cloudflared
sudo rm -f /etc/apt/sources.list.d/cloudflared.list
sudo apt-get remove -y cloudflared
```

The `cloudflared` apt source is also removed so it doesn't get re-installed on future `apt upgrade` runs.

---

## Section 7: Tailscale + SSH on Port 2222

Tailscale provides a private `100.x.x.x` IP to the server that the teacher can reach from any device with Tailscale installed — from home, from a phone, anywhere.

### Install Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

`tailscale up` prints an auth URL. Open it in a browser, log in to the Tailscale account, and the server is registered. Get the Tailscale IP:

```bash
tailscale ip -4
```

### SSH on port 2222

Add to `/etc/ssh/sshd_config`:
```
Port 22
Port 2222
```

Allow in UFW:
```bash
sudo ufw allow 2222/tcp
sudo systemctl restart ssh
```

SSH from teacher's device (with Tailscale running):
```bash
ssh -p 2222 gdhughey@<tailscale-ip>
```

Port 22 remains open on the LAN for local access. Port 2222 over Tailscale is the remote-maintenance path, replacing the old `ssh.cistracker.net` Cloudflare tunnel.

---

## Section 8: install-cistracker.sh Changes

| Old function | New function |
|---|---|
| `install_cloudflared()` | Removed |
| `configure_nginx()` (HTTP only) | `configure_nginx()` (HTTPS) + `setup_tls()` |
| _(none)_ | `set_static_ip()` — writes netplan config, prompts operator for IP |
| _(none)_ | `install_tailscale()` — installs tailscale, prints `tailscale up` instructions |
| _(none)_ | `configure_ssh_port()` — adds Port 2222 to sshd_config, allows UFW |
| `print_summary()` | Updated — shows Tailscale instructions, no Cloudflare mentions |

The script remains idempotent. Re-running it on an already-configured host is safe.

### New script variables

```bash
STATIC_IP="${STATIC_IP:-}"          # e.g. 10.0.2.10 — required for TLS setup
STATIC_NETMASK="${STATIC_NETMASK:-16}"
GATEWAY="${GATEWAY:-10.0.255.1}"
DNS_SERVER="${DNS_SERVER:-10.2.201.4}"
DOMAIN="${DOMAIN:-cistracker.net}"
SSH_EXTRA_PORT="${SSH_EXTRA_PORT:-2222}"
SKIP_TAILSCALE="${SKIP_TAILSCALE:-0}"
```

Usage:
```bash
sudo STATIC_IP=10.0.2.10 bash install-cistracker.sh
```

---

## Internet Access Requirement

The **initial installation** requires outbound internet access (apt packages, Node.js installer, mkcert binary, Tailscale installer, npm packages, GitHub clone). This is a one-time bootstrapping step — connect the server to the internet for the install, then it runs indefinitely on the LAN with zero outbound traffic.

After install, the only outbound connection the server makes is Tailscale's keepalive to the Tailscale coordination server (a small background process). If even that is unacceptable, Tailscale can be skipped (`SKIP_TAILSCALE=1`) and remote access is handled by other means (direct LAN SSH only).

---

## Out of Scope

- No changes to the Node.js app code beyond `.env` values
- No changes to the database, auth, or any routes
- Cloudflare DNS records for `cistracker.net` are left as-is (they serve the outside world; the LAN DNS override shadows them for school machines)
- No Let's Encrypt / ACME — fully offline cert management via mkcert

---

## Deployment

Fresh install on a new Ubuntu server:

```bash
# On the Ubuntu server (as root or with sudo):
sudo STATIC_IP=10.0.2.10 bash install-cistracker.sh
sudo tailscale up   # authenticate once in browser
tailscale ip -4     # note this IP for SSH access

# On the Windows DNS Server:
# Add Forward Lookup Zone: cistracker.net → 10.0.2.10

# Copy CA cert to Windows Server for Group Policy:
# scp root@10.0.2.10:/etc/ssl/cistracker/rootCA.crt .
# Import into GPO → Trusted Root Certification Authorities
```
