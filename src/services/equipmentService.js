'use strict';
const db = require('../db/connection');

function listAll({ status, checkedOutBy } = {}) {
  const conds = [];
  const params = [];
  if (status) { conds.push('e.status = ?'); params.push(status); }
  if (checkedOutBy !== undefined) {
    conds.push('e.checked_out_by = ?');
    params.push(checkedOutBy);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  return db.prepare(`
    SELECT e.*, u.username AS checked_out_username
    FROM equipment e
    LEFT JOIN users u ON u.id = e.checked_out_by
    ${where}
    ORDER BY e.name
  `).all(...params);
}

// Compute the next asset ID in the CIS-NNNNNN sequence by scanning
// existing barcodes. Pads to 6 digits but accepts longer numbers.
const ASSET_ID_PREFIX = 'CIS-';
function nextAssetId() {
  const rows = db.prepare(
    "SELECT barcode FROM equipment WHERE barcode LIKE 'CIS-%'"
  ).all();
  let max = 0;
  for (const r of rows) {
    const m = /^CIS-(\d+)$/i.exec((r.barcode || '').trim());
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  const next = max + 1;
  return ASSET_ID_PREFIX + String(next).padStart(6, '0');
}

function getById(id) {
  return db.prepare(`
    SELECT e.*, u.username AS checked_out_username
    FROM equipment e
    LEFT JOIN users u ON u.id = e.checked_out_by
    WHERE e.id = ?
  `).get(id);
}

// Look up an existing equipment row by barcode and/or serial number.
// Returns null if nothing matches OR if both identifiers are blank.
function findByIdentifier({ barcode, serial_number }) {
  const bc = (barcode || '').trim();
  const sn = (serial_number || '').trim();
  if (!bc && !sn) return null;
  const conds = [];
  const params = [];
  if (bc) { conds.push('lower(trim(barcode)) = lower(trim(?))'); params.push(bc); }
  if (sn) { conds.push('lower(trim(serial_number)) = lower(trim(?))'); params.push(sn); }
  // Match if either identifier matches (logical OR).
  return db.prepare(`
    SELECT e.*, u.username AS checked_out_username
    FROM equipment e
    LEFT JOIN users u ON u.id = e.checked_out_by
    WHERE ${conds.join(' OR ')}
    LIMIT 1
  `).get(...params) || null;
}

function create({ name, type, serial_number, barcode, category, location, image_path, notes }) {
  // Server-side dedupe: if a barcode or serial number is supplied and an
  // equipment row already exists with that identifier, return that row
  // instead of creating a duplicate. This prevents the checkout flow from
  // accidentally inflating the equipment table when the same physical
  // item is scanned multiple times. Items without any identifier are
  // always created as new rows (e.g. unbarcoded cables).
  const existing = findByIdentifier({ barcode, serial_number });
  if (existing) return existing;
  const info = db.prepare(`
    INSERT INTO equipment (name, type, serial_number, barcode, category, location, image_path, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, type || '', serial_number || '', barcode || '', category || '', location || '', image_path || null, notes || '');
  return getById(info.lastInsertRowid);
}

function update(id, fields) {
  const allowed = ['name', 'type', 'serial_number', 'barcode', 'category', 'location', 'notes', 'image_path'];
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
  db.prepare(`UPDATE equipment SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getById(id);
}

function remove(id) {
  db.prepare('DELETE FROM equipment WHERE id = ?').run(id);
}

// Atomic checkout — only succeeds if status is currently 'available'.
// userId/username identify the *borrower* (the student getting the gear).
// performedById identifies the actor (admin in kiosk mode, otherwise same as
// borrower). The checkout_log keeps both: performed_by = actor, checkout_user
// = borrower username, so audits show who actually scanned/clicked.
function checkout(equipmentId, userId, username, notes = '', source = 'Manual', performedById = null, durationDays = 7) {
  const actorId = performedById || userId;
  // Calculate due date: today + durationDays (stored as YYYY-MM-DD UTC)
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + Math.max(1, Math.min(30, durationDays || 7)));
  const dueDate = due.toISOString().slice(0, 10);
  const tx = db.transaction(() => {
    const eq = db.prepare('SELECT * FROM equipment WHERE id = ?').get(equipmentId);
    if (!eq) throw Object.assign(new Error('Equipment not found'), { status: 404 });
    if (eq.status !== 'available') {
      throw Object.assign(new Error('Equipment is already checked out'), { status: 409 });
    }
    db.prepare(`
      UPDATE equipment
      SET status = 'checked_out', checked_out_by = ?, checked_out_at = datetime('now'),
          due_date = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(userId, dueDate, equipmentId);
    db.prepare(`
      INSERT INTO checkout_log (equipment_id, action, performed_by, checkout_user, notes, source)
      VALUES (?, 'checkout', ?, ?, ?, ?)
    `).run(equipmentId, actorId, username, notes, source);
  });
  tx();
  return getById(equipmentId);
}

// Atomic checkin — IDOR-safe: enforces ownership unless the caller is admin.
// Returns { item, nextInQueue } — nextInQueue is populated if someone was
// waiting in the queue and has been notified.
function checkin(equipmentId, actingUser, notes = '', source = 'Manual') {
  let nextInQueue = null;
  const tx = db.transaction(() => {
    const eq = db.prepare('SELECT * FROM equipment WHERE id = ?').get(equipmentId);
    if (!eq) throw Object.assign(new Error('Equipment not found'), { status: 404 });
    if (eq.status !== 'checked_out') {
      throw Object.assign(new Error('Equipment is not checked out'), { status: 409 });
    }
    if (actingUser.role !== 'admin' && eq.checked_out_by !== actingUser.id) {
      throw Object.assign(new Error('You did not check this item out'), { status: 403 });
    }
    db.prepare(`
      UPDATE equipment
      SET status = 'available', checked_out_by = NULL, checked_out_at = NULL,
          due_date = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(equipmentId);
    db.prepare(`
      INSERT INTO checkout_log (equipment_id, action, performed_by, checkout_user, notes, source)
      VALUES (?, 'checkin', ?, ?, ?, ?)
    `).run(equipmentId, actingUser.id, actingUser.username, notes, source);
    // Pop next person from the waitlist (if any)
    try {
      const queueService = require('./queueService');
      nextInQueue = queueService.popNext(equipmentId);
    } catch { /* queue table may not exist yet */ }
  });
  tx();
  // Send queue notification outside the transaction (async, fire-and-forget)
  if (nextInQueue) {
    const emailService = require('./emailService');
    const item = getById(equipmentId);
    emailService.sendQueueNotification(
      nextInQueue.email, nextInQueue.username, item?.name || 'Equipment'
    ).catch(() => {});
  }
  return { item: getById(equipmentId), nextInQueue };
}

function getLog({ limit = 100, equipmentId, userId } = {}) {
  let where = '';
  const params = [];
  const conds = [];
  if (equipmentId) { conds.push('cl.equipment_id = ?'); params.push(equipmentId); }
  if (userId) { conds.push('cl.performed_by = ?'); params.push(userId); }
  if (conds.length) where = 'WHERE ' + conds.join(' AND ');
  params.push(limit);
  return db.prepare(`
    SELECT cl.*, e.name AS equipment_name, e.serial_number
    FROM checkout_log cl
    LEFT JOIN equipment e ON e.id = cl.equipment_id
    ${where}
    ORDER BY cl.created_at DESC
    LIMIT ?
  `).all(...params);
}

function getOverdue(daysThreshold) {
  return db.prepare(`
    SELECT e.*, u.username AS checked_out_username, u.email AS checked_out_email,
           CAST((julianday('now') - julianday(e.checked_out_at)) AS INTEGER) AS days_out
    FROM equipment e
    JOIN users u ON u.id = e.checked_out_by
    WHERE e.status = 'checked_out'
      AND julianday('now') - julianday(e.checked_out_at) >= ?
    ORDER BY days_out DESC
  `).all(daysThreshold);
}

function getCheckoutsForUser(userId) {
  return db.prepare(`
    SELECT * FROM equipment
    WHERE checked_out_by = ?
    ORDER BY checked_out_at DESC
  `).all(userId);
}

function clearLog() {
  db.prepare('DELETE FROM checkout_log').run();
}

module.exports = {
  listAll, getById, create, update, remove, findByIdentifier,
  checkout, checkin, getLog, clearLog, getOverdue, getCheckoutsForUser,
  nextAssetId,
};
