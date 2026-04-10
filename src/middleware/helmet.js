'use strict';
const helmet = require('helmet');
const config = require('../config');

const isProd = config.env === 'production';

const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline only for the placeholder UI
  imgSrc: ["'self'", 'data:', 'blob:'],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
};

// Only force HTTPS upgrade in production, where nginx terminates TLS.
// In dev (plain HTTP) this directive breaks every subresource.
if (isProd) {
  cspDirectives.upgradeInsecureRequests = [];
}

module.exports = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: cspDirectives,
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false, // browser warns when origin is untrusted (HTTP)
  referrerPolicy: { policy: 'no-referrer' },
  // HSTS only makes sense over HTTPS. Sending it over HTTP is ignored by
  // spec-compliant browsers anyway, but skipping it avoids confusion.
  hsts: isProd
    ? { maxAge: 31536000, includeSubDomains: true, preload: false }
    : false,
});
