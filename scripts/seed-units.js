'use strict';
/**
 * seed-units.js
 *
 * For every equipment row with quantity > 1, creates N blank entries in
 * equipment_units (one per unit) so serial numbers can be filled in manually.
 *
 * Already-seeded items are skipped — safe to re-run.
 *
 * Usage (run from /opt/CISTracker):
 *   sudo node scripts/seed-units.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'cyberlab.db');
console.log(`Using database: ${DB_PATH}\n`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const bulkItems = db.prepare(
  'SELECT * FROM equipment WHERE quantity > 1 ORDER BY name'
).all();

if (!bulkItems.length) {
  console.log('No items with quantity > 1 found.');
  process.exit(0);
}

console.log(`Found ${bulkItems.length} bulk item(s):\n`);

const insertUnit = db.prepare(
  'INSERT INTO equipment_units (equipment_id, serial_number, barcode, notes) VALUES (?, ?, ?, ?)'
);
const countUnits = db.prepare(
  'SELECT COUNT(*) AS cnt FROM equipment_units WHERE equipment_id = ?'
);

const seed = db.transaction(() => {
  let totalAdded = 0;

  for (const item of bulkItems) {
    const existing = countUnits.get(item.id).cnt;
    const needed = item.quantity - existing;

    if (needed <= 0) {
      console.log(`  SKIP  [${item.id}] "${item.name}" — already has ${existing} unit(s)`);
      continue;
    }

    // Unit 1 gets the existing serial/barcode from the parent row (if any)
    for (let i = 0; i < needed; i++) {
      const isFirst = existing === 0 && i === 0;
      insertUnit.run(
        item.id,
        isFirst && item.serial_number ? item.serial_number : '',
        isFirst && item.barcode       ? item.barcode       : '',
        '',
      );
    }

    console.log(`  ADD   [${item.id}] "${item.name}" (qty ${item.quantity}) — added ${needed} unit slot(s)${existing > 0 ? `, ${existing} already existed` : ''}`);
    totalAdded += needed;
  }

  console.log(`\nDone — ${totalAdded} unit slot(s) added across ${bulkItems.length} item(s).`);
  console.log('Open each item in CISTracker and fill in the serial numbers under the Units section.');
});

seed();
