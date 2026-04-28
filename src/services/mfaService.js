'use strict';
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

function generateSecret(username) {
  return speakeasy.generateSecret({
    name: `CISTracker (${username})`,
    length: 20,
  });
}

async function makeQrDataUri(otpauthUrl) {
  return QRCode.toDataURL(otpauthUrl);
}

function verifyToken(secret, token) {
  if (!secret || !token) return false;
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: String(token).trim(),
    window: 1,
  });
}

module.exports = { generateSecret, makeQrDataUri, verifyToken };
