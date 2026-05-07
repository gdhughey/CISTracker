'use strict';
const db = require('../db/connection');

/** Get the queue for an equipment item, ordered by position. */
function getQueue(equipmentId) {
  return db.prepare(`
    SELECT q.*, u.username, u.email
    FROM equipment_queue q
    JOIN users u ON u.id = q.user_id
    WHERE q.equipment_id = ?
    ORDER BY q.position ASC
  `).all(equipmentId);
}

/** How many people are waiting for this item? */
function queueLength(equipmentId) {
  const row = db.prepare(
    'SELECT COUNT(*) AS cnt FROM equipment_queue WHERE equipment_id = ?'
  ).get(equipmentId);
  return row ? row.cnt : 0;
}

/** Fetch all queue lengths in one query. Returns a Map of equipment_id → count. */
function allQueueLengths() {
  const rows = db.prepare(
    'SELECT equipment_id, COUNT(*) AS cnt FROM equipment_queue GROUP BY equipment_id'
  ).all();
  const map = new Map();
  for (const r of rows) map.set(r.equipment_id, r.cnt);
  return map;
}

/** Join the queue. Returns the new queue entry. */
function join(equipmentId, userId) {
  // Already in queue?
  const existing = db.prepare(
    'SELECT id FROM equipment_queue WHERE equipment_id = ? AND user_id = ?'
  ).get(equipmentId, userId);
  if (existing) {
    throw Object.assign(new Error('You are already in the queue for this item'), { status: 409 });
  }
  // Next position
  const maxPos = db.prepare(
    'SELECT COALESCE(MAX(position), 0) AS mp FROM equipment_queue WHERE equipment_id = ?'
  ).get(equipmentId);
  const position = (maxPos?.mp || 0) + 1;
  const info = db.prepare(`
    INSERT INTO equipment_queue (equipment_id, user_id, position)
    VALUES (?, ?, ?)
  `).run(equipmentId, userId, position);
  return { id: info.lastInsertRowid, equipmentId, userId, position };
}

/** Leave the queue. */
function leave(equipmentId, userId) {
  const row = db.prepare(
    'SELECT id, position FROM equipment_queue WHERE equipment_id = ? AND user_id = ?'
  ).get(equipmentId, userId);
  if (!row) return;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM equipment_queue WHERE id = ?').run(row.id);
    // Shift everyone after this position down
    db.prepare(`
      UPDATE equipment_queue SET position = position - 1
      WHERE equipment_id = ? AND position > ?
    `).run(equipmentId, row.position);
  });
  tx();
}

/** Admin: remove a specific user from the queue. */
function removeUser(equipmentId, targetUserId) {
  leave(equipmentId, targetUserId);
}

/**
 * On checkin: pop the first person off the queue and return their info
 * so we can notify them. Returns null if queue is empty.
 */
function popNext(equipmentId) {
  const next = db.prepare(`
    SELECT q.*, u.username, u.email
    FROM equipment_queue q
    JOIN users u ON u.id = q.user_id
    WHERE q.equipment_id = ?
    ORDER BY q.position ASC
    LIMIT 1
  `).get(equipmentId);
  if (!next) return null;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM equipment_queue WHERE id = ?').run(next.id);
    db.prepare(`
      UPDATE equipment_queue SET position = position - 1
      WHERE equipment_id = ? AND position > ?
    `).run(equipmentId, next.position);
  });
  tx();
  return next;
}

/**
 * Get all queue entries for a user (across all equipment).
 */
function getUserQueues(userId) {
  return db.prepare(`
    SELECT q.*, e.name AS equipment_name, e.barcode
    FROM equipment_queue q
    JOIN equipment e ON e.id = q.equipment_id
    WHERE q.user_id = ?
    ORDER BY q.created_at DESC
  `).all(userId);
}

module.exports = { getQueue, queueLength, allQueueLengths, join, leave, removeUser, popNext, getUserQueues };
