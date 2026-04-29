'use strict';
const helmet = require('helmet');
const config = require('../config');

const cspDirectives = {
  defaultSrc: ["'self'"],
  // All scripts now served from /js/ — no CDN needed
  scriptSrc: ["'self'"],
  // Inline onclick= handlers require this; see CLAUDE.md for context
  scriptSrcAttr: ["'unsafe-inline'"],
  // Fonts: self-hosted + Orbitron from Google Fonts
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
  // blob: for getUserMedia camera stream; data: for generated QR images
  imgSrc: ["'self'", 'data:', 'blob:'],
  mediaSrc: ["'self'", 'blob:'],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
};

// Only force HTTPS upgrade when there's actually TLS in front of us.
// Gating on NODE_ENV=production is wrong: the app can run in "production"
// mode behind plain HTTP nginx (e.g. on a LAN), and upgradeInsecureRequests
// would rewrite every subresource to https:// and break the page.
// NOTE: helmet's useDefaults=true *adds* upgrade-insecure-requests by
// default, so we must explicitly set it to null to remove it from the
// emitted CSP — leaving the key unset is not enough.
if (config.tlsEnabled) {
  cspDirectives.upgradeInsecureRequests = [];
} else {
  cspDirectives.upgradeInsecureRequests = null;
}

module.exports = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: cspDirectives,
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  referrerPolicy: { policy: 'no-referrer' },
  hsts: config.tlsEnabled
    ? { maxAge: 31536000, includeSubDomains: true, preload: false }
    : false,
});
