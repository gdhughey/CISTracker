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

  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    noReplyFrom: process.env.RESEND_NOREPLY_FROM || 'CISTracker <noreply@cistracker.net>',
    supportFrom: process.env.RESEND_SUPPORT_FROM || 'CISTracker Support <support@cistracker.net>',
    // Tickets get forwarded here. MUST be set in .env — no personal email
    // hardcoded as a fallback.
    supportForwardTo: process.env.RESEND_SUPPORT_FORWARD || '',
    // When an admin drops a ticket assignment without resolving the ticket,
    // the ticket gets forwarded here so a fallback owner is alerted.
    // MUST be set in .env if you want this notification (e.g. a personal
    // address that gets read even when nobody else is monitoring tickets).
    droppedForwardTo: process.env.RESEND_DROPPED_FORWARD || '',
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
    // No fixed default — if SEED_ADMIN_PASSWORD is not set, scripts/seed.js
    // generates a random one and prints it to stdout (it's seen exactly once
    // by the operator running the install, then the admin must change it on
    // first login because must_change_pw=1).
    password: process.env.SEED_ADMIN_PASSWORD || '',
  },
};

module.exports = config;
