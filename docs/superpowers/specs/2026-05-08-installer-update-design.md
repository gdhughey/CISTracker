# Installer Update Design — 2026-05-08

## Context

CISTracker runs on a Proxmox VM (Ubuntu/Debian). After a RAID failure and Proxmox reinstall, the
installer (`install-cistracker.sh`) needs to be updated so a fresh install is a single command with
minimal manual input.

## Goals

1. Support Cloudflare Global API Key auth (in addition to existing scoped token) for certbot DNS-01
2. Bake in correct network defaults so they never have to be typed again
3. Print a clear reminder at the end showing how to pass the API key if it was omitted

## Out of Scope

- `scripts/install-from-here.sh` — not used; not changed
- Any app-level code changes

---

## Changes to `install-cistracker.sh`

### 1. Cloudflare Auth — Global API Key Support

Add two new env vars:

| Var | Default | Notes |
|-----|---------|-------|
| `CF_EMAIL` | `gdhughey0726@gmail.com` | Cloudflare account email |
| `CF_GLOBAL_API_KEY` | _(empty)_ | Cloudflare Global API Key — passed at runtime, never hardcoded |

**Detection logic** in `setup_letsencrypt_cf()`:
- If `CF_GLOBAL_API_KEY` is set → write global-key format to `cloudflare.ini`
- Else if `CF_API_TOKEN` is set → write scoped-token format (existing behavior)
- Else → skip certbot, fall through to mkcert fallback

**`cloudflare.ini` formats:**

Global key format:
```ini
dns_cloudflare_email = gdhughey0726@gmail.com
dns_cloudflare_api_key = <CF_GLOBAL_API_KEY>
```

Scoped token format (existing):
```ini
dns_cloudflare_api_token = <CF_API_TOKEN>
```

File permissions remain `600` (root only).

### 2. Network Defaults

| Var | Old Default | New Default |
|-----|-------------|-------------|
| `STATIC_IP` | _(empty)_ | `10.0.2.127` |
| `STATIC_NETMASK` | `16` | `24` |
| `GATEWAY` | `10.0.255.1` | `10.0.255.1` _(unchanged)_ |
| `DNS_SERVER` | `10.2.201.4` | `10.0.2.1` (primary) |
| `DNS_SERVER_2` | _(new, empty)_ | `10.2.201.4` (secondary) |

`configure_static_ip()` emits both in the netplan array when `DNS_SERVER_2` is set:
```yaml
nameservers:
  addresses: [10.0.2.1, 10.2.201.4]
```
If `DNS_SERVER_2` is empty, only the primary is written.

### 3. `print_summary()` — API Key Reminder

At the end of the install:
- If CF creds **were** provided → print: `SSL: Let's Encrypt cert issued via Cloudflare`
- If CF creds **were not** provided → print the full curl command showing how to re-run with the key:

```
To enable HTTPS with a trusted Let's Encrypt cert, re-run with your Cloudflare Global API Key:

  curl -fsSL https://raw.githubusercontent.com/gdhughey/CISTracker/main/install-cistracker.sh \
    | sudo CF_GLOBAL_API_KEY=<your-key> bash
```

---

## Usage After This Change

Minimal fresh install (one env var):
```bash
curl -fsSL https://raw.githubusercontent.com/gdhughey/CISTracker/main/install-cistracker.sh \
  | sudo CF_GLOBAL_API_KEY=yourkey bash
```

Full override example:
```bash
sudo CF_GLOBAL_API_KEY=yourkey STATIC_IP=10.0.2.127 bash install-cistracker.sh
```

---

## What Is NOT Changing

- All existing env vars remain valid (`CF_API_TOKEN`, `CERT_EMAIL`, `SKIP_TAILSCALE`, etc.)
- Certbot install process, nginx config, systemd service, firewall, Tailscale — unchanged
- mkcert fallback still works when no CF creds are provided at all
