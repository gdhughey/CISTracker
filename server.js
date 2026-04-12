'use strict';
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('./src/config');
const helmetMw = require('./src/middleware/helmet');
const { apiLimiter } = require('./src/middleware/rateLimit');
const { issueToken, verifyToken } = require('./src/middleware/csrf');
const { loadSession } = require('./src/middleware/auth');
const { audit } = require('./src/middleware/audit');
const { notFound, errorHandler } = require('./src/middleware/error');

const authRoutes = require('./src/routes/auth');
const equipmentRoutes = require('./src/routes/equipment');
const adminRoutes = require('./src/routes/admin');
const scanRoutes = require('./src/routes/scan');

const { runMigrations } = require('./src/db/migrate');
runMigrations();

const app = express();

if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmetMw);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false, limit: '5mb' }));
app.use(cookieParser());
app.use(loadSession);
app.use(audit);
app.use(issueToken);

// Static frontend.
// No-store on HTML/JS so users never run stale code after a deploy.
// Other static assets (css, fonts, images) fall through to defaults.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (/\.(html|js)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));

// Healthcheck (no auth, no rate limit)
app.get('/healthz', (_req, res) => res.json({ ok: true, version: '0.1.0' }));

// API
app.use('/api', apiLimiter, verifyToken);
app.use('/api/auth', authRoutes);
app.use('/api/equipment', equipmentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/scan', scanRoutes);

app.use(notFound);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`CIS Equipment Tracker listening on http://0.0.0.0:${config.port} (env=${config.env})`);
  // Start overdue-reminder cron job
  require('./src/services/reminderService').start();
});

function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`\n${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
