# CyberLab On-Premises

Self-hosted equipment checkout & inventory tracker for the CyberLab.

Built to run on a dedicated Ubuntu Server with no cloud dependencies. Replaces the previous AWS-hosted version (Lambda + DynamoDB + Cognito) with a single Node.js process backed by SQLite, with local AI vision via Ollama.

## Stack

- **Runtime:** Node.js 20 + Express 4
- **Database:** SQLite (better-sqlite3)
- **Auth:** bcrypt + server-side sessions + HttpOnly cookies + TOTP MFA
- **Vision:** Ollama running `qwen2.5vl:7b` (local), with optional Anthropic Sonnet fallback
- **Reverse proxy:** nginx
- **Process manager:** pm2

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
