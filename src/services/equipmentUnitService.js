'use strict';
const db = require('../db/connection');

function listByEquipment(equipmentId) {
  return db.prepare('SELECT * FROM equipment_units WHERE equipment_id = ? ORDER BY id').all(equipmentId);
}

function create(equipmentId, { serial_number = '', barcode = '', notes = '' }) {
  const info = db.prepare(
    'INSERT INTO equipment_units (equipment_id, serial_number, barcode, notes) VALUES (?, ?, ?, ?)'
  ).run(equipmentId, serial_number.trim(), barcode.trim(), notes.trim());
  return db.prepare('SELECT * FROM equipment_units WHERE id = ?').get(info.lastInsertRowid);
}

function update(id, { serial_number, barcode, notes }) {
  const unit = db.prepare('SELECT * FROM equipment_units WHERE id = ?').get(id);
  if (!unit) throw Object.assign(new Error('Unit not found'), { status: 404 });
  db.prepare('UPDATE equipment_units SET serial_number = ?, barcode = ?, notes = ? WHERE id = ?')
    .run(
      serial_number !== undefined ? serial_number.trim() : unit.serial_number,
      barcode       !== undefined ? barcode.trim()       : unit.barcode,
      notes         !== undefined ? notes.trim()         : unit.notes,
      id,
    );
  return db.prepare('SELECT * FROM equipment_units WHERE id = ?').get(id);
}

function remove(id) {
  const unit = db.prepare('SELECT * FROM equipment_units WHERE id = ?').get(id);
  if (!unit) throw Object.assign(new Error('Unit not found'), { status: 404 });
  db.prepare('DELETE FROM equipment_units WHERE id = ?').run(id);
}

module.exports = { listByEquipment, create, update, remove };
