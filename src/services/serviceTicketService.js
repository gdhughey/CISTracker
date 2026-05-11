'use strict';
const db = require('../db/connection');

function listAll({ status } = {}) {
  const where = status ? "WHERE st.status = ?" : '';
  const params = status ? [status] : [];
  return db.prepare(`
    SELECT st.*, u.username AS requester_username, r.username AS resolver_username
    FROM service_tickets st
    JOIN users u ON u.id = st.requested_by
    LEFT JOIN users r ON r.id = st.resolved_by
    ${where}
    ORDER BY st.created_at DESC
  `).all(...params);
}

function getById(id) {
  return db.prepare(`
    SELECT st.*, u.username AS requester_username, r.username AS resolver_username
    FROM service_tickets st
    JOIN users u ON u.id = st.requested_by
    LEFT JOIN users r ON r.id = st.resolved_by
    WHERE st.id = ?
  `).get(id);
}

function create({ type, requestedBy, payload }) {
  const info = db.prepare(`
    INSERT INTO service_tickets (type, requested_by, payload)
    VALUES (?, ?, ?)
  `).run(type, requestedBy, JSON.stringify(payload));
  return getById(info.lastInsertRowid);
}

function pendingCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM service_tickets WHERE status = 'pending'").get().n;
}

function approve(id, adminId, adminNotes, executeCallback) {
  const ticket = getById(id);
  if (!ticket) throw Object.assign(new Error('Not found'), { status: 404 });
  if (ticket.status !== 'pending') throw Object.assign(new Error('Already resolved'), { status: 409 });
  if (executeCallback) executeCallback(JSON.parse(ticket.payload));
  db.prepare(`
    UPDATE service_tickets
    SET status = 'approved', resolved_by = ?, admin_notes = ?, resolved_at = datetime('now')
    WHERE id = ?
  `).run(adminId, adminNotes || '', id);
  return getById(id);
}

function reject(id, adminId, adminNotes) {
  const ticket = getById(id);
  if (!ticket) throw Object.assign(new Error('Not found'), { status: 404 });
  if (ticket.status !== 'pending') throw Object.assign(new Error('Already resolved'), { status: 409 });
  db.prepare(`
    UPDATE service_tickets
    SET status = 'rejected', resolved_by = ?, admin_notes = ?, resolved_at = datetime('now')
    WHERE id = ?
  `).run(adminId, adminNotes || '', id);
  return getById(id);
}

module.exports = { listAll, getById, create, pendingCount, approve, reject };
