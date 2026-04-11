'use strict';
const helmet = require('helmet');
const config = require('../config');

const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  // The ported UI uses inline onclick= attributes on every button. Helmet's
  // default blocks those via script-src-attr 'none'. 'unsafe-inline' on the
  // attribute channel is the least-bad option until we refactor to
  // addEventListener everywhere — it still blocks injected <script> tags.
  scriptSrcAttr: ["'unsafe-inline'"],
  // Google Fonts stylesheet is loaded from fonts.googleapis.com
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  // Google Fonts .woff2 files come from fonts.gstatic.com
  fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
  imgSrc: ["'self'", 'data:', 'blob:', 'https://api.qrserver.com'],
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
