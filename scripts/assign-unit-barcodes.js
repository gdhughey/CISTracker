'use strict';
/**
 * assign-unit-barcodes.js
 *
 * Assigns CIS-NNNNNN barcodes to every equipment_units row that has an
 * empty barcode field. Continues the counter from the highest CIS number
 * already used across both the equipment and equipment_units tables.
 *
 * Usage: sudo node scripts/assign-unit-barcodes.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'cyberlab.db');
console.log(`Using database: ${DB_PATH}\n`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── find highest existing CIS number across both tables ───────────────────────
let counter = 0;
function scanBarcodes(rows) {
  for (const r of rows) {
    const m = /^CIS-(\d+)$/i.exec((r.barcode || '').trim());
    if (m) { const n = parseInt(m[1], 10); if (n > counter) counter = n; }
  }
}
scanBarcodes(db.prepare("SELECT barcode FROM equipment WHERE barcode LIKE 'CIS-%'").all());
scanBarcodes(db.prepare("SELECT barcode FROM equipment_units WHERE barcode LIKE 'CIS-%'").all());
console.log(`Starting from CIS-${String(counter + 1).padStart(6, '0')}\n`);

function nextBarcode() {
  counter++;
  return 'CIS-' + String(counter).padStart(6, '0');
}

// ── fetch all units with blank barcode ────────────────────────────────────────
const blank = db.prepare(
  "SELECT id FROM equipment_units WHERE barcode IS NULL OR trim(barcode) = '' ORDER BY id"
).all();

console.log(`Found ${blank.length} unit(s) without a barcode.`);

if (blank.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

const upd = db.prepare("UPDATE equipment_units SET barcode = ? WHERE id = ?");

const assign = db.transaction(() => {
  for (const row of blank) {
    upd.run(nextBarcode(), row.id);
  }
});

assign();

console.log(`Assigned ${blank.length} barcode(s). Last: CIS-${String(counter).padStart(6, '0')}`);
