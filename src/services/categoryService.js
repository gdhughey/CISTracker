'use strict';
const db = require('../db/connection');

function listAll() {
  return db.prepare('SELECT * FROM categories ORDER BY name').all();
}

function getById(id) {
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
}

function create(name) {
  const existing = db.prepare('SELECT * FROM categories WHERE lower(name) = lower(?)').get(name.trim());
  if (existing) return existing;
  const info = db.prepare("INSERT INTO categories (name) VALUES (?)").run(name.trim());
  return getById(info.lastInsertRowid);
}

function update(id, name) {
  db.prepare("UPDATE categories SET name = ? WHERE id = ?").run(name.trim(), id);
  return getById(id);
}

function remove(id) {
  db.prepare('UPDATE models SET category_id = NULL WHERE category_id = ?').run(id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
}

module.exports = { listAll, getById, create, update, remove };
