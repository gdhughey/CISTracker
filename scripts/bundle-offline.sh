#!/usr/bin/env bash
set -euo pipefail

# bundle-offline.sh — Build an offline install bundle for CISTracker.
#
# Run this on ANY Linux machine that has internet access (Ubuntu/Debian
# preferred; matches what the target server runs). The output is a single
# tarball you copy to USB and bring to the air-gapped server.
#
# The bundle contains:
#   - The full repo source (.git stripped)
#   - node_modules/ pre-built for Linux x86_64 (matches Ubuntu 24.04 server)
#   - Node.js 20.x .deb package
#   - mkcert binary
#   - Tailscale .deb package (skipped if --no-tailscale)
#   - install-offline.sh (the runtime installer)
#
# Usage:
#   ./scripts/bundle-offline.sh              # full bundle
#   ./scripts/bundle-offline.sh --no-tailscale
#
# Requirements on this build machine:
#   - bash, curl, tar, dpkg-deb (apt-get install dpkg-dev if missing)
#   - Node.js 20 + npm (the bundle inherits whatever native bindings npm
#     compiles, so this MUST be Linux x86_64 to match the target)
#   - Internet access during the bundle step

# ── Args ────────────────────────────────────────────────────────────────
INCLUDE_TAILSCALE=1
for arg in "$@"; do
  case "$arg" in
    --no-tailscale) INCLUDE_TAILSCALE=0 ;;
    -h|--help)
      sed -n '1,30p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

# ── Setup ───────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_MAJOR="${NODE_MAJOR:-20}"
MKCERT_VERSION="${MKCERT_VERSION:-v1.4.4}"
BUNDLE_NAME="cistracker-offline-$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d)/${BUNDLE_NAME}"
mkdir -p "${WORK}"/{repo,nodejs,mkcert,tailscale}

cleanup() { rm -rf "$(dirname "${WORK}")"; }
trap cleanup EXIT

log() { echo; echo "==> $*"; }

# Sanity checks
if [[ "$(uname -s)" != "Linux" ]] || [[ "$(uname -m)" != "x86_64" ]]; then
  echo "ERROR: bundle-offline.sh must run on Linux x86_64 (the target server's arch)." >&2
  echo "       On Windows, use WSL Ubuntu or:" >&2
  echo "       docker run -v \"\$(pwd):/app\" -w /app node:20-bookworm bash scripts/bundle-offline.sh" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm not found. Install Node.js ${NODE_MAJOR} first." >&2
  exit 1
fi

# ── 1. Copy source (without .git, node_modules, data, .env) ─────────────
log "Copying source tree"
rsync -a \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='data' \
  --exclude='uploads' \
  --exclude='.env' \
  --exclude='.superpowers' \
  --exclude='.claude' \
  --exclude='.agents' \
  --exclude='.worktrees' \
  --exclude='*.log' \
  "${REPO_ROOT}/" "${WORK}/repo/"

# ── 2. Install node_modules into the bundle ─────────────────────────────
log "Installing npm dependencies (production only)"
cd "${WORK}/repo"
npm ci --omit=dev 2>&1 | tail -5 || npm install --omit=dev 2>&1 | tail -5
cd - >/dev/null

# Verify native bindings landed (better-sqlite3 + bcrypt)
for native in better-sqlite3 bcrypt; do
  if ! find "${WORK}/repo/node_modules/${native}" -name '*.node' | grep -q .; then
    echo "ERROR: ${native} did not produce a .node native binding. Are we on Linux x86_64?" >&2
    exit 1
  fi
done
log "Native bindings OK (better-sqlite3 + bcrypt compiled for $(uname -m))"

# ── 3. Download Node.js 20 .deb ─────────────────────────────────────────
log "Fetching Node.js ${NODE_MAJOR}.x .deb"
# Use the nodesource pool which packages a single all-in-one nodejs deb
NODE_DEB_URL="$(curl -fsSL "https://deb.nodesource.com/node_${NODE_MAJOR}.x/pool/main/n/nodejs/" \
  | grep -oE 'nodejs_'"${NODE_MAJOR}"'\.[0-9.]+-1nodesource1_amd64\.deb' \
  | sort -V | tail -1)"
if [[ -z "${NODE_DEB_URL}" ]]; then
  echo "ERROR: could not discover Node.js .deb URL from nodesource." >&2
  exit 1
fi
curl -fsSL "https://deb.nodesource.com/node_${NODE_MAJOR}.x/pool/main/n/nodejs/${NODE_DEB_URL}" \
  -o "${WORK}/nodejs/${NODE_DEB_URL}"
log "Saved ${NODE_DEB_URL}"

# ── 4. Download mkcert binary ───────────────────────────────────────────
log "Fetching mkcert ${MKCERT_VERSION}"
curl -fsSL \
  "https://github.com/FiloSottile/mkcert/releases/download/${MKCERT_VERSION}/mkcert-${MKCERT_VERSION}-linux-amd64" \
  -o "${WORK}/mkcert/mkcert"
chmod +x "${WORK}/mkcert/mkcert"

# ── 5. Download Tailscale .deb (optional) ───────────────────────────────
if [[ "${INCLUDE_TAILSCALE}" == "1" ]]; then
  log "Fetching Tailscale .deb"
  TS_VERSION="$(curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/dists/noble/main/binary-amd64/Packages \
    | awk '/^Package: tailscale$/{flag=1} flag && /^Version: /{print $2; exit}')"
  if [[ -z "${TS_VERSION}" ]]; then
    echo "WARNING: could not discover Tailscale version. Skipping Tailscale." >&2
  else
    curl -fsSL "https://pkgs.tailscale.com/stable/ubuntu/pool/tailscale_${TS_VERSION}_amd64.deb" \
      -o "${WORK}/tailscale/tailscale_${TS_VERSION}_amd64.deb"
    log "Saved tailscale_${TS_VERSION}_amd64.deb"
  fi
else
  log "Skipping Tailscale (--no-tailscale)"
fi

# ── 6. Copy install-offline.sh into the bundle ──────────────────────────
cp "${REPO_ROOT}/scripts/install-offline.sh" "${WORK}/install-offline.sh"
chmod +x "${WORK}/install-offline.sh"

# ── 7. Tar it up ────────────────────────────────────────────────────────
log "Creating tarball"
OUT_DIR="${REPO_ROOT}/dist"
mkdir -p "${OUT_DIR}"
TARBALL="${OUT_DIR}/${BUNDLE_NAME}.tar.gz"
tar -czf "${TARBALL}" -C "$(dirname "${WORK}")" "${BUNDLE_NAME}"

SIZE="$(du -h "${TARBALL}" | awk '{print $1}')"

cat <<EOF

═══════════════════════════════════════════════════════════════════════
  Offline bundle ready
═══════════════════════════════════════════════════════════════════════

  ${TARBALL}
  Size: ${SIZE}

To deploy on the air-gapped server:

  1. Copy the tarball to USB
  2. Plug USB into the Proxmox host or directly into the Ubuntu VM
  3. From the server (sudo):

     mkdir -p /tmp/cistracker-bundle
     tar -xzf /media/usb/${BUNDLE_NAME}.tar.gz -C /tmp/cistracker-bundle --strip-components=1
     cd /tmp/cistracker-bundle
     sudo STATIC_IP=10.0.2.10 bash install-offline.sh

  All STATIC_IP / GATEWAY / DNS_SERVER / DOMAIN env vars from
  install-cistracker.sh are honored here too.

═══════════════════════════════════════════════════════════════════════
EOF
