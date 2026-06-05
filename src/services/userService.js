'use strict';
const bcrypt = require('bcrypt');
const db = require('../db/connection');
const config = require('../config');

const PUBLIC_FIELDS = ['id', 'username', 'email', 'role', 'mfa_enabled', 'must_change_pw', 'student_group', 'created_at'];

function pickPublic(user) {
  if (!user) return null;
  const out = {};
  for (const k of PUBLIC_FIELDS) out[k] = user[k];
  return out;
}

function getById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(username);
}

function getByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

async function createUser({ username, email, password, role = 'user', mustChangePw = 1 }) {
  const hash = await bcrypt.hash(password, config.auth.bcryptCost);
  const stmt = db.prepare(`
    INSERT INTO users (username, email, password_hash, role, must_change_pw)
    VALUES (?, ?, ?, ?, ?)
  `);
  const info = stmt.run(username, email, hash, role, mustChangePw);
  return getById(info.lastInsertRowid);
}

async function verifyPassword(user, password) {
  if (!user) return false;
  return bcrypt.compare(password, user.password_hash);
}

function clearFailedLogins(userId) {
  db.prepare(`
    UPDATE users SET failed_logins = 0, locked_until = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(userId);
}

async function setPassword(userId, newPassword) {
  const hash = await bcrypt.hash(newPassword, config.auth.bcryptCost);
  db.prepare(`
    UPDATE users
    SET password_hash = ?, must_change_pw = 0, recovery_token = NULL, recovery_expires = NULL,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(hash, userId);
}

function forcePwChange(userId) {
  db.prepare("UPDATE users SET must_change_pw = 1, updated_at = datetime('now') WHERE id = ?").run(userId);
}

function setMfa(userId, secret, enabled) {
  db.prepare(`
    UPDATE users SET mfa_secret = ?, mfa_enabled = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(secret, enabled ? 1 : 0, userId);
}

function listAll() {
  return db.prepare(`
    SELECT id, username, email, role, mfa_enabled, must_change_pw, locked_until,
           failed_logins, student_group, created_at, updated_at
    FROM users
    ORDER BY username
  `).all();
}

function deleteUser(id) {
  const tx = db.transaction(() => {
    // Find an admin to inherit checked-out equipment
    const admin = db.prepare(
      "SELECT id, username FROM users WHERE role = 'admin' AND id != ? ORDER BY id LIMIT 1"
    ).get(id);

    // Transfer any checked-out equipment to the admin rather than just returning it
    if (admin) {
      // Grab the items BEFORE reassigning so we only log the transferred ones
      const items = db.prepare('SELECT id FROM equipment WHERE checked_out_by = ?').all(id);
      db.prepare(`
        UPDATE equipment SET checked_out_by = ?, updated_at = datetime('now')
        WHERE checked_out_by = ?
      `).run(admin.id, id);
      for (const item of items) {
        db.prepare(`INSERT INTO checkout_log (equipment_id, action, performed_by, checkout_user, notes, source)
          VALUES (?, 'checkout', ?, ?, 'Transferred from deleted user', 'Admin')
        `).run(item.id, admin.id, admin.username);
      }
    } else {
      // No other admin — just return the equipment
      db.prepare(`UPDATE equipment SET checked_out_by = NULL, checked_out_at = NULL,
        due_date = NULL, status = 'available' WHERE checked_out_by = ?`).run(id);
    }

    // Clear remaining FK references
    db.prepare('DELETE FROM equipment_queue WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM ticket_comments WHERE user_id = ?').run(id);
    // Only delete tickets this user created. If they were merely assigned to
    // someone else's ticket, unassign rather than delete — the reporter's
    // ticket should survive the deletion of a different user.
    db.prepare('UPDATE tickets SET assigned_to = NULL WHERE assigned_to = ?').run(id);
    db.prepare('DELETE FROM tickets WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM checkout_log WHERE performed_by = ?').run(id);
    // Preserve audit history but remove the FK reference
    db.prepare('UPDATE audit_log SET user_id = NULL WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  });
  tx();
}

function updateRole(id, role) {
  db.prepare(`
    UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?
  `).run(role, id);
}

function updateEmail(id, email) {
  db.prepare(`
    UPDATE users SET email = ?, updated_at = datetime('now') WHERE id = ?
  `).run(email, id);
}

function updateStudentGroup(id, group) {
  db.prepare(`
    UPDATE users SET student_group = ?, updated_at = datetime('now') WHERE id = ?
  `).run(group, id);
}

function setRecoveryToken(userId, token, expires) {
  db.prepare(`
    UPDATE users SET recovery_token = ?, recovery_expires = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(token, expires, userId);
}

function findByRecoveryToken(token) {
  return db.prepare(`
    SELECT * FROM users
    WHERE recovery_token = ?
      AND recovery_expires > datetime('now')
  `).get(token) || null;
}

module.exports = {
  pickPublic,
  getById,
  getByUsername,
  getByEmail,
  createUser,
  verifyPassword,
  clearFailedLogins,
  setPassword,
  forcePwChange,
  setMfa,
  listAll,
  deleteUser,
  updateRole,
  updateEmail,
  updateStudentGroup,
  setRecoveryToken,
  findByRecoveryToken,
};
