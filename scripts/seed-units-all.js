'use strict';
/**
 * seed-units-all.js
 *
 * Populates equipment_units from all CIS Spring Inventory 2026 sheets.
 * Matches equipment rows by name (case-insensitive). Safe to re-run.
 *
 * Usage: sudo node scripts/seed-units-all.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'cyberlab.db');
console.log(`Using database: ${DB_PATH}\n`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── CIS barcode counter (continues from highest existing in both tables) ──────
let _cisCounter = 0;
function _scanBarcodes(rows) {
  for (const r of rows) {
    const m = /^CIS-(\d+)$/i.exec((r.barcode || '').trim());
    if (m) { const n = parseInt(m[1], 10); if (n > _cisCounter) _cisCounter = n; }
  }
}
_scanBarcodes(db.prepare("SELECT barcode FROM equipment WHERE barcode LIKE 'CIS-%'").all());
_scanBarcodes(db.prepare("SELECT barcode FROM equipment_units WHERE barcode LIKE 'CIS-%'").all());
function nextBarcode() { _cisCounter++; return 'CIS-' + String(_cisCounter).padStart(6, '0'); }

// ── helpers ──────────────────────────────────────────────────────────────────
const findEq  = db.prepare("SELECT * FROM equipment WHERE lower(trim(name)) = lower(trim(?)) LIMIT 1");
const hasUnit = db.prepare("SELECT id FROM equipment_units WHERE equipment_id = ? AND serial_number = ?");
const insUnit = db.prepare("INSERT INTO equipment_units (equipment_id, serial_number, barcode, notes) VALUES (?, ?, ?, ?)");
const setSN   = db.prepare("UPDATE equipment SET serial_number = ?, updated_at = datetime('now') WHERE id = ? AND (serial_number IS NULL OR serial_number = '')");

let totalAdded = 0, totalSkipped = 0, totalMiss = 0;

function addUnits(name, units /* [{sn, notes}] */) {
  const item = findEq.get(name);
  if (!item) { console.log(`  MISS  "${name}"`); totalMiss++; return; }
  let added = 0, skipped = 0;
  for (const { sn, notes = '' } of units) {
    if (!sn || sn.match(/^(unreadable|no sn|no serial|n\/a|doesn't have one)$/i)) continue;
    if (hasUnit.get(item.id, sn)) { skipped++; continue; }
    insUnit.run(item.id, sn, nextBarcode(), notes);
    added++;
  }
  if (added > 0 || skipped > 0)
    console.log(`  ${added > 0 ? 'ADD  ' : 'SKIP '} [${item.id}] "${item.name}" — ${added} added, ${skipped} skipped`);
  totalAdded += added; totalSkipped += skipped;
}

function setSingle(name, sn) {
  const item = findEq.get(name);
  if (!item) { console.log(`  MISS  "${name}"`); totalMiss++; return; }
  if (item.serial_number && item.serial_number.trim()) {
    console.log(`  SKIP  [${item.id}] "${item.name}" serial already set`); return;
  }
  setSN.run(sn, item.id);
  console.log(`  SET   [${item.id}] "${item.name}" → ${sn}`);
}

// ═══════════════════════════════════════════════════════════════════════
// NETWORKING CLOSET
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── Networking Closet ──');

addUnits('Cisco 2600 Router', [
  {sn:'JMX060K1UX'},{sn:'JMX0704L4DP'},{sn:'JMX0707L1C3'},{sn:'JMX0713L60D'},
  {sn:'JMX0606K523'},{sn:'JMX0642L889'},{sn:'JMX0609K5LQ'},{sn:'JMX0627K1CM'},
  {sn:'JMX0651L27W'},{sn:'JMX0614K2G1'},{sn:'JMX0709L6LX'},{sn:'JMX0709L4BE'},
  {sn:'JMX0835L9RP'},{sn:'JMX0637L3WL'},{sn:'JMX0637L5P6'},{sn:'JMX0710L5E8'},
  {sn:'JMX0617K3P1'},{sn:'JMX0626K1K5'},{sn:'JMX0642L46Q'},{sn:'JMX0701L2W2'},
  {sn:'JMX0702L9KE'},{sn:'JMX0708L8SV'},{sn:'JMX0710L5JU'},{sn:'JMX0627K14A'},
  {sn:'JMX0713L651'},{sn:'JMX0627K0ZT'},{sn:'JMX0637L5QC'},{sn:'JMX0712L0PZ'},
  {sn:'JMX0608K56H'},{sn:'JMX0716L19X'},{sn:'JMX0707L1A6'},{sn:'JMX0609K5MV'},
  {sn:'JMX0710L5L7'},{sn:'JMX0610K1T8'},{sn:'JMX0710L3E0'},{sn:'JMX0706L23W'},
  {sn:'JMX0713L66H'},{sn:'JMX0625KA1C'},{sn:'JMX0610K21Z'},{sn:'JAB0444875J'},
  {sn:'JMX0637L3PE'},{sn:'JMX0710L5K7'},{sn:'JMX0710L3DA'},{sn:'JMX0637L5U8'},
  {sn:'JMXO71OL5XJ'},{sn:'JMX0645L1SW'},{sn:'JMX0627K1JT'},{sn:'JMX0627K0ZP'},
  {sn:'JMX0635L9QS'},{sn:'JMX0707L1CF'},{sn:'JMX0635L8JJ'},{sn:'JMX0709L6N6'},
  {sn:'JMX0706L28T'},{sn:'JMX0608K588'},{sn:'JMX0702L9LN'},{sn:'JMX0627K0TV'},
  {sn:'JMX0636L6H4'},{sn:'JMX0645L11H'},{sn:'JMX0627K1FV'},{sn:'JMX0636L0RA'},
  {sn:'JMX0710L5Y0'},{sn:'JMX0623K7XF'},{sn:'JMX0651L28L'},{sn:'JMX0608K5C3'},
  {sn:'JMX0610K20P'},{sn:'JMX0645L2NF'},{sn:'JMX0710L5HE'},{sn:'JMX0627K1CC'},
  {sn:'JMX0634L6GC'},{sn:'JMX0710L5XQ'},{sn:'JMX0710L4WK'},{sn:'JMX0609K5M1'},
  {sn:'JMX0627KOTX'},{sn:'JMX0617K4TD'},{sn:'JMX0706L231'},{sn:'JMX0713L670'},
  {sn:'JMX0707L16J'},{sn:'JMX0712L0QM'},{sn:'JMX0642L472'},{sn:'JMX0713LOV4'},
  {sn:'JMX0637LJV3'},{sn:'JMX0649L0F5'},{sn:'JMX0617K4KD'},{sn:'JMX0710L5EU'},
  {sn:'JMX0701L2UU'},{sn:'JMX0627K1C0'},{sn:'JMX0710L5KP'},{sn:'JMX0627K1EB'},
  {sn:'JMX0637L3NQ'},{sn:'JMX0531K936'},{sn:'JMX0713L0UT'},{sn:'JMX709L4BQ'},
  {sn:'JMX0625KA1P'},{sn:'JMXO708L90P',notes:'last letter unreadable'},{sn:'JMX0707L6DE'},
  {sn:'JMX0707L1X4'},{sn:'JMX0707L6QH'},{sn:'JMX0610K2OB'},{sn:'JMX0701L2VW'},
  {sn:'JMX0701L2XH'},{sn:'JMX0637LGTE'},{sn:'JMX0652L52L'},{sn:'JMX0707L13Q'},
  {sn:'JMX0713L600'},{sn:'JMX0643L4AW'},{sn:'JMX0645L2ND'},{sn:'JMX0642L46G'},
  {sn:'JMX0701L3AB'},{sn:'JMX0627K0TQ'},{sn:'JMX0605K5MH'},{sn:'JMX0627K13R'},
  {sn:'JMX0708L8HB'},{sn:'JMX0649L0F1'},{sn:'JMX0702L5H8'},{sn:'JMX0713L698'},
  {sn:'JMX0609K5MG'},{sn:'JMX0627K1GQ'},{sn:'JMX0725L09F'},{sn:'JMX0627K1H7'},
  {sn:'JMX0710L5E6'},{sn:'JMX0710L5GU'},{sn:'JMX0608K5AU'},
]);

addUnits('Cisco 2950 Switch', [
  {sn:'FOC1014Z629'},{sn:'FOC0804Y09F'},{sn:'FHK0616X2Z0'},{sn:'FHK0722W0U9'},
  {sn:'FHK0616W2U1'},{sn:'F0C074620V8'},{sn:'FHK065020HX'},{sn:'FOC0912Y190'},
  {sn:'FOC0821Z33R'},{sn:'FOC0752T044'},{sn:'FCZ1207Y027'},{sn:'FOC1149X09L'},
  {sn:'FHK0718W1Q6'},{sn:'FOC09122Z1AN'},{sn:'FHK0625Z1CL'},{sn:'FOC1104W3EA'},
  {sn:'FOC0839W1FQ'},{sn:'FOC1149W1JM'},{sn:'FOC0835X1RB'},{sn:'FOC1014Z5BD'},
  {sn:'FOC0804Y00E'},{sn:'FAB0545W2ZN'},{sn:'FHK0636Y1XB'},{sn:'FOC0912Y182'},
  {sn:'FOC0836Y1ML'},{sn:'FOC1124X0JR'},{sn:'FOC1128W5HX'},{sn:'FOC1222U1UF'},
  {sn:'FOC0835X2AA'},{sn:'FOC1123W5BA'},{sn:'FOC1014Z5CS'},{sn:'FOC0824S1SP'},
  {sn:'FHK0636Y160'},{sn:'FOC1149W1DG'},{sn:'FOC0912Y18X'},{sn:'FHK0722X0V0'},
  {sn:'FOC0803Z1JF'},{sn:'FOC0733X1ZT'},{sn:'FOC1108Z55M'},{sn:'FOC0835X1R7'},
  {sn:'FOC0739Y3L9'},{sn:'FOC0835W1MD'},
]);

setSingle('Cisco 3650 switch', 'FOC1442W4N5');
setSingle('Cisco 3560 switch', 'FOC1245Z3FT');

// Single-SN networking items
setSingle('NetGear VPN Firewall',    '1BU4187X0124B');
setSingle('Microsoft LifeCam Studio Webcam', '258601971594');
setSingle('TRENDnet kvm switch',     'UN16158030253');
setSingle('ChromeCast',              '4926101PJK38');
// NOTE: 'hp optical drive', 'Dell Computer', 'Windows XP Laptop', 'Switching Adapter'
// not found in equipment table — skipped

// ═══════════════════════════════════════════════════════════════════════
// SOUTH SHELVES — HP monitors, keyboards, mice, peripherals
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── South Shelves ──');

addUnits('HP LV1911 monitor', [
  {sn:'6CM31223SH'},{sn:'6CM31228ZS'},{sn:'6CM30214QX'},{sn:'6CM312291Y'},
  {sn:'6CM30215PS'},{sn:'6CM31228ZN'},{sn:'6CM31228ZT'},{sn:'6CM31228ZW'},
  {sn:'6CM30216SX'},{sn:'6CM30215PK'},{sn:'6CM30214R0'},
]);

setSingle('Samsung SyncMaster S20B350', 'Z4W8HCLC603657J');

addUnits('Keyboard Lenovo', [
  {sn:'1649665'},{sn:'0611445'},{sn:'1873841'},{sn:'1695757'},{sn:'3779193'},{sn:'1795818'},
  {sn:'1378441'},{sn:'1010675'},{sn:'1101546'},{sn:'0001248'},{sn:'0507266'},{sn:'0803688'},
  {sn:'2138188'},{sn:'1951281'},{sn:'3981146'},{sn:'1352931'},{sn:'1333654'},{sn:'3481922'},
  {sn:'0091719'},{sn:'0897832'},{sn:'01102585'},{sn:'1669029'},{sn:'1813242'},{sn:'01165833'},
  {sn:'1951319'},{sn:'3727240'},
]);

addUnits('Keyboard Dell', [
  {sn:'0081N8-LO300-295-G2HO-A02'},{sn:'0RKR0N-71616-689-22IB-A03'},
  {sn:'0081N8-LO300-295-G2HL-A02'},{sn:'0081N8-LO300-29C-0AFK-A01'},
  {sn:'0081N8-LO300-295-G0SB-A02'},{sn:'0RKR0N-LO300-79S-0SIE-A03'},
  {sn:'0081N8-LO300-295-0BTB-A01'},{sn:'0RKR0N-71616-689-21IX-A03'},
  {sn:'0RKR0N-71616-67S-02TF-A03'},{sn:'0081N8-LO300-295-G2HN-A02'},
  {sn:'0RKR0N-71616-689-22CQ-A03'},{sn:'0RKR0N-71616-689-24QL-A03'},
  {sn:'0081N8-LO300-295-G0TT-A02'},{sn:'0RKR0N-71616-67U-0HLS-A03'},
  {sn:'0081N8-LO300-295-G2HT-A02'},{sn:'0081N8-LO300-295-G2HH-A02'},
  {sn:'0081N8-LO300-295-G2HZ-A02'},
]);

// Key Tronic PS2 keyboard → Keyboard (unmarked)
addUnits('Keyboard (unmarked)', [
  {sn:'C124500214',notes:'Key Tronic PS2'},
  {sn:'IMJS013121009810',notes:'No brand'},
]);

addUnits('Mouse Dell', [
  {sn:'009NK2-73826-682-07V7'},{sn:'065K5F-LO300-2AH-0I3N'},
  {sn:'0DV0RH-LO300-79T-058M'},{sn:'009NK2-73826-67U-0D6Q'},
  {sn:'009NK2-73826-686-1TLS'},{sn:'009NK2-73826-686-1U2R'},
  {sn:'009NK2-73826-686-1UON'},{sn:'0DV0RH-L030?-70Y-T012A'},
  {sn:'065K5F-LO300-2AH-0J0P'},{sn:'HC7470C0CEV'},
  {sn:'HC8200B0XKH'},{sn:'CN-065KSF-LO300-2AH-0HXP'},
]);

addUnits('Mouse Key Tronic (PS2)', [
  {sn:'1151002747'},{sn:'1151002741'},
]);

addUnits('Mouse Key Tronic', [
  {sn:'1151000568'},{sn:'1151000040'},{sn:'1151002642'},
]);

addUnits('Mouse Logitech', [
  {sn:'1310HS02LFG8'},{sn:'810-001243'},{sn:'831087-A000'},
]);

addUnits('Mouse SYX Systemax', [
  {sn:'120402213'},{sn:'120402229'},{sn:'120402027'},{sn:'120402220'},
  {sn:'120402227'},{sn:'120402284'},{sn:'120402246'},{sn:'120402209'},
  {sn:'120402035'},{sn:'120402235'},{sn:'120402297'},
]);

// Gear Head (111157-109283) and HP (FATSK0JUJZCFJO) mice have no matching DB item — skipped

// South shelves — individual laptops/desktops
setSingle('Dell Laptop',            '7ZX4102');
setSingle('DELL Inspiron 11 300 series 3137', '25Y4102');
setSingle('TRENDnet TK-803R',       'UN16158030218');
setSingle('AC Adapter',              '232X0462C01');
setSingle('HP Compaq Spare Case',   'S1-457651');
// IDE floppy-disk drive, Spare DVD drive, Switch/Catalyst 2950 Series — not in DB, skipped

addUnits('Dell Laptop charger 65w', [
  {sn:'OHN662-47890-78P-A5EV'},{sn:'OHN662-47890-88K-A4HT'},
]);
setSingle('Dell Laptop charger 90w', '09T215-71615-56H-0463');

// Optical / CD drives from South Shelves — no generic optical-drive item in DB, skipped

// NIC cards
addUnits('NIC Card', [
  {sn:'001B214DCB23419AD',notes:'Intel'},{sn:'001B214EE644 439AD',notes:'Intel'},
  {sn:'0018214EDF5F 439AD',notes:'Intel'},{sn:'BCM95708A0804F',notes:'Tyco'},
  {sn:'001B214DC458419AD',notes:'Intel'},{sn:'St100slp',notes:'Startech'},
  {sn:'0018214EE663439AD',notes:'Intel'},{sn:'12430771083',notes:'StarTech'},
  {sn:'1-243-0771072',notes:'StarTech'},{sn:'1-243-077-0434',notes:'StarTech'},
  {sn:'1-243-0771073',notes:'StarTech'},{sn:'1-243-0771071',notes:'StarTech'},
  {sn:'1-243-0771074',notes:'StarTech'},{sn:'1-243-0771057',notes:'StarTech'},
  {sn:'1-243-0771069',notes:'StarTech'},{sn:'1-243-0771075',notes:'StarTech'},
  {sn:'1-243-0771068',notes:'StarTech'},{sn:'Pex1394b3',notes:'StarTech'},
  {sn:'1-243-077-0428',notes:'StarTech'},{sn:'2b46121d07d',notes:'Adapted RAID controller'},
]);

// ═══════════════════════════════════════════════════════════════════════
// NORTHEAST CABINETS — Motherboards, GPUs, CPUs, Drives
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── Northeast Cabinets ──');

addUnits('ASRock 760GM-HDV', [
  {sn:'9AM0XB253640'},{sn:'9AM0X253793'},{sn:'9AM0XB253840'},{sn:'9AM0XB253788'},
  {sn:'9AM0XB253639'},{sn:'9AM0XB253838'},{sn:'9AM0XB253626'},{sn:'9AM0XB253635'},
  {sn:'9AM0XB253787'},{sn:'9AM0XB253782'},{sn:'9AM0XB253791'},{sn:'9AM0XB253800'},
  {sn:'9AM0XB253634'},{sn:'9AM0XB253794'},{sn:'9AM0XB253637'},{sn:'9AM0XB253837'},
  {sn:'9AM0XB253789'},{sn:'9AM0XB253839'},{sn:'9AM0XB253786'},
]);

addUnits('GIGABYTE Service Care', [
  {sn:'408D5C10D69F',notes:'ATX'},{sn:'94DE800BAADB',notes:'ATX'},
  {sn:'74D435B4ED37',notes:'Micro ATX'},{sn:'1C1B0D90E0CD',notes:'ATX'},
]);

addUnits('GIGABYTE Ultra durable 970A-D33P', [
  {sn:'E0D55E75A250'},{sn:'E0D55E759658'},{sn:'FCAA149A7EE5'},
  {sn:'eod55e732c02'},{sn:'1c1b0dd57ec1'},{sn:'E0D55ED33AC7'},
  {sn:'E0D55E37ED8D',notes:'Has 2x8GB RAM + CPU + heatsink/fan'},
]);

setSingle('Z97 PC Mate',          '448A5BC00A85');
setSingle('ASUS F2a55-MLK',       '047653-01465-MB0CV0-A19 5024');
setSingle('FM2-A85XA-G65',        'D43D7E519D85');

addUnits('MSI B350M GAMING PRO', [
  {sn:'309C2302E545',notes:'Has AMD Ryzen 5 1600 (CPU S/N: YD1600BBM6IAE)'},
  {sn:'309C2322CC07',notes:'Box S/N: 601-7A39-010B1707001497, CPU+heatsink installed'},
  {sn:'309C2322CC04',notes:'Box S/N: 601-7A39-010B1707001495'},
  {sn:'309C2322CC05',notes:'Box S/N: 601-7A39-010B1704005076'},
]);

// GPUs
addUnits('MSI NVIDIA GEFORCE GT 710 2GB DDR3', [
  {sn:'602-V809-Z758T1906001766'},{sn:'602-V809-Z758T1906001767'},{sn:'602-V809-Z758T1906001765'},
  {sn:'602-V809-Z758T1906000651'},{sn:'602-V809-Z758T1906001860'},{sn:'602-V809-Z758T1906001858'},
  {sn:'602-V809-Z758T1906001846'},{sn:'602-V809-Z758T1906001850'},{sn:'602-V809-Z758T1906001859'},
  {sn:'602-V809-Z758T1906000657'},{sn:'602-V809-711SD1709007388'},{sn:'602-V809-Z758T1906001848'},
  {sn:'602-V809-Z758T1906001768'},
]);

// V212 board = R6450-MD1GD3/LP (1GB); V809-1020 board = R6450-2GD3H/LP (2GB)
addUnits('MSI Radeon HD 6450 (R6450-MD1GD3/LP)', [
  {sn:'602-V212-510B1707000871'},{sn:'602-V212-510B1707000865'},
  {sn:'602-V212-510B1707001324'},{sn:'602-V809-1020SD1807000152'},
]);

addUnits('MSI Radeon HD 6450 (R6450-2GD3H/LP)', [
  {sn:'602-V809-1020SD1807000268'},{sn:'602-V809-1020SD1807000574'},
  {sn:'602-V809-1020SD1807000155'},{sn:'602-V809-1020SD1807000270'},
  {sn:'602-V809-1020SD1807000153'},{sn:'602-V809-1020SD1807000572'},
]);

addUnits('VisionTek 5570 1GB PCIe', [
  {sn:'VG419020000090'},{sn:'VG319060000055'},{sn:'VG419020001'},
  {sn:'VG319050000291'},{sn:'VG319060000105'},{sn:'VG418120000891'},
]);

setSingle('MSI RADEON R9 380 GAMING 4G',      '602-V314-070B1507001634');
setSingle('SAPPHIRE RADEON HD6450 1GB DDR3',   'A172500008973');
setSingle('EVGA GEFORCE 210 1024MB DDR3',      '1710831313852459');

// CPUs
addUnits('INTEL PENTIUM E5200', [
  {sn:'2L9314'},{sn:'2l93139'},{sn:'2l92834'},{sn:'2l93529'},
  {sn:'2l92968'},{sn:'2l93527'},{sn:'2v91382'},{sn:'2l91832'},
  {sn:'2v94200'},{sn:'2v83211'},{sn:'3591914'},{sn:'2l91017'},
  {sn:'2l93529'},{sn:'2l93529'},
]);

setSingle('Intel core i5-330s', '3233b666');

addUnits('Intel core i5-6400', [
  {sn:'x634b813'},{sn:'l547b500'},{sn:'x639b076'},{sn:'x634b819'},
]);

addUnits('Intel Celeron g1820', [
  {sn:'x609c440'},{sn:'x515c927'},{sn:'x515c927'},{sn:'x515c927'},
]);

setSingle('Intel core i3-3220', '3316b088');

addUnits('Intel Celeron g1610', [
  {sn:'l226c066'},{sn:'3339b212'},
]);

setSingle('Intel core i3-6100', 'x601c023');

addUnits('amd fx fd4300', [
  {sn:'90u1029070453'},{sn:'9gv8951070041'},{sn:'9hb2651p80186'},{sn:'9hb2628p80073'},
  {sn:'y799904l30408'},{sn:'9hb2628p80059'},{sn:'9gt1972l60525'},{sn:'9hb2651p80008'},
  {sn:'9gt1972160918'},{sn:'9hb2628p80329'},{sn:'y799904l30484'},{sn:'9av8724l30117'},
  {sn:'9hb2628p80074'},{sn:'9gt1890l61376'},
]);

addUnits('AMD FX 4350', [
  {sn:'y884141h50111'},{sn:'y884141h5057'},{sn:'y884141h50547'},{sn:'y884141h50100'},
]);

setSingle('amd a6-5400',   'y723932d30056');
setSingle('Intel core i3-7100', 'x835e451');

addUnits('amd fx 4100', [
  {sn:'yn86916b30480'},{sn:'9n86916b30042'},{sn:'9n55786b30094'},{sn:'9n56056b31125'},
]);

addUnits('amd fx 8350', [
  {sn:'9ej6792b50436'},{sn:'9ce0492b40786'},{sn:'9ej6792b50963'},{sn:'9ep2932c50903'},
]);

addUnits('amd fx 6300', [
  {sn:'9fl0633h50093'},{sn:'y868923c51244'},{sn:'9gv6567p70355'},{sn:'9f05903150642'},
  {sn:'9gv9572p70076'},{sn:'9gv9572p70099'},{sn:'9gv9572p70073'},{sn:'9fq5903i50643'},
]);

addUnits('Intel core i3-8100', [
  {sn:'x827f102'},{sn:'x840d927'},{sn:'x851b675'},
]);

addUnits('Intel core2 e8400', [
  {sn:'q850a747'},{sn:'q921a425'},{sn:'q930a765'},{sn:'q921b735'},
]);

setSingle('AMD RYZEN 3 1200',    'yd1200bbm4kae');
setSingle('Intel core i3-4150',  '3434b144');

addUnits('amd a10-5800', [
  {sn:'9n82152b30097'},{sn:'9n82372b30135'},
]);

setSingle('AMD RYZEN 5 1600',    'yd1600bbm6iae');

addUnits('amd a8-5500', [
  {sn:'9m08002l20676'},{sn:'9m08002l20255'},
]);

addUnits('amd a6-7400', [
  {sn:'9gu5195070212'},{sn:'9gu5195070565'},{sn:'9gu5195070207'},
]);

setSingle('amd a8-5600',         '9cq0511d40478');
setSingle('amd a4-5300',         '9ha8109x70246');
setSingle('amd fx 6100',         '9s69394f30220');
setSingle('Intel Celeron g4900', 'x928h603');
setSingle('Intel core2 duo e7500', 'q928b899');
setSingle('Intel core2 duo e6550', '3839a637');
setSingle('Intel core i5-2500',  '3138a828');

addUnits('Intel Celeron g3900', [
  {sn:'x717d827'},{sn:'x717d822'},{sn:'x717d827'},
]);

addUnits('amd fx 9590', [
  {sn:'9gs1293k60280'},{sn:'9gs1293k60184'},{sn:'9gu2699m70264'},
  {sn:'9gu2699m70003'},{sn:'9gu2683m70125'},{sn:'9gu2699m70014'},
]);

setSingle('Intel core2 duo e8500',          'q001b530');
setSingle('Intel PENTIUM d 930',            'l616a678');
setSingle('Intel core i3-7350k',            'l702d6s0');
setSingle('Intel Celeron g540',             'l228b138');
setSingle('Intel PENTIUM dual-core e2160',  'q745a896');

// SSDs / Drives — Northeast Cabinets
addUnits('TRANSCEND SSD370S', [
  {sn:'C43451-0101'},{sn:'E93003-0940'},{sn:'E93003-0932'},{sn:'E93003-0959'},
  {sn:'E93003-0965'},{sn:'E93003-1039'},{sn:'E93003-1038'},{sn:'E93003-0682'},
  {sn:'E93003-1037'},{sn:'E93003-0938'},{sn:'E93003-0990'},{sn:'E93003-0991'},
  {sn:'E93003-1044'},{sn:'E93003-0993'},{sn:'E93003-1035'},{sn:'E96174-0706'},
  {sn:'E89894-1239'},{sn:'E96174-0715'},{sn:'E80122-0638'},{sn:'E75883-0841'},
  {sn:'C43451-0052'},{sn:'C43451-0110'},{sn:'C43451-0143'},{sn:'C43451-0068'},
  {sn:'C43451-0249'},{sn:'C43451-0111'},{sn:'C43451-0126'},{sn:'C43451-0114'},
  {sn:'C43451-0128'},{sn:'C43451-0105'},{sn:'C43451-0222'},{sn:'C43451-0201'},
]);

addUnits('WD Blue SSD', [
  {sn:'171804423656'},{sn:'171804421752'},{sn:'174539804730'},{sn:'174539806979'},
  {sn:'174539805989'},{sn:'174539802053'},{sn:'171804433583'},{sn:'174539802390'},
  {sn:'174539802128'},{sn:'WXA1A33K1180'},{sn:'WXE1E13DZXV8'},{sn:'WXE1E13DMDK6'},
  {sn:'WXE1E13DMLT8'},{sn:'WXE1E13DJTJ2'},{sn:'WXE1E13AYMA2'},{sn:'WXE1E13EZPZ7'},
]);

addUnits('WD Scorpio', [
  {sn:'WXC408068178'},{sn:'WXC108351091'},{sn:'WXEX08RYL523'},{sn:'WXE608NY7457'},
  // WD Scorpio Blue variant — same item family
  {sn:'WXR0E99VHA64'},{sn:'WX91A4132501'},{sn:'WXBAA1174774'},
  {sn:'WX31A33P4817'},{sn:'WX51A43L0956'},
]);

addUnits('Western Digital HDD', [
  {sn:'WCAP93139635'},{sn:'WMAP94426242'},{sn:'WMAP9F144021'},{sn:'WCAT16558817'},
  {sn:'WCAPZ2087351'},{sn:'WCAPZ1747683'},{sn:'WMAP9E126561'},{sn:'WMA8H4060345'},
  // Western Digital Blue variant
  {sn:'WCAV3F316410'},{sn:'WCAV3F317433'},
]);

addUnits('Seagate HDD', [
  {sn:'5NH1BD71'},{sn:'5LY4PSA8'},{sn:'5LY78KSB'},{sn:'5VC1DA7'},{sn:'5LY79M7Z'},
  {sn:'5RX8AAHT'},{sn:'9RXN9S46'},{sn:'9RX4GHV3'},{sn:'9RX18G3V'},{sn:'9RX6BZX6'},
  {sn:'9RXNDBGP'},{sn:'6VY12W8Q'},{sn:'5YD4YXQ5'},{sn:'9RX5W1EF'},{sn:'9RX4J68F'},
  {sn:'9RX4GTQY'},{sn:'3HS0EWA2'},{sn:'3QD1GENZ'},{sn:'3QD0Z285'},{sn:'5QD2KA19'},
  {sn:'9VY1C85T'},
]);

addUnits('Hitachi HDD', [
  {sn:'080510DP0B30DQGVJ5TP'},{sn:'SGHYE3GB'},{sn:'KGDWP2BE'},{sn:'SB22DBKGFLHGRN'},
  {sn:'JQ3B012K'},{sn:'MM2VJZEC'},{sn:'MM2PV1WC'},{sn:'MM1TU6UA'},{sn:'MM33W52C'},
  {sn:'HV1YBTDA'},{sn:'HV2ZD5JH'},{sn:'JQ3D9LPK'},{sn:'HV0AT2XE'},{sn:'JQ2BYWNH'},
  {sn:'JQ271XLK'},
]);

addUnits('Toshiba Hard Drive', [
  {sn:'779QT4CNT'},{sn:'961Y2296S'},{sn:'95065293T'},{sn:'32Q0T0JJT'},{sn:'72JEC0X7T'},
  {sn:'32Q0T0JKT'},{sn:'18ESTCJ5T'},{sn:'188CTEI9T'},{sn:'Y7L0T09GT'},{sn:'22F3C1DJT'},
  {sn:'MQ01ABD050'},{sn:'570MT02FT'},{sn:'424UC1H1T'},{sn:'832ESZYFS'},{sn:'832ES02DS'},
  {sn:'832ESZYUS'},{sn:'832ESZYJS'},{sn:'832ES01QS'},{sn:'832ES032S'},{sn:'832ESZZES'},
  {sn:'832ESZYGS'},{sn:'832ESZYHS'},{sn:'832ES00IS'},{sn:'832ES00NS'},{sn:'832ESZY9S'},
  {sn:'832ES02MS'},{sn:'832ESZZKS'},{sn:'832ESZYZS'},{sn:'732JPETGS'},{sn:'732K4HTAS'},
  {sn:'732KMRDGS'},
]);

setSingle('Samsung Magic station',    'S1V3J9DS603308');
// Maxtor — not in equipment table, skipped

addUnits('Intel Optane NVMe', [
  {sn:'PHBT723000VG032E'},{sn:'PHBT817400LL032E'},{sn:'PHBT723000XL032E'},
]);

addUnits('Dell Hard Drive', [
  {sn:'S0K1T0AK'},{sn:'S0K2FQSM'},{sn:'WXE1E11PZT86'},
]);

// ═══════════════════════════════════════════════════════════════════════
// EAST HP COMPUTER ROW
// ═══════════════════════════════════════════════════════════════════════
console.log('\n── East HP Computer Row ──');

// HP Compaq computers are individual qty=1 rows named "HP Compaq #SERIAL".
// addUnits doesn't work for them; instead we update the notes field with component details.
const findHPCompaq = db.prepare("SELECT id, notes FROM equipment WHERE lower(trim(name)) = lower(trim(?)) LIMIT 1");
const updateNotes  = db.prepare("UPDATE equipment SET notes = ?, updated_at = datetime('now') WHERE id = ? AND (notes IS NULL OR notes = '')");

function setCompaqNotes(sn, notes) {
  const name = `HP Compaq #${sn.toUpperCase()}`;
  const item = findHPCompaq.get(name);
  if (!item) { console.log(`  MISS  "${name}"`); totalMiss++; return; }
  if (item.notes && item.notes.trim()) { console.log(`  SKIP  [${item.id}] "${name}" notes already set`); return; }
  updateNotes.run(notes, item.id);
  console.log(`  SET   [${item.id}] "${name}" notes`);
}

const hpCompaqData = [
  {sn:'2UA9150BWQ',notes:'PSU:68BSA59656 CPU-fan:CT:5ABDP0AG5Y645N Fan:AUB0912VH HS:450666-001 HDD:HV0SPNHK RAM:1x2GB MB:P70130J9VWYLZV Status:working'},
  {sn:'2UA0010S5B',notes:'PSU:B9LCBP2642960 CPU:5ABDP0B4DXTD02 Fan:AD0912UX-A7BGL HS:480368-001 HDD:S1VBJ90S133133 RAM:4x2GB MB:PAVFE0SSUYD2LP'},
  {sn:'MXL9530013',notes:'PSU:6RGS624037 CPU:5ABDP0B4DY3BBJ Fan:PV902512PSPF HS:450666-001 HDD:MM341MTC RAM:1x2GB MB:P70130K9VXWT1W Status:working'},
  {sn:'MXL94117ZQ',notes:'PSU:360947006062 CPU:CT:5ABDP0B4DY3EC9 Fan:PV902512PSPF HS:450666-001 HDD:832ES020S RAM:4x2GB MB:P70130K9VXWTGT Status:working'},
  {sn:'MXL94505BN',notes:'PSU:R93E6YDD302YMR CPU:5ABDP0BM7XI8WD Fan:435452-001 HS:450666-001 HDD:0F11009 RAM:2x512MB MB:P70130K9VXXIYO Status:working(Win8)'},
  {sn:'MXL9411C3H',notes:'PSU:384908476193 CPU:5AEKE014DX6687 Fan:435452-001 HS:450666-001 HDD:0F11009 RAM:4x2GB MB:P70130K9VXF8CC Status:Working'},
  {sn:'MXL94505BV',notes:'PSU:68BS971797 CPU:CT:5ABDP0AG5Y64R4 Fan:PV902512PSPF HS:450666-001 HDD:JR006TXS RAM:2x2GB MB:P70130J9VX86F6 Status:was in system restore'},
  {sn:'mxl94118cf',notes:'PSU:6rgs706691 CPU:CT:5ABDP0AG5XK7KU Fan:PV902512PSPF HS:450666-001 HDD:832eszyks RAM:2x2GB MB:p70130k9vxuguj Status:working'},
  {sn:'2UA9420444',notes:'PSU:N/A CPU:5ABDP0B4DXXBYA Fan:AD0912UX-A7BGL HS:450666-001 HDD:N/A RAM:2x2GB MB:PAVFE0N9VXVAEV Status:not working(no HDD/disk drive)'},
  {sn:'MXL94503M5',notes:'PSU:6RWS211138 CPU:CT:5ABDP0B4DXNHP0 Fan:PV902512PSPF HS:450666-001 HDD:MM2VHMKC RAM:4x2GB MB:P70130KSVY966Y Status:multiple OS'},
  {sn:'MXL0030BD7',notes:'PSU:6RGS857991 CPU:CT:5ABDP0B4DXVA7G Fan:PV902512PSPF HS:450666-001 HDD:WMAM9DPS7702 RAM:4x2GB MB:P70130K9VXXLTP Status:working'},
  {sn:'MXL9470YWW',notes:'PSU:405HCSF029638 CPU:5ABDP0BM7XX4LY Fan:PV902512PSPF HS:450666-001 HDD:HCS5C3232SLA30 RAM:2x512MB MB:P70130KSVXFO34 Status:WORKING'},
  {sn:'mxl9290rkq',notes:'PSU:286845426484 CPU:5abdp0b4dycex2 Fan:ad0912ux-a7bgl HS:480368-001 HDD:5qd1vkbg RAM:4x2GB MB:pabdh0f9vwsdu0 Status:posts/no OS'},
  {sn:'MXL9411860',notes:'PSU:6RBS815576 CPU:887763 Fan:PV902512PSPF HS:450666-001 HDD:HV2245TS RAM:1x2GB MB:P70130K9VXXHVG Status:WORKING'},
  {sn:'MXL9270X9C',notes:'PSU:244936006135 CPU:CT:5AEKE014DX63QU Fan:AUB0912VH HS:480368-001 HDD:MM33343C RAM:2x2GB MB:P70130K9VXICHA Status:working'},
  {sn:'2UA9251N11',notes:'PSU:6RGQB07352 CPU:CT:5ABDP0B5PY76A1 Fan:AUB0912VH HS:480368-001 HDD:6VY26F9X RAM:2x2GB MB:PABDH0K9VXG70D Status:working'},
  {sn:'MXL9450P68',notes:'PSU:6RBS817507 CPU:862189 Fan:435452-001 HS:450666-001 HDD:WCAPZ2893270 RAM:3 sticks MB:p70130k9vxwlh9 Status:WORKING'},
  {sn:'2UA94608SX',notes:'PSU:74409012NY4DH6 CPU:SABDP0BM7Y134I Fan:435452-001 HS:480368-001 HDD:wd3200JS RAM:4x1GB MB:PAVFE0NCYXUM3R Status:Disk error'},
  {sn:'MXL912031T',notes:'PSU:344945003628 CPU:5ADP0BM7XX2R0 Fan:AUB0912HV HS:450666-001 HDD:WCAPZ4087003 RAM:1x2GB MB:P70130KSVY6FNN'},
  {sn:'2ua9310628',notes:'PSU:R54068bzc54523 CPU:CT:5abdp0b4dxhpog Fan:AD0912UX-A7BGL HS:480368-001 HDD:9rw6c7q3 RAM:4 sticks MB:pabdh0f9vx7O6e Status:working'},
  {sn:'mxl9371cdd',notes:'PSU:947ch000989 CPU:CT:5abdp0b4dxzeub Fan:435452-001 HS:450666-001 HDD:c43451-0060 RAM:4x2GB MB:p70130k9vxubn8 Status:ssd failure'},
  {sn:'2UA912077C',notes:'PSU:6RDS214184 CPU:CT:5ABDP0B4DX6EZ4 Fan:AUB0912VH HS:450666-001 HDD:HV1SUMWE RAM:2x2GB MB:P70130J9VX5FP6 Status:not working(5 beep)'},
  {sn:'mxl0030blt',notes:'PSU:R93E6YDD302YM1 CPU:580796 Fan:435452-001 HS:450666-001 HDD:172825802417 RAM:2x1GB MB:p70130jsvx985n Status:working'},
  {sn:'2UA9430WQ8',notes:'CPU:285440 Fan:435452-001 HS:450666-001 HDD:WCARW6180492 RAM:1 stick MB:P70130KSVXMNV2'},
  {sn:'MXL95205Z1',notes:'PSU:6RGS829711 CPU:5ABDP0AG5Y65I5 Fan:435452-001 HS:450666-001 HDD:9RW50AGE RAM:2x2GB MB:P70130K9VY1B5U Status:Working'},
  {sn:'MXL9411894',notes:'PSU:344935009622 CPU:884464 Fan:AUB0912VH HS:450666-001 HDD:JR0V98AH RAM:1x4GB MB:P70130K9VXWT94 Status:working'},
  {sn:'MXL941183G',notes:'PSU:284907460429 CPU:CT:5ABDP0B4DXWDNC Fan:435452-001 HDD:WXA1A33K2681 RAM:2x1GB MB:p70130KSUXS2K1 Status:No CPU/No Heatsink'},
  {sn:'2ua9130fjy',notes:'PSU:419496-001 CPU:CT:5aeke014dx924z Fan:AD0912UX-A7BGL HS:480368-001 HDD:e96174-0749 RAM:2x2GB MB:pavfe0scyy761g Status:working'},
  {sn:'MXL94118BT',notes:'PSU:R93E6YDD302YV0 CPU:876187 Fan:PV9002512PSPF HS:450666-001 HDD:WCAT13513196 RAM:4x2GB MB:P70130K9VXWTG4 Status:working'},
  {sn:'2UA9280042',notes:'PSU:7AA802LKW3C0 CPU:CT:5ABDP0BM7YAL2 Fan:435452-001 HS:480368-001 HDD:9VY377WK RAM:2x2GB MB:PABDH0KCYXNDRC Status:not working(5 beep)'},
  {sn:'2UA9511JC2',notes:'PSU:R67468CZ114720 CPU:5ABDP0BM7XN0XI Fan:PV902512PSPF HS:480368-001 HDD:9VY1VY35 RAM:2x1GB MB:RAVFE0SCYY7VUM Status:Works(Multi-boot)'},
  {sn:'MLX94118B0',notes:'PSU:6RGS829471 CPU:5ABDP0AG5XE8Z0 Fan:PV902512PSPF HS:450666-001 HDD:732JKRPGS X15 RAM:3x2GB MB:p70130K9VXWTWC Status:Hanging in post'},
  {sn:'2UA9040QGQ',notes:'PSU:DH-16D5S11C CPU:5ABDP0B5PXY308 MB:PABDH0KSUXJE11 HS:450666-001 RAM:2x2GB Status:not working(no SSD)'},
  {sn:'MXL93008S1',notes:'PSU:6RBS715910 CPU:606554 Fan:PV902512PSPF HS:450666-001 HDD:HV1PU0MH RAM:1x1GB MB:P70130KSVXLL1E Status:working'},
  {sn:'MXL91604BL',notes:'PSU:6RWS211134 CPU:5ABDP0BM7XX1GF Fan:AUB0192VH HS:450666-001 HDD:142362402926 RAM:2x2GB MB:P70130JSVWUJ7I Status:working'},
  {sn:'2UA94608SS',notes:'PSU:7CD0AA540125 CPU:CT:5AYQB0AG5YE0W3 Fan:PV902512PSPF HS:450666-001 HDD:9RAB0STG RAM:2x1GB MB:PAVFE0SSUYC3XY Status:posts but wont boot'},
  {sn:'2ua0070227',notes:'PSU:R93E6YDD302YWP CPU:CT:5ABDP0B4DY3CN1 Fan:PV902512PSPF HS:480368-001 HDD:jq12m8uh RAM:1x2GB MB:pavfe0scyyf0xa Status:not working'},
  {sn:'2UA9310DCC',notes:'PSU:934CG011055 CPU:CT:5ABDP0B5PXW9YO Fan:AD0912UX-A7BGL HS:480368-001 HDD:9RW5DLB9 RAM:2x2GB MB:PAVFE0SCYYLE Status:DO NOT TURN ON'},
  {sn:'2ua9240znc',notes:'PSU:6RDS214281 CPU:899187 Fan:435452-001 HS:450666-001 HDD:JQ3840XH RAM:2 sticks MB:p70130k9vxwllx Status:working (Extra SSD: ASP600SS-32GM)'},
  {sn:'MXL00509B4',notes:'PSU:410125-200 CPU:5ABDP0B4DXN0BH Fan:AD0912UX-A7BGL HS:480368-001 HDD:174539807207 RAM:3x1GB+1x2GB MB:PAVFE0SCYYABGQ Status:not working'},
  {sn:'2UA949083K',notes:'PSU:68BSA18455 CPU:5ABDP0B4DY1UKS Fan:AD0912UX-A7BGL HS:EAEQP0AYGY44IK HDD:174539807072 RAM:4x2GB MB:PAVFE0SCYY97OL'},
  {sn:'2ua9310d8c',notes:'PSU:934cg009152 CPU:685045 Fan:AD0912UX-A7BGL HS:480368-001 HDD:wmav31529079 RAM:3x2GB MB:pabdh0kcyxnivc Status:working'},
  {sn:'mxl94521f1',notes:'PSU:6rts420754 CPU:CT:5abdp0b4dxxiht Fan:435452-001 HS:450666-001 HDD:Wd-Wmam9el72679 RAM:2x1GB MB:P70130k9vy1b64 Status:working'},
  {sn:'2UA9200KXZ',notes:'PSU:284801432233 CPU:5ABDP0B4DXCJY9 Fan:AD0912UX-A7BGL HS:480368-001 HDD:WCAT15182112 RAM:4x2GB MB:ABDH0FSUX8B2L Status:working'},
  {sn:'2UA949056J',notes:'PSU:419496-001 CPU:460974-001 Fan:435452-001 HS:480368-001 HDD:JQ2Z0PKH RAM:4x2GB MB:PAVFE0SCYY7Y3P Status:working'},
  {sn:'2UA942043X',notes:'PSU:7440901GYXWLCU CPU:5ABDP0BM7XX8NC Fan:AD0912UXA7BGL HS:480368-001 HDD:9VY9LS74 RAM:4x2GB MB:PAVFE0N9VXVAFL'},
  {sn:'2UA9240ZMW',notes:'PSU:410125-200 Fan:425452-001 HS:450666-001 HDD:WCAPZ4067448 RAM:3x2GB+1x1GB MB:P70130K9VXZE50 Status:not working'},
  {sn:'MXL94118BR',notes:'PSU:6RDS215838 CPU:5ABDP0M7X81HO Fan:435452-001 HS:450666-001 HDD:9S113A-033 RAM:2x2GB MB:p70130K9VXYU8D Status:Working'},
  {sn:'2UA9431520',notes:'PSU:R93E6YDD302YWM CPU:5ABDP0AG5Y93MG Fan:PV902512PSPF HS:480368-001 HDD:6QZ3PGKR RAM:4x2GB MB:PAVFE0R9VY164C Status:CORRUPT BIOS'},
  {sn:'MXL9350Y1Z',notes:'PSU:381915403387 CPU:CT:5ABDP0B4DXA4I7 Fan:PV902512PSPF HS:450666-001 HDD:WMAP94690902 RAM:2x2GB MB:P70130K9VXQPQH Status:working'},
  {sn:'NL014UC#ABA',notes:'PSU:260936003661 CPU:5ABDP0BM7WN2RT Fan:435452-001 HS:450666-001 HDD:174539802990 RAM:1x2GB MB:P7013DJ8VX8D35 Status:not working'},
  {sn:'JPA00401ZY',notes:'PSU:3B9942006490 CPU:SABDP0BM7Y1611 Fan:PV902512PSPF0D HDD:Z1E3E3JN RAM:2x1GB MB:PAVFE0NCYXUYFG'},
  {sn:'2UA9150BWD',notes:'PSU:2272505021190 CPU:5ABDP0BM7XI8XM Fan:AUB0912VH HS:450666-001 HDD:WCAPZ2614588 RAM:2x2GB+2x1GB MB:P70130K9VXZ8SB Status:not working(3 beep)'},
  {sn:'MXL92408LH',notes:'PSU:934CG018373 CPU:CT:5AEKE014DX65zy Fan:3851A134 HS:450666-001 HDD:HV3XMPFC RAM:377725-888-X3 MB:P70130K9VY18UR'},
  {sn:'2UA9511JDK',notes:'PSU:6RGS836379 CPU:5ABDP0B5PXX1EB Fan:435452-001 HS:480368-001 HDD:0F16113 RAM:2x2GB MB:PABDH0F9VX8ULA Status:Working'},
  {sn:'Mxl9450XTT',notes:'PSU:6RGS838132 CPU:CT:5abdp0b4dx9beg Fan:435452-001 HS:450666-001 HDD:wcat16089249 RAM:4 sticks MB:P70130ksvxfqcq Status:posts/no os'},
  {sn:'2ua00113v7',notes:'PSU:934cg017366 CPU:CT:5abdp0b4dy884t HS:480368-001 HDD:jq3ynvvs RAM:3x2GB MB:pavfe0ssuyb70p Status:working'},
  {sn:'MXL9411C8T',notes:'PSU:R93E6YDD302YLY CPU:866239 Fan:PV902512PSPF HS:450666-001 HDD:5LR470EP RAM:2 sticks MB:P70130K9VXWSHA Status:working'},
  {sn:'MXL94215MD',notes:'PSU:6RGS838313 CPU:CT:5ABDP08M7XY3GS Fan:PV902512PSPF HS:450666-001 HDD:603ABBF0 RAM:2x2GB MB:P70130K8VXZGGB Status:WORKING'},
  {sn:'MXL91908ZZ',notes:'PSU:R93E68ED202XLK CPU:5ABDP0B4DY3D9Y Fan:PV902512PSPF HS:450666-001 HDD:WMAM98848227 RAM:4x2GB MB:P70130K9VXWT21 Status:working'},
  {sn:'2UA95111LP',notes:'PSU:946CG012950 CPU:CT:5ABDP0AG5Y983C Fan:PV902512PSPF HS:480368-001 HDD:WMAV2S402145 RAM:2x2GB MB:PAVFE0SCYY7Y6K Status:working in wrong res'},
  {sn:'MXL9370Y5M',notes:'PSU:405HCSF029590 CPU:5ABDP0B4DXW773 Fan:PV902512PSPF HS:450666-001 HDD:E89894-1231 RAM:3x2GB MB:P70130KSVY97XE Status:working'},
  {sn:'2UA9150BY6',notes:'PSU:6RGS829554 CPU:844488 Fan:AUB0912VH HS:450666-001 HDD:9RW6YRN0 RAM:2x1GB MB:P70130K9VXWTKU Status:working'},
  {sn:'2UA937029D',notes:'PSU:6GBS210087 CPU:5840601G5XRA2F Fan:AD0912UX-A7BCL HS:480368-001 HDD:9VY2B1PD RAM:4x1GB MB:PAVFE0N9VXR2CJ Status:WORKING'},
  {sn:'MXL94215SG',notes:'PSU:405HCRN029582 CPU:605125 Fan:PV902512PSPF HS:450666-001 HDD:WMAV31626922 RAM:1x1GB MB:P70130K9VXWFSE Status:working'},
  {sn:'MXL9411C39',notes:'PSU:6RGS274373 CPU:5ABDP0B4DX6IT4 Fan:435452-001 HS:450666-001 HDD:174539806774 RAM:4x1GB MB:P70130JSVX8PF3 Status:working'},
  {sn:'2ua9490f5l',notes:'PSU:405hcqx029540 CPU:1064513 Fan:PV902512PSPF HS:480368-001 HDD:wmam9jj98616 RAM:4x2GB MB:pavfe0s9vy7j0r Status:working'},
  {sn:'MXL94713DZ',notes:'PSU:68BS932668 CPU:5ABDP0B5PXY2NF Fan:PV902512PSPF HS:E70120AYGXV6FQ HDD:WX51A2347304 RAM:2x2GB MB:P70130K9VXIDP'},
  {sn:'2UA949148K',notes:'PSU:6RGS644312 CPU:5ABDP0AG5Y82HB Fan:PV902512PSPF HS:EAEQP0AX9Y68MU HDD:9RW7NPC1 RAM:4x2GB MB:PAVFE0SCYY6CKB'},
  {sn:'MXL92814WG',notes:'PSU:943CG017576 CPU:849526 Fan:AUB0912VH HS:450666-001 HDD:JQ1DGMVH RAM:1x2GB MB:P70130K9VXIFE5 Status:working'},
  {sn:'MXL91604BP',notes:'PSU:405HCPY029584 CPU:CT:5ABDP0B4DX9UY2 Fan:AUB0912VH HS:450666-001 HDD:0F11009 RAM:2x2GB MB:P70130KSVY7EM4 Status:working'},
  {sn:'MXL9450WV0',notes:'PSU:R93E68ED302XK4 CPU:CT:5ABDP0B4DX8HSB Fan:PV902512PSPF HS:450666-001 HDD:6vy2e31y RAM:2x2GB MB:P70130K9VXZFC5 Status:working'},
  {sn:'mxl95300xx',notes:'PSU:431162-001 CPU:CT:5abdp0ag5xc6hr Fan:435452-001 HS:450666-001 HDD:174809a002a7 RAM:2x2GB MB:p70130ksvxlkb4 Status:working'},
  {sn:'MXL9520CN4',notes:'PSU:R93E6YDD302YWL CPU:5ABDP0B4DX7ME8 Fan:435452-001 HS:E70120AX9Y3OFW HDD:WCAWFC338528 RAM:2x2GB MB:P70130J9VX7AZT Status:WORKING'},
  {sn:'MXL9411C7T',notes:'PSU:R93E6YDD302YMB CPU:5AEKE014DWY05Y Fan:PV9002512PSPF HS:450666-001 HDD:JR0TGJXK RAM:2x2GB MB:P70130JSVX5378 Status:working'},
  {sn:'2ua9150bwb',notes:'PSU:419496-001 CPU:898176 Fan:AUB0912VH HS:450666-001 HDD:3qd0qlnl RAM:1x1GB MB:p70130ksvy6frf Status:Works(Win7)'},
  {sn:'MXL9450XVM',notes:'PSU:244930037906 CPU:CT:5ABDP0AG5X535J Fan:PV902512PSPF HS:450666-001 HDD:JQ32W9VK RAM:1x1GB MB:P70130K9VXZFE3 Status:working'},
  {sn:'2UA9150BWH',notes:'PSU:384908476440 CPU:5AEKE014DX664V Fan:AUB0912VH HS:450666-001 HDD:WCAYV2077887 RAM:4x2GB MB:P70130J9VX7RZ8 Status:Working'},
  {sn:'MXL9270X0L',notes:'PSU:B9KCBP2592858 CPU:CT:5ABDP0AG5Y92LW HS:450666-001 HDD:9VY1CK2D RAM:1x1GB+1x2GB MB:P70130K9VXWS1E Status:windows recovery mode'},
  {sn:'2ua0050595',notes:'PSU:405HAHY027353 CPU:CT:5abdp0b4dyb4mh Fan:435452-001 HS:480368-001 HDD:9vy8g9sc RAM:3x2GB MB:pavfe0scyye4vr Status:working'},
  {sn:'2UA9140YNY',notes:'PSU:410125-501 CPU:5ABDP0B4DXYH38 Fan:G92283 HS:480368-001 HDD:N/A RAM:4x1GB MB:PABDH0KK9VXJIY Status:no HDD'},
  {sn:'MXL91180Y', notes:'PSU:934CG006996 CPU:885294 Fan:PV902512PSPF HS:450666-001 HDD:HV27E24A RAM:2x2GB MB:P70130K9VXWFLJ Status:WORKING'},
  {sn:'mxl9450kfz',notes:'PSU:6rd9365597 CPU:CT:5abdp0b4dxg15O Fan:435452-001 HS:450666-001 HDD:JQ379AKH RAM:1x2GB+1x1GB MB:P70130K9VXXF8O Status:POSTS/no boot'},
  {sn:'2UA92504PH',notes:'PSU:H3D0CL138194 CPU:CT:5ABDP0B4DXEA5F Fan:AD0912UX-A7BGL HS:480368-001 HDD:9RW59H5G RAM:4x2GB MB:PABDH0K9VXF1C9 Status:boots Win7 pro'},
  {sn:'MXL94215QZ',notes:'PSU:6RDS300637 CPU:5ABDP0AG5XXO80 Fan:PV902512PSPF HS:480368-001 HDD:MM2HSVA RAM:2x2GB MB:P70130K9Y533F Status:working'},
  {sn:'MXL9160484',notes:'PSU:405HCQX029588 CPU:CT:5ABDP0B4DW01ZR Fan:AUB0912VH HS:450666-001 HDD:WMAP9H392286 RAM:2x2GB MB:P70130JSVX5IS0 Status:working'},
  {sn:'MXL9411865',notes:'PSU:R93E6YDD302YLV CPU:844269 Fan:PV902512PSPF HS:450666-001 HDD:WCAPZ2418589 RAM:2x1GB MB:P70130J9VX7RM7 Status:working'},
  {sn:'2UA91109TZ',notes:'PSU:R93E6YDD302YQJ CPU:844523 Fan:AUB0912VH HS:450666-001 HDD:WMAP94768085 RAM:2x2GB MB:P70130K9VKWA58 Status:Working'},
  {sn:'MXL9450KM6',notes:'PSU:6RGS836519 CPU:CT:5AEKE014DX84IW Fan:PV902512PSPF HS:450666-001 HDD:WCAPZ2087516 RAM:2x2GB MB:P70130K9VXZAL6 Status:working'},
  {sn:'MXL92806J8',notes:'PSU:H3D0CL138191 CPU:5AYQB0AG5YD0LO Fan:PV902512PSPF HS:450666-001 HDD:WCARW6023183 RAM:2x512MB MB:P70130JSVX8H4G Status:WORKING'},
  {sn:'MXL941183H',notes:'PSU:344935009753 CPU:862474 Fan:PV902512PSPF HS:450666-001 HDD:DOESNT HAVE RAM:4x2GB MB:P70130K9VXWTN2 Status:working'},
  {sn:'MXL9421BD9',notes:'PSU:234926006569 CPU:5ABDP0BM7XJ0AT Fan:435452-001 HS:450666-001 HDD:6VY2B0Y9 RAM:2x2GB MB:P70130J9VX99SL Status:working'},
  {sn:'MXL9411C3M',notes:'PSU:6RBS660629 CPU:ct:5ABDP0AG5XB6OK Fan:435452-001 HS:450666-001 HDD:9RW2511E RAM:1x2GB MB:P70130KSVY6DPO Status:Power on bootloops'},
  {sn:'MXL9450XQP',notes:'PSU:934CG017460 CPU:ct:5ABDP0B4DX9I6N Fan:PV902512PS0D HS:450666-001 HDD:732HGJ2GS RAM:2x2GB MB:P70130J9VX7S6N Status:WORKING'},
  {sn:'MXL9411829',notes:'PSU:292911443671 CPU:868283 Fan:PV902512PSPF HS:450666-001 HDD:9VY1T2RW RAM:4x2GB MB:P70130K9VXWE8H Status:not working(ram error)'},
  {sn:'MXL9450P3Q',notes:'PSU:384929007156 CPU:CT:5abdp0ag5xdbtw Fan:435452-001 HS:450666-001 HDD:wcav30355501 RAM:2x1GB MB:p70130ksvxijdy Status:working'},
  {sn:'MXL935188D',notes:'PSU:R93E6YDD302YM5 CPU:CT:5ABDP0B4DXXIFB Fan:PV9002512PSPF HS:450666-001 HDD:N/A RAM:1x1GB+1x2GB MB:P70130KSVXJOSN Status:No HDD'},
  {sn:'MXL94117Z9',notes:'PSU:419496-001 CPU:868290 Fan:PV902512PSPF HS:450666-001 HDD:WD1600AABS-61PRA0 RAM:2x2GB MB:P70130K9VXWHJ9 Status:NO BOOT'},
  {sn:'MXL93518GV',notes:'CPU:887629 Fan:PV902512PSPF HS:450666-001 HDD:WCAPD4225629 RAM:2x2GB MB:p70130ksvy72a6 Status:working'},
  {sn:'MXL9450KDM',notes:'PSU:6RGS390458 CPU:CT:5ABDP0AG5Y63SE Fan:PV902512PSPF HS:450666-001 HDD:5RW4Z3BH RAM:2x1GB MB:P70130K9VXXEKS Status:working'},
  {sn:'2ua94006yx',notes:'PSU:405hahy027137 CPU:CT:5abdp0ag5xu2hy Fan:PV902512PSPF HS:480368-001 HDD:sc300s37a/240g RAM:1x2GB MB:pavfe0nd6xs0ls Status:working'},
  {sn:'MXL9260F95',notes:'PSU:6RTS418516 CPU:494405 Fan:AUB0912VH HS:450666-001 HDD:WCAPZ4076314 RAM:1x512MB+1x2GB MB:P70130JSVX8L5N Status:WORKING(WinXP)'},
  {sn:'2UA8220V5K',notes:'PSU:304HAHY298825 CPU:CT:530510BG5VX4OB Fan:AD0912UX-A7BGL HS:449796-001 HDD:MM33HD3C RAM:4x1GB MB:P30490FSVVY40Y Status:WORKING Win7'},
  {sn:'2UA928002F',notes:'PSU:R93E6YDD302YMA CPU:5ABDP0B4DXYGZ9 Fan:435425-001 HS:480368-001 HDD:50026B044501 RAM:4x2GB MB:PABDH0KSUXJMMV Status:blinking red'},
  {sn:'MXL93008S6',notes:'PSU:7AA8802LKXH4WL CPU:5ABDP0B4DWJ00U Fan:PV902512PSPF HS:450666-001 HDD:JR0S8BKS RAM:4x2GB MB:P70130K9VXI374 Status:WORKING'},
  {sn:'2ua9140brc',notes:'PSU:R93e68bd4001b1 CPU:CT:5ABDP0B4DX74YZ Fan:pv902512pspf HS:480368-001 HDD:wcapz2285926 RAM:2x2GB MB:pabdh0f9vx5aot Status:not working'},
  {sn:'2UA94315VG',notes:'PSU:68CS926231 CPU:5ABDP0B4DXY7AJ Fan:PV902512-001 HS:480368-001 HDD:JQ3Z36LS RAM:2x2GB MB:PAVFE0R9VY1AU0 Status:boot looping'},
  {sn:'2ua9150bxj',notes:'PSU:934CG007353 CPU:5AEKEA3M7X82VL Fan:AUB0912VH HS:450666-001 HDD:MM2U3S8C RAM:2x512MB+2x2GB MB:P70130K9VXZFBT Status:WORKING'},
  {sn:'MXL9270X27',notes:'PSU:227250501827 CPU:5AEKE014DX6D0F Fan:AUB0912VH HS:E70120AYGX785H HDD:5YD4Z24T RAM:4x1GB MB:P70130KSVY72G8 Status:working'},
  {sn:'MXL0030F37',notes:'PSU:344947004598 CPU:CT:5AEKE014DX848G4 Fan:PV9002512PSPF HS:450666-001 HDD:9RXDSM5C RAM:4x2GB MB:P70130K9VXXJ96 Status:working'},
  {sn:'MXL95205JC',notes:'PSU:227250501828 CPU:SAVDP0BM7XX5O2 Fan:435452-001 HS:450666-001 HDD:HV3J7ZGS RAM:1x2GB MB:P70130KSVY6DQQ Status:Working'},
  {sn:'MXL9270XF1',notes:'PSU:R93E6YDD302YLX CPU:5ABDP0AG5XU4TE Fan:AUB0912VH HS:450666-001 HDD:N/A RAM:2x2GB MB:P70130K9VXSU7F Status:No HDD'},
  {sn:'MXL9411839',notes:'PSU:284921408629 CPU:CT:5ABDP0B4DXDBPH Fan:435452-001 HS:450666-001 HDD:WCAPD3292042 RAM:3x512MB+1x2GB MB:P70130KSVXHE8F Status:posts/no OS'},
  {sn:'2ua9040qmv',notes:'PSU:284904433375 CPU:CT:5ABDP0B4DWO1VK Fan:AUB0912VH HS:480368-001 HDD:6VY27H9H RAM:4x1GB MB:PABDH0F9VWSCTX Status:POSTS/WIN CORRUPTED'},
  {sn:'MXL9351639',notes:'PSU:344935009744 CPU:5ABDP0B4DXXNJX Fan:PV902512PSPF HS:450666-001 HDD:HV1SNR2H RAM:4x2GB MB:P70130K9VXL6RQ Status:WORKING'},
  {sn:'MXL9350Y4C',notes:'PSU:244930037972 CPU:763716 Fan:PV902512PSPF HS:450666-001 HDD:WCAPD3839788 RAM:4x2GB MB:P70130K9VXQRML Status:WORKING'},
  {sn:'2UA9090RJW',notes:'PSU:6RWS214619 CPU:887058 Fan:AUB0912VH HS:450666-001 HDD:HV1YHRDH RAM:1x2GB MB:P70130K9VXXEVZ Status:will not boot(5 beeps)'},
  {sn:'MXL9270X3B',notes:'PSU:R67468BZ310045 CPU:CT:5abDP0Aag5xdcal Fan:AUB0912VH HS:450666-001 HDD:JR0TU9GH RAM:2x2GB MB:P70130jsvx5ijp Status:Working'},
  {sn:'mxl9371cvl',notes:'PSU:935ch006679 CPU:897528 Fan:PV902512PSPF HS:450666-001 HDD:mm2np52c RAM:2x2GB MB:p70130ksvy69dk Status:working'},
  {sn:'MXL9520578',notes:'PSU:6GFSB10690 CPU:869535 Fan:435452-001 HS:450666-001 HDD:WCAPZ3814286 RAM:2x2GB MB:P70130KSVXFLZP Status:WORKING'},
  {sn:'2UA91902W9',notes:'PSU:929CG049695 CPU:CT:5ABDP0B4DY38G6 Fan:AUB0912VH HS:450666-001 HDD:9RW80Z7V RAM:2x2GB MB:P70130J9VX7RY9 Status:working'},
  {sn:'2UA9070J6W',notes:'PSU:7AA8801LKX6JM6 CPU:5ABDP0B4DY3B8Q Fan:AUB0912VH HS:450666-001 HDD:6VY26KEG RAM:1x2GB MB:P70130Ksvy7dx4 Status:working'},
  {sn:'2UA9150BTF',notes:'PSU:R93E68BD4001B0 CPU:CT:5ABDP0B5PXW9X8 Fan:AUB0912VH HS:450666-001 HDD:HV2AMRXK RAM:2x2GB+2x1GB MB:P70130K9VXXFZ9 Status:working Win7'},
  {sn:'MXL9320YSJ',notes:'PSU:6RDS2114512 CPU:861509 Fan:435452-001 HS:450666-001 HDD:MM17TDAA RAM:2x2GB MB:P70130KSVXWTGL Status:Working'},
  {sn:'MXL9320VMP',notes:'PSU:68CS925962 CPU:CT:5ABDP0B4DY39S0 Fan:PV902512PSPF HS:450666-001 HDD:WCAPZ2383624 RAM:1x1GB MB:P70130K9VY1FGS Status:working'},
  {sn:'MXL95300XG',notes:'PSU:R67468CZ403399 CPU:CT:5ABDP0B4DXCZQO Fan:435452-001 HS:480368-001 HDD:C43451-0131 RAM:2x2GB MB:P70130K9VXZE5V Status:Working'},
  {sn:'2UA9451GZ8',notes:'PSU:410125-200 CPU:5ABDP0B4DX4GZP Fan:435452-001 HS:450666-001 HDD:832ESZYAS RAM:2x2GB MB:P70130K9VXXJMM Status:Working'},
  {sn:'MXL94505C6',notes:'PSU:3494945003382 CPU:869625 Fan:PV902512PSPF HS:450666-001 HDD:MM18RE8A RAM:1x1GB+1x512MB MB:P70130K9VXWTWC Status:working'},
  {sn:'mxl93207p3',notes:'PSU:419496-001 CPU:CT:5abdp0bm7xlcld Fan:PV902512PSPF HS:450666-001 HDD:ASP600ss-32gm RAM:2x2GB MB:P70130KSVXJISY Status:working'},
  {sn:'2UA95116VX',notes:'PSU:JP1572FN1R58UK CPU:5ABDP0BM7Y703H Fan:PV902512PS0D HS:480368-001 HDD:JP1572FN1R58UK RAM:4x2GB MB:PAVFE0SSUYC2V2 Status:not working/no os'},
  {sn:'2UA91302PS',notes:'PSU:24493600S844 CPU:5ABDP0B4DX00NJ Fan:AUB0912VH HS:480368-001 HDD:WMAV40121494 RAM:4x2GB MB:PABDH0FSUX82YD Status:working'},
  {sn:'MXL8200KH2',notes:'PSU:B9JCBP2488606 CPU:530520A4DVV0SK Fan:437352-001 HS:449769-001 HDD:WMAP95472995 RAM:4x1GB MB:P30490E9VVWH42 Status:working'},
  {sn:'MXL002189Y',notes:'PSU:410125-200 CPU:5ABDP0AG5XCE27 Fan:435452-001 HS:450666-001 HDD:0F11009 RAM:2x2GB MB:P70130J9VX79O3 Status:Blinking red(no display)'},
  {sn:'MXL9520HGQ',notes:'PSU:R93E6YDD302YM2 CPU:CT:5AEKE014DWW8VN Fan:435452-001 HS:450666-001 HDD:9RW82KW5 RAM:377735-888 MB:P70130K9VXWTJ0'},
  {sn:'MXL94118D2',notes:'PSU:R93E6YDD302YLR CPU:88019 Fan:PV902512PSPF HS:450666-001 HDD:732KMBHGS X15 RAM:1x1GB+1x2GB MB:P70130K9VXWTJ0 Status:working'},
  {sn:'2UA9120776',notes:'PSU:6RBS715907 CPU:CT:5ABDP0B4DY3E5X Fan:AUB0912VH HS:450666-001 HDD:732JPP7GS X15 RAM:4x2GB MB:P70130KSVY6DUO Status:working'},
  {sn:'MXL9520H9Q',notes:'PSU:R93E6YDD302YM7 CPU:CT:5AE014DX84I1 Fan:PV902512PSPF HS:450666-001 HDD:JQ09HHEK RAM:4x2GB MB:P70130KSVY6BOW Status:working'},
  {sn:'MXL94717NW',notes:'PSU:419496-001 CPU:849522 Fan:435452-001 HS:450666-001 HDD:JR0TDKJK RAM:2x2GB MB:P70130J9VX79PM Status:WORKING'},
  {sn:'2ua93106YS',notes:'PSU:447310-001 CPU:648917 Fan:N969B1B HS:480368-001 HDD:9RW52CGN RAM:4x1GB MB:PABDH0KCYXNIC6 Status:Working'},
  {sn:'MXL92806H6',notes:'PSU:419496-001 CPU:638367 Fan:PV902512PSPF HS:450666-001 HDD:jq1azmuk RAM:2x2GB MB:p70130ksuxs4j7 Status:doesnt work'},
  {sn:'2UA9420KYD',notes:'PSU:360946001526 CPU:5AEKE014DX920N Fan:PV902512PSPF HS:450666-001 HDD:JR0VSJEH RAM:2x2GB MB:P70130KSVXIHKF'},
  {sn:'mxl94118db',notes:'PSU:419496-001 CPU:CT5abdp0bm7xx1FE Fan:435452-001 HS:450666-001 HDD:JQ32xzek RAM:1x2GB+1x1GB MB:p70130ksv6d8l Status:working'},
  {sn:'mxl91604b7',notes:'PSU:N/A CPU:610825 Fan:AUB0912VH HS:450666-001 HDD:jq32s2mk RAM:1x1GB+1x2GB MB:P70130k9vy1b1b Status:working'},
  {sn:'MXL945016B',notes:'PSU:344935007604 CPU:CT:5ABDP0AG5XU2IR Fan:PV902512PSPF HS:450666-001 HDD:WXE1E3DZRE3 RAM:2x2GB MB:P70130K9VXWSFT Status:4 beep post'},
  {sn:'MXL942085P',notes:'PSU:34492400435 CPU:719917 Fan:PV902512PSPF HS:450666-001 HDD:JQ05K75H RAM:1x2GB MB:P70130K9VXZECD Status:DO NOT BOOT - PSU SMELLS'},
  {sn:'2UA9040QLH',notes:'PSU:410125-200 CPU:353138 Fan:AUB0912VH HS:480368-001 HDD:9VY1TQHC RAM:2x2GB MB:PABDH0FSUX6S1G Status:Hanging in post(Smells funky)'},
  {sn:'2UA9260TP1',notes:'PSU:419496-001 CPU:5ABDP0AG5XB6NY Fan:AD0912UX-A7BGL HS:480368-001 HDD:6VY1R2W8 RAM:4 sticks MB:PABDH0KSUXH4QR Status:working'},
  {sn:'2ua916030j',notes:'PSU:405hche023729 CPU:5abdp0b4dxu4e4 Fan:AD0912UX-A7BGL HS:480368-001 HDD:wcapz4089893 MB:PABDH0KSUXH4QR Status:not working'},
];

for (const { sn, notes } of hpCompaqData) {
  setCompaqNotes(sn, notes);
}

console.log(`\n════════════════════════`);
console.log(`Total added:   ${totalAdded}`);
console.log(`Total skipped: ${totalSkipped}`);
console.log(`Total missing: ${totalMiss}`);
console.log('\nMISSes = item name not found in DB — check spelling and re-run.');
