#!/usr/bin/env node
// seed-inventory-v4.js
// Seeds networking equipment from pages 59-66 and 85 of CIS Spring Inventory 2026 PDF
// — Cisco 2600 Routers (130 units, pages 61-65)
// — Cisco 2950 Switches (45 + 1, pages 65-66, 85)
// — Cisco 3650, 3560, ASA 5505 (page 66)
// — Remaining networking closet items (pages 59-61) not yet in DB
// Idempotent: guard rows prevent double-import on re-run.

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DB_PATH = process.env.DB_PATH || './data/cyberlab.db';
const Database = require('better-sqlite3');
const db = new Database(path.resolve(DB_PATH));
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

const LOCATION = 'networking closet';

// ── helpers ──────────────────────────────────────────────────────────────────

function nextBarcode() {
  const row = db.prepare(`
    SELECT barcode FROM equipment
    WHERE barcode LIKE 'CIS-%'
    ORDER BY CAST(SUBSTR(barcode,5) AS INTEGER) DESC
    LIMIT 1
  `).get();
  const last = row ? parseInt(row.barcode.replace('CIS-', ''), 10) : 0;
  return `CIS-${String(last + 1).padStart(6, '0')}`;
}

let inserted = 0;
let skipped = 0;

function insert({ name, type, category, serial, notes }) {
  // Guard: skip if item with this name+serial already exists
  if (serial && serial !== 'N/A' && serial !== '') {
    const exists = db.prepare(
      'SELECT id FROM equipment WHERE LOWER(serial_number) = LOWER(?)'
    ).get(serial);
    if (exists) { skipped++; return; }
  } else {
    // For no-serial items, guard by name+location to avoid exact duplicates on re-run
    // but allow multiple (e.g. 10 KVM cables) — guard is handled by counting inserts per run
  }

  const barcode = nextBarcode();
  db.prepare(`
    INSERT INTO equipment (name, type, serial_number, barcode, category, status, location, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'available', ?, ?, datetime('now'), datetime('now'))
  `).run(name, type, serial || '', barcode, category, LOCATION, notes || '');
  inserted++;
}

function insertBulk({ name, type, category, qty, notes }) {
  // Guard: count existing rows with this name+location, only insert difference
  const existing = db.prepare(
    "SELECT COUNT(*) as c FROM equipment WHERE LOWER(name) = LOWER(?) AND LOWER(location) = LOWER(?)"
  ).get(name, LOCATION).c;
  const toInsert = Math.max(0, qty - existing);
  if (toInsert === 0) { skipped += qty; return; }
  for (let i = 0; i < toInsert; i++) {
    const barcode = nextBarcode();
    db.prepare(`
      INSERT INTO equipment (name, type, serial_number, barcode, category, status, location, notes, created_at, updated_at)
      VALUES (?, ?, '', ?, ?, 'available', ?, ?, datetime('now'), datetime('now'))
    `).run(name, type, barcode, category, LOCATION, notes || '');
    inserted++;
  }
}

// ── Cisco 2600 Routers ────────────────────────────────────────────────────────

const cisco2600 = [
  'JMX060K1UX','JMX0704L4DP','JMX0707L1C3','JMX0713L60D','JMX0606K523',
  'JMX0642L889','JMX0609K5LQ','JMX0627K1CM','JMX0651L27W','JMX0614K2G1',
  'JMX0709L6LX','JMX0709L4BE','JMX0835L9RP','JMX0637L3WL','JMX0637L5P6',
  // page 62
  'JMX0710L5E8','JMX0617K3P1','JMX0626K1K5','JMX0642L46Q','JMX0701L2W2',
  'JMX0702L9KE','JMX0708L8SV','JMX0710L5JU','UNREADABLE-1','JMX0627K14A',
  'JMX0713L651','JMX0627K0ZT','JMX0637L5QC','JMX0712L0PZ','JMX0608K56H',
  'JMX0716L19X','JMX0707L1A6','JMX0609K5MV','JMX0710L5L7','JMX0610K1T8',
  'JMX0710L3E0','JMX0706L23W','JMX0713L66H','JMX0625KA1C','JMX0610K21Z',
  'JAB0444875J','JMX0637L3PE','JMX0710L5K7','JMX0710L3DA','JMX0637L5U8',
  'JMXO71OL5XJ','JMX0645L1SW','JMX0627K1JT','UNREADABLE-2','JMX0627K0ZP',
  'JMX0635L9QS','JMX0707L1CF',
  // page 63
  'JMX0635L8JJ','JMX0709L6N6','JMX0706L28T','JMX0608K588','JMX0702L9LN',
  'JMX0627K0TV','JMX0636L6H4','JMX0645L11H','JMX0627K1FV','JMX0636L0RA',
  'JMX0710L5Y0','UNREADABLE-3','JMX0623K7XF','JMX0651L28L','JMX0608K5C3',
  'JMX0610K20P','JMX0645L2NF','JMX0710L5HE','JMX0627K1CC','UNREADABLE-4',
  'JMX0634L6GC','JMX0710L5XQ','JMX0710L4WK','JMX0609K5M1','JMX0627KOTX',
  'JMX0617K4TD','JMX0706L231','JMX0713L670','JMX0707L16J','JMX0712L0QM',
  'JMX0642L472','JMX0713LOV4','JMX0637LJV3','UNREADABLE-5','JMX0649L0F5',
  'JMX0617K4KD','JMX0710L5EU',
  // page 64
  'JMX0701L2UU','JMX0627K1C0','JMX0710L5KP','JMX0627K1EB','JMX0637L3NQ',
  'UNREADABLE-6','JMX0531K936','JMX0713L0UT','JMX709L4BQ','JMX0625KA1P',
  'JMXO708L90P','JMX0707L6DE','JMX0707L1X4','JMX0707L6QH','JMX0610K2OB',
  'JMX0701L2VW','JMX0701L2XH','JMX0637LGTE','JMX0652L52L','JMX0713L607',
  'NO-SN-1','JMX0713L600','JMX0643L4AW','JMX0645L2ND','JMX0642L46G',
  'JMX0701L3AB','JMX0627K0TQ','JMX0605K5MH','JMX0627K13R','JMX0708L8HB',
  'JMX0649L0F1','UNREADABLE-7','JMX0702L5H8','JMX0713L698','JMX0609K5MG',
  'JMX0627K1GQ','JMX0725L09F',
  // page 65
  'JMX0627K1H7','JMX0710L5E6','JMX0710L5GU','JMX0608K5AU',
];

console.log(`Inserting ${cisco2600.length} Cisco 2600 Routers...`);
// Make unreadable SNs unique
let unreadableIdx = 1;
const seenSNs = new Set();
for (let sn of cisco2600) {
  // Deduplicate unreadable labels
  if (sn.startsWith('UNREADABLE') || sn.startsWith('NO-SN')) {
    sn = `${sn}-${unreadableIdx++}`;
  }
  // Also deduplicate actual SNs that appear twice in the PDF (typos)
  let finalSN = sn;
  if (seenSNs.has(sn.toUpperCase())) {
    finalSN = `${sn}-DUP`;
  }
  seenSNs.add(sn.toUpperCase());

  insert({
    name: 'Cisco 2600 Router',
    type: 'Router',
    category: 'Networking',
    serial: finalSN,
    notes: 'Seeded from CIS Spring Inventory 2026 p61-65',
  });
}

// ── Cisco 2950 Switches ───────────────────────────────────────────────────────

const cisco2950 = [
  // page 65
  'FOC1014Z629','FOC0804Y09F','FHK0616X2Z0','FHK0722W0U9','FHK0616W2U1',
  'F0C074620V8','FHK065020HX','FOC0912Y190','FOC0821Z33R','FOC0752T044',
  'FCZ1207Y027','NO-SN-2950-1','FOC1149X09L','FHK0718W1Q6','FOC09122Z1AN',
  'FHK0625Z1CL','FOC1104W3EA','FOC0839W1FQ','FOC1149W1JM','FOC0835X1RB',
  'FOC1014Z5BD','FOC0804Y00E','NO-SN-2950-2','FAB0545W2ZN','FHK0636Y1XB',
  'FOC0912Y182','FOC0836Y1ML','FOC1124X0JR','FOC1128W5HX','FOC1222U1UF',
  'FOC0835X2AA','FOC1123W5BA','FOC1014Z5CS',
  // page 66
  'FOC0824S1SP','FHK0636Y160','FOC1149W1DG','FOC0912Y18X','FHK0722X0V0',
  'FOC0803Z1JF','FOC0733X1ZT','FOC1108Z55M','FOC0835X1R7','FOC0739Y3L9',
  'FOC0835W1MD',
  // page 85 - no SN
  'NO-SN-2950-3',
];

console.log(`Inserting ${cisco2950.length} Cisco 2950 Switches...`);
for (const sn of cisco2950) {
  insert({
    name: 'Cisco 2950 Switch',
    type: 'Switch',
    category: 'Networking',
    serial: sn,
    notes: 'Seeded from CIS Spring Inventory 2026 p65-66',
  });
}

// ── Cisco 3650 / 3560 / ASA 5505 ─────────────────────────────────────────────

insert({ name: 'Cisco 3650 Switch', type: 'Switch', category: 'Networking', serial: 'FOC1442W4N5', notes: 'p66' });
insert({ name: 'Cisco 3560 Switch', type: 'Switch', category: 'Networking', serial: 'FOC1245Z3FT', notes: 'p66' });
insert({ name: 'Cisco ASA 5505', type: 'Firewall', category: 'Networking', serial: 'ASA5505-1', notes: 'p61 - 2 units; SN not recorded' });
insert({ name: 'Cisco ASA 5505', type: 'Firewall', category: 'Networking', serial: 'ASA5505-2', notes: 'p61 - 2 units; SN not recorded' });

// ── Other networking closet items from pages 59-61 ───────────────────────────

// Page 60 items not yet in DB
insertBulk({ name: 'TrendNet Switch', type: 'Switch', category: 'Networking', qty: 1, notes: 'p60 - no SN' });
insert({ name: 'TRENDnet KVM Switch', type: 'KVM Switch', category: 'Networking', serial: 'UN16158030253', notes: 'p60' });
insertBulk({ name: 'KVM Cable', type: 'Cable', category: 'Cables', qty: 10, notes: 'p60' });
insertBulk({ name: '5-Port NetGear Switch', type: 'Switch', category: 'Networking', qty: 4, notes: 'p60 - no SN' });
insertBulk({ name: 'USB to Ethernet Adapter', type: 'Adapter', category: 'Networking', qty: 1, notes: 'p60' });
insertBulk({ name: 'Gutted Router Case', type: 'Other', category: 'Networking', qty: 1, notes: 'p59' });
insertBulk({ name: 'Gutted Router', type: 'Other', category: 'Networking', qty: 1, notes: 'p60' });

// Page 61 items not yet in DB
insertBulk({ name: 'Serial Card for Cisco 260X', type: 'NIC/Card', category: 'Networking', qty: 12, notes: 'p61' });
insertBulk({ name: '2-Port PS/2 KVM Switch with Cables', type: 'KVM Switch', category: 'Networking', qty: 1, notes: 'p61' });
insertBulk({ name: 'Wall Plate Key (patch panel)', type: 'Other', category: 'Networking', qty: 163, notes: 'p61 - patch panel keys, separate from south shelf wall plate keys' });

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\nDone.`);
console.log(`  Inserted : ${inserted}`);
console.log(`  Skipped  : ${skipped} (already in DB)`);

db.close();
