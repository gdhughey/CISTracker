'use strict';
const db = require('../db/connection');

function listAll(userId) {
  const where = userId ? 'WHERE ia.created_by = ?' : '';
  const params = userId ? [userId] : [];
  return db.prepare(`
    SELECT ia.*, u.username AS created_by_username,
           COUNT(ae.id) AS entry_count
    FROM inventory_audits ia
    JOIN users u ON u.id = ia.created_by
    LEFT JOIN audit_entries ae ON ae.audit_id = ia.id
    ${where}
    GROUP BY ia.id
    ORDER BY ia.created_at DESC
  `).all(...params);
}

function getById(id) {
  return db.prepare(`
    SELECT ia.*, u.username AS created_by_username
    FROM inventory_audits ia
    JOIN users u ON u.id = ia.created_by
    WHERE ia.id = ?
  `).get(id);
}

function getEntries(auditId) {
  return db.prepare(`
    SELECT ae.*, m.name AS model_name, c.name AS category_name
    FROM audit_entries ae
    LEFT JOIN models m ON m.id = ae.model_id
    LEFT JOIN categories c ON c.id = ae.category_id
    WHERE ae.audit_id = ?
    ORDER BY ae.created_at
  `).all(auditId);
}

function computeExpected(modelId, itemName) {
  if (modelId) {
    return db.prepare("SELECT COUNT(*) AS n FROM equipment WHERE model_id = ?").get(modelId).n;
  }
  return db.prepare("SELECT COUNT(*) AS n FROM equipment WHERE lower(trim(name)) = lower(trim(?))").get(itemName).n;
}

function create(userId, notes) {
  const info = db.prepare(`
    INSERT INTO inventory_audits (created_by, notes) VALUES (?, ?)
  `).run(userId, notes || '');
  return getById(info.lastInsertRowid);
}

function addEntry(auditId, { model_id, category_id, item_name, counted_qty, notes }) {
  const expected = computeExpected(model_id, item_name);
  const info = db.prepare(`
    INSERT INTO audit_entries (audit_id, model_id, category_id, item_name, expected_qty, counted_qty, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(auditId, model_id || null, category_id || null, item_name, expected, counted_qty, notes || '');
  return db.prepare('SELECT * FROM audit_entries WHERE id = ?').get(info.lastInsertRowid);
}

function closeAudit(id) {
  db.prepare(`
    UPDATE inventory_audits SET status = 'closed', closed_at = datetime('now') WHERE id = ?
  `).run(id);
  return getById(id);
}

module.exports = { listAll, getById, getEntries, create, addEntry, closeAudit };
