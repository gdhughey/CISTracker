'use strict';
/**
 * seed-inventory.js
 *
 * Imports the CIS Spring Inventory 2026 (Northeast Closet Room 1035-D)
 * into the equipment table.  Run once on the server:
 *
 *   cd /opt/CISTracker && node scripts/seed-inventory.js
 *
 * Safe to re-run — items with serial numbers are deduped by serial_number,
 * and a guard row prevents double-importing bulk items.
 */

const path = require('path');

// Load .env so DB_PATH resolves correctly on the server
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../src/db/connection');

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
const insertEquipment = db.prepare(`
  INSERT INTO equipment (name, type, serial_number, barcode, category, notes)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const findBySerial = db.prepare(
  `SELECT id FROM equipment WHERE serial_number = ? LIMIT 1`
);

const findByNameAndCategory = db.prepare(
  `SELECT id FROM equipment WHERE name = ? AND category = ? LIMIT 1`
);

// Compute the next CIS-NNNNNN barcode
let assetCounter = 0;
(function initCounter() {
  const rows = db.prepare(
    "SELECT barcode FROM equipment WHERE barcode LIKE 'CIS-%'"
  ).all();
  for (const r of rows) {
    const m = /^CIS-(\d+)$/i.exec((r.barcode || '').trim());
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > assetCounter) assetCounter = n;
    }
  }
})();

function nextAssetId() {
  assetCounter++;
  return 'CIS-' + String(assetCounter).padStart(6, '0');
}

let inserted = 0;
let skipped = 0;

function addItem(name, { serial = '', qty = 1, category = '', type = '', notes = '' } = {}) {
  // Items with serial numbers — one row each, deduped by serial
  if (serial) {
    if (findBySerial.get(serial)) {
      skipped++;
      return;
    }
    insertEquipment.run(name, type, serial, nextAssetId(), category, notes);
    inserted++;
    return;
  }

  // Bulk items (no serial) — create `qty` individual rows
  // Each gets its own CIS barcode so they can be checked out individually
  for (let i = 0; i < qty; i++) {
    insertEquipment.run(
      name,
      type,
      '',              // no serial
      nextAssetId(),
      category,
      notes || (qty > 1 ? `Imported qty: ${qty} (unit ${i + 1} of ${qty})` : '')
    );
    inserted++;
  }
}

// ------------------------------------------------------------------
// Guard: prevent double-import of bulk items
// ------------------------------------------------------------------
const guard = db.prepare(
  "SELECT id FROM equipment WHERE notes LIKE '%seed-inventory-2026%' LIMIT 1"
).get();
if (guard) {
  console.log('Inventory already seeded (guard row found). To re-import, delete existing items first.');
  process.exit(0);
}

// ------------------------------------------------------------------
// Begin import inside a transaction for speed + atomicity
// ------------------------------------------------------------------
const importAll = db.transaction(() => {

  // ============================================================
  //  PAGE 1 — Misc equipment & Corsair CX550M power supplies
  // ============================================================

  addItem('KVM Switch', { qty: 24, category: 'Networking', type: 'KVM Switch' });
  addItem('Keyboard (unmarked)', { qty: 36, category: 'Peripherals', type: 'Keyboard' });
  addItem('Key Tonic Keyboard', { serial: 'C124801772', category: 'Peripherals', type: 'Keyboard' });
  addItem('SunsetMicro Mouse', { qty: 4, category: 'Peripherals', type: 'Mouse' });
  addItem('Power Supply (generic)', { qty: 1, category: 'Components', type: 'Power Supply' });
  addItem('HAJAAN', { qty: 2, category: 'Components', type: 'Component' });
  addItem('Trendnet Mount KVM Switch', { serial: 'UN81831300584', category: 'Networking', type: 'KVM Switch' });
  addItem('Dell OptiPlex 790 Mid-Tower', { qty: 12, category: 'Computers', type: 'Desktop' });
  addItem('Raspberry Pi', { qty: 12, category: 'Computers', type: 'SBC' });
  addItem('Dell DW316 USB DVD-RW Drive', { serial: '95E-000S', category: 'Storage', type: 'Optical Drive' });
  addItem('Dell OptiPlex 390 Mid-Tower', { qty: 31, category: 'Computers', type: 'Desktop' });
  addItem('Dell OptiPlex 790 Mini-Tower', { qty: 11, category: 'Computers', type: 'Desktop' });
  addItem('Dell OptiPlex 7010 Mid-Tower', { qty: 1, category: 'Computers', type: 'Desktop' });
  addItem('Power Cord / Brick', { qty: 1, category: 'Cables', type: 'Power Cable' });
  addItem('AC Adapter', { qty: 5, category: 'Cables', type: 'Power Adapter' });
  addItem('SATA Drive Cable', { qty: 4, category: 'Cables', type: 'Data Cable' });
  addItem('SATA Cable', { qty: 4, category: 'Cables', type: 'Data Cable' });
  addItem('24-Pin Power Cable', { qty: 1, category: 'Cables', type: 'Power Cable' });
  addItem('SATA Power Cable', { qty: 19, category: 'Cables', type: 'Power Cable' });
  addItem('PCIe Power Cable', { qty: 6, category: 'Cables', type: 'Power Cable' });
  addItem('Molex Connector', { qty: 12, category: 'Cables', type: 'Power Cable' });

  // Corsair CX550M — each has a unique serial
  const cx550mSerials = [
    '18107142000022361417', '18217114000022360110', '18217114000022360544',
    '18447104000022363845', '18107142000022362325', '18217114000022360111',
    '18217114000022360622', '10097120000022361053', '18447104000022363843',
    '18107142000022362327', '18107142000022361309', '18217114000022360543',
    '18447104000022363841', '18107142000022362339', '18447104000022363844',
    '18107142000022362323',
    // Page 2 continuation
    '18107142000022362326', '18107142000022362340',
  ];
  for (const sn of cx550mSerials) {
    addItem('Corsair CX550M Power Supply', { serial: sn, category: 'Components', type: 'Power Supply' });
  }

  // ============================================================
  //  PAGE 2 — CX650M, GPUs, misc
  // ============================================================

  const cx650mSerials = [
    '20085804000012670455', '19405802000012674519', '20065804000012670699',
    '20085803000012670857', '20065803000012670716', '20065803000012671754',
    '20065804000012670750', '20085804000012670842', '20065803000012670853',
  ];
  for (const sn of cx650mSerials) {
    addItem('Corsair CX650M Power Supply', { serial: sn, category: 'Components', type: 'Power Supply' });
  }

  addItem('Port Panel', { qty: 2, category: 'Networking', type: 'Panel' });
  addItem('Pink SATA Cable', { qty: 2, category: 'Cables', type: 'Data Cable' });
  addItem('Server Rack', { qty: 1, category: 'Infrastructure', type: 'Rack' });
  addItem('AC Charger / Power', { qty: 5, category: 'Cables', type: 'Power Adapter' });
  addItem('Dell OptiPlex 390', { qty: 8, category: 'Computers', type: 'Desktop' });

  // GPUs
  addItem('NVIDIA R128', { qty: 1, category: 'GPUs', type: 'Graphics Card' });
  addItem('NVIDIA G210', { qty: 2, category: 'GPUs', type: 'Graphics Card' });
  addItem('NVIDIA GT620', { qty: 1, category: 'GPUs', type: 'Graphics Card' });
  addItem('NVIDIA GE420', { qty: 1, category: 'GPUs', type: 'Graphics Card' });
  addItem('NVIDIA GT430', { qty: 1, category: 'GPUs', type: 'Graphics Card' });
  addItem('NVIDIA G520', { qty: 1, category: 'GPUs', type: 'Graphics Card' });
  addItem('NVIDIA GT630', { qty: 1, category: 'GPUs', type: 'Graphics Card' });
  addItem('NVIDIA GT710', { qty: 1, category: 'GPUs', type: 'Graphics Card' });
  addItem('NVIDIA GF8400', { qty: 1, category: 'GPUs', type: 'Graphics Card' });
  addItem('NVIDIA 8400GS', { qty: 1, category: 'GPUs', type: 'Graphics Card' });
  addItem('NVIDIA VT4350', { qty: 1, category: 'GPUs', type: 'Graphics Card' });
  addItem('Radeon HD5450', { qty: 1, category: 'GPUs', type: 'Graphics Card' });
  addItem('Radeon 6350', { qty: 1, category: 'GPUs', type: 'Graphics Card' });
  addItem('Radeon R6450', { qty: 2, category: 'GPUs', type: 'Graphics Card' });
  addItem('Radeon HD6670', { qty: 1, category: 'GPUs', type: 'Graphics Card' });
  addItem('Radeon VT7000', { qty: 1, category: 'GPUs', type: 'Graphics Card' });
  addItem('Pegatron HD6450', { qty: 1, category: 'GPUs', type: 'Graphics Card' });
  addItem('Radeon VT4350', { qty: 1, category: 'GPUs', type: 'Graphics Card' });
  addItem('DMI Digital Video Demo Card', { qty: 9, category: 'GPUs', type: 'Video Card' });

  // ============================================================
  //  PAGE 3 — Cases, adapters, fans, storage, power cables
  // ============================================================

  addItem('NVIDIA G210', { qty: 2, category: 'GPUs', type: 'Graphics Card' });
  addItem('VIVO UTP CAT5 Cable (500ft box)', { qty: 2, category: 'Cables', type: 'Network Cable' });
  addItem('Equipment Rack', { qty: 5, category: 'Infrastructure', type: 'Rack' });

  // Kendomen cases with serials
  for (const sn of ['DC2017031601661', 'DC2017031601478', 'DC2017031601473']) {
    addItem('Kendomen ATX Case', { serial: sn, category: 'Cases', type: 'ATX Case' });
  }

  // Tyrfing cases with serials
  const tyrfingSerials = [
    '1147253091700401', '1147253091700751', '1147253091700328',
    '1147253091700407', '1147253091700418', '1147253091700413',
    '1147253091700416', '1147253011800132', '1147253091700409',
    '1147253091700356',
  ];
  for (const sn of tyrfingSerials) {
    addItem('Tyrfing ATX Case', { serial: sn, category: 'Cases', type: 'ATX Case' });
  }

  addItem('DP to VGA Adapter', { qty: 11, category: 'Adapters', type: 'Video Adapter' });
  addItem('Moread HDMI to VGA Adapter', { qty: 22, category: 'Adapters', type: 'Video Adapter' });
  addItem('Heat Sink', { qty: 22, category: 'Components', type: 'Cooling' });
  addItem('CPU Fan', { qty: 99, category: 'Components', type: 'Cooling' });
  addItem('StarTech Storage System', { serial: 'SAT3540U2E', category: 'Storage', type: 'Storage Enclosure' });

  // Power supply cables
  addItem('SATA Power Cable (PSU)', { qty: 14, category: 'PSU Cables', type: 'Power Cable' });
  addItem('PCI to Molex Cable', { qty: 10, category: 'PSU Cables', type: 'Power Cable' });
  addItem('CPU Power Cable', { qty: 29, category: 'PSU Cables', type: 'Power Cable' });
  addItem('GPU Power Cable', { qty: 27, category: 'PSU Cables', type: 'Power Cable' });
  addItem('Power Cable (generic)', { qty: 2, category: 'PSU Cables', type: 'Power Cable' });
  addItem('6+2 to 8 Pin Cable', { qty: 11, category: 'PSU Cables', type: 'Power Cable' });
  addItem('6 Pin to Molex Cable', { qty: 14, category: 'PSU Cables', type: 'Power Cable' });
  addItem('8 Pin to 4+4 Cable', { qty: 17, category: 'PSU Cables', type: 'Power Cable' });
  addItem('6 Pin to SATA Cable', { qty: 42, category: 'PSU Cables', type: 'Power Cable' });
  addItem('8 Pin to Double 6+2 Cable', { qty: 26, category: 'PSU Cables', type: 'Power Cable' });

  // Tag one item so we can detect a re-run
  db.prepare(
    "UPDATE equipment SET notes = notes || ' [seed-inventory-2026]' WHERE id = (SELECT MIN(id) FROM equipment)"
  ).run();

});

// ------------------------------------------------------------------
// Run it
// ------------------------------------------------------------------
console.log('Importing CIS Spring Inventory 2026 — Northeast Closet Room 1035-D...');
importAll();
console.log(`Done! Inserted ${inserted} items, skipped ${skipped} duplicates.`);
console.log(`Asset IDs assigned: CIS-000001 through CIS-${String(assetCounter).padStart(6, '0')}`);
