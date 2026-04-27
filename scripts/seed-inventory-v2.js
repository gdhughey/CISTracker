'use strict';
/**
 * seed-inventory-v2.js
 *
 * Imports additional CIS Spring Inventory 2026 items (pages 29-61 of the
 * UPDATED PDF) into the equipment table.  The original seed-inventory.js
 * covered pages 1-3; this script adds everything else.
 *
 *   cd /opt/CISTracker && node scripts/seed-inventory-v2.js
 *
 * Safe to re-run -- items with serial numbers are deduped, and a guard row
 * prevents double-importing bulk items.
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

// Compute the next CIS-NNNNNN barcode (continues from max existing)
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
  // Items with serial numbers -- one row each, deduped by serial
  if (serial) {
    if (findBySerial.get(serial)) {
      skipped++;
      return;
    }
    insertEquipment.run(name, type, serial, nextAssetId(), category, notes);
    inserted++;
    return;
  }

  // Bulk items (no serial) -- create `qty` individual rows
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
  "SELECT id FROM equipment WHERE notes LIKE '%seed-inventory-v2-2026%' LIMIT 1"
).get();
if (guard) {
  console.log('Inventory v2 already seeded (guard row found). To re-import, delete existing items first.');
  process.exit(0);
}

// ------------------------------------------------------------------
// Begin import inside a transaction for speed + atomicity
// ------------------------------------------------------------------
const importAll = db.transaction(() => {

  // ================================================================
  //  MOTHERBOARDS (Page 29)
  // ================================================================

  // ASRock 760GM-HDV Micro ATX -- 19 boards
  const asrock760Serials = [
    '9AM0XB253640', '9AM0X253793', '9AM0XB253840', '9AM0XB253788',
    '9AM0XB253639', '9AM0XB253838', '9AM0XB253626', '9AM0XB253635',
    '9AM0XB253787', '9AM0XB253782', '9AM0XB253791', '9AM0XB253800',
    '9AM0XB253634', '9AM0XB253794', '9AM0XB253637', '9AM0XB253837',
    '9AM0XB253789', '9AM0XB253839', '9AM0XB253786',
  ];
  for (const sn of asrock760Serials) {
    addItem('ASRock 760GM-HDV', { serial: sn, category: 'Motherboards', type: 'Micro ATX' });
  }

  // GIGABYTE Service Care ATX -- 4 boards (third is Micro ATX)
  const gigabyteServiceCareSerials = ['408D5C10D69F', '94DE800BAADB', '74D435B4ED37', '1C1B0D90E0CD'];
  for (let i = 0; i < gigabyteServiceCareSerials.length; i++) {
    const mbType = (i === 2) ? 'Micro ATX' : 'ATX';
    addItem('GIGABYTE Service Care', {
      serial: gigabyteServiceCareSerials[i], category: 'Motherboards', type: mbType,
    });
  }

  // GIGABYTE Ultra Durable 970A-D33P ATX -- 7 boards
  const gigabyte970aSerials = [
    'E0D55E75A250', 'E0D55E759658', 'FCAA149A7EE5', 'eod55e732c02',
    '1c1b0dd57ec1', 'E0D55ED33AC7', 'E0D55E37ED8D',
  ];
  for (let i = 0; i < gigabyte970aSerials.length; i++) {
    const n = (i === gigabyte970aSerials.length - 1)
      ? 'Has 2 sticks of 8GB RAM, and CPU + heatsink/fan'
      : '';
    addItem('GIGABYTE Ultra Durable 970A-D33P', {
      serial: gigabyte970aSerials[i], category: 'Motherboards', type: 'ATX', notes: n,
    });
  }

  // Z97 PC Mate ATX
  addItem('Z97 PC Mate', { serial: '448A5BC00A85', category: 'Motherboards', type: 'ATX', notes: 'No box' });

  // ASUS F2A55-MLK Micro ATX
  addItem('ASUS F2A55-MLK', { serial: '047653-01465-MB0CV0-A19', category: 'Motherboards', type: 'Micro ATX', notes: 'No box' });

  // FM2-A85XA-G65 ATX
  addItem('FM2-A85XA-G65', { serial: 'D43D7E519D85', category: 'Motherboards', type: 'ATX', notes: 'No box' });

  // ASUS H61M-A/USB3 ATX -- no serial
  addItem('ASUS H61M-A/USB3', { qty: 1, category: 'Motherboards', type: 'ATX', notes: 'No box' });

  // MSI B350M GAMING PRO Micro ATX -- 4 boards
  addItem('MSI B350M GAMING PRO', { serial: '309C2302E545', category: 'Motherboards', type: 'Micro ATX', notes: 'Has AMD Ryzen 5 1600 installed' });
  addItem('MSI B350M GAMING PRO', { serial: '309C2322CC07', category: 'Motherboards', type: 'Micro ATX', notes: 'Has CPU + AMD Heatsink/Fan installed' });
  addItem('MSI B350M GAMING PRO', { serial: '309C2322CC04', category: 'Motherboards', type: 'Micro ATX' });
  addItem('MSI B350M GAMING PRO', { serial: '309C2322CC05', category: 'Motherboards', type: 'Micro ATX' });

  // MSI B85M-P33 -- empty box
  addItem('MSI B85M-P33', { qty: 1, category: 'Motherboards', type: 'Micro ATX', notes: 'EMPTY BOX - NO MOTHERBOARD' });

  // ================================================================
  //  GPUs WITH SERIALS (Page 29)
  // ================================================================

  // MSI NVIDIA GeForce GT 710 2GB DDR3 -- 13 units
  const gt710Serials = [
    '602-V809-Z758T1906001766', '602-V809-Z758T1906001767', '602-V809-Z758T1906001765',
    '602-V809-Z758T1906000651', '602-V809-Z758T1906001860', '602-V809-Z758T1906001858',
    '602-V809-Z758T1906001846', '602-V809-Z758T1906001850', '602-V809-Z758T1906001859',
    '602-V809-Z758T1906000657', '602-V809-711SD1709007388', '602-V809-Z758T1906001848',
    '602-V809-Z758T1906001768',
  ];
  for (const sn of gt710Serials) {
    addItem('MSI NVIDIA GeForce GT 710 2GB DDR3', { serial: sn, category: 'GPUs', type: 'Graphics Card' });
  }

  // MSI Radeon HD 6450 (R6450-MD1GD3/LP) -- 4
  const hd6450md1Serials = [
    '602-V212-510B1707000871', '602-V212-510B1707000865',
    '602-V809-1020SD1807000152', '602-V212-510B1707001324',
  ];
  for (const sn of hd6450md1Serials) {
    addItem('MSI Radeon HD 6450 (R6450-MD1GD3/LP)', { serial: sn, category: 'GPUs', type: 'Graphics Card' });
  }

  // MSI Radeon HD 6450 (R6450-2GD3H/LP) -- 6
  const hd64502gSerials = [
    '602-V809-1020SD1807000268', '602-V809-1020SD1807000574',
    '602-V809-1020SD1807000155', '602-V809-1020SD1807000270',
    '602-V809-1020SD1807000153', '602-V809-1020SD1807000572',
  ];
  for (const sn of hd64502gSerials) {
    addItem('MSI Radeon HD 6450 (R6450-2GD3H/LP)', { serial: sn, category: 'GPUs', type: 'Graphics Card' });
  }

  // VisionTek 5570 1GB PCIe -- 6
  const visiontek5570Serials = [
    'VG419020000090', 'VG319060000055', 'VG419020001',
    'VG319050000291', 'VG319060000105', 'VG418120000891',
  ];
  for (const sn of visiontek5570Serials) {
    addItem('VisionTek 5570 1GB PCIe', { serial: sn, category: 'GPUs', type: 'Graphics Card' });
  }

  // MSI Radeon R9 380 Gaming 4G
  addItem('MSI Radeon R9 380 Gaming 4G', { serial: '602-V314-070B1507001634', category: 'GPUs', type: 'Graphics Card' });

  // EVGA GeForce 210 1024MB DDR3 -- 2
  for (const sn of ['1710831313852459', '1610831313851355']) {
    addItem('EVGA GeForce 210 1024MB DDR3', { serial: sn, category: 'GPUs', type: 'Graphics Card' });
  }

  // Sapphire Radeon HD6450 1GB DDR3 -- 2
  for (const sn of ['A172500008973', 'A172500008988']) {
    addItem('Sapphire Radeon HD6450 1GB DDR3', { serial: sn, category: 'GPUs', type: 'Graphics Card' });
  }

  // ================================================================
  //  CPUs (Pages 29-30)
  // ================================================================

  // Intel Pentium E5200 -- 14
  const e5200Serials = [
    '2L9314', '2l93139', '2l92834', '2l93529', '2l92968', '2l93527', '2v91382',
    '2l91832', '2v94200', '2v83211', '3591914', '2l91017', '2l93529', '2l93529',
  ];
  for (const sn of e5200Serials) {
    addItem('Intel Pentium E5200', { serial: sn, category: 'CPUs', type: 'Processor' });
  }

  addItem('Intel Core i5-330s', { serial: '3233b666', category: 'CPUs', type: 'Processor' });

  // Intel Core i5-6400 -- 4
  for (const sn of ['x634b813', 'l547b500', 'x639b076', 'x634b819']) {
    addItem('Intel Core i5-6400', { serial: sn, category: 'CPUs', type: 'Processor' });
  }

  // Intel Celeron G1820 -- 4
  for (const sn of ['x609c440', 'x515c927', 'x515c927', 'x515c927']) {
    addItem('Intel Celeron G1820', { serial: sn, category: 'CPUs', type: 'Processor' });
  }

  addItem('Intel Core i3-3220', { serial: '3316b088', category: 'CPUs', type: 'Processor' });

  // Intel Celeron G1610 -- 2
  for (const sn of ['l226c066', '3339b212']) {
    addItem('Intel Celeron G1610', { serial: sn, category: 'CPUs', type: 'Processor' });
  }

  addItem('Intel Core i3-6100', { serial: 'x601c023', category: 'CPUs', type: 'Processor' });

  // AMD FX FD4300 -- 14
  const fd4300Serials = [
    '90u1029070453', '9gv8951070041', '9hb2651p80186', '9hb2628p80073',
    'y799904l30408', '9hb2628p80059', '9gt1972l60525', '9hb2651p80008',
    '9gt1972160918', '9hb2628p80329', 'y799904l30484', '9av8724l30117',
    '9hb2628p80074', '9gt1890l61376',
  ];
  for (const sn of fd4300Serials) {
    addItem('AMD FX FD4300', { serial: sn, category: 'CPUs', type: 'Processor' });
  }

  // AMD FX 4350 -- 4
  for (const sn of ['y884141h50111', 'y884141h5057', 'y884141h50547', 'y884141h50100']) {
    addItem('AMD FX 4350', { serial: sn, category: 'CPUs', type: 'Processor' });
  }

  addItem('AMD A6-5400', { serial: 'y723932d30056', category: 'CPUs', type: 'Processor' });

  // Intel Core i3-7100 -- 2
  for (const sn of ['x835e451', 'x835l451']) {
    addItem('Intel Core i3-7100', { serial: sn, category: 'CPUs', type: 'Processor' });
  }

  // AMD FX 4100 -- 4
  for (const sn of ['yn86916b30480', '9n86916b30042', '9n55786b30094', '9n56056b31125']) {
    addItem('AMD FX 4100', { serial: sn, category: 'CPUs', type: 'Processor' });
  }

  // AMD FX 8350 -- 4
  for (const sn of ['9ej6792b50436', '9ce0492b40786', '9ej6792b50963', '9ep2932c50903']) {
    addItem('AMD FX 8350', { serial: sn, category: 'CPUs', type: 'Processor' });
  }

  // AMD FX 6300 -- 8
  const fx6300Serials = [
    '9fl0633h50093', 'y868923c51244', '9gv6567p70355', '9f05903150642',
    '9gv9572p70076', '9gv9572p70099', '9gv9572p70073', '9fq5903i50643',
  ];
  for (const sn of fx6300Serials) {
    addItem('AMD FX 6300', { serial: sn, category: 'CPUs', type: 'Processor' });
  }

  // Intel Core i3-8100 -- 3
  for (const sn of ['x827f102', 'x840d927', 'x851b675']) {
    addItem('Intel Core i3-8100', { serial: sn, category: 'CPUs', type: 'Processor' });
  }

  // Intel Core2 E8400 -- 4
  for (const sn of ['q850a747', 'q921a425', 'q930a765', 'q921b735']) {
    addItem('Intel Core2 E8400', { serial: sn, category: 'CPUs', type: 'Processor' });
  }

  addItem('AMD Ryzen 3 1200', { serial: 'yd1200bbm4kae', category: 'CPUs', type: 'Processor' });
  addItem('Intel Core i3-4150', { serial: '3434b144', category: 'CPUs', type: 'Processor' });

  // AMD A10-5800 -- 2
  for (const sn of ['9n82152b30097', '9n82372b30135']) {
    addItem('AMD A10-5800', { serial: sn, category: 'CPUs', type: 'Processor' });
  }

  addItem('AMD Ryzen 5 1600', { serial: 'yd1600bbm6iae', category: 'CPUs', type: 'Processor' });

  // AMD A8-5500 -- 2
  for (const sn of ['9m08002l20676', '9m08002l20255']) {
    addItem('AMD A8-5500', { serial: sn, category: 'CPUs', type: 'Processor' });
  }

  // AMD A6-7400 -- 3
  for (const sn of ['9gu5195070212', '9gu5195070565', '9gu5195070207']) {
    addItem('AMD A6-7400', { serial: sn, category: 'CPUs', type: 'Processor' });
  }

  addItem('AMD A8-5600', { serial: '9cq0511d40478', category: 'CPUs', type: 'Processor' });
  addItem('AMD A4-5300', { serial: '9ha8109x70246', category: 'CPUs', type: 'Processor' });
  addItem('AMD FX 6100', { serial: '9s69394f30220', category: 'CPUs', type: 'Processor' });
  addItem('Intel Celeron G4900', { serial: 'x928h603', category: 'CPUs', type: 'Processor' });
  addItem('Intel Core2 Duo E7500', { serial: 'q928b899', category: 'CPUs', type: 'Processor' });
  addItem('Intel Core2 Duo E6550', { serial: '3839a637', category: 'CPUs', type: 'Processor' });
  addItem('Intel Core i5-2500', { serial: '3138a828', category: 'CPUs', type: 'Processor' });

  // Intel Celeron G3900 -- 3
  for (const sn of ['x717d827', 'x717d822', 'x717d827']) {
    addItem('Intel Celeron G3900', { serial: sn, category: 'CPUs', type: 'Processor' });
  }

  // AMD FX 9590 -- 6
  const fx9590Serials = [
    '9gs1293k60280', '9gs1293k60184', '9gu2699m70264',
    '9gu2699m70003', '9gu2683m70125', '9gu2699m70014',
  ];
  for (const sn of fx9590Serials) {
    addItem('AMD FX 9590', { serial: sn, category: 'CPUs', type: 'Processor' });
  }

  addItem('Intel Core2 Duo E8500', { serial: 'q001b530', category: 'CPUs', type: 'Processor' });
  addItem('Intel Pentium D 930', { serial: 'l616a678', category: 'CPUs', type: 'Processor' });
  addItem('Intel Core i3-7350K', { serial: 'l702d6s0', category: 'CPUs', type: 'Processor' });
  addItem('Intel Celeron G540', { serial: 'l228b138', category: 'CPUs', type: 'Processor' });
  addItem('Intel Pentium Dual-Core E2160', { serial: 'q745a896', category: 'CPUs', type: 'Processor' });

  // ================================================================
  //  BOXED CPUs (Page 30)
  // ================================================================

  addItem('Intel Core i3-7100 Boxed', { serial: 'x835e451', category: 'CPUs', type: 'Boxed Processor', notes: 'includes heatsink/fan' });

  // Intel Celeron G3900 Boxed -- 9 units
  addItem('Intel Celeron G3900 Boxed', { qty: 9, category: 'CPUs', type: 'Boxed Processor', notes: 'Boxed' });

  // Intel Celeron G4900 Boxed -- 9 units
  addItem('Intel Celeron G4900 Boxed', { qty: 9, category: 'CPUs', type: 'Boxed Processor', notes: 'Boxed' });

  // Intel Core i3-8100 Boxed -- 5 units
  addItem('Intel Core i3-8100 Boxed', { qty: 5, category: 'CPUs', type: 'Boxed Processor', notes: 'Boxed' });

  addItem('Intel Core i3-7350K Boxed', { serial: 'l706b057', category: 'CPUs', type: 'Boxed Processor' });

  // Empty CPU Boxes -- 8
  addItem('Empty CPU Box', { qty: 8, category: 'Empty Boxes', type: 'Empty Box' });

  // ================================================================
  //  RAM (Pages 30-31) -- No serials, individual rows
  // ================================================================

  // 512MB DDR2 sticks
  addItem('RAMAXEL 512MB DDR2', { qty: 10, category: 'RAM', type: 'DDR2' });
  addItem('ProMOS 512MB DDR2', { qty: 6, category: 'RAM', type: 'DDR2' });
  addItem('ELPIDA 512MB DDR2', { qty: 2, category: 'RAM', type: 'DDR2' });
  addItem('CENTON 512MB DDR2', { qty: 8, category: 'RAM', type: 'DDR2' });
  addItem('MEMORIA 512MB DDR2', { qty: 8, category: 'RAM', type: 'DDR2' });
  addItem('PAVILLION 512MB DDR2', { qty: 4, category: 'RAM', type: 'DDR2' });
  addItem('SAMSUNG 512MB DDR2', { qty: 12, category: 'RAM', type: 'DDR2' });
  addItem('PC2 512MB DDR2', { qty: 4, category: 'RAM', type: 'DDR2' });
  addItem('KINGSTON 512MB DDR2', { qty: 2, category: 'RAM', type: 'DDR2' });
  addItem('HYNIX 512MB DDR2', { qty: 1, category: 'RAM', type: 'DDR2' });

  // 1GB DDR2 sticks
  addItem('Pavillion 1GB DDR2', { qty: 1, category: 'RAM', type: 'DDR2' });
  addItem('Crucial 1GB DDR2', { qty: 3, category: 'RAM', type: 'DDR2' });
  addItem('Kingston (fat) 1GB DDR2', { qty: 3, category: 'RAM', type: 'DDR2' });
  addItem('Kingston (skinny) 1GB DDR2', { qty: 7, category: 'RAM', type: 'DDR2' });
  addItem('Elpida 1GB DDR2', { qty: 7, category: 'RAM', type: 'DDR2' });
  addItem('Hynix (green) 1GB DDR2', { qty: 17, category: 'RAM', type: 'DDR2' });
  addItem('Samsung 1GB DDR2', { qty: 18, category: 'RAM', type: 'DDR2' });
  addItem('Memoria 1GB DDR2', { qty: 18, category: 'RAM', type: 'DDR2' });
  addItem('Ramaxel 1GB DDR2', { qty: 14, category: 'RAM', type: 'DDR2' });
  addItem('Nanya 1GB DDR2', { qty: 4, category: 'RAM', type: 'DDR2' });
  addItem('Hynix (blue) 1GB DDR2', { qty: 2, category: 'RAM', type: 'DDR2' });
  addItem('Elpida (blue) 1GB DDR2', { qty: 6, category: 'RAM', type: 'DDR2' });

  // SODIMMs
  addItem('HYNIX 1GB SODIMM', { qty: 3, category: 'RAM', type: 'SODIMM' });
  addItem('SK HYNIX 4GB SODIMM', { qty: 1, category: 'RAM', type: 'SODIMM' });
  addItem('SAMSUNG 256MB SODIMM', { qty: 1, category: 'RAM', type: 'SODIMM' });
  addItem('SAMSUNG 512MB SODIMM', { qty: 2, category: 'RAM', type: 'SODIMM' });
  addItem('2GB SODIMM', { qty: 4, category: 'RAM', type: 'SODIMM' });
  addItem('CORSAIR SODIMM', { qty: 1, category: 'RAM', type: 'SODIMM' });
  addItem('KINGSTON 1GB SODIMM', { qty: 1, category: 'RAM', type: 'SODIMM' });
  addItem('KINGSTON 2GB SODIMM', { qty: 4, category: 'RAM', type: 'SODIMM' });
  addItem('CRUCIAL 1GB SODIMM', { qty: 4, category: 'RAM', type: 'SODIMM' });

  // 2GB DDR2 and additional DDR2
  addItem('KINGSTON 2GB DDR2', { qty: 4, category: 'RAM', type: 'DDR2' });
  addItem('HYNIX 2GB DDR2', { qty: 7, category: 'RAM', type: 'DDR2' });
  addItem('KINGSTON 2GB DDR2 Skinny', { qty: 21, category: 'RAM', type: 'DDR2' });
  addItem('A-TECH 2GB DDR2', { qty: 10, category: 'RAM', type: 'DDR2' });
  addItem('CENTON 2GB DDR2', { qty: 8, category: 'RAM', type: 'DDR2' });
  addItem('MEMORIA 512MB DDR2', { qty: 4, category: 'RAM', type: 'DDR2' });
  addItem('SAMSUNG 2GB DDR2', { qty: 4, category: 'RAM', type: 'DDR2' });
  addItem('SAMSUNG 512MB DDR2', { qty: 2, category: 'RAM', type: 'DDR2' });
  addItem('PAVILLION 512MB DDR2', { qty: 2, category: 'RAM', type: 'DDR2' });
  addItem('SUPER TALENT 1GB DDR2', { qty: 1, category: 'RAM', type: 'DDR2' });
  addItem('NANYA 512MB DDR2', { qty: 1, category: 'RAM', type: 'DDR2' });
  addItem('RAMAXEL 1GB DDR2', { qty: 2, category: 'RAM', type: 'DDR2' });
  addItem('ELPIDA 512MB DDR2', { qty: 3, category: 'RAM', type: 'DDR2' });
  addItem('ELPIDA 2GB DDR2', { qty: 1, category: 'RAM', type: 'DDR2' });
  addItem('1GB DDR2', { qty: 1, category: 'RAM', type: 'DDR2' });
  addItem('SEALED HYNIX 512MB DDR3', { qty: 6, category: 'RAM', type: 'DDR3' });

  // DDR3
  addItem('CRUCIAL 2GB DDR3', { qty: 18, category: 'RAM', type: 'DDR3' });
  addItem('NANYA 2GB DDR3', { qty: 2, category: 'RAM', type: 'DDR3' });
  addItem('KINGSTON 2GB DDR3', { qty: 6, category: 'RAM', type: 'DDR3' });
  addItem('SAMSUNG 2GB DDR3', { qty: 1, category: 'RAM', type: 'DDR3' });
  addItem('SUPER TALENT 2GB DDR3', { qty: 1, category: 'RAM', type: 'DDR3' });
  addItem('KINGSTON 4GB DDR3 Skinny', { qty: 24, category: 'RAM', type: 'DDR3' });
  addItem('CORSAIR VENGEANCE 8GB DDR3', { qty: 8, category: 'RAM', type: 'DDR3' });
  addItem('ADATA 4GB DDR3', { qty: 6, category: 'RAM', type: 'DDR3' });
  addItem('RIPJAWS X 8GB DDR3', { qty: 10, category: 'RAM', type: 'DDR3' });
  addItem('XMS3 4GB DDR3', { qty: 3, category: 'RAM', type: 'DDR3' });
  addItem('BALLISTIX 4GB DDR3', { qty: 2, category: 'RAM', type: 'DDR3' });
  addItem('SAMSUNG 4GB DDR3', { qty: 1, category: 'RAM', type: 'DDR3' });
  addItem('CORSAIR VENGEANCE 16GB DDR3', { qty: 15, category: 'RAM', type: 'DDR3' });
  addItem('PNY 8GB DDR3', { qty: 5, category: 'RAM', type: 'DDR3' });
  addItem('XPG ADATA 8GB DDR3', { qty: 1, category: 'RAM', type: 'DDR3' });
  addItem('KINGSTON 8GB DDR3', { qty: 5, category: 'RAM', type: 'DDR3' });

  // DDR4
  addItem('BALLISTIX 8GB DDR4', { qty: 4, category: 'RAM', type: 'DDR4' });
  addItem('HYPERX FURY 16GB DDR4', { qty: 5, category: 'RAM', type: 'DDR4' });

  // ================================================================
  //  DISK DRIVES / SSDs (Pages 31-32)
  // ================================================================

  // ADATA SSD (no serial) -- 14
  addItem('ADATA SSD', { qty: 14, category: 'Storage', type: 'SSD' });

  // Dell drives
  for (const sn of ['S0K1T0AK', 'S0K2FQSM', 'WXE1E11PZT86']) {
    addItem('Dell Hard Drive', { serial: sn, category: 'Storage', type: 'Hard Drive' });
  }

  // Hitachi
  for (const sn of ['080510DP0B30DQGVJ5TP', 'SGHYE3GB', 'KGDWP2BE', 'SB22DBKGFLHGRN']) {
    addItem('Hitachi Hard Drive', { serial: sn, category: 'Storage', type: 'Hard Drive' });
  }

  // Kingston SSD (no serial) -- 4
  addItem('Kingston SSD', { qty: 4, category: 'Storage', type: 'SSD' });

  // PNY SSD (no serial) -- 1
  addItem('PNY SSD', { qty: 1, category: 'Storage', type: 'SSD' });

  // Seagate
  for (const sn of ['5NH1BD71', '5LY4PSA8', '5LY78KSB', '5VC1DA7', '5LY79M7Z']) {
    addItem('Seagate Hard Drive', { serial: sn, category: 'Storage', type: 'Hard Drive' });
  }

  // Toshiba drives
  const toshibaSerials = [
    '779QT4CNT', '961Y2296S', '95065293T', '32Q0T0JJT', '72JEC0X7T',
    '32Q0T0JKT', '18ESTCJ5T', '188CTEI9T', 'Y7L0T09GT', '22F3C1DJT',
    'MQ01ABD050', '570MT02FT', '424UC1H1T', '832ESZYFS', '832ES02DS',
    '832ESZYUS', '832ESZYJS', '832ES01QS', '832ES032S', '832ESZZES',
    '832ESZYGS', '832ESZYHS', '832ES00IS', '832ES00NS', '832ESZY9S',
    '832ES02MS', '832ESZZKS', '832ESZYZS',
  ];
  for (const sn of toshibaSerials) {
    addItem('Toshiba Hard Drive', { serial: sn, category: 'Storage', type: 'Hard Drive' });
  }

  // Transcend SSD370S
  const transcendSerials = [
    'C43451-0101', 'E93003-0940', 'E93003-0932', 'E93003-0959', 'E93003-0965',
    'E93003-1039', 'E93003-1038', 'E93003-0682', 'E93003-1037', 'E93003-0938',
    'E93003-0990', 'E93003-0991', 'E93003-1044', 'E93003-0993', 'E93003-1035',
    'E96174-0706', 'E89894-1239', 'E96174-0715', 'E80122-0638', 'E75883-0841',
    'C43451-0052', 'C43451-0110', 'C43451-0143', 'C43451-0068', 'C43451-0249',
    'C43451-0111', 'C43451-0126', 'C43451-0114', 'C43451-0128', 'C43451-0105',
    'C43451-0222', 'C43451-0201',
  ];
  for (const sn of transcendSerials) {
    addItem('Transcend SSD370S', { serial: sn, category: 'Storage', type: 'SSD' });
  }

  // Ultra Plus SSD
  addItem('Ultra Plus SSD', { serial: '130504400119', category: 'Storage', type: 'SSD' });

  // WD Blue SSD
  const wdBlueSsdSerials = [
    '171804423656', '171804421752', '174539804730', '174539806979',
    '174539805989', '174539802053', '171804433583', '174539802390',
    '174539802128', 'WXA1A33K1180', 'WXE1E13DZXV8', 'WXE1E13DMDK6',
    'WXE1E13DMLT8', 'WXE1E13DJTJ2', 'WXE1E13AYMA2', 'WXE1E13EZPZ7',
  ];
  for (const sn of wdBlueSsdSerials) {
    addItem('WD Blue SSD', { serial: sn, category: 'Storage', type: 'SSD' });
  }

  // WD Scorpio
  const wdScorpioSerials = [
    'WXC408068178', 'WXC108351091', 'WXEX08RYL523', 'WXE608NY7457',
    'WXR0E99VHA64', 'WX91A4132501', 'WXBAA1174774', 'WX31A33P4817',
    'WX51A43L0956',
  ];
  for (const sn of wdScorpioSerials) {
    addItem('WD Scorpio', { serial: sn, category: 'Storage', type: 'Hard Drive' });
  }

  // Western Digital HDD
  const wdHddSerials = [
    'WCAP93139635', 'WMAP94426242', 'WMAP9F144021', 'WCAT16558817',
    'WCAPZ2087351', 'WCAPZ1747683', 'WMAP9E126561', 'WMA8H4060345',
    'WCAV3F316410', 'WCAV3F317433', 'WCAATF098230', 'WCAPD4281340',
    'WCAM9H985463',
  ];
  for (const sn of wdHddSerials) {
    addItem('Western Digital HDD', { serial: sn, category: 'Storage', type: 'Hard Drive' });
  }

  // Misc HDDs
  addItem('Toshiba HDD', { serial: '732JPETGS', category: 'Storage', type: 'Hard Drive' });

  // Hitachi HDD -- 11
  const hitachiHddSerials = [
    'JQ3B012K', 'MM2VJZEC', 'MM2PV1WC', 'MM1TU6UA', 'MM33W52C',
    'HV1YBTDA', 'HV2ZD5JH', 'JQ3D9LPK', 'HV0AT2XE', 'JQ2BYWNH', 'JQ271XLK',
  ];
  for (const sn of hitachiHddSerials) {
    addItem('Hitachi HDD', { serial: sn, category: 'Storage', type: 'Hard Drive' });
  }

  // Seagate HDD -- 16
  const seagateHddSerials = [
    '5RX8AAHT', '9RXN9S46', '9RX4GHV3', '9RX18G3V', '9RX6BZX6',
    '9RXNDBGP', '6VY12W8Q', '5YD4YXQ5', '9RX5W1EF', '9RX4J68F',
    '9RX4GTQY', '3HS0EWA2', '3QD1GENZ', '3QD0Z285', '5QD2KA19', '9VY1C85T',
  ];
  for (const sn of seagateHddSerials) {
    addItem('Seagate HDD', { serial: sn, category: 'Storage', type: 'Hard Drive' });
  }

  addItem('Maxtor HDD', { serial: 'Y27TYWWC', category: 'Storage', type: 'Hard Drive' });
  addItem('Samsung HDD', { serial: 'S1V3J9DS603308', category: 'Storage', type: 'Hard Drive' });
  addItem('Toshiba HDD', { serial: '732K4HTAS', category: 'Storage', type: 'Hard Drive' });
  addItem('Toshiba HDD', { serial: '732KMRDGS', category: 'Storage', type: 'Hard Drive' });

  // NVMe drives
  addItem('KINGSTON NVMe Memory', { qty: 11, category: 'Storage', type: 'NVMe' });
  addItem('ELPIDA NVMe', { qty: 1, category: 'Storage', type: 'NVMe' });

  // Intel Optane NVMe -- 3
  for (const sn of ['PHBT723000VG032E', 'PHBT817400LL032E', 'PHBT723000XL032E']) {
    addItem('Intel Optane NVMe', { serial: sn, category: 'Storage', type: 'NVMe' });
  }

  // ================================================================
  //  HP COMPAQ SYSTEMS (Pages 36-38)
  // ================================================================

  // Each entry: [sticker, serial, suffix]
  // suffix is '' for first, '-B' for second, '-C' for third with same sticker
  const hpCompaqSystems = [
    ['1', '2UA9150BWQ', ''],
    ['1', '2UA0010S5B', '-B'],
    ['2', '2UA9280042', ''],
    ['2', '2UA9511JC2', '-B'],
    ['3', 'NL014UC#ABA', ''],
    ['3', 'JPA00401ZY', '-B'],
    ['3', '2UA9150BWD', '-C'],
    ['4', 'mxl95300xx', ''],
    ['5', 'mxl9450kfz', ''],
    ['5', '2UA92504PH', '-B'],
    ['5', 'MXL94215QZ', '-C'],
    ['6', 'MXL9450P3Q', ''],
    ['6', 'MXL935188D', '-B'],
    ['7', '2UA94315VG', ''],
    ['7', '2ua9150bxj', '-B'],
    ['8', 'mxl9371cvl', ''],
    ['9', 'mxl93207p3', ''],
    ['9', '2UA95116VX', '-B'],
    ['10', 'MXL9530013', ''],
    ['10', 'MXL94117ZQ', '-B'],
    ['10', 'MXL94505BN', '-C'],
    ['11', 'mxl9290rkq', ''],
    ['11', 'MXL9411860', '-B'],
    ['12', 'MXL9270X9C', ''],
    ['12', '2UA9251N11', '-B'],
    ['13', 'MXL9450P68', ''],
    ['13', '2UA94608SX', '-B'],
    ['14', 'MXL912031T', ''],
    ['14', '2ua9310628', '-B'],
    ['15', 'mxl9371cdd', ''],
    ['15', '2UA912077C', '-B'],
    ['16', 'mxl0030blt', ''],
    ['16', '2UA9430WQ8', '-B'],
    ['17', 'MXL95205Z1', ''],
    ['17', 'MXL9411894', '-B'],
    ['18', 'MXL941183G', ''],
    ['19', '2ua9130fjy', ''],
    ['19', 'MXL94118BT', '-B'],
    ['20', 'MLX94118B0', ''],
    ['20', '2UA9040QGQ', '-B'],
    ['21', 'MXL93008S1', ''],
    ['21', '2ua916030j', '-B'],
    ['22', 'MXL91604BL', ''],
    ['22', '2UA94608SS', '-B'],
    ['23', '2ua0070227', ''],
    ['23', '2UA9310DCC', '-B'],
    ['24', '2ua9240znc', ''],
    ['24', 'MXL00509B4', '-B'],
    ['25', '2UA949083K', ''],
    ['25', '2ua9310d8c', '-B'],
    ['26', 'mxl94521f1', ''],
    ['26', '2UA9200KXZ', '-B'],
    ['27', '2UA949056J', ''],
    ['27', '2UA942043X', '-B'],
    ['27', '2UA9240ZMW', '-C'],
    ['28', 'MXL94118BR', ''],
    ['29', '2UA9431520', ''],
    ['29', 'MXL9350Y1Z', '-B'],
    ['30', 'MXL92408LH', ''],
    ['31', '2UA9511JDK', ''],
    ['31', 'Mxl9450XTT', '-B'],
    ['32', '2ua00113v7', ''],
    ['32', 'MXL9411C8T', '-B'],
    ['33', 'MXL94215MD', ''],
    ['33', 'MXL91908ZZ', '-B'],
    ['34', '2UA95111LP', ''],
    ['34', 'MXL9370Y5M', '-B'],
    ['34', '2UA9150BY6', '-C'],
    ['35', '2UA937029D', ''],
    ['35', 'MXL94215SG', '-B'],
    ['36', 'MXL9411C39', ''],
    ['36', '2ua9490f5l', '-B'],
    ['37', 'MXL94713DZ', ''],
    ['37', '2UA949148K', '-B'],
    ['38', 'MXL92814WG', ''],
    ['39', 'MXL91604BP', ''],
    ['39', 'MXL9450WV0', '-B'],
    ['40', 'MXL9520CN4', ''],
    ['41', 'MXL9411C7T', ''],
    ['42', '2ua9150bwb', ''],
    ['42', 'MXL9450XVM', '-B'],
    ['44', '2ua94006yx', ''],
    ['45', '2UA9150BWH', ''],
    ['46', 'MXL9270X0L', ''],
    ['47', '2ua0050595', ''],
    ['48', '2UA9140YNY', ''],
    ['49', 'MXL91180Y', ''],
    ['50', 'MXL9160484', ''],
    ['51', 'MXL9411865', ''],
    ['52', '2UA91109TZ', ''],
    ['53', 'MXL9450KM6', ''],
    ['54', 'MXL92806J8', ''],
    ['55', 'MXL941183H', ''],
    ['56', 'MXL9421BD9', ''],
    ['57', 'MXL9411C3M', ''],
    ['58', 'MXL9450XQP', ''],
    ['59', 'MXL9411829', ''],
    ['60', 'MXL94117Z9', ''],
    ['61', 'MXL93518GV', ''],
    ['62', 'MXL9450KDM', ''],
    ['63', '2ua94006yx', ''],
    ['64', '7440902KKW2CN8', ''],
    ['65', 'MXL9260F95', ''],
    ['66', '2UA8220V5K', ''],
    ['67', '2UA928002F', ''],
    ['68', 'MXL93008S6', ''],
    ['69', '2ua9140brc', ''],
    ['70', 'MXL9270X27', ''],
    ['71', 'MXL0030F37', ''],
    ['72', 'MXL95205JC', ''],
    ['73', 'MXL9270XF1', ''],
    ['74', 'MXL9411839', ''],
    ['75', '2ua9040qmv', ''],
    ['76', 'MXL9351639', ''],
    ['77', 'MXL9350Y4C', ''],
    ['78', '2UA9090RJW', ''],
    ['79', 'MXL9270X3B', ''],
    ['80', 'MXL9520578', ''],
    ['81', '2UA91902W9', ''],
    ['82', '2UA9070J6W', ''],
    ['84', '2UA9150BTF', ''],
    ['85', 'MXL9320YSJ', ''],
    ['86', 'MXL9320VMP', ''],
    ['87', 'MXL95300XG', ''],
    ['88', '2UA9451GZ8', ''],
    ['89', 'MXL94505C6', ''],
    ['90', '2UA91302PS', ''],
    ['91', 'MXL8200KH2', ''],
    ['93', 'MXL002189Y', ''],
    ['94', '2UA9430WQ8', ''],
    ['94', 'MXL9520HGQ', '-B'],
    ['95', 'MXL94118D2', ''],
    ['96', '2UA9120776', ''],
    ['97', 'MXL9520H9Q', ''],
    ['98', 'MXL94717NW', ''],
    ['98', '2ua93106YS', '-B'],
    ['98', 'MXL92806H6', '-C'],
    ['99', '2UA9420KYD', ''],
    ['100', 'MXL9411C3H', ''],
    ['101', 'MXL94505BV', '', 'Was in system restore mode'],
    ['102', 'mxl94118cf', ''],
    ['102', '2UA9420444', '-B'],
    ['103', 'MXL94503M5', ''],
    ['104', 'MXL0030BD7', ''],
    ['105', 'MXL9470YWW', ''],
    ['L102', 'mxl94118db', ''],
  ];

  for (const entry of hpCompaqSystems) {
    const sticker = entry[0];
    const serial = entry[1];
    const suffix = entry[2];
    const extraNotes = entry[3] || '';
    const displayName = `HP Compaq #${sticker}${suffix}`;
    addItem(displayName, {
      serial: serial,
      category: 'Computers',
      type: 'Desktop',
      notes: extraNotes,
    });
  }

  // ================================================================
  //  MONITORS (Page 52)
  // ================================================================

  const hpLV1911Serials = [
    '6CM31223SH', '6CM31228ZS', '6CM30214QX', '6CM312291Y', '6CM30215PS',
    '6CM31228ZN', '6CM31228ZT', '6CM31228ZW', '6CM30216SX', '6CM30215PK',
    '6CM30214R0',
  ];
  for (const sn of hpLV1911Serials) {
    addItem('HP LV1911 Monitor', { serial: sn, category: 'Monitors', type: 'Monitor' });
  }

  addItem('Samsung SyncMaster S20B350', { serial: 'Z4W8HCLC603657J', category: 'Monitors', type: 'Monitor' });

  // ================================================================
  //  BOOKS (Page 52)
  // ================================================================

  addItem('CompTIA A+ Cert Guide 11th Ed', { qty: 8, category: 'Books', type: 'Textbook' });
  addItem('CompTIA Network+ N10-008 8th Ed', { qty: 8, category: 'Books', type: 'Textbook' });
  addItem('CompTIA Security+ 5th Ed', { qty: 9, category: 'Books', type: 'Textbook' });
  addItem('CompTIA Security+ 3rd Ed', { qty: 1, category: 'Books', type: 'Textbook' });
  addItem('Windows Server 2008 Pocket Consultant 2nd Ed', { qty: 3, category: 'Books', type: 'Textbook' });
  addItem('EXAMCRAM Security+ SY0-301', { qty: 1, category: 'Books', type: 'Textbook' });
  addItem('CompTIA Security+ SY0-301 Study Guide', { qty: 1, category: 'Books', type: 'Textbook' });
  addItem('CompTIA Security+ SY0-301 Get Ahead', { qty: 2, category: 'Books', type: 'Textbook' });
  addItem('MCSA Windows Server 2016 Study Guide', { qty: 10, category: 'Books', type: 'Textbook' });
  addItem('Mike Meyers A+ Guide 801', { qty: 1, category: 'Books', type: 'Textbook' });
  addItem('Mike Meyers A+ Guide 801 Full Color', { qty: 1, category: 'Books', type: 'Textbook' });
  addItem('Mike Meyers A+ Guide 802 Full Color', { qty: 1, category: 'Books', type: 'Textbook' });
  addItem('CCNA 2 Companion Guide', { qty: 1, category: 'Books', type: 'Textbook' });
  addItem('Ubuntu Unleashed 2016', { qty: 1, category: 'Books', type: 'Textbook' });
  addItem('CCNA All In One For Dummies', { qty: 1, category: 'Books', type: 'Textbook' });
  addItem('CCNA 1 and 2 Companion Guide 3rd Ed', { qty: 1, category: 'Books', type: 'Textbook' });
  addItem('CCNA 3 and 4 Companion Guide 3rd Ed', { qty: 1, category: 'Books', type: 'Textbook' });
  addItem('Cisco CCNA R&S 200-120 Official Cert Guide', { qty: 3, category: 'Books', type: 'Textbook' });

  // ================================================================
  //  PERIPHERALS (Pages 52-53)
  // ================================================================

  // Keyboard Lenovo -- 26 with serials
  const lenovoKbSerials = [
    '1649665', '0611445', '1873841', '1695757', '3779193', '1795818',
    '1378441', '1010675', '1101546', '0001248', '0507266', '0803688',
    '2138188', '1951281', '3981146', '1352931', '1333654', '3481922',
    '0091719', '0897832', '01102585', '1669029', '1813242', '01165833',
    '1951319', '3727240',
  ];
  for (const sn of lenovoKbSerials) {
    addItem('Keyboard Lenovo', { serial: sn, category: 'Peripherals', type: 'Keyboard' });
  }

  // Keyboard Dell -- 17 with serials
  const dellKbSerials = [
    '0081N8-LO300-295-G2HO-A02', '0RKR0N-71616-689-22IB-A03',
    '0081N8-LO300-295-G2HL-A02', '0081N8-LO300-29C-0AFK-A01',
    '0081N8-LO300-295-G0SB-A02', '0RKR0N-LO300-79S-0SIE-A03',
    '0081N8-LO300-295-0BTB-A01', '0RKR0N-71616-689-21IX-A03',
    '0RKR0N-71616-67S-02TF-A03', '0081N8-LO300-295-G2HN-A02',
    '0RKR0N-71616-689-22CQ-A03', '0RKR0N-71616-689-24QL-A03',
    '0081N8-LO300-295-G0TT-A02', '0RKR0N-71616-67U-0HLS-A03',
    '0081N8-LO300-295-G2HT-A02', '0081N8-LO300-295-G2HH-A02',
    '0081N8-LO300-295-G2HZ-A02',
  ];
  for (const sn of dellKbSerials) {
    addItem('Keyboard Dell', { serial: sn, category: 'Peripherals', type: 'Keyboard' });
  }

  addItem('Keyboard Logitech', { qty: 1, category: 'Peripherals', type: 'Keyboard' });
  addItem('Keyboard HAJAAN', { qty: 5, category: 'Peripherals', type: 'Keyboard', notes: 'w/ broken keys' });
  addItem('Keyboard Key Tronic', { serial: 'C124500214', category: 'Peripherals', type: 'Keyboard', notes: 'PS2 connector' });
  addItem('Keyboard (no brand, broken)', { qty: 5, category: 'Peripherals', type: 'Keyboard', notes: 'Missing keys, frayed wires' });
  addItem('Keyboard (no brand)', { serial: 'IMJS013121009810', category: 'Peripherals', type: 'Keyboard' });

  // Mouse Dell -- 10 with serials
  const dellMouseSerials = [
    '009NK2-73826-682-07V7', '065K5F-LO300-2AH-0I3N', '0DV0RH-LO300-79T-058M',
    '009NK2-73826-67U-0D6Q', '009NK2-73826-686-1TLS', '009NK2-73826-686-1U2R',
    '009NK2-73826-686-1UON', '0DV0RH-L030-70Y-T012A', '065K5F-LO300-2AH-0J0P',
    'HC7470C0CEV',
  ];
  for (const sn of dellMouseSerials) {
    addItem('Mouse Dell', { serial: sn, category: 'Peripherals', type: 'Mouse' });
  }

  addItem('Mouse Dell', { serial: 'HC8200B0XKH', category: 'Peripherals', type: 'Mouse' });
  addItem('Mouse Dell', { serial: 'CN-065KSF-LO300-2AH-0HXP', category: 'Peripherals', type: 'Mouse' });
  addItem('Mouse Gear Head', { qty: 5, serial: '111157-109283', category: 'Peripherals', type: 'Mouse' });
  addItem('Mouse HAJAAN', { qty: 1, category: 'Peripherals', type: 'Mouse' });
  addItem('Mouse HP', { serial: 'FATSK0JUJZCFJO', category: 'Peripherals', type: 'Mouse' });

  // Mouse Key Tronic (PS2) -- 2
  for (const sn of ['1151002747', '1151002741']) {
    addItem('Mouse Key Tronic (PS2)', { serial: sn, category: 'Peripherals', type: 'Mouse' });
  }

  // Mouse Key Tronic -- 3
  for (const sn of ['1151000568', '1151000040', '1151002642']) {
    addItem('Mouse Key Tronic', { serial: sn, category: 'Peripherals', type: 'Mouse' });
  }

  // Mouse Logitech -- 3
  for (const sn of ['1310HS02LFG8', '810-001243', '831087-A000']) {
    addItem('Mouse Logitech', { serial: sn, category: 'Peripherals', type: 'Mouse' });
  }

  addItem('Mouse (no brand)', { qty: 23, category: 'Peripherals', type: 'Mouse' });
  addItem('Mouse Sunset Micro', { qty: 3, category: 'Peripherals', type: 'Mouse' });

  // Mouse SYX Systemax -- 11
  const syxMouseSerials = [
    '120402213', '120402229', '120402027', '120402220', '120402227',
    '120402284', '120402246', '120402209', '120402035', '120402235', '120402297',
  ];
  for (const sn of syxMouseSerials) {
    addItem('Mouse SYX Systemax', { serial: sn, category: 'Peripherals', type: 'Mouse' });
  }

  // Headsets
  addItem('Headset (generic)', { qty: 17, category: 'Peripherals', type: 'Headset' });
  addItem('Headset KOSS', { qty: 3, category: 'Peripherals', type: 'Headset' });
  addItem('Headset Panasonic', { qty: 1, category: 'Peripherals', type: 'Headset' });

  // ================================================================
  //  MISC / TOOLS / CABLES (Pages 52-54)
  // ================================================================

  addItem('GearHead Lighted Optical Mouse', { qty: 6, serial: '111157-109283', category: 'Peripherals', type: 'Mouse' });
  addItem('Ethernet Cable', { qty: 300, category: 'Cables', type: 'Network Cable' });
  addItem('VGA Cable', { qty: 33, category: 'Cables', type: 'Video Cable' });
  addItem('HDMI Cable', { qty: 4, category: 'Cables', type: 'Video Cable' });
  addItem('Extension Cord', { qty: 1, category: 'Cables', type: 'Power Cable' });
  addItem('DTE Cable', { qty: 11, category: 'Cables', type: 'Serial Cable' });
  addItem('VLAN Connector', { qty: 4, category: 'Networking', type: 'Connector' });
  addItem('DCE Cable', { qty: 3, category: 'Cables', type: 'Serial Cable' });
  addItem('Power Cable', { qty: 71, category: 'Cables', type: 'Power Cable' });
  addItem('Display Port to Display Port Cable', { qty: 4, category: 'Cables', type: 'Video Cable' });
  addItem('HP Compaq Fan Cover', { qty: 15, category: 'Components', type: 'Cover' });
  addItem('HP Compaq Spare Case', { qty: 3, category: 'Cases', type: 'Desktop Case' });
  addItem('USB Keyboard', { qty: 35, category: 'Peripherals', type: 'Keyboard' });
  addItem('SYX Systemax Mouse', { qty: 37, category: 'Peripherals', type: 'Mouse' });
  addItem('Spare PSU', { qty: 13, category: 'Components', type: 'Power Supply' });
  addItem('Screwdriver Large', { qty: 26, category: 'Tools', type: 'Tool' });
  addItem('Punch Down Tool', { qty: 10, category: 'Tools', type: 'Tool' });
  addItem('Adjustable Wrench', { qty: 3, category: 'Tools', type: 'Tool' });
  addItem('Pliers', { qty: 8, category: 'Tools', type: 'Tool' });
  addItem('Soldering Iron', { qty: 2, category: 'Tools', type: 'Tool' });
  addItem('Screws (misc)', { qty: 51, category: 'Tools', type: 'Hardware' });
  addItem('ESD Strap', { qty: 51, category: 'Tools', type: 'Safety' });
  addItem('Fan Shield', { qty: 9, category: 'Components', type: 'Cover' });
  addItem('Electrical Tape', { qty: 2, category: 'Tools', type: 'Supply' });
  addItem('Toolkit', { qty: 8, category: 'Tools', type: 'Kit' });
  addItem('Wall Plate Key', { qty: 21, category: 'Tools', type: 'Tool' });
  addItem('Flathead Screwdriver', { qty: 11, category: 'Tools', type: 'Tool' });
  addItem('Cable Tester', { qty: 12, category: 'Tools', type: 'Tool' });
  addItem('DVD-R Disc', { qty: 75, category: 'Media', type: 'Disc' });
  addItem('Screwdriver Small', { qty: 31, category: 'Tools', type: 'Tool' });
  addItem('Tweezers', { qty: 3, category: 'Tools', type: 'Tool' });
  addItem('Screwdriver Medium', { qty: 22, category: 'Tools', type: 'Tool' });
  addItem('DELL Smartbook', { qty: 16, category: 'Books', type: 'Manual' });
  addItem('Jacket Stripper', { qty: 11, category: 'Tools', type: 'Tool' });
  addItem('Scissors', { qty: 5, category: 'Tools', type: 'Tool' });
  addItem('Crimper', { qty: 5, category: 'Tools', type: 'Tool' });
  addItem('Thermal Paste Plunger', { qty: 11, category: 'Tools', type: 'Tool' });
  addItem('Alan Wrench Set', { qty: 5, category: 'Tools', type: 'Tool' });
  addItem('Wrench Set', { qty: 2, category: 'Tools', type: 'Tool' });
  addItem('Mallet', { qty: 2, category: 'Tools', type: 'Tool' });
  addItem('NexStar CX External HDD Enclosure', { qty: 5, category: 'Storage', type: 'Enclosure' });
  addItem('NexStar.3 SATA to eSATA & USB 2.0', { qty: 5, category: 'Storage', type: 'Enclosure' });
  addItem('Ziploc XLarge Big Bag', { qty: 2, category: 'Supplies', type: 'Supply' });
  addItem('HP Monitor Stand', { qty: 1, category: 'Monitors', type: 'Stand' });
  addItem('DVD+R 100-Pack Spindle', { qty: 3, category: 'Media', type: 'Disc' });
  addItem('White Paper CD/DVD Sleeve', { qty: 2300, category: 'Media', type: 'Sleeve' });
  addItem('Wall Plate', { qty: 4, category: 'Networking', type: 'Plate' });
  addItem('Patch Panel', { qty: 1, category: 'Networking', type: 'Panel' });
  addItem('PDU (MS-1215-S6)', { serial: 'MS-1215-S6', category: 'Infrastructure', type: 'PDU' });
  addItem('Switch/Catalyst 2950', { serial: '9113790', category: 'Networking', type: 'Switch' });
  addItem('Example Networking Rack', { qty: 1, category: 'Infrastructure', type: 'Rack' });

  // Dell Laptop
  addItem('Dell Laptop', { serial: '7ZX4102', category: 'Computers', type: 'Laptop' });

  // Dell Laptop chargers
  addItem('Dell Laptop Charger 65w', { serial: 'OHN662-47890-78P-A5EV', category: 'Cables', type: 'Charger' });
  addItem('Dell Laptop Charger 65w', { serial: 'OHN662-47890-88K-A4HT', category: 'Cables', type: 'Charger' });
  addItem('Dell Laptop Charger 90w', { serial: '09T215-71615-56H-0463', category: 'Cables', type: 'Charger' });

  // DELL Inspiron
  addItem('DELL Inspiron 11 300 series 3137', { serial: '25Y4102', category: 'Computers', type: 'Laptop' });

  // KVM / networking peripherals
  addItem('KVM Desktop Controller', { qty: 1, category: 'Networking', type: 'KVM' });
  addItem('IOGEAR KVM Switch', { qty: 2, category: 'Networking', type: 'KVM' });
  addItem('TRENDnet TK-803R', { serial: 'UN16158030218', category: 'Networking', type: 'KVM' });
  addItem('RIJER Smart USB KVM Switch', { qty: 1, category: 'Networking', type: 'KVM' });

  // Misc Computers
  addItem('Lenovo YOGA', { qty: 1, category: 'Computers', type: 'Laptop' });
  addItem('Acer Aspire One', { qty: 1, category: 'Computers', type: 'Laptop' });
  addItem('Toshiba Satellite M105', { qty: 1, category: 'Computers', type: 'Laptop' });
  addItem('Dell Windows XP Pro', { qty: 1, category: 'Computers', type: 'Desktop' });
  addItem('Dell PP02X', { qty: 1, category: 'Computers', type: 'Laptop' });
  addItem('Gateway Solo 5300', { qty: 1, category: 'Computers', type: 'Laptop' });
  addItem('Dell PP11L', { qty: 2, category: 'Computers', type: 'Laptop' });
  addItem('Dell Optiplex GX270', { qty: 1, category: 'Computers', type: 'Desktop' });
  addItem('HP Compaq Spare', { qty: 6, category: 'Computers', type: 'Desktop' });
  addItem('Lenovo ThinkCentre', { qty: 1, category: 'Computers', type: 'Desktop' });
  addItem('IBM Lenovo ThinkCentre', { qty: 1, category: 'Computers', type: 'Desktop' });
  addItem('Samsung Magic Station', { qty: 1, category: 'Computers', type: 'Desktop' });
  addItem('Dell Optiplex 755', { qty: 1, category: 'Computers', type: 'Desktop' });
  addItem('Small MSI Desktop', { qty: 1, category: 'Computers', type: 'Desktop' });
  addItem('MSI Desktop', { qty: 1, category: 'Computers', type: 'Desktop' });

  // ================================================================
  //  NETWORKING / CABLES (Page 54)
  // ================================================================

  addItem('Velcro Strap', { qty: 252, category: 'Cables', type: 'Accessory' });
  addItem('Zip Tie', { qty: 502, category: 'Cables', type: 'Accessory' });
  addItem('Power Strip', { qty: 6, category: 'Cables', type: 'Power' });
  addItem('Netgear 5-port 10/100 Switch FS605', { qty: 37, category: 'Networking', type: 'Switch' });
  addItem('SATA Cable', { qty: 198, category: 'Cables', type: 'Data Cable' });
  addItem('Power Cable (batch 2)', { qty: 98, category: 'Cables', type: 'Power Cable' });
  addItem('Ethernet Cable (batch 2)', { qty: 148, category: 'Cables', type: 'Network Cable' });
  addItem('VGA Cable (batch 2)', { qty: 22, category: 'Cables', type: 'Video Cable' });

  // Power adapters with serials -- various brands
  // (grouped by brand with serials from the PDF)
  // Dell power adapters
  // Shanpu, TPV, Samsung, Hi Capacity, Cisco, LG, DVE, PWR, APD, Fly Power, Hon-Kwang
  // Creating representative entries since specific serials vary
  addItem('Dell Power Adapter', { qty: 5, category: 'Cables', type: 'Power Adapter' });
  addItem('Shanpu Power Adapter', { qty: 2, category: 'Cables', type: 'Power Adapter' });
  addItem('TPV Power Adapter', { qty: 2, category: 'Cables', type: 'Power Adapter' });
  addItem('Samsung Power Adapter', { qty: 2, category: 'Cables', type: 'Power Adapter' });
  addItem('Hi Capacity Power Adapter', { qty: 1, category: 'Cables', type: 'Power Adapter' });
  addItem('Cisco Power Adapter', { qty: 2, category: 'Cables', type: 'Power Adapter' });
  addItem('LG Power Adapter', { qty: 1, category: 'Cables', type: 'Power Adapter' });
  addItem('DVE Power Adapter', { qty: 1, category: 'Cables', type: 'Power Adapter' });
  addItem('PWR Power Adapter', { qty: 1, category: 'Cables', type: 'Power Adapter' });
  addItem('APD Power Adapter', { qty: 1, category: 'Cables', type: 'Power Adapter' });
  addItem('Fly Power Adapter', { qty: 1, category: 'Cables', type: 'Power Adapter' });
  addItem('Hon-Kwang Power Adapter', { qty: 1, category: 'Cables', type: 'Power Adapter' });

  // Routers with serials
  // Linksys -- 5
  for (const sn of ['10A30C67517730', '10A30C68614822', '10A30C6A505711', '10420061391772', '10A10C6B246952']) {
    addItem('Linksys Router', { serial: sn, category: 'Networking', type: 'Router' });
  }

  // Cisco routers -- 8
  const ciscoRouterSerials = [
    'CVR01KC52052', '10A20C65334246', '10A30C65525716', '10A20C61391772',
    'CVR01L156178', '10A30C68615493', 'CVR01KCD5320', '10A20C67322247',
  ];
  for (const sn of ciscoRouterSerials) {
    addItem('Cisco Router', { serial: sn, category: 'Networking', type: 'Router' });
  }

  // D-Link -- 3
  addItem('D-Link Router', { qty: 3, serial: 'US10RB4', category: 'Networking', type: 'Router' });

  // Netgear routers -- 3
  for (const sn of ['2SG32B5A111C5', '2SG2245T10DF9', '2SG32B5E157B9']) {
    addItem('Netgear Router', { serial: sn, category: 'Networking', type: 'Router' });
  }

  // Zonet
  addItem('Zonet Router', { serial: 'CO0CT001867', category: 'Networking', type: 'Router' });

  // Optical disc drives with serials
  const dellOddSerials = [
    '95e-00qw', '08J15V-HLCOO-95E-00QY-A03',
  ];
  for (const sn of dellOddSerials) {
    addItem('Dell Optical Drive', { serial: sn, category: 'Storage', type: 'Optical Drive' });
  }
  addItem('Dell Optical Drive', { qty: 5, category: 'Storage', type: 'Optical Drive' });

  addItem('LiteOn Optical Drive', { serial: '6F8313402054', category: 'Storage', type: 'Optical Drive' });
  addItem('Asus Optical Drive', { serial: 'D6D0AD009942', category: 'Storage', type: 'Optical Drive' });

  for (const sn of ['511HLNP049503', '511HLUX049502']) {
    addItem('LG Optical Drive', { serial: sn, category: 'Storage', type: 'Optical Drive' });
  }

  // Network cards with serials
  for (const sn of ['001B214DCB23419AD', '001B214EE644', '0018214EDF5F']) {
    addItem('Intel NIC', { serial: sn, category: 'Networking', type: 'Network Card' });
  }

  addItem('Tyco NIC', { serial: 'BCM95708A0804F', category: 'Networking', type: 'Network Card' });
  addItem('Intel NIC', { serial: '001B214DC458419AD', category: 'Networking', type: 'Network Card' });

  // StarTech NICs -- 12 + Pex1394b3
  addItem('StarTech NIC', { qty: 12, category: 'Networking', type: 'Network Card' });
  addItem('StarTech Pex1394b3', { qty: 1, category: 'Networking', type: 'Expansion Card' });

  // Misc adapters and cables
  addItem('DVI to USB Splitter', { qty: 5, category: 'Cables', type: 'Adapter' });
  addItem('DVI USB to DVI USB B', { qty: 6, category: 'Cables', type: 'Adapter' });
  addItem('PS2 to USB Adapter', { qty: 71, category: 'Cables', type: 'Adapter' });
  addItem('IO Shield', { qty: 34, category: 'Components', type: 'Shield' });
  addItem('eSATA Cable', { qty: 180, category: 'Cables', type: 'Data Cable' });
  addItem('SATA Power Adapter', { qty: 46, category: 'Cables', type: 'Power Adapter' });
  addItem('Microphone', { qty: 9, category: 'Peripherals', type: 'Microphone' });
  addItem('SLI GPU Bridge', { qty: 13, category: 'Components', type: 'Bridge' });
  addItem('Rioddas External ODD/HDD', { qty: 12, category: 'Storage', type: 'External Drive' });

  // ================================================================
  //  Pages 60-61
  // ================================================================

  addItem('SATA-eSATA Plate Adapter', { qty: 6, category: 'Cables', type: 'Adapter' });
  addItem('Mini USB Cable', { qty: 4, category: 'Cables', type: 'USB Cable' });
  addItem('Micro USB Cable', { qty: 5, category: 'Cables', type: 'USB Cable' });
  addItem('USB Splitter', { qty: 32, category: 'Cables', type: 'USB Cable' });
  addItem('USB A to Mini USB Splitter', { qty: 25, category: 'Cables', type: 'USB Cable' });
  addItem('USB A Male to Female', { qty: 1, category: 'Cables', type: 'USB Cable' });
  addItem('Dell Battery Module', { qty: 1, category: 'Components', type: 'Battery' });
  addItem('Power Supply', { qty: 13, category: 'Components', type: 'Power Supply' });
  addItem('ChromeCast', { serial: '4926101PJK38', category: 'Electronics', type: 'Streaming Device' });
  addItem('Small Power Cord', { qty: 9, category: 'Cables', type: 'Power Cable' });

  // Microsoft LifeCam Studio Webcam -- 8 units, 1 serial given
  addItem('Microsoft LifeCam Studio Webcam', { serial: '258601971594', category: 'Peripherals', type: 'Webcam' });
  addItem('Microsoft LifeCam Studio Webcam', { qty: 7, category: 'Peripherals', type: 'Webcam' });

  addItem('Ethernet Cable (batch 3)', { qty: 396, category: 'Cables', type: 'Network Cable' });
  addItem('Ultra External Hard Drive', { qty: 17, category: 'Storage', type: 'External Drive' });
  addItem('NexStar External Hard Drive', { qty: 40, category: 'Storage', type: 'External Drive' });
  addItem('SABRENT External Hard Drive', { qty: 4, category: 'Storage', type: 'External Drive' });
  addItem('NIC Card', { qty: 8, category: 'Networking', type: 'Network Card' });
  addItem('NetGear VPN Firewall', { serial: '1BU4187X0124B', category: 'Networking', type: 'Firewall' });
  addItem('VGA Audio Cable', { qty: 2, category: 'Cables', type: 'Video Cable' });
  addItem('Patch Panel (batch 2)', { qty: 20, category: 'Networking', type: 'Panel' });
  addItem('DLink Router', { qty: 1, category: 'Networking', type: 'Router' });
  addItem('DVI Splitter', { qty: 1, category: 'Cables', type: 'Adapter' });
  addItem('Server Rack Arm', { qty: 7, category: 'Infrastructure', type: 'Rack Accessory' });
  addItem('NETTOP Computer', { qty: 1, category: 'Computers', type: 'Desktop' });
  addItem('StarTech PDU', { qty: 18, category: 'Infrastructure', type: 'PDU' });
  addItem('CyberPower PDU', { qty: 1, category: 'Infrastructure', type: 'PDU' });
  addItem('Tripp-Lite PDU', { qty: 2, category: 'Infrastructure', type: 'PDU' });
  addItem('APC PDU', { qty: 1, category: 'Infrastructure', type: 'PDU' });
  addItem('USB Keyboard (batch 2)', { qty: 35, category: 'Peripherals', type: 'Keyboard' });
  addItem('Rollover Cable', { qty: 23, category: 'Cables', type: 'Serial Cable' });
  addItem('RJ11 Flat Cable', { qty: 95, category: 'Cables', type: 'Phone Cable' });
  addItem('CAT5 Unkeyed 568B', { qty: 30, category: 'Cables', type: 'Network Cable' });
  addItem('DB9 to RJ45', { qty: 101, category: 'Cables', type: 'Serial Cable' });
  addItem('SATA Cable (batch 2)', { qty: 6, category: 'Cables', type: 'Data Cable' });
  addItem('DB25 External', { qty: 1, category: 'Cables', type: 'Serial Cable' });

  // ----------------------------------------------------------------
  // Tag one item so we can detect a re-run
  // ----------------------------------------------------------------
  db.prepare(
    "UPDATE equipment SET notes = notes || ' [seed-inventory-v2-2026]' WHERE id = (SELECT MAX(id) FROM equipment)"
  ).run();

});

// ------------------------------------------------------------------
// Run it
// ------------------------------------------------------------------
console.log('Importing CIS Spring Inventory 2026 v2 -- pages 29-61...');
importAll();
console.log(`Done! Inserted ${inserted} items, skipped ${skipped} duplicates.`);
console.log(`Asset IDs now go up to: CIS-${String(assetCounter).padStart(6, '0')}`);
