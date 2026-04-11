# CyberLab On-Premises

Self-hosted equipment checkout & inventory tracker for the CyberLab.

Built to run on a dedicated Ubuntu Server with no cloud dependencies. Replaces the previous AWS-hosted version (Lambda + DynamoDB + Cognito) with a single Node.js process backed by SQLite, with local AI vision via Ollama.

## Stack

- **Runtime:** Node.js 20 + Express 4
- **Database:** SQLite (better-sqlite3)
- **Auth:** bcrypt + server-side sessions + HttpOnly cookies + TOTP MFA
- **Vision:** Ollama running `qwen2.5vl:7b` (local), with optional Anthropic Sonnet fallback
- **Reverse proxy:** nginx
- **Process manager:** systemd

## Install on Ubuntu Server (one command)

```bash
curl -fsSL https://raw.githubusercontent.com/gdhughey/cyberlab-onprem/main/install.sh | sudo bash
```

This installs Node.js 20, nginx, Ollama + the vision model, creates a `cyberlab` system user, clones the repo to `/opt/cyberlab/app`, generates a fresh `.env` with a random `SESSION_SECRET` and admin password, runs migrations, registers a systemd service, and brings up nginx on port 80.

The initial admin password is printed at the end and also saved to `/root/cyberlab-admin-password`. You will be forced to change it on first login.

Re-running the installer updates the app in place while preserving the database, uploads, and `.env`.

### Uninstall

```bash
# Keeps database + uploads + .env
curl -fsSL https://raw.githubusercontent.com/gdhughey/cyberlab-onprem/main/scripts/uninstall.sh | sudo bash

# Delete everything
curl -fsSL https://raw.githubusercontent.com/gdhughey/cyberlab-onprem/main/scripts/uninstall.sh | sudo bash -s -- --purge
```

### Installer environment overrides

| Variable | Default | Purpose |
|---|---|---|
| `CYBERLAB_BRANCH` | `main` | Git branch to install from |
| `CYBERLAB_OLLAMA_MODEL` | `qwen2.5vl:7b` | Vision model to pull |
| `CYBERLAB_SKIP_OLLAMA` | `0` | Set to `1` to skip Ollama entirely |

## Quick start (development)

```bash
git clone https://github.com/gdhughey/cyberlab-onprem.git
cd cyberlab-onprem
npm install
cp .env.example .env
# edit .env — at minimum set SESSION_SECRET
npm run migrate
npm run seed
npm start
```

Open http://localhost:3000 and log in with the seeded admin credentials.

## Production deployment

See `PRODUCTION.md` (coming soon) or the build guide PDF.

## Security model

- All passwords hashed with bcrypt cost 12
- Sessions stored server-side in SQLite, looked up by HttpOnly cookie
- CSRF protection via double-submit cookie pattern
- Rate limiting on login (5/15min) and API (100/min)
- Helmet security headers + strict CSP
- Account lockout after 5 failed logins
- All security-relevant actions written to `audit_log` table
- App runs as unprivileged `cyberlab` user, not root
