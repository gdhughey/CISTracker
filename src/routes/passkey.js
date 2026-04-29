'use strict';
const express = require('express');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const config = require('../config');
const passkeyService = require('../services/passkeyService');
const userService = require('../services/userService');
const sessionService = require('../services/sessionService');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── Relying Party config (derived from APP_URL) ────────────────────────────
//   rpID    = the hostname only (no protocol, no port)
//   origin  = full origin including protocol (and port for dev)
// In production these are e.g. "cistracker.net" + "https://cistracker.net".
// In dev they're "localhost" + "http://localhost:3000".
function getRpConfig() {
  const url = new URL(config.appUrl);
  return {
    rpName: 'CISTracker',
    rpID: url.hostname,
    expectedOrigin: url.origin,
  };
}

// ── Challenge cookies ───────────────────────────────────────────────────────
// WebAuthn flows need a server-generated challenge that's sent to the client
// then echoed back. We store it in a short-lived httpOnly cookie. Two cookies
// because registration (auth required) and login (no auth) can run in parallel
// in different tabs without clobbering each other.
const REGISTER_COOKIE = 'cistracker_pk_reg_chal';
const LOGIN_COOKIE = 'cistracker_pk_login_chal';
const CHALLENGE_TTL_MS = 5 * 60_000;

function setChallenge(res, name, value, secure) {
  res.cookie(name, value, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: CHALLENGE_TTL_MS,
    path: '/',
  });
}

// ──────────────────────────────────────────────────────────────────────────
// REGISTRATION (user must be logged in to add a passkey to their account)
// ──────────────────────────────────────────────────────────────────────────

// POST /api/passkey/register-options
//   Returns the WebAuthn options blob for navigator.credentials.create()
router.post('/register-options', requireAuth, async (req, res, next) => {
  try {
    const { rpName, rpID } = getRpConfig();
    const existing = passkeyService.listForUser(req.user.id);

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      // userID must be Uint8Array in @simplewebauthn v9+
      userID: new TextEncoder().encode(String(req.user.id)),
      userName: req.user.username,
      userDisplayName: req.user.username,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      // Tell the client which credentials are already registered so the
      // platform doesn't offer to overwrite an existing passkey.
      excludeCredentials: existing.map(p => ({
        id: p.credential_id,
        transports: safeJsonArray(p.transports),
      })),
    });

    setChallenge(res, REGISTER_COOKIE, options.challenge, req.secure);
    res.json(options);
  } catch (err) { next(err); }
});

// POST /api/passkey/register-verify
//   Verifies the attestation, stores the public key on success
router.post('/register-verify', requireAuth, async (req, res, next) => {
  try {
    const { rpID, expectedOrigin } = getRpConfig();
    const expectedChallenge = req.cookies[REGISTER_COOKIE];
    if (!expectedChallenge) {
      return res.status(400).json({ error: 'No registration in progress' });
    }
    const { response, deviceName } = req.body || {};
    if (!response) return res.status(400).json({ error: 'Missing response' });

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Verification failed' });
    }

    const { credential, credentialBackedUp } = verification.registrationInfo;
    // @simplewebauthn v11: credential = { id, publicKey (Uint8Array), counter, transports? }

    // Reject if this credential is already registered (rare, but possible if a
    // user tries to register the same authenticator twice across accounts)
    if (passkeyService.findByCredentialId(credential.id)) {
      return res.status(409).json({ error: 'This passkey is already registered' });
    }

    const stored = passkeyService.create({
      userId: req.user.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports || [],
      deviceName: (deviceName && String(deviceName).trim()) || guessDeviceName(req),
      backedUp: !!credentialBackedUp,
    });

    res.clearCookie(REGISTER_COOKIE, { path: '/' });
    req.audit('passkey_register', String(stored.id), { device: stored.device_name });
    res.json({ ok: true, passkey: publicPasskey(stored) });
  } catch (err) { next(err); }
});

// ──────────────────────────────────────────────────────────────────────────
// AUTHENTICATION (sign in via passkey — no session yet)
// ──────────────────────────────────────────────────────────────────────────

// POST /api/passkey/login-options
//   Returns options for navigator.credentials.get(). With discoverable
//   credentials we don't need to know the user up front — the OS picker
//   shows whichever CISTracker passkeys exist on the device.
router.post('/login-options', async (req, res, next) => {
  try {
    const { rpID } = getRpConfig();
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
      // Empty allowCredentials = "any passkey for this site" (discoverable flow)
    });
    setChallenge(res, LOGIN_COOKIE, options.challenge, req.secure);
    res.json(options);
  } catch (err) { next(err); }
});

// POST /api/passkey/login-verify
//   Verifies the assertion, looks up the user, creates a session.
router.post('/login-verify', async (req, res, next) => {
  try {
    const { rpID, expectedOrigin } = getRpConfig();
    const expectedChallenge = req.cookies[LOGIN_COOKIE];
    if (!expectedChallenge) {
      return res.status(400).json({ error: 'No login in progress' });
    }
    const response = req.body?.response;
    if (!response || !response.id) return res.status(400).json({ error: 'Missing response' });

    const stored = passkeyService.findByCredentialId(response.id);
    if (!stored) {
      req.audit('passkey_login_failed', null, { reason: 'unknown_credential' });
      return res.status(401).json({ error: 'Passkey not recognized' });
    }
    const user = userService.getById(stored.user_id);
    if (!user) return res.status(401).json({ error: 'User no longer exists' });

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin,
      expectedRPID: rpID,
      // v11 shape:
      credential: {
        id: stored.credential_id,
        publicKey: Buffer.from(stored.public_key, 'base64url'),
        counter: stored.counter,
      },
      requireUserVerification: false,
    });

    if (!verification.verified) {
      req.audit('passkey_login_failed', user.username, { reason: 'bad_signature' });
      return res.status(401).json({ error: 'Verification failed' });
    }

    // Bump the signature counter (clone-detection)
    passkeyService.updateCounter(stored.id, verification.authenticationInfo.newCounter);

    res.clearCookie(LOGIN_COOKIE, { path: '/' });
    const sid = sessionService.create(user.id, req);
    res.cookie(config.session.cookieName, sid, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure,
      path: '/',
      maxAge: config.session.idleMinutes * 60_000,
    });
    req.user = user;
    req.audit('passkey_login_success', user.username, { passkeyId: stored.id });
    res.json({
      user: userService.pickPublic(user),
      mustChangePw: !!user.must_change_pw,
    });
  } catch (err) { next(err); }
});

// ──────────────────────────────────────────────────────────────────────────
// MANAGEMENT (logged-in user manages their own passkeys)
// ──────────────────────────────────────────────────────────────────────────

router.get('/', requireAuth, (req, res) => {
  res.json({ passkeys: passkeyService.listForUser(req.user.id).map(publicPasskey) });
});

router.put('/:id(\\d+)', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const pk = passkeyService.getById(id);
  if (!pk || pk.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  const name = String(req.body?.device_name || '').trim();
  if (!name) return res.status(400).json({ error: 'device_name is required' });
  passkeyService.rename(id, req.user.id, name);
  req.audit('passkey_rename', String(id), { name });
  res.json({ ok: true });
});

router.delete('/:id(\\d+)', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const pk = passkeyService.getById(id);
  if (!pk || pk.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  passkeyService.remove(id, req.user.id);
  req.audit('passkey_remove', String(id), { device: pk.device_name });
  res.json({ ok: true });
});

// ── Helpers ────────────────────────────────────────────────────────────────

function safeJsonArray(s) {
  try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

function publicPasskey(p) {
  return {
    id: p.id,
    device_name: p.device_name,
    transports: safeJsonArray(p.transports),
    backed_up: !!p.backed_up,
    created_at: p.created_at,
    last_used_at: p.last_used_at,
  };
}

// Best-effort device label from User-Agent. The user can rename later.
function guessDeviceName(req) {
  const ua = (req.get('user-agent') || '').toLowerCase();
  if (/iphone/.test(ua))                  return 'iPhone';
  if (/ipad/.test(ua))                    return 'iPad';
  if (/macintosh|mac os x/.test(ua))      return 'Mac';
  if (/android/.test(ua))                 return 'Android device';
  if (/windows/.test(ua))                 return 'Windows PC';
  if (/cros|chrome os/.test(ua))          return 'ChromeOS device';
  if (/linux/.test(ua))                   return 'Linux';
  return 'Unnamed device';
}

module.exports = router;
