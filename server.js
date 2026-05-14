'use strict';
const path = require('path');
const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const config = require('./src/config');

// Run migrations before requiring any service/middleware that prepares SQL statements.
const { runMigrations } = require('./src/db/migrate');
runMigrations();

const helmetMw = require('./src/middleware/helmet');
const { apiLimiter } = require('./src/middleware/rateLimit');
const { issueToken, verifyToken } = require('./src/middleware/csrf');
const { loadSession } = require('./src/middleware/auth');
const { audit } = require('./src/middleware/audit');
const { notFound, errorHandler } = require('./src/middleware/error');

const authRoutes = require('./src/routes/auth');
const equipmentRoutes = require('./src/routes/equipment');
const adminRoutes = require('./src/routes/admin');
const queueRoutes = require('./src/routes/queue');
const ticketRoutes = require('./src/routes/tickets');
const passkeyRoutes = require('./src/routes/passkey');
const serviceTicketRoutes  = require('./src/routes/serviceTickets');
const inventoryAuditRoutes = require('./src/routes/inventoryAudit');

require('./src/services/reminderService');

const app = express();

if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(compression());
app.use(helmetMw);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false, limit: '5mb' }));
app.use(cookieParser());
app.use(loadSession);
app.use(audit);
app.use(issueToken);

// Temporary request logger — remove after debugging
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    const user = req.user ? `${req.user.username}(${req.user.role})` : 'anon';
    const orig = res.json.bind(res);
    res.json = (body) => {
      const ok = res.statusCode < 400;
      if (!ok || req.path.startsWith('/api/equipment') || req.path.startsWith('/api/admin')) {
        console.log(`[REQ] ${req.method} ${req.path} user=${user} → ${res.statusCode}${ok ? '' : ' ' + JSON.stringify(body)}`);
      }
      return orig(body);
    };
  }
  next();
});

// Static frontend.
// No-store on HTML/JS so users never run stale code after a deploy.
// Other static assets (css, fonts, images) fall through to defaults.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/.test(filePath)) {
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
app.use('/api/queue', queueRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/passkey', passkeyRoutes);
app.use('/api/service-tickets', serviceTicketRoutes);
app.use('/api/inventory-audit', inventoryAuditRoutes);

app.use(notFound);
app.use(errorHandler);

const server = app.listen(config.port, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`CIS Tracker listening on http://127.0.0.1:${config.port} (env=${config.env})`);
  if (config.appUrl && config.appUrl !== 'http://localhost:3000') {
    console.log(`  → ${config.appUrl}`);
  }

});

function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`\n${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
