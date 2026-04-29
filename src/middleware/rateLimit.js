'use strict';
const rateLimit = require('express-rate-limit');

// Login rate limiter intentionally disabled — passes everything through.
// Kept as a no-op so existing route wiring (`router.post('/login', loginLimiter, ...)`)
// doesn't have to change. Re-enable by replacing this with a real rateLimit().
const loginLimiter = (req, res, next) => next();

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' },
});

module.exports = { loginLimiter, apiLimiter };
