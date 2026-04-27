'use strict';
require('dotenv').config();

function bool(v, def = false) {
  if (v === undefined) return def;
  return String(v).toLowerCase() === 'true';
}
function int(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}
function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 3000),
  trustProxy: bool(process.env.TRUST_PROXY, true),
  // Are we actually behind TLS? Controls HSTS + upgradeInsecureRequests.
  // Must stay false until nginx has a real cert — otherwise every
  // subresource (CSS/JS/images) gets force-upgraded to https and fails.
  tlsEnabled: bool(process.env.TLS_ENABLED, false),

  session: {
    secret: required('SESSION_SECRET'),
    idleMinutes: int(process.env.SESSION_IDLE_MINUTES, 15),
    absoluteHours: int(process.env.SESSION_ABSOLUTE_HOURS, 8),
    cookieName: 'cyberlab_sid',
  },

  db: {
    path: process.env.DB_PATH || './data/cyberlab.db',
  },

  uploads: {
    dir: process.env.UPLOAD_DIR || './uploads',
    maxBytes: int(process.env.UPLOAD_MAX_MB, 10) * 1024 * 1024,
  },

  registration: {
    allowed: bool(process.env.ALLOW_REGISTRATION, false),
  },

  auth: {
    maxFailedLogins: int(process.env.MAX_FAILED_LOGINS, 5),
    lockoutMinutes: int(process.env.LOCKOUT_MINUTES, 15),
    passwordMinLength: int(process.env.PASSWORD_MIN_LENGTH, 10),
    bcryptCost: int(process.env.BCRYPT_COST, 12),
  },

  vision: {
    // 100% local. Ollama only, no cloud fallback — CyberLab classrooms
    // may not have outbound internet.
    ollamaEnabled: bool(process.env.OLLAMA_ENABLED, true),
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'qwen2.5vl:7b',
    ollamaTimeoutMs: int(process.env.OLLAMA_TIMEOUT_MS, 180000),
  },

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'cyberlab@example.com',
  },

  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    noReplyFrom: process.env.RESEND_NOREPLY_FROM || 'CISTracker <noreply@cistracker.net>',
    supportFrom: process.env.RESEND_SUPPORT_FROM || 'CISTracker Support <support@cistracker.net>',
    supportForwardTo: process.env.RESEND_SUPPORT_FORWARD || 'gdhughey0726@gmail.com',
  },

  reminders: {
    reminderDays: int(process.env.REMINDER_DAYS, 3),
    alertDays: int(process.env.ALERT_DAYS, 5),
    cron: process.env.REMINDER_CRON || '0 9 * * *',
  },

  appUrl: process.env.APP_URL || 'http://localhost:3000',

  seed: {
    username: process.env.SEED_ADMIN_USERNAME || 'admin',
    email: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
    password: process.env.SEED_ADMIN_PASSWORD || 'ChangeMe!2026',
  },
};

module.exports = config;
