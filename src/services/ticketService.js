'use strict';
const db = require('../db/connection');

function listAll({ status, userId, assignedTo, limit = 100 } = {}) {
  const conds = [];
  const params = [];
  if (status) { conds.push('t.status = ?'); params.push(status); }
  if (userId) { conds.push('t.user_id = ?'); params.push(userId); }
  if (assignedTo) { conds.push('t.assigned_to = ?'); params.push(assignedTo); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  params.push(limit);
  return db.prepare(`
    SELECT t.*,
           u.username AS reporter_username,
           a.username AS assigned_username,
           (SELECT COUNT(*) FROM ticket_comments tc WHERE tc.ticket_id = t.id) AS comment_count
    FROM tickets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN users a ON a.id = t.assigned_to
    ${where}
    ORDER BY
      CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      t.created_at DESC
    LIMIT ?
  `).all(...params);
}

function getById(id) {
  return db.prepare(`
    SELECT t.*,
           u.username AS reporter_username, u.email AS reporter_email,
           a.username AS assigned_username
    FROM tickets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN users a ON a.id = t.assigned_to
    WHERE t.id = ?
  `).get(id);
}

function create({ userId, subject, description, priority, equipmentId }) {
  const info = db.prepare(`
    INSERT INTO tickets (user_id, subject, description, priority, equipment_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, subject, description || '', priority || 'normal', equipmentId || null);
  return getById(info.lastInsertRowid);
}

function update(id, fields) {
  const allowed = ['status', 'priority', 'assigned_to', 'subject', 'description'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(fields[key]);
    }
  }
  if (!sets.length) return getById(id);
  sets.push("updated_at = datetime('now')");
  params.push(id);
  db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getById(id);
}

function addComment(ticketId, userId, body) {
  const info = db.prepare(`
    INSERT INTO ticket_comments (ticket_id, user_id, body)
    VALUES (?, ?, ?)
  `).run(ticketId, userId, body);
  // Touch the ticket's updated_at
  db.prepare("UPDATE tickets SET updated_at = datetime('now') WHERE id = ?").run(ticketId);
  return {
    id: info.lastInsertRowid,
    ticket_id: ticketId,
    user_id: userId,
    body,
  };
}

function getComments(ticketId) {
  return db.prepare(`
    SELECT tc.*, u.username, u.role
    FROM ticket_comments tc
    JOIN users u ON u.id = tc.user_id
    WHERE tc.ticket_id = ?
    ORDER BY tc.created_at ASC
  `).all(ticketId);
}

function remove(id) {
  db.prepare('DELETE FROM tickets WHERE id = ?').run(id);
}

function counts() {
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS cnt FROM tickets GROUP BY status
  `).all();
  const result = { open: 0, in_progress: 0, resolved: 0, closed: 0, total: 0 };
  for (const r of rows) {
    result[r.status] = r.cnt;
    result.total += r.cnt;
  }
  return result;
}

module.exports = { listAll, getById, create, update, addComment, getComments, remove, counts };
