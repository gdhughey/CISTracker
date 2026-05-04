# Offline / USB install

For environments where the target server can't reach GitHub or npm — typical of a school network with strict egress filtering. The install becomes a two-step process:

1. **At home (or any machine with internet)**: build a single tarball containing everything
2. **At school**: copy the tarball to USB, run one script on the air-gapped Proxmox/Ubuntu VM

---

## Step 1 — Build the bundle (run once, from home)

You need a **Linux x86_64** machine with internet to build the bundle. The native modules in `node_modules` (`better-sqlite3`, `bcrypt`) compile against whatever architecture you build on, so building on Windows or macOS would produce binaries the target can't load.

### Option A — Native Linux (or WSL)

```bash
git clone https://github.com/gdhughey/CISTracker.git
cd CISTracker
bash scripts/bundle-offline.sh
```

### Option B — Docker on Windows / macOS

```bash
git clone https://github.com/gdhughey/CISTracker.git
cd CISTracker
docker run --rm -v "$(pwd):/app" -w /app node:20-bookworm bash scripts/bundle-offline.sh
```

Either option produces a tarball at `dist/cistracker-offline-YYYYMMDD-HHMMSS.tar.gz` (~80–120 MB). Inside it:

| Path | What it is |
|---|---|
| `repo/` | Full source tree, `node_modules/` already installed for Linux |
| `nodejs/nodejs_*.deb` | Node.js 20.x .deb |
| `mkcert/mkcert` | mkcert binary for the local-CA cert |
| `tailscale/tailscale_*.deb` | Tailscale (skip with `--no-tailscale`) |
| `install-offline.sh` | The runtime installer |

---

## Step 2 — Copy to USB

```bash
cp dist/cistracker-offline-*.tar.gz /media/<your-usb>/
```

Eject and walk it over.

---

## Step 3 — Install on the school server

The server runs Proxmox; CISTracker installs into an **Ubuntu 24.04 VM**. Pass the USB through to that VM (Proxmox → VM → Hardware → Add → USB Device → pick the stick), or just `scp` the tarball over Tailscale if you already have that, or mount the USB on the Proxmox host and copy via `qm` push.

Once the tarball is on the VM:

```bash
# 1. Mount the USB if needed
sudo mkdir -p /mnt/usb
sudo mount /dev/sdb1 /mnt/usb     # check `lsblk` for the right device

# 2. Extract
mkdir -p /tmp/cistracker-bundle
tar -xzf /mnt/usb/cistracker-offline-*.tar.gz \
    -C /tmp/cistracker-bundle --strip-components=1
cd /tmp/cistracker-bundle

# 3. Run the installer (no internet required)
sudo STATIC_IP=10.0.2.10 \
     GATEWAY=10.0.255.1 \
     DNS_SERVER=10.2.201.4 \
     DOMAIN=cistracker.net \
     bash install-offline.sh
```

### Env vars (same as `install-cistracker.sh`)

| Variable | Default | Notes |
|---|---|---|
| `STATIC_IP`       | _(unset)_ | LAN IP for the server. Required to enable HTTPS. Without it, the installer falls back to HTTP on port 80. |
| `STATIC_NETMASK`  | `16` | CIDR prefix length |
| `GATEWAY`         | `10.0.255.1` | School gateway IP |
| `DNS_SERVER`      | `10.2.201.4` | School DNS |
| `DOMAIN`          | `cistracker.net` | Hostname clients use to reach the server |
| `SSH_EXTRA_PORT`  | `2222` | Port for Tailscale SSH; port 22 is closed |
| `SKIP_TAILSCALE`  | `0` | Set `1` to skip the Tailscale install step |

The installer is **idempotent** — re-running it on the same VM upgrades the app in place without trashing the database, uploads, or `.env`.

---

## After install

The website is at `https://cistracker.net` (when `STATIC_IP` was set), but only resolves correctly from machines that have a DNS override mapping the domain to the LAN IP. Two options:

- **Per-machine `hosts` file** — add `<STATIC_IP>  cistracker.net` to `C:\Windows\System32\drivers\etc\hosts` (Windows) or `/etc/hosts` (Linux/Mac)
- **School DNS** — easier if you can ask IT to add a local DNS entry

Each client device also needs the **mkcert root CA** trusted, otherwise browsers will warn about the self-signed cert. Copy `/etc/ssl/cistracker/rootCA.crt` off the server and:

- **Windows (one-off)**: double-click → Install Certificate → Local Machine → Trusted Root Certification Authorities
- **Windows (fleet via Group Policy)**: Computer Configuration → Policies → Windows Settings → Security Settings → Public Key Policies → Trusted Root Certification Authorities → Import the .crt
- **iOS**: AirDrop the `.crt` to the device, install the profile, then in Settings → General → About → Certificate Trust Settings, enable full trust for the new cert
- **Android**: Settings → Security → Encryption & credentials → Install a certificate → CA certificate

---

## Updating later (without rebuilding the whole bundle)

If you only changed application code (no new dependencies), you can ship just the source diff:

```bash
# At home
tar --exclude='node_modules' --exclude='.git' --exclude='data' --exclude='.env' \
    -czf src-update.tar.gz -C /path/to/CISTracker .
# Copy via USB

# On the server
sudo tar -xzf /mnt/usb/src-update.tar.gz -C /opt/CISTracker --strip-components=1
sudo chown -R cistracker:cistracker /opt/CISTracker
sudo systemctl restart cistracker
```

For dependency changes (`package.json`/`package-lock.json` updated), you must rebuild the whole bundle — `node_modules` has to be regenerated on a Linux x86_64 box.

---

## Troubleshooting

**`apt-get install` fails "Unable to locate package nginx"** during the offline install — Ubuntu 24.04 ships with nginx in the base image but if you used a minimal cloud-init image it may be absent. Fix:

```bash
# Build a small extra-debs bundle on a connected Ubuntu machine
apt-get download nginx nginx-common nginx-core sqlite3 build-essential ca-certificates
# tar them up, copy to USB, install with `sudo dpkg -i *.deb` on the server
```

**better-sqlite3: module did not self-register** — node_modules was built on the wrong architecture. Rebuild the bundle on a Linux x86_64 host (Ubuntu/Debian, not Alpine — musl vs glibc mismatch).

**Tailscale won't authenticate** — Tailscale's auth endpoint requires internet. From the school network, run `sudo tailscale up` from a phone hotspot or temporarily uncage the VM's egress; once authenticated, the device key persists and you don't need internet for normal SSH access via Tailscale's mesh.
