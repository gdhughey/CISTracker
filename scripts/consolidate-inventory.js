'use strict';
/**
 * consolidate-inventory.js
 *
 * Merges duplicate equipment rows (same name + category) into a single row
 * with a quantity field. Only merges rows that are currently 'available' —
 * checked-out items are left alone so checkout history is preserved.
 *
 * Usage (run from /opt/CISTracker):
 *   sudo -u cistracker node scripts/consolidate-inventory.js
 *
 * Safe to re-run — already-consolidated rows (quantity > 1) are skipped.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'cyberlab.db');
console.log(`Using database: ${DB_PATH}`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Find all groups with more than 1 available row
const groups = db.prepare(`
  SELECT
    lower(trim(name))     AS norm_name,
    lower(trim(category)) AS norm_cat,
    MIN(name)             AS canonical_name,
    MIN(category)         AS canonical_cat,
    COUNT(*)              AS total,
    GROUP_CONCAT(id)      AS ids,
    MIN(id)               AS keep_id
  FROM equipment
  WHERE status = 'available'
    AND quantity = 1
  GROUP BY lower(trim(name)), lower(trim(category))
  HAVING COUNT(*) > 1
  ORDER BY COUNT(*) DESC
`).all();

if (!groups.length) {
  console.log('No duplicates found — already consolidated or nothing to do.');
  process.exit(0);
}

console.log(`\nFound ${groups.length} groups to consolidate:\n`);

const consolidate = db.transaction(() => {
  let totalMerged = 0;

  for (const group of groups) {
    const ids = group.ids.split(',').map(Number);
    const keepId = group.keep_id;
    const deleteIds = ids.filter(id => id !== keepId);
    const qty = ids.length;

    console.log(`  [${group.canonical_cat}] "${group.canonical_name}" — ${qty} rows → 1 row (id=${keepId}, qty=${qty})`);

    // Update the kept row with the consolidated quantity
    db.prepare(`
      UPDATE equipment SET quantity = ?, updated_at = datetime('now') WHERE id = ?
    `).run(qty, keepId);

    // Reassign FK references to the kept row before deleting duplicates
    if (deleteIds.length) {
      const placeholders = deleteIds.map(() => '?').join(',');
      db.prepare(`UPDATE checkout_log SET equipment_id = ? WHERE equipment_id IN (${placeholders})`).run(keepId, ...deleteIds);
      db.prepare(`UPDATE tickets SET equipment_id = ? WHERE equipment_id IN (${placeholders})`).run(keepId, ...deleteIds);
      db.prepare(`DELETE FROM equipment_queue WHERE equipment_id IN (${placeholders})`).run(...deleteIds);
      // Delete the duplicate rows
      db.prepare(`DELETE FROM equipment WHERE id IN (${placeholders})`).run(...deleteIds);
    }

    totalMerged += deleteIds.length;
  }

  return totalMerged;
});

const removed = consolidate();
console.log(`\nDone. Consolidated ${groups.length} groups, removed ${removed} duplicate rows.`);
console.log('Restart the app to apply: sudo systemctl restart cistracker');
