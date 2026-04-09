'use strict';
const db = require('../db/connection');

const insertStmt = db.prepare(`
  INSERT INTO audit_log (user_id, action, target, ip_address, user_agent, details)
  VALUES (?, ?, ?, ?, ?, ?)
`);

function write({ userId, action, target, ipAddress, userAgent, details }) {
  try {
    insertStmt.run(userId, action, target, ipAddress, userAgent, details);
  } catch (err) {
    // Audit failure must never break the request, but log it.
    // eslint-disable-next-line no-console
    console.error('[audit] write failed:', err.message);
  }
}

function recent(limit = 100) {
  return db.prepare(`
    SELECT a.*, u.username
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.created_at DESC
    LIMIT ?
  `).all(limit);
}

module.exports = { write, recent };
