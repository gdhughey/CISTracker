'use strict';
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const config = require('../config');
const userService = require('../services/userService');
const sessionService = require('../services/sessionService');
const mfaService = require('../services/mfaService');
const emailService = require('../services/emailService');
const { validate } = require('../middleware/validate');
const { loginLimiter } = require('../middleware/rateLimit');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// --- schemas ---

const passwordSchema = z.string()
  .min(config.auth.passwordMinLength, `Password must be at least ${config.auth.passwordMinLength} characters`)
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[0-9]/, 'Password must contain a digit')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a special character');

const usernameSchema = z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, 'Username must be alphanumeric/underscore');

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const registerSchema = z.object({
  username: usernameSchema,
  email: z.string().email(),
  password: passwordSchema,
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

const mfaVerifySchema = z.object({
  token: z.string().length(6).regex(/^\d{6}$/),
});

// --- helpers ---

function setSessionCookie(res, sid, secure) {
  res.cookie(config.session.cookieName, sid, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: config.session.idleMinutes * 60_000,
  });
}


// --- routes ---

router.get('/me', (req, res) => {
  res.json({
    user: req.user ? userService.pickPublic(req.user) : null,
    mustChangePw: req.user ? !!req.user.must_change_pw : false,
  });
});

router.post('/login', loginLimiter, validate(loginSchema), async (req, res) => {
  const { username, password } = req.body;
  const user = userService.getByUsername(username);
  if (!user) {
    req.audit('login_failed', username, { reason: 'no_such_user' });
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const ok = await userService.verifyPassword(user, password);
  if (!ok) {
    req.audit('login_failed', username);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (user.mfa_enabled) {
    // Issue a short-lived MFA challenge cookie. The value is HMAC-signed with
    // SESSION_SECRET so it cannot be forged by crafting a userId:anything value.
    const hmac = crypto.createHmac('sha256', config.session.secret)
      .update(String(user.id))
      .digest('hex');
    res.cookie('cyberlab_mfa_challenge', `${user.id}:${hmac}`, {
      httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: 5 * 60_000, path: '/',
    });
    req.audit('login_mfa_required', username);
    return res.json({ challenge: 'MFA_REQUIRED' });
  }

  const sid = sessionService.create(user.id, req);
  setSessionCookie(res, sid, req.secure);
  req.user = user;
  req.audit('login_success', username);
  res.json({ user: userService.pickPublic(user), mustChangePw: !!user.must_change_pw });
});

router.post('/mfa-verify', loginLimiter, validate(mfaVerifySchema), async (req, res) => {
  const challengeCookie = req.cookies.cyberlab_mfa_challenge;
  if (!challengeCookie) return res.status(400).json({ error: 'No MFA challenge in progress' });
  const [userIdStr, cookieHmac] = challengeCookie.split(':');
  if (!userIdStr || !cookieHmac) return res.status(400).json({ error: 'Invalid challenge' });
  // Verify the HMAC so the cookie cannot be forged with an arbitrary user ID
  const expectedHmac = crypto.createHmac('sha256', config.session.secret)
    .update(userIdStr)
    .digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(cookieHmac, 'hex'), Buffer.from(expectedHmac, 'hex'))) {
    return res.status(400).json({ error: 'Invalid challenge' });
  }
  const user = userService.getById(parseInt(userIdStr, 10));
  if (!user || !user.mfa_enabled) return res.status(400).json({ error: 'Invalid challenge' });
  const ok = mfaService.verifyToken(user.mfa_secret, req.body.token);
  if (!ok) {
    req.audit('mfa_failed', user.username);
    return res.status(401).json({ error: 'Invalid MFA code' });
  }
  res.clearCookie('cyberlab_mfa_challenge');
  const sid = sessionService.create(user.id, req);
  setSessionCookie(res, sid, req.secure);
  req.user = user;
  req.audit('login_success_mfa', user.username);
  res.json({ user: userService.pickPublic(user), mustChangePw: !!user.must_change_pw });
});

router.post('/logout', (req, res) => {
  const sid = req.cookies[config.session.cookieName];
  if (sid) sessionService.destroy(sid);
  res.clearCookie(config.session.cookieName);
  if (req.user) req.audit('logout', req.user.username);
  res.json({ ok: true });
});

router.post('/register', validate(registerSchema), async (req, res) => {
  if (!config.registration.allowed) {
    return res.status(403).json({ error: 'Self-registration is disabled' });
  }
  const { username, email, password } = req.body;
  if (userService.getByUsername(username)) return res.status(409).json({ error: 'Username taken' });
  if (userService.getByEmail(email)) return res.status(409).json({ error: 'Email already registered' });
  const user = await userService.createUser({ username, email, password, role: 'user', mustChangePw: 0 });
  req.audit('register', username);
  res.status(201).json({ user: userService.pickPublic(user) });
});

router.post('/change-password', requireAuth, validate(changePasswordSchema), async (req, res) => {
  const ok = await userService.verifyPassword(req.user, req.body.currentPassword);
  if (!ok) return res.status(401).json({ error: 'Current password incorrect' });
  await userService.setPassword(req.user.id, req.body.newPassword);
  sessionService.destroyAllForUser(req.user.id);
  res.clearCookie(config.session.cookieName);
  req.audit('password_changed', req.user.username);
  res.json({ ok: true, message: 'Password changed. Please log in again.' });
});

// MFA enroll: returns secret + QR data URI. User must verify before it's enabled.
router.post('/mfa/setup', requireAuth, async (req, res) => {
  const secret = mfaService.generateSecret(req.user.username);
  // Stage the secret but don't enable yet — store on user row with mfa_enabled=0.
  userService.setMfa(req.user.id, secret.base32, false);
  const qr = await mfaService.makeQrDataUri(secret.otpauth_url);
  req.audit('mfa_setup_started', req.user.username);
  res.json({ secret: secret.base32, qr });
});

router.post('/mfa/enable', requireAuth, validate(mfaVerifySchema), (req, res) => {
  const fresh = userService.getById(req.user.id);
  if (!fresh.mfa_secret) return res.status(400).json({ error: 'MFA setup not started' });
  if (!mfaService.verifyToken(fresh.mfa_secret, req.body.token)) {
    return res.status(401).json({ error: 'Invalid code' });
  }
  userService.setMfa(req.user.id, fresh.mfa_secret, true);
  req.audit('mfa_enabled', req.user.username);
  res.json({ ok: true });
});

router.post('/mfa/disable', requireAuth, validate(mfaVerifySchema), (req, res) => {
  const fresh = userService.getById(req.user.id);
  if (!mfaService.verifyToken(fresh.mfa_secret, req.body.token)) {
    return res.status(401).json({ error: 'Invalid code' });
  }
  userService.setMfa(req.user.id, null, false);
  req.audit('mfa_disabled', req.user.username);
  res.json({ ok: true });
});

// Forgot password — generate a reset token and email a link.
// Always returns 200 so we don't reveal whether the email exists.
router.post('/forgot-password', loginLimiter, validate(z.object({ email: z.string().email() })), async (req, res) => {
  const user = userService.getByEmail(req.body.email);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    userService.setRecoveryToken(user.id, token, expires);
    const resetUrl = `${config.appUrl}/?reset_token=${token}`;
    emailService.sendPasswordReset(user, resetUrl);
  }
  res.json({ ok: true });
});

// Reset password — validate token, set new password, clear token.
router.post('/reset-password', validate(z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
})), async (req, res) => {
  // findByRecoveryToken already checks expiry in SQL; returns null if expired/missing.
  const user = userService.findByRecoveryToken(req.body.token);
  if (!user) return res.status(400).json({ error: 'Invalid or expired reset link' });
  await userService.setPassword(user.id, req.body.newPassword); // also clears recovery_token
  sessionService.destroyAllForUser(user.id);
  res.json({ ok: true });
});

module.exports = router;
