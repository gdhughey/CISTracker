'use strict';
const db = require('../db/connection');

function listAll() {
  return db.prepare(`
    SELECT m.*,
           c.name AS category_name,
           COUNT(e.id) AS total_units,
           SUM(CASE WHEN e.status = 'available' THEN 1 ELSE 0 END) AS available_units
    FROM models m
    LEFT JOIN categories c ON c.id = m.category_id
    LEFT JOIN equipment e ON e.model_id = m.id
    GROUP BY m.id
    ORDER BY m.name
  `).all();
}

function getById(id) {
  return db.prepare(`
    SELECT m.*, c.name AS category_name
    FROM models m
    LEFT JOIN categories c ON c.id = m.category_id
    WHERE m.id = ?
  `).get(id);
}

function getUnits(modelId) {
  return db.prepare(`
    SELECT e.*, u.username AS checked_out_username
    FROM equipment e
    LEFT JOIN users u ON u.id = e.checked_out_by
    WHERE e.model_id = ?
    ORDER BY e.barcode, e.serial_number
  `).all(modelId);
}

function create({ name, category_id, description }) {
  const info = db.prepare(`
    INSERT INTO models (name, category_id, description)
    VALUES (?, ?, ?)
  `).run(name, category_id || null, description || '');
  return getById(info.lastInsertRowid);
}

function update(id, fields) {
  const allowed = ['name', 'category_id', 'description', 'image_path'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) { sets.push(`${key} = ?`); params.push(fields[key]); }
  }
  if (!sets.length) return getById(id);
  sets.push("updated_at = datetime('now')");
  params.push(id);
  db.prepare(`UPDATE models SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getById(id);
}

function remove(id) {
  db.prepare('UPDATE equipment SET model_id = NULL WHERE model_id = ?').run(id);
  db.prepare('DELETE FROM models WHERE id = ?').run(id);
}

module.exports = { listAll, getById, getUnits, create, update, remove };
