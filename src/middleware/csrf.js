'use strict';
const crypto = require('crypto');

// Double-submit cookie CSRF protection.
// On every authenticated GET we set/refresh a non-HttpOnly `csrf_token` cookie.
// State-changing requests must echo the value back via the X-CSRF-Token header.
// An attacker on a different origin cannot read the cookie (SameSite=Strict
// session cookie blocks the request anyway, but this is defense in depth).

const COOKIE_NAME = 'csrf_token';

function issueToken(req, res, next) {
  if (!req.cookies[COOKIE_NAME]) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie(COOKIE_NAME, token, {
      httpOnly: false,
      sameSite: 'strict',
      secure: req.secure,
      path: '/',
    });
    req.csrfToken = token;
  } else {
    req.csrfToken = req.cookies[COOKIE_NAME];
  }
  next();
}

function verifyToken(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const cookieToken = req.cookies[COOKIE_NAME];
  const headerToken = req.get('X-CSRF-Token');
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  next();
}

module.exports = { issueToken, verifyToken, COOKIE_NAME };
