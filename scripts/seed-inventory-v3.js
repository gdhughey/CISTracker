'use strict';
/**
 * seed-inventory-v3.js
 *
 * Backfills the `location` column for all items previously imported by
 * seed-inventory.js (v1, pages 1-3) and seed-inventory-v2.js (pages 29-61).
 * Location data was added to the updated PDF (CIS Spring Inventory 2026);
 * this script maps every existing item to the correct physical location.
 *
 *   cd /opt/CISTracker && node scripts/seed-inventory-v3.js
 *
 * Safe to re-run — updates are idempotent (only touches rows where location='')
 * and a guard row prevents the final tag from being applied twice.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../src/db/connection');

// ── Location constants ──────────────────────────────────────────────────────
const LOC_CLOSET   = 'Northeast closet room 1035-D';
const LOC_CABINETS = 'Northeast cabinets by door 1041';
const LOC_HP_ROW   = 'east HP computer row';
const LOC_SHELVES  = 'south shelves';
const LOC_TOOLBOX  = 'southeast toolbox';
const LOC_NETWORK  = 'networking closet';

// ── Guard: prevent double-tagging ──────────────────────────────────────────
const guard = db.prepare(
  "SELECT id FROM equipment WHERE notes LIKE '%seed-inventory-v3-2026%' LIMIT 1"
).get();
if (guard) {
  console.log('Inventory v3 location update already applied (guard row found).');
  process.exit(0);
}

let updated = 0;

function upd(sql, loc) {
  const info = db.prepare(sql).run(loc);
  updated += info.changes;
}

// ── Run everything in one transaction ──────────────────────────────────────
const applyLocations = db.transaction(() => {

  // ====================================================================
  // PASS 1 — Specific name-based overrides (most precise — run first so
  //          later category sweeps only touch truly unmatched rows)
  // ====================================================================

  // ── HP Compaq computers → east HP computer row ──────────────────────
  upd(`UPDATE equipment SET location = ? WHERE location = '' AND name LIKE 'HP Compaq%'`, LOC_HP_ROW);

  // ── Northeast closet room 1035-D (v1 seed: pages 1-3) ───────────────

  // Dell desktops / Raspberry Pi in the closet
  upd(`UPDATE equipment SET location = ?
       WHERE location = '' AND name IN (
         'Dell OptiPlex 790 Mid-Tower',
         'Dell OptiPlex 390 Mid-Tower',
         'Dell OptiPlex 790 Mini-Tower',
         'Dell OptiPlex 7010 Mid-Tower',
         'Dell OptiPlex 390',
         'Raspberry Pi'
       )`, LOC_CLOSET);

  // Corsair power supplies (individual serials in closet)
  upd(`UPDATE equipment SET location = ?
       WHERE location = '' AND name IN (
         'Corsair CX550M Power Supply',
         'Corsair CX650M Power Supply'
       )`, LOC_CLOSET);

  // KVM switches in closet
  upd(`UPDATE equipment SET location = ?
       WHERE location = '' AND name IN (
         'KVM Switch',
         'Trendnet Mount KVM Switch'
       )`, LOC_CLOSET);

  // Cases in closet
  upd(`UPDATE equipment SET location = ?
       WHERE location = '' AND name IN (
         'Kendomen ATX Case',
         'Tyrfing ATX Case'
       )`, LOC_CLOSET);

  // Loose GPU cards from pages 2-3 (unbranded, older models — in closet)
  upd(`UPDATE equipment SET location = ?
       WHERE location = '' AND name IN (
         'NVIDIA R128',
         'NVIDIA G210',
         'NVIDIA GT620',
         'NVIDIA GE420',
         'NVIDIA GT430',
         'NVIDIA G520',
         'NVIDIA GT630',
         'NVIDIA GT710',
         'NVIDIA GF8400',
         'NVIDIA 8400GS',
         'NVIDIA VT4350',
         'Radeon HD5450',
         'Radeon 6350',
         'Radeon R6450',
         'Radeon HD6670',
         'Radeon VT7000',
         'Pegatron HD6450',
         'Radeon VT4350',
         'DMI Digital Video Demo Card'
       )`, LOC_CLOSET);

  // Storage items from v1 that are in the closet
  upd(`UPDATE equipment SET location = ?
       WHERE location = '' AND name IN (
         'Dell DW316 USB DVD-RW Drive',
         'StarTech Storage System'
       )`, LOC_CLOSET);

  // Infrastructure in closet
  upd(`UPDATE equipment SET location = ?
       WHERE location = '' AND name IN (
         'Server Rack',
         'Equipment Rack',
         'VIVO UTP CAT5 Cable (500ft box)'
       )`, LOC_CLOSET);

  // Networking panel in closet (Port Panel from v1, not to be confused with Patch Panel)
  upd(`UPDATE equipment SET location = ?
       WHERE location = '' AND name = 'Port Panel'`, LOC_CLOSET);

  // Heat/cooling components from v1 (page 3)
  upd(`UPDATE equipment SET location = ?
       WHERE location = '' AND name IN (
         'Heat Sink',
         'CPU Fan'
       )`, LOC_CLOSET);

  // Cables specific to closet (v1 page 1-2 cables; category 'Cables')
  upd(`UPDATE equipment SET location = ?
       WHERE location = '' AND category = 'Cables' AND name IN (
         'Power Cord / Brick',
         'AC Adapter',
         'SATA Drive Cable',
         'SATA Cable',
         '24-Pin Power Cable',
         'SATA Power Cable',
         'PCIe Power Cable',
         'Molex Connector',
         'Pink SATA Cable',
         'AC Charger / Power'
       )`, LOC_CLOSET);

  // Components specific to closet (v1 pages 1-2)
  upd(`UPDATE equipment SET location = ?
       WHERE location = '' AND category = 'Components' AND name IN (
         'Power Supply (generic)',
         'HAJAAN'
       )`, LOC_CLOSET);

  // All PSU cable extensions (dedicated category only in v1)
  upd(`UPDATE equipment SET location = ?
       WHERE location = '' AND category = 'PSU Cables'`, LOC_CLOSET);

  // Adapters category only exists in v1 (DP-VGA, HDMI-VGA)
  upd(`UPDATE equipment SET location = ?
       WHERE location = '' AND category = 'Adapters'`, LOC_CLOSET);

  // Keyboard / mouse from v1 pages 1-2 that ended up in closet
  upd(`UPDATE equipment SET location = ?
       WHERE location = '' AND name IN (
         'Keyboard (unmarked)',
         'Key Tonic Keyboard',
         'SunsetMicro Mouse'
       )`, LOC_CLOSET);

  // ====================================================================
  // PASS 2 — Category sweeps for v2 pages 29-35
  //          (Northeast cabinets by door 1041)
  //          Only items still location='' reach here
  // ====================================================================

  upd(`UPDATE equipment SET location = ? WHERE location = '' AND category = 'Motherboards'`, LOC_CABINETS);
  upd(`UPDATE equipment SET location = ? WHERE location = '' AND category = 'CPUs'`, LOC_CABINETS);
  upd(`UPDATE equipment SET location = ? WHERE location = '' AND category = 'RAM'`, LOC_CABINETS);

  // Remaining GPUs after loose-card update (MSI, VisionTek, EVGA, Sapphire etc.)
  upd(`UPDATE equipment SET location = ? WHERE location = '' AND category = 'GPUs'`, LOC_CABINETS);

  // Remaining Storage after Dell DW316 / StarTech (HDDs, SSDs, NVMe from pages 31-32)
  upd(`UPDATE equipment SET location = ? WHERE location = '' AND category = 'Storage'`, LOC_CABINETS);

  // ====================================================================
  // PASS 3 — south shelves (v2 pages 51-61)
  // ====================================================================

  upd(`UPDATE equipment SET location = ? WHERE location = '' AND category = 'Monitors'`, LOC_SHELVES);
  upd(`UPDATE equipment SET location = ? WHERE location = '' AND category = 'Books'`, LOC_SHELVES);
  upd(`UPDATE equipment SET location = ? WHERE location = '' AND category = 'Peripherals'`, LOC_SHELVES);
  upd(`UPDATE equipment SET location = ? WHERE location = '' AND category = 'Media'`, LOC_SHELVES);
  upd(`UPDATE equipment SET location = ? WHERE location = '' AND category = 'Supplies'`, LOC_SHELVES);
  upd(`UPDATE equipment SET location = ? WHERE location = '' AND category = 'Empty Boxes'`, LOC_SHELVES);

  // ====================================================================
  // PASS 4 — southeast toolbox (page 47)
  // ====================================================================

  upd(`UPDATE equipment SET location = ? WHERE location = '' AND category = 'Tools'`, LOC_TOOLBOX);

  // ====================================================================
  // PASS 5 — networking closet (page 59 — rack-mounted infrastructure)
  // ====================================================================

  upd(`UPDATE equipment SET location = ? WHERE location = '' AND category = 'Infrastructure'`, LOC_NETWORK);

  // ====================================================================
  // PASS 6 — remaining category sweeps (south shelves default)
  // ====================================================================

  // Cables that weren't named above (v2 batch cables, SATA, ethernet, etc.)
  upd(`UPDATE equipment SET location = ? WHERE location = '' AND category = 'Cables'`, LOC_SHELVES);

  // Components not already placed (spare fans, shields, PSUs from v2)
  upd(`UPDATE equipment SET location = ? WHERE location = '' AND category = 'Components'`, LOC_SHELVES);

  // Networking gear from shelves (routers, switches, NICs from pages 54-61)
  upd(`UPDATE equipment SET location = ? WHERE location = '' AND category = 'Networking'`, LOC_SHELVES);

  // Remaining computers (Dell laptops, Lenovo, misc desktops from page 52)
  upd(`UPDATE equipment SET location = ? WHERE location = '' AND category = 'Computers'`, LOC_SHELVES);

  // ====================================================================
  // PASS 7 — catch-all for anything still unset
  // ====================================================================

  upd(`UPDATE equipment SET location = ? WHERE location = ''`, LOC_SHELVES);

  // ── Guard tag ────────────────────────────────────────────────────────────
  db.prepare(
    "UPDATE equipment SET notes = notes || ' [seed-inventory-v3-2026]' WHERE id = (SELECT MAX(id) FROM equipment)"
  ).run();
});

// ── Execute ─────────────────────────────────────────────────────────────────
console.log('Applying location data to CIS inventory (v3)...');
applyLocations();
console.log(`Done! Updated ${updated} item(s) with location data.`);
console.log('');
console.log('Location mapping applied:');
console.log(`  ${LOC_CLOSET}   ← v1 items (pages 1-3)`);
console.log(`  ${LOC_CABINETS} ← v2 Motherboards, CPUs, RAM, GPUs, Storage`);
console.log(`  ${LOC_HP_ROW}             ← v2 HP Compaq computers`);
console.log(`  ${LOC_SHELVES}                      ← v2 Peripherals, Books, Cables, etc.`);
console.log(`  ${LOC_TOOLBOX}               ← v2 Tools`);
console.log(`  ${LOC_NETWORK}               ← v2 Infrastructure`);
