'use strict';
const sessionService = require('../services/sessionService');
const config = require('../config');

async function loadSession(req, res, next) {
  const sid = req.cookies[config.session.cookieName];
  if (!sid) {
    req.user = null;
    req.session = null;
    return next();
  }
  const result = sessionService.lookup(sid, req);
  if (!result) {
    res.clearCookie(config.session.cookieName);
    req.user = null;
    req.session = null;
    return next();
  }
  req.user = result.user;
  req.session = result.session;
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}

function requireRole(role) {
  const allowed = Array.isArray(role) ? role : [role];
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!allowed.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

module.exports = { loadSession, requireAuth, requireRole };
