'use strict';
const crypto = require('crypto');
const db = require('../db/connection');
const config = require('../config');
const userService = require('./userService');

const insertStmt = db.prepare(`
  INSERT INTO sessions (id, user_id, ip_address, user_agent, expires_at)
  VALUES (?, ?, ?, ?, ?)
`);
const lookupStmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
const touchStmt = db.prepare(`
  UPDATE sessions SET last_seen = datetime('now'), expires_at = ?
  WHERE id = ?
`);
const deleteStmt = db.prepare('DELETE FROM sessions WHERE id = ?');
const deleteByUserStmt = db.prepare('DELETE FROM sessions WHERE user_id = ?');
const purgeStmt = db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')");

function newId() {
  return crypto.randomBytes(32).toString('hex');
}

function idleExpiry() {
  return new Date(Date.now() + config.session.idleMinutes * 60_000).toISOString();
}

function create(userId, req) {
  const id = newId();
  const ip = req.ip;
  const ua = (req.get('user-agent') || '').slice(0, 500);
  insertStmt.run(id, userId, ip, ua, idleExpiry());
  return id;
}

function lookup(sid, req) {
  const session = lookupStmt.get(sid);
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    deleteStmt.run(sid);
    return null;
  }
  // Absolute session timeout — even with constant activity, kill the session
  // after `absoluteHours` from creation. Stops a stolen cookie from being
  // useful indefinitely.
  if (session.created_at) {
    const createdMs = new Date(session.created_at + 'Z').getTime();
    const ageMs = Date.now() - createdMs;
    if (ageMs > config.session.absoluteHours * 3600_000) {
      deleteStmt.run(sid);
      return null;
    }
  }
  // Bind to IP/UA — if either changed dramatically, kill the session.
  // (UA can drift slightly across browser updates so we only compare IP strictly.)
  if (session.ip_address && session.ip_address !== req.ip) {
    deleteStmt.run(sid);
    return null;
  }
  // Sliding idle expiry
  touchStmt.run(idleExpiry(), sid);
  const user = userService.getById(session.user_id);
  if (!user) {
    deleteStmt.run(sid);
    return null;
  }
  return { session, user };
}

function destroy(sid) {
  deleteStmt.run(sid);
}

function destroyAllForUser(userId) {
  deleteByUserStmt.run(userId);
}

function purgeExpired() {
  purgeStmt.run();
}

// Periodic cleanup
setInterval(purgeExpired, 5 * 60 * 1000).unref();

module.exports = { create, lookup, destroy, destroyAllForUser, purgeExpired };
