'use strict';
/**
 * seed-units-northeast.js
 *
 * Populates equipment_units from the CIS Spring Inventory 2026 — Northeast Closet.
 * Matches equipment rows by name (case-insensitive), then inserts per-unit serial numbers.
 * Safe to re-run — skips any serial that already exists for that equipment_id.
 *
 * Usage (run from /opt/CISTracker):
 *   sudo node scripts/seed-units-northeast.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'cyberlab.db');
console.log(`Using database: ${DB_PATH}\n`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Items with individual serial numbers from the inventory sheet
const UNIT_DATA = [
  {
    name: 'Corsair CX550M power supply',
    serials: [
      '18107142000022361417',
      '18217114000022360110',
      '18217114000022360544',
      '18447104000022363845',
      '18107142000022362325',
      '18217114000022360111',
      '18217114000022360622',
      '10097120000022361053',
      '18447104000022363843',
      '18107142000022362327',
      '18107142000022361309',
      '18217114000022360543',
      '18447104000022363841',
      '18107142000022362339',
      '18447104000022363844',
      '18107142000022362323',
      '18107142000022362326',
      '18107142000022362340',
    ],
  },
  {
    name: 'Corsair CX650M power supply',
    serials: [
      '20085804000012670455',
      '19405802000012674519',
      '20065804000012670699',
      '20085803000012670857',
      '20065803000012670716',
      '20065803000012671754',
      '20065804000012670750',
      '20085804000012670842',
      '20065803000012670853',
    ],
  },
  {
    name: 'Kendomen case atx',
    serials: [
      'DC2017031601661',
      'DC2017031601478',
      'DC2017031601473',
    ],
  },
  {
    name: 'Tyrfing atx case',
    serials: [
      '1147253091700401',
      '1147253091700751',
      '1147253091700328',
      '1147253091700407',
      '1147253091700418',
      '1147253091700413',
      '1147253091700416',
      '1147253011800132',
      '1147253091700409',
      '1147253091700356',
    ],
  },
];

// Single-serial items — update the equipment row's serial_number directly
const SINGLE_SERIAL = [
  { name: 'Key tonic',                    serial: 'C124801772'    },
  { name: 'Trendnet mount KVM Switch',    serial: 'UN81831300584' },
  { name: 'Dell DW316 USB DVDRW DRIVE',   serial: '95E-000S'      },
  { name: 'STARTECH STORAGE SYSTEM',      serial: 'SAT3540U2E'    },
];

const findEquipment = db.prepare(
  "SELECT * FROM equipment WHERE lower(trim(name)) = lower(trim(?)) LIMIT 1"
);
const existingUnit = db.prepare(
  'SELECT id FROM equipment_units WHERE equipment_id = ? AND serial_number = ?'
);
const insertUnit = db.prepare(
  'INSERT INTO equipment_units (equipment_id, serial_number, barcode, notes) VALUES (?, ?, ?, ?)'
);
const updateSerial = db.prepare(
  "UPDATE equipment SET serial_number = ?, updated_at = datetime('now') WHERE id = ? AND (serial_number IS NULL OR serial_number = '')"
);

const run = db.transaction(() => {
  let totalAdded = 0;
  let totalSkipped = 0;

  // Insert per-unit serials
  for (const { name, serials } of UNIT_DATA) {
    const item = findEquipment.get(name);
    if (!item) {
      console.log(`  MISS  "${name}" — not found in equipment table (check name spelling)`);
      continue;
    }
    let added = 0, skipped = 0;
    for (const sn of serials) {
      const already = existingUnit.get(item.id, sn);
      if (already) { skipped++; continue; }
      insertUnit.run(item.id, sn, '', '');
      added++;
    }
    console.log(`  ${added > 0 ? 'ADD  ' : 'SKIP '} [${item.id}] "${item.name}" — ${added} unit(s) added, ${skipped} already existed`);
    totalAdded   += added;
    totalSkipped += skipped;
  }

  console.log('');

  // Update single-serial items on the equipment row itself
  for (const { name, serial } of SINGLE_SERIAL) {
    const item = findEquipment.get(name);
    if (!item) {
      console.log(`  MISS  "${name}" — not found in equipment table`);
      continue;
    }
    if (item.serial_number && item.serial_number.trim()) {
      console.log(`  SKIP  [${item.id}] "${item.name}" — serial already set (${item.serial_number})`);
      continue;
    }
    updateSerial.run(serial, item.id);
    console.log(`  SET   [${item.id}] "${item.name}" serial → ${serial}`);
  }

  console.log(`\nDone — ${totalAdded} unit serial(s) inserted, ${totalSkipped} skipped (already existed).`);
});

run();
