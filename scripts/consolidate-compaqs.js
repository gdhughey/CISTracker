'use strict';
// Consolidate individual Compaq equipment rows into one parent item with units.
// Keeps every unit's name exactly as-is. Safe to re-run (idempotent).

const path = require('path');
const db = require('better-sqlite3')(
  process.env.DB_PATH || path.join(__dirname, '../data/cyberlab.db')
);

// Find all Compaq rows that are individual equipment entries (qty=1, no units yet)
// They match names like "#1 HP Compaq dc5800", "#2 HP Compaq dc7900", etc.
const rows = db.prepare(`
  SELECT id, name, barcode, serial_number, category, location, notes, status
  FROM equipment
  WHERE (name LIKE '%Compaq%' OR name LIKE '%compaq%')
    AND (quantity IS NULL OR quantity = 1)
  ORDER BY name
`).all();

if (rows.length === 0) {
  console.log('No individual Compaq rows found — nothing to do.');
  process.exit(0);
}

console.log(`Found ${rows.length} Compaq equipment rows to consolidate.`);
rows.forEach(r => console.log(`  [${r.id}] ${r.name} — ${r.barcode || '(no barcode)'}`));

// Check if a parent already exists
const existing = db.prepare(`
  SELECT id, name FROM equipment
  WHERE name = 'HP Compaq Computers' AND quantity > 1
  LIMIT 1
`).get();

const tx = db.transaction(() => {
  let parentId;
  if (existing) {
    parentId = existing.id;
    console.log(`\nUsing existing parent: [${parentId}] ${existing.name}`);
    // Update quantity to total units
    const currentUnits = db.prepare('SELECT COUNT(*) AS n FROM equipment_units WHERE equipment_id = ?').get(parentId).n;
    const newQty = currentUnits + rows.length;
    db.prepare('UPDATE equipment SET quantity = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newQty, parentId);
  } else {
    // Use location/category from first row
    const ref = rows[0];
    const info = db.prepare(`
      INSERT INTO equipment (name, type, category, location, notes, status, quantity, checked_out_count, barcode, serial_number)
      VALUES ('HP Compaq Computers', 'Computer', ?, ?, 'Consolidated Compaq desktop computers', 'available', ?, 0, '', '')
    `).run(ref.category || 'Computers', ref.location || '', rows.length);
    parentId = info.lastInsertRowid;
    console.log(`\nCreated parent item: [${parentId}] HP Compaq Computers (qty: ${rows.length})`);
  }

  // Insert each row as a unit under the parent
  const insertUnit = db.prepare(`
    INSERT OR IGNORE INTO equipment_units (equipment_id, name, barcode, serial_number, notes)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const row of rows) {
    // Skip if a unit with this barcode already exists under ANY parent
    if (row.barcode) {
      const dup = db.prepare('SELECT id FROM equipment_units WHERE barcode = ?').get(row.barcode);
      if (dup) {
        console.log(`  Skipping [${row.id}] ${row.name} — barcode ${row.barcode} already in equipment_units`);
        continue;
      }
    }

    insertUnit.run(parentId, row.name, row.barcode || '', row.serial_number || '', row.notes || '');
    console.log(`  + Unit added: ${row.name} (${row.barcode})`);

    // Clear FK refs then delete the original equipment row
    db.prepare('UPDATE tickets SET equipment_id = NULL WHERE equipment_id = ?').run(row.id);
    db.prepare('DELETE FROM checkout_log WHERE equipment_id = ?').run(row.id);
    db.prepare('DELETE FROM equipment WHERE id = ?').run(row.id);
  }

  // Final parent quantity = actual unit count
  const finalCount = db.prepare('SELECT COUNT(*) AS n FROM equipment_units WHERE equipment_id = ?').get(parentId).n;
  db.prepare('UPDATE equipment SET quantity = ? WHERE id = ?').run(finalCount, parentId);
  console.log(`\nDone. Parent [${parentId}] now has ${finalCount} units.`);
});

tx();
db.close();
