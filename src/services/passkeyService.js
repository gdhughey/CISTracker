'use strict';
const db = require('../db/connection');

// ── DB layer ───────────────────────────────────────────────────────────────

function listForUser(userId) {
  return db.prepare(`
    SELECT id, credential_id, device_name, transports, backed_up,
           created_at, last_used_at
    FROM passkeys WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId);
}

function findByCredentialId(credentialId) {
  return db.prepare('SELECT * FROM passkeys WHERE credential_id = ?').get(credentialId);
}

function getById(id) {
  return db.prepare('SELECT * FROM passkeys WHERE id = ?').get(id);
}

function create({ userId, credentialId, publicKey, counter, transports, deviceName, backedUp }) {
  const info = db.prepare(`
    INSERT INTO passkeys
      (user_id, credential_id, public_key, counter, transports, device_name, backed_up)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    credentialId,
    publicKey,
    counter || 0,
    JSON.stringify(transports || []),
    deviceName || 'Unnamed device',
    backedUp ? 1 : 0,
  );
  return getById(info.lastInsertRowid);
}

function updateCounter(id, counter) {
  db.prepare(`
    UPDATE passkeys
    SET counter = ?, last_used_at = datetime('now')
    WHERE id = ?
  `).run(counter, id);
}

function rename(id, userId, newName) {
  // Scope to user_id so a user can only rename their own passkeys
  db.prepare(`
    UPDATE passkeys SET device_name = ? WHERE id = ? AND user_id = ?
  `).run(String(newName).slice(0, 60) || 'Unnamed device', id, userId);
}

function remove(id, userId) {
  db.prepare(`DELETE FROM passkeys WHERE id = ? AND user_id = ?`).run(id, userId);
}

function countForUser(userId) {
  const r = db.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').get(userId);
  return r ? r.n : 0;
}

module.exports = {
  listForUser, findByCredentialId, getById, create, updateCounter, rename, remove, countForUser,
};
