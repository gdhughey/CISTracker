'use strict';

// ─────────────────────────────────────────────────────────────
// CyberLab Tracker — on-prem client
// Same UI as the AWS build, rewired to /api/* with session
// cookies + double-submit CSRF instead of Cognito.
// ─────────────────────────────────────────────────────────────

let ME = null;          // current signed-in user
let usr = '';           // selected checkout user (name string)
let cacheLog = [];      // last fetched activity log
let cacheUsers = [];    // last fetched admin user list (for search filter)
let cacheCI = [];       // last fetched check-in list (for search filter)
let cacheInv = [];      // last fetched inventory list
let invStatus = 'all';  // current inventory status filter
let kioskUsers = [];    // admin-only: list of users available as kiosk borrower
let _lastFocusedBeforeOverlay = null; // for restoring focus after closing overlays

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// SQLite datetime('now') stores UTC without a timezone suffix.
// Append 'Z' so the browser converts to the user's local timezone.
function utc(d) {
  if (!d) return new Date(NaN);
  const s = String(d).trim();
  if (/[Zz+\-]\d{2}:?\d{2}$/.test(s) || s.endsWith('Z')) return new Date(s);
  return new Date(s.replace(' ', 'T') + 'Z');
}

// ── HTTP helpers ──────────────────────────────────────────────
function getCookie(name) {
  const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[2]) : null;
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const csrf = getCookie('csrf_token');
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const r = await fetch(path, { ...opts, headers, credentials: 'same-origin' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || r.statusText || 'Request failed');
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

function toast(msg, type) {
  const el = $('toast');
  el.textContent = msg;
  el.style.borderColor =
    type === 'red' ? 'var(--red)' :
    type === 'green' ? 'var(--green)' :
    type === 'yellow' ? 'var(--yellow)' : 'var(--border)';
  el.style.display = 'block';
  // Make toasts announceable to screen readers
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  clearTimeout(window._tt);
  window._tt = setTimeout(() => (el.style.display = 'none'), 3200);
}

// ── Page switching ────────────────────────────────────────────
function swPage(p, fromPop) {
  // Non-admins can't see the log/inventory pages — bounce to checkout.
  const adminOnly = ['log', 'inventory'];
  if (adminOnly.includes(p) && (!ME || ME.role !== 'admin')) p = 'checkout';
  $('backBtn').style.display = p === 'checkout' ? 'none' : 'inline-block';
  if (!fromPop) history.pushState({ page: p }, '', location.href);
  ['checkout', 'checkin', 'inventory', 'log'].forEach((x) => {
    const pg = $('pg-' + x);
    const bt = $('bt-' + x);
    if (pg) pg.classList.toggle('on', x === p);
    if (bt) {
      bt.classList.toggle('on', x === p);
      bt.setAttribute('aria-selected', x === p ? 'true' : 'false');
    }
  });
  $('scr').scrollTop = 0;
  // Auto-load when entering tabs that need data
  if (p === 'checkin') loadCI();
  if (p === 'log') loadLog();
  if (p === 'inventory') loadInventory();
}
window.swPage = swPage;

window.addEventListener('popstate', (e) => swPage((e.state && e.state.page) || 'checkout', true));

// ── Manual entry ──────────────────────────────────────────────
function prepManual() {
  const n = $('m_name').value.trim();
  if (!n) { toast('Equipment name required!', 'yellow'); return; }
  popV({
    name: n,
    type: $('m_type').value.trim(),
    serial: $('m_serial').value.trim(),
    barcode: $('m_barcode').value.trim(),
    notes: $('m_notes').value.trim(),
  });
}
window.prepManual = prepManual;

// Pressing Enter (or clicking 🔎 Look Up) on the Check Out manual entry
// barcode field calls /lookup just like the camera scanner. If a row
// matches, jump straight into the populated Confirm Check Out modal —
// no re-typing the name/type/serial. If it doesn't, we leave the form
// alone so the user can keep filling in a new manual item.
async function manualBarcodeLookup() {
  const code = ($('m_barcode').value || '').trim();
  const status = $('m_lookup_status');
  if (status) { status.textContent = ''; status.classList.remove('err', 'ok'); }
  if (!code) {
    if (status) { status.textContent = 'Enter or scan an asset ID first.'; status.classList.add('err'); }
    $('m_barcode').focus();
    return;
  }
  if (status) status.textContent = `Looking up ${code}...`;
  try {
    const { item } = await api('/api/equipment/lookup?code=' + encodeURIComponent(code));
    if (status) { status.textContent = `Found ${item.name} — confirm to check out.`; status.classList.add('ok'); }
    openConfirmModal(item, 'checkout');
  } catch (err) {
    if (err && err.status === 404) {
      if (status) {
        status.textContent = `No inventory item matches ${code}. Fill in the rest of the form to create a new item.`;
        status.classList.add('err');
      }
      // Focus the name field so the admin can finish creating a new item.
      const nameEl = $('m_name');
      if (nameEl && !nameEl.value.trim()) nameEl.focus();
    } else {
      if (status) { status.textContent = err.message || 'Lookup failed'; status.classList.add('err'); }
    }
  }
}
window.manualBarcodeLookup = manualBarcodeLookup;

// ── Browse inventory (checkout tab) ─────────────────────────
let cacheBrowse = [];

async function loadBrowseInventory() {
  const el = $('browseList');
  el.innerHTML = '<div class="sw"><div class="sp" aria-hidden="true"></div><span>Loading...</span></div>';
  try {
    const { items } = await api('/api/equipment');
    cacheBrowse = (items || []).filter(i => i.status === 'available');
    // Populate category dropdown
    const cats = [...new Set(cacheBrowse.map(i => i.category).filter(Boolean))].sort();
    const sel = $('browseCat');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All Categories</option>';
    cats.forEach(c => {
      const o = document.createElement('option');
      o.value = c; o.textContent = c;
      sel.appendChild(o);
    });
    if (cur) sel.value = cur;
    filterBrowseInventory();
  } catch (err) {
    el.innerHTML = '<div class="es"><div class="ei">⚠️</div><div class="et">' + esc(err.message) + '</div></div>';
  }
}
window.loadBrowseInventory = loadBrowseInventory;

function filterBrowseInventory() {
  const q = ($('browseSearch').value || '').trim().toLowerCase();
  const cat = ($('browseCat').value || '');
  const el = $('browseList');
  let filtered = cacheBrowse;
  if (cat) filtered = filtered.filter(i => i.category === cat);
  if (q) {
    filtered = filtered.filter(i =>
      (i.name || '').toLowerCase().includes(q) ||
      (i.serial_number || '').toLowerCase().includes(q) ||
      (i.barcode || '').toLowerCase().includes(q) ||
      (i.category || '').toLowerCase().includes(q) ||
      (i.type || '').toLowerCase().includes(q)
    );
  }
  if (!filtered.length) {
    el.innerHTML = '<div class="es"><div class="ei">🔍</div><div class="et">No available items match</div></div>';
    return;
  }
  // Show max 50 items at a time
  const shown = filtered.slice(0, 50);
  el.innerHTML = '';
  shown.forEach(item => {
    const row = document.createElement('div');
    row.className = 'ci-row';
    row.style.cursor = 'pointer';
    row.onclick = () => openConfirmModal(item, 'checkout');

    const left = document.createElement('div');
    left.className = 'ci-left';
    const nameEl = document.createElement('div');
    nameEl.className = 'cname';
    nameEl.textContent = item.name;
    const meta = document.createElement('div');
    meta.className = 'cmeta';
    const parts = [item.barcode, item.category, item.serial_number].filter(Boolean);
    meta.textContent = parts.join(' · ');
    left.appendChild(nameEl);
    left.appendChild(meta);

    const btn = document.createElement('button');
    btn.className = 'btn bg bsm';
    btn.textContent = '📤 Out';
    btn.setAttribute('aria-label', 'Check out ' + item.name);
    btn.onclick = (e) => { e.stopPropagation(); openConfirmModal(item, 'checkout'); };

    row.appendChild(left);
    row.appendChild(btn);
    el.appendChild(row);
  });
  if (filtered.length > 50) {
    const more = document.createElement('div');
    more.className = 'es';
    more.innerHTML = '<div class="et">Showing 50 of ' + filtered.length + ' — narrow your search</div>';
    el.appendChild(more);
  }
}
window.filterBrowseInventory = filterBrowseInventory;

// ── Verify card ───────────────────────────────────────────────
function popV(d) {
  $('v_name').value = d.name || '';
  $('v_type').value = d.type || '';
  $('v_serial').value = d.serial || '';
  $('v_barcode').value = d.barcode || '';
  $('v_notes').value = d.notes || '';
  // For admin kiosk mode show the *target* student; otherwise the signed-in user.
  const target = (ME && ME.role === 'admin') ? selectedKioskUsername() : usr;
  $('v_user').textContent = target || usr;
  $('v_dt').textContent = new Date().toLocaleString();
  const vc = $('vcard');
  vc.classList.remove('hidden');
  setTimeout(() => vc.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
}

function cancelV() { $('vcard').classList.add('hidden'); }
window.cancelV = cancelV;

// Look up an existing equipment row by barcode or serial.
// Returns the first matching item (server already trims/strips on input).
async function findExistingEquipment(barcode, serial) {
  if (!barcode && !serial) return null;
  try {
    // listAll returns all items the caller is allowed to see.
    // For non-admins this is only items they have checked out — that is
    // sufficient to detect a "duplicate" of their own item, but not to
    // reuse an admin-owned available item. The API returns items keyed
    // to the user's role, so this is the safest dedupe we can do client-side.
    const { items } = await api('/api/equipment');
    const list = items || [];
    const bc = (barcode || '').trim().toLowerCase();
    const sn = (serial || '').trim().toLowerCase();
    return list.find((i) => {
      const ibc = (i.barcode || '').trim().toLowerCase();
      const isn = (i.serial_number || '').trim().toLowerCase();
      return (bc && ibc === bc) || (sn && isn === sn);
    }) || null;
  } catch {
    return null;
  }
}

async function confirmCO() {
  const name = $('v_name').value.trim();
  if (!name) { toast('Equipment name required!', 'yellow'); return; }
  const payload = {
    name,
    type: $('v_type').value.trim(),
    serial_number: $('v_serial').value.trim(),
    barcode: $('v_barcode').value.trim(),
    notes: $('v_notes').value.trim(),
  };
  const btn = $('confbtn');
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Saving...';
  try {
    let item;
    // Dedupe: if barcode or serial is provided and matches an existing
    // available item, reuse it instead of creating a duplicate row.
    const existing = await findExistingEquipment(payload.barcode, payload.serial_number);
    if (existing && existing.status === 'available') {
      item = existing;
    } else if (existing && existing.status === 'checked_out') {
      throw new Error(`"${existing.name}" with that ${payload.barcode ? 'barcode' : 'serial'} is already checked out`);
    } else {
      const created = await api('/api/equipment', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      item = created.item;
    }
    const checkoutBody = { notes: payload.notes, source: 'Manual' };
    const forUserId = selectedKioskUserId();
    if (forUserId) checkoutBody.for_user_id = forUserId;
    await api(`/api/equipment/${item.id}/checkout`, {
      method: 'POST',
      body: JSON.stringify(checkoutBody),
    });
    toast('Checked out!', 'green');
    $('vcard').classList.add('hidden');
    ['m_name', 'm_type', 'm_serial', 'm_barcode', 'm_notes'].forEach((id) => ($(id).value = ''));
    // Refresh tabs that may now be stale.
    if ($('pg-checkin').classList.contains('on')) loadCI();
    if ($('pg-inventory').classList.contains('on')) loadInventory();
  } catch (err) {
    toast('Error: ' + err.message, 'red');
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}
window.confirmCO = confirmCO;

// ── Admin kiosk user-selector ─────────────────────────────────
// Returns the currently selected borrower's user id, or null when not in
// admin kiosk mode (or when "self" is selected).
function selectedKioskUserId() {
  if (!ME || ME.role !== 'admin') return null;
  const sel = $('kioskUser');
  if (!sel) return null;
  const v = parseInt(sel.value, 10);
  if (!Number.isFinite(v) || v === ME.id) return null;
  return v;
}

function selectedConfirmUsername() {
  const sel = $('confirmUser');
  if (!sel) return '';
  const opt = sel.options[sel.selectedIndex];
  return (opt && opt.dataset && opt.dataset.username) || '';
}

function selectedKioskUsername() {
  if (!ME || ME.role !== 'admin') return ME ? ME.username : '';
  const sel = $('kioskUser');
  if (!sel) return ME.username;
  const opt = sel.options[sel.selectedIndex];
  return (opt && opt.dataset && opt.dataset.username) || ME.username;
}

async function loadKioskUsers() {
  if (!ME || ME.role !== 'admin') return;
  try {
    const { users } = await api('/api/admin/users');
    kioskUsers = (users || []).slice().sort((a, b) =>
      (a.username || '').localeCompare(b.username || ''));
    populateKioskSelect($('kioskUser'));
  } catch {
    // non-fatal — admin can still check out as themselves
  }
}

function populateKioskSelect(sel) {
  if (!sel) return;
  sel.innerHTML = '';
  // First option is the admin themselves.
  const selfOpt = document.createElement('option');
  selfOpt.value = String(ME.id);
  selfOpt.dataset.username = ME.username;
  selfOpt.textContent = `${ME.username} (myself)`;
  sel.appendChild(selfOpt);
  kioskUsers.forEach((u) => {
    if (u.id === ME.id) return;
    const o = document.createElement('option');
    o.value = String(u.id);
    o.dataset.username = u.username;
    o.textContent = u.username + (u.role === 'admin' ? ' · admin' : '');
    sel.appendChild(o);
  });
}

// ── Check-in list ─────────────────────────────────────────────
async function loadCI() {
  const l = $('ciList');
  l.innerHTML = '<div class="sw"><div class="sp" aria-hidden="true"></div><span>Loading...</span></div>';
  try {
    const { items } = await api('/api/equipment?status=checked_out');
    let list = items || [];
    // Non-admins only see items they themselves checked out.
    if (ME && ME.role !== 'admin') {
      list = list.filter((e) => e.checked_out_by === ME.id);
    }
    cacheCI = list;
    renderCI(filteredCI());
  } catch (e) {
    l.innerHTML = `<div class="es es-err"><div class="ei" aria-hidden="true">⚠️</div><div class="et">${esc(e.message)}</div></div>`;
  }
}
window.loadCI = loadCI;

function filteredCI() {
  const q = (($('ciSearch') && $('ciSearch').value) || '').trim().toLowerCase();
  if (!q) return cacheCI;
  return cacheCI.filter((e) => {
    const fields = [e.name, e.type, e.serial_number, e.barcode, e.checked_out_username]
      .filter(Boolean).join(' ').toLowerCase();
    return fields.includes(q);
  });
}

function filterCI() { renderCI(filteredCI()); }
window.filterCI = filterCI;

function renderCI(items) {
  const l = $('ciList');
  if (!cacheCI.length) {
    l.innerHTML = '<div class="es"><div class="ei" aria-hidden="true">✅</div><div class="et">All equipment is checked in!</div></div>';
    return;
  }
  if (!items.length) {
    l.innerHTML = '<div class="es"><div class="ei" aria-hidden="true">🔎</div><div class="et">No matches for that search.</div></div>';
    return;
  }
  l.innerHTML = '';
  items.forEach((e) => {
    const row = document.createElement('div');
    row.className = 'ci checked-out';
    const info = document.createElement('div');
    info.className = 'cin';
    const name = document.createElement('div');
    name.className = 'cname';
    name.textContent = e.name;
    const meta = document.createElement('div');
    meta.className = 'cmeta';
    const bits = [];
    if (e.type) bits.push(e.type);
    if (e.serial_number) bits.push('S/N: ' + e.serial_number);
    if (e.barcode) bits.push('BC: ' + e.barcode);
    if (e.checked_out_at) bits.push(utc(e.checked_out_at).toLocaleString());
    meta.textContent = bits.join(' · ');
    if (e.checked_out_username) {
      const userTag = document.createElement('span');
      userTag.className = 'badge bwarn';
      userTag.style.marginLeft = '6px';
      userTag.textContent = e.checked_out_username;
      name.appendChild(document.createTextNode(' '));
      name.appendChild(userTag);
    }
    info.appendChild(name);
    info.appendChild(meta);
    const btn = document.createElement('button');
    btn.className = 'btn bg bsm';
    btn.type = 'button';
    btn.setAttribute('aria-label', `Check in ${e.name}`);
    btn.textContent = '📥 In';
    btn.addEventListener('click', () => doCI(e.id, e.name));
    row.appendChild(info);
    row.appendChild(btn);
    l.appendChild(row);
  });
}

async function doCI(id, name) {
  try {
    await api(`/api/equipment/${id}/checkin`, {
      method: 'POST',
      body: JSON.stringify({ source: 'Manual' }),
    });
    toast(`"${name}" checked in!`, 'green');
    await loadCI();
    if ($('pg-inventory').classList.contains('on')) loadInventory();
  } catch (e) {
    toast(e.message, 'red');
  }
}
window.doCI = doCI;

// ── Inventory (admin) ─────────────────────────────────────────
async function loadInventory() {
  if (!ME || ME.role !== 'admin') return;
  const l = $('invList');
  l.innerHTML = '<div class="sw"><div class="sp" aria-hidden="true"></div><span>Loading...</span></div>';
  try {
    const { items } = await api('/api/equipment');
    cacheInv = items || [];
    renderInventory();
    // Pre-fill the next asset ID if the field is empty.
    const aid = $('ai_assetid');
    if (aid && !aid.value.trim()) suggestAssetId();
  } catch (e) {
    l.innerHTML = `<div class="es es-err"><div class="ei" aria-hidden="true">⚠️</div><div class="et">${esc(e.message)}</div></div>`;
  }
}
window.loadInventory = loadInventory;

// Ask the server for the next CIS-NNNNNN asset ID and drop it into the
// Add Item form's asset-ID field.
async function suggestAssetId() {
  const aid = $('ai_assetid');
  if (!aid) return;
  try {
    const { asset_id } = await api('/api/equipment/next-asset-id');
    aid.value = asset_id;
  } catch (e) {
    // Non-fatal — the admin can still type one in manually.
  }
}
window.suggestAssetId = suggestAssetId;

async function addInventoryItem(skipLabel) {
  const errEl = $('ai_err');
  errEl.textContent = '';
  const name = $('ai_name').value.trim();
  if (!name) { errEl.textContent = 'Name is required'; return; }
  let assetId = $('ai_assetid').value.trim();
  if (!assetId) {
    try {
      const r = await api('/api/equipment/next-asset-id');
      assetId = r.asset_id;
      $('ai_assetid').value = assetId;
    } catch (e) {
      errEl.textContent = 'Could not generate asset ID: ' + (e.message || '');
      return;
    }
  }
  const payload = {
    name,
    type: $('ai_type').value.trim(),
    serial_number: $('ai_serial').value.trim(),
    barcode: assetId,
    notes: $('ai_notes').value.trim(),
  };
  try {
    const { item } = await api('/api/equipment', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    toast('Added: ' + item.name, 'green');
    // Clear the form (but pre-fill the next asset ID).
    $('ai_name').value = '';
    $('ai_type').value = '';
    $('ai_serial').value = '';
    $('ai_notes').value = '';
    $('ai_assetid').value = '';
    suggestAssetId();
    loadInventory();
    if (!skipLabel) showLabelFor(item.id);
  } catch (e) {
    errEl.textContent = e.message || 'Failed to create';
  }
}
window.addInventoryItem = addInventoryItem;

// ── Print Label modal ─────────────────────────────────────────
async function showLabelFor(equipmentId) {
  _lastFocusedBeforeOverlay = document.activeElement;
  const ov = $('labelOv');
  $('labelErr').textContent = '';
  $('labelName').textContent = '';
  $('labelAssetId').textContent = '';
  $('labelQr').removeAttribute('src');
  ov.classList.remove('hidden');
  document.body.classList.add('label-open');
  try {
    const data = await api(`/api/equipment/${equipmentId}/label`);
    $('labelQr').src = data.qr_data_url;
    $('labelName').textContent = data.name || '';
    $('labelAssetId').textContent = data.asset_id || '';
  } catch (e) {
    $('labelErr').textContent = e.message || 'Could not load label';
  }
}
window.showLabelFor = showLabelFor;

function hideLabel() {
  $('labelOv').classList.add('hidden');
  document.body.classList.remove('label-open');
  if (_lastFocusedBeforeOverlay && _lastFocusedBeforeOverlay.focus) {
    _lastFocusedBeforeOverlay.focus();
  }
}
window.hideLabel = hideLabel;

function doPrintLabel() {
  // Build an isolated 40mm x 30mm print document in a new window so the
  // browser's "Save as PDF" / printer driver only sees the label, not the
  // surrounding modal/page. Sized for the user's 40x30mm thermal labels.
  const qrSrc = $('labelQr').getAttribute('src') || '';
  const assetId = $('labelAssetId').textContent || '';
  if (!qrSrc) {
    $('labelErr').textContent = 'Label is still loading. Please wait a moment and try again.';
    return;
  }

  // No inline script: the parent (this window) drives the print to avoid
  // running afoul of the page's CSP, which does not allow inline scripts.
  // Layout: 40mm x 30mm (landscape). A 26mm square QR on the left preserves
  // a generous quiet zone; the right column holds the asset ID + "CIS Tracker"
  // footer. Item name is intentionally omitted from the print to avoid
  // crowding the QR — readability of the code is more important.
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Label ${esc(assetId)}</title>
<style>
  @page { size: 40mm 30mm; margin: 0; }
  html, body {
    margin: 0; padding: 0; background: #fff; color: #000;
    width: 40mm; height: 30mm; overflow: hidden;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .lbl {
    width: 40mm; height: 30mm; box-sizing: border-box;
    display: flex; align-items: center; gap: 1mm;
    padding: 1mm; background: #fff; color: #000;
    font-family: "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace;
    overflow: hidden;
  }
  .lbl-img {
    width: 26mm; height: 26mm; flex: 0 0 auto;
    background: #fff; padding: 0; box-sizing: border-box;
  }
  .lbl-img img {
    width: 100%; height: 100%; display: block;
    image-rendering: pixelated; image-rendering: crisp-edges;
  }
  .lbl-text {
    flex: 1; min-width: 0; height: 26mm;
    display: flex; flex-direction: column; justify-content: center;
    gap: 0.5mm; overflow: hidden;
  }
  .lbl-id {
    font-size: 8pt; font-weight: 700; letter-spacing: 0.02em;
    line-height: 1.05; word-break: break-all; overflow: hidden;
    color: #000;
  }
  .lbl-foot {
    font-size: 5pt; font-weight: 600; letter-spacing: 0.04em;
    color: #000; text-transform: uppercase; line-height: 1;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    font-family: "Sora", system-ui, sans-serif;
  }
</style></head>
<body>
  <div class="lbl">
    <div class="lbl-img"><img id="qr" alt="QR" src="${esc(qrSrc)}"></div>
    <div class="lbl-text">
      <div class="lbl-id">${esc(assetId)}</div>
      <div class="lbl-foot">CIS Tracker</div>
    </div>
  </div>
</body></html>`;

  const w = window.open('', '_blank', 'width=360,height=260');
  if (!w) {
    $('labelErr').textContent = 'Popup blocked. Allow popups for this site to print labels.';
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();

  // Drive print/close from the opener so we don't need inline script in the
  // popup (which would be blocked by the page CSP).
  function triggerPrint() {
    let closed = false;
    function closeSoon() {
      if (closed) return;
      closed = true;
      try { w.close(); } catch (e) { /* ignore */ }
    }
    try { w.addEventListener('afterprint', closeSoon); } catch (e) { /* ignore */ }
    try { w.focus(); } catch (e) { /* ignore */ }
    try { w.print(); } catch (e) { /* ignore */ }
    setTimeout(closeSoon, 1500);
  }

  const img = w.document.getElementById('qr');
  if (img && !img.complete) {
    img.addEventListener('load', triggerPrint, { once: true });
    img.addEventListener('error', triggerPrint, { once: true });
    // Safety net in case load events never fire (e.g. data-URL edge cases).
    setTimeout(triggerPrint, 1500);
  } else {
    setTimeout(triggerPrint, 50);
  }
}
window.doPrintLabel = doPrintLabel;

function setInvStatus(s) {
  invStatus = s;
  document.querySelectorAll('[data-inv-status]').forEach((c) => {
    const on = c.dataset.invStatus === s;
    c.classList.toggle('on', on);
    c.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  renderInventory();
}
window.setInvStatus = setInvStatus;

function filterInventory() { renderInventory(); }
window.filterInventory = filterInventory;

function renderInventory() {
  const l = $('invList');
  if (!cacheInv.length) {
    l.innerHTML = '<div class="es"><div class="ei" aria-hidden="true">📦</div><div class="et">No equipment yet.</div></div>';
    return;
  }
  const q = (($('invSearch') && $('invSearch').value) || '').trim().toLowerCase();
  let list = cacheInv;
  if (invStatus !== 'all') list = list.filter((i) => i.status === invStatus);
  if (q) {
    list = list.filter((e) => {
      const fields = [e.name, e.type, e.serial_number, e.barcode, e.checked_out_username]
        .filter(Boolean).join(' ').toLowerCase();
      return fields.includes(q);
    });
  }
  if (!list.length) {
    l.innerHTML = '<div class="es"><div class="ei" aria-hidden="true">🔎</div><div class="et">No items match.</div></div>';
    return;
  }
  l.innerHTML = '';
  list.forEach((e) => {
    const row = document.createElement('div');
    row.className = 'ci ' + (e.status === 'checked_out' ? 'checked-out' : 'available');
    const info = document.createElement('div');
    info.className = 'cin';
    const name = document.createElement('div');
    name.className = 'cname';
    name.textContent = e.name;
    const status = document.createElement('span');
    status.className = 'badge ' + (e.status === 'checked_out' ? 'bout' : 'bavail');
    status.style.marginLeft = '6px';
    status.textContent = e.status === 'checked_out' ? 'OUT' : 'AVAIL';
    name.appendChild(document.createTextNode(' '));
    name.appendChild(status);
    const meta = document.createElement('div');
    meta.className = 'cmeta';
    const bits = [];
    if (e.type) bits.push(e.type);
    if (e.serial_number) bits.push('S/N: ' + e.serial_number);
    if (e.barcode) bits.push('BC: ' + e.barcode);
    if (e.status === 'checked_out' && e.checked_out_username) bits.push('with ' + e.checked_out_username);
    meta.textContent = bits.join(' · ');
    info.appendChild(name);
    info.appendChild(meta);
    row.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'ci-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn bo bsm';
    editBtn.type = 'button';
    editBtn.setAttribute('aria-label', `Edit ${e.name}`);
    editBtn.textContent = '✏️ Edit';
    editBtn.addEventListener('click', () => showEqEdit(e));
    actions.appendChild(editBtn);
    if (e.barcode && e.barcode.trim()) {
      const labelBtn = document.createElement('button');
      labelBtn.className = 'btn bo bsm';
      labelBtn.type = 'button';
      labelBtn.setAttribute('aria-label', `Print label for ${e.name}`);
      labelBtn.textContent = '🏷 Label';
      labelBtn.addEventListener('click', () => showLabelFor(e.id));
      actions.appendChild(labelBtn);
    }
    if (e.status === 'available') {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn br bsm';
      delBtn.type = 'button';
      delBtn.setAttribute('aria-label', `Delete ${e.name}`);
      delBtn.textContent = '🗑 Delete';
      delBtn.addEventListener('click', () => confirmDeleteEq(e));
      actions.appendChild(delBtn);
    } else {
      const ciBtn = document.createElement('button');
      ciBtn.className = 'btn bg bsm';
      ciBtn.type = 'button';
      ciBtn.setAttribute('aria-label', `Check in ${e.name}`);
      ciBtn.textContent = '📥 In';
      ciBtn.addEventListener('click', () => doCI(e.id, e.name));
      actions.appendChild(ciBtn);
    }
    row.appendChild(actions);
    l.appendChild(row);
  });
}

async function confirmDeleteEq(e) {
  if (!confirm(`Permanently delete "${e.name}"? This cannot be undone.`)) return;
  try {
    await api(`/api/equipment/${e.id}`, { method: 'DELETE' });
    toast('Deleted', 'green');
    loadInventory();
  } catch (err) {
    toast(err.message, 'red');
  }
}

function showEqEdit(e) {
  _lastFocusedBeforeOverlay = document.activeElement;
  $('eqEditId').value = e.id;
  $('eqEditName').value = e.name || '';
  $('eqEditType').value = e.type || '';
  $('eqEditSerial').value = e.serial_number || '';
  $('eqEditBarcode').value = e.barcode || '';
  $('eqEditNotes').value = e.notes || '';
  $('eqEditErr').textContent = '';
  $('eqEditOv').classList.remove('hidden');
  setTimeout(() => $('eqEditName').focus(), 30);
}
window.showEqEdit = showEqEdit;

function hideEqEdit() {
  $('eqEditOv').classList.add('hidden');
  if (_lastFocusedBeforeOverlay && _lastFocusedBeforeOverlay.focus) {
    _lastFocusedBeforeOverlay.focus();
  }
}
window.hideEqEdit = hideEqEdit;

async function saveEqEdit() {
  const id = parseInt($('eqEditId').value, 10);
  const name = $('eqEditName').value.trim();
  if (!name) { $('eqEditErr').textContent = 'Name is required'; return; }
  const payload = {
    name,
    type: $('eqEditType').value.trim(),
    serial_number: $('eqEditSerial').value.trim(),
    barcode: $('eqEditBarcode').value.trim(),
    notes: $('eqEditNotes').value.trim(),
  };
  try {
    await api(`/api/equipment/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    toast('Saved', 'green');
    hideEqEdit();
    loadInventory();
  } catch (err) {
    $('eqEditErr').textContent = err.message || 'Failed';
  }
}
window.saveEqEdit = saveEqEdit;

// ── Activity log ──────────────────────────────────────────────
async function clearLog() {
  if (!confirm('Clear the entire activity log? This cannot be undone.')) return;
  try {
    await api('/api/equipment/log', { method: 'DELETE' });
    toast('Log cleared', 'green');
    loadLog();
  } catch (e) {
    toast(e.message, 'red');
  }
}
window.clearLog = clearLog;

async function loadLog() {
  const clb = $('clearLogBtn');
  if (clb) clb.style.display = (ME && ME.role === 'admin') ? '' : 'none';
  const w = $('logW');
  w.innerHTML = '<div class="sw"><div class="sp" aria-hidden="true"></div><span>Loading...</span></div>';
  try {
    const { entries } = await api('/api/equipment/log');
    cacheLog = entries || [];
    if (!cacheLog.length) {
      w.innerHTML = '<div class="es"><div class="ei" aria-hidden="true">📋</div><div class="et">No entries yet.</div></div>';
      return;
    }
    let html = '<div class="ls"><table><thead><tr><th scope="col">Action</th><th scope="col">Equipment</th><th scope="col">S/N · BC</th><th scope="col">User</th><th scope="col">When</th></tr></thead><tbody>';
    cacheLog.forEach((e) => {
      const badge = e.action === 'checkout'
        ? '<span class="badge bout" aria-label="Check out">OUT</span>'
        : '<span class="badge bin" aria-label="Check in">IN</span>';
      const sn = e.serial_number ? 'S/N: ' + esc(e.serial_number) : '<span style="color:var(--muted)">—</span>';
      html += `<tr>
        <td>${badge}</td>
        <td><strong>${esc(e.equipment_name || '')}</strong></td>
        <td class="mono small">${sn}</td>
        <td class="accent bold">${esc(e.checkout_user || '')}</td>
        <td class="mono small" style="color:var(--muted-strong)">${esc(utc(e.created_at).toLocaleString())}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    w.innerHTML = html;
  } catch (e) {
    w.innerHTML = `<div class="es es-err"><div class="ei" aria-hidden="true">⚠️</div><div class="et">${esc(e.message)}</div></div>`;
  }
}
window.loadLog = loadLog;

// ═══════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════
function showOnly(id) {
  ['lf', 'cf', 'vf', 'fp'].forEach((x) => $(x).classList.toggle('hidden', x !== id));
}
function showLogin() { $('lo').classList.remove('hidden'); showOnly('lf'); }
function hideLogin() { $('lo').classList.add('hidden'); }
function showLoginForm() { showOnly('lf'); $('le').textContent = ''; }
window.showLoginForm = showLoginForm;

async function doLogin() {
  const u = $('lu').value.trim();
  const p = $('lp').value;
  $('le').textContent = 'Signing in...';
  try {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: u, password: p }),
    });
    if (res.challenge === 'MFA_REQUIRED') {
      showOnly('vf');
      $('le').textContent = '';
      setTimeout(() => $('mc2').focus(), 80);
      return;
    }
    ME = res.user;
    if (res.mustChangePw) {
      showOnly('cf');
      $('le').textContent = '';
      // Pre-fill the current-password field with what the user just typed
      // so they don't need to retype it. (The original UI re-used the
      // login field in memory, which produced a stale value if anything
      // mutated it.)
      $('cpCur').value = p;
      setTimeout(() => $('np1').focus(), 50);
      return;
    }
    await onAuthed();
  } catch (err) {
    $('le').textContent = err.message || 'Login failed';
  }
}
window.doLogin = doLogin;

async function doForceChg() {
  const cur = $('cpCur').value;
  const np = $('np1').value, np2 = $('np2').value;
  if (!cur) { $('ce').textContent = 'Current password required'; return; }
  if (np !== np2) { $('ce').textContent = 'Passwords do not match'; return; }
  try {
    await api('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: cur, newPassword: np }),
    });
    // Server invalidated all sessions — log in again with the new password.
    $('ce').textContent = 'Password updated — signing you back in...';
    await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('lu').value.trim(), password: np }),
    });
    const me = await api('/api/auth/me');
    ME = me.user;
    // Wipe sensitive fields
    $('cpCur').value = '';
    $('np1').value = '';
    $('np2').value = '';
    $('lp').value = '';
    await onAuthed();
  } catch (err) {
    $('ce').textContent = err.message || 'Failed';
  }
}
window.doForceChg = doForceChg;

async function doMfaLoginVerify() {
  const code = $('mc2').value.trim();
  if (code.length !== 6) { $('me2').textContent = 'Enter a 6-digit code'; return; }
  $('me2').textContent = 'Verifying...';
  try {
    const res = await api('/api/auth/mfa-verify', {
      method: 'POST',
      body: JSON.stringify({ token: code }),
    });
    ME = res.user;
    if (res.mustChangePw) {
      showOnly('cf');
      $('cpCur').value = $('lp').value;
      return;
    }
    await onAuthed();
  } catch (err) {
    $('me2').textContent = err.message || 'Invalid code';
  }
}
window.doMfaLoginVerify = doMfaLoginVerify;

function showForgot() { showOnly('fp'); $('fpMsg').textContent = ''; }
window.showForgot = showForgot;

async function doForgot() {
  const email = $('fpEmail').value.trim();
  if (!email) { $('fpMsg').textContent = 'Enter your email'; return; }
  $('fpMsg').textContent = 'Sending...';
  try {
    const res = await api('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    $('fpMsg').style.color = 'var(--green)';
    $('fpMsg').textContent = res.message || 'If that email is registered, a reset link has been sent.';
  } catch (err) {
    $('fpMsg').textContent = err.message || 'Failed';
  }
}
window.doForgot = doForgot;

async function doLogout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  ME = null;
  $('gearDrop').classList.remove('on');
  $('gearBtn').setAttribute('aria-expanded', 'false');
  showLogin();
}
window.doLogout = doLogout;

async function onAuthed() {
  hideLogin();
  $('curUser').textContent = ME.username;
  usr = ME.username;
  const isAdmin = ME.role === 'admin';
  $('miAdmin').classList.toggle('on', isAdmin);
  const logBtn = $('bt-log');
  logBtn.classList.toggle('hidden', !isAdmin);
  logBtn.style.display = isAdmin ? '' : 'none';
  const invBtn = $('bt-inventory');
  if (invBtn) {
    invBtn.classList.toggle('hidden', !isAdmin);
    invBtn.style.display = isAdmin ? '' : 'none';
  }
  // Kiosk mode: admins get a "Checking out for" student picker on the
  // Check Out page so they can hand gear to students who don't have phones.
  const kioskBox = $('kioskBox');
  if (kioskBox) kioskBox.classList.toggle('hidden', !isAdmin);
  if (isAdmin) loadKioskUsers();
  if (!isAdmin && ($('pg-log').classList.contains('on') || $('pg-inventory').classList.contains('on'))) {
    swPage('checkout');
  }
}

// ═══════════════════════════════════════════════════════════
// GEAR MENU
// ═══════════════════════════════════════════════════════════
function toggleGear() {
  const d = $('gearDrop');
  const open = !d.classList.contains('on');
  d.classList.toggle('on', open);
  $('gearBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
}
window.toggleGear = toggleGear;

document.addEventListener('click', (e) => {
  const gw = $('gearWrap');
  if (gw && !gw.contains(e.target)) {
    $('gearDrop').classList.remove('on');
    $('gearBtn').setAttribute('aria-expanded', 'false');
  }
});

// Allow Enter/Space to activate gear menu items (since they are divs)
document.addEventListener('keydown', (e) => {
  if (e.target && e.target.classList && e.target.classList.contains('gear-item')) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.target.click();
    }
  }
  // Close any visible overlay on Escape
  if (e.key === 'Escape') {
    if (!$('confirmOv').classList.contains('hidden')) { closeConfirmModal(); return; }
    if (!$('scanOv').classList.contains('hidden')) { closeScanModal(); return; }
    if (!$('eqEditOv').classList.contains('hidden')) { hideEqEdit(); return; }
    if (!$('chpOv').classList.contains('hidden')) { hideChp(); return; }
    if (!$('mfaOv').classList.contains('hidden')) { hideMfa(); return; }
    if (!$('adminOv').classList.contains('hidden')) { hideAdmin(); return; }
    if ($('gearDrop').classList.contains('on')) {
      $('gearDrop').classList.remove('on');
      $('gearBtn').setAttribute('aria-expanded', 'false');
      $('gearBtn').focus();
    }
  }
});

// ── Change password (signed-in user) ──
function showChp() {
  _lastFocusedBeforeOverlay = document.activeElement;
  $('gearDrop').classList.remove('on');
  $('gearBtn').setAttribute('aria-expanded', 'false');
  $('chpOv').classList.remove('hidden');
  setTimeout(() => $('cpOld').focus(), 30);
}
window.showChp = showChp;

function hideChp() {
  $('chpOv').classList.add('hidden');
  ['cpOld', 'cpN1', 'cpN2'].forEach((x) => ($(x).value = ''));
  $('cpErr').textContent = '';
  if (_lastFocusedBeforeOverlay && _lastFocusedBeforeOverlay.focus) {
    _lastFocusedBeforeOverlay.focus();
  }
}
window.hideChp = hideChp;

async function doChgPass() {
  const old = $('cpOld').value, np = $('cpN1').value, np2 = $('cpN2').value;
  if (np !== np2) { $('cpErr').textContent = 'Passwords do not match'; return; }
  try {
    await api('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: old, newPassword: np }),
    });
    hideChp();
    toast('Password changed — sign in again', 'green');
    ME = null;
    showLogin();
  } catch (err) {
    $('cpErr').textContent = err.message || 'Failed';
  }
}
window.doChgPass = doChgPass;

// ── MFA setup ──
async function showMfa() {
  _lastFocusedBeforeOverlay = document.activeElement;
  $('gearDrop').classList.remove('on');
  $('gearBtn').setAttribute('aria-expanded', 'false');
  $('mfaErr').textContent = 'Loading QR code...';
  $('mfaOv').classList.remove('hidden');
  try {
    const { qr, secret } = await api('/api/auth/mfa/setup', { method: 'POST' });
    $('mfaQr').src = qr;
    $('mfaQr').alt = 'MFA QR code — scan with authenticator app';
    $('mfaSecret').textContent = secret;
    $('mfaErr').textContent = '';
    setTimeout(() => $('mfaCode').focus(), 30);
  } catch (err) {
    $('mfaErr').textContent = err.message || 'Failed to start MFA setup';
  }
}
window.showMfa = showMfa;

function hideMfa() {
  $('mfaOv').classList.add('hidden');
  $('mfaCode').value = '';
  $('mfaErr').textContent = '';
  if (_lastFocusedBeforeOverlay && _lastFocusedBeforeOverlay.focus) {
    _lastFocusedBeforeOverlay.focus();
  }
}
window.hideMfa = hideMfa;

async function doMfaEnable() {
  const code = $('mfaCode').value.trim();
  if (code.length !== 6) { $('mfaErr').textContent = 'Enter a 6-digit code'; return; }
  try {
    await api('/api/auth/mfa/enable', {
      method: 'POST',
      body: JSON.stringify({ token: code }),
    });
    hideMfa();
    toast('MFA enabled', 'green');
  } catch (err) {
    $('mfaErr').textContent = err.message || 'Invalid code';
  }
}
window.doMfaEnable = doMfaEnable;

// ═══════════════════════════════════════════════════════════
// ADMIN PANEL
// ═══════════════════════════════════════════════════════════
function showAdmin() {
  _lastFocusedBeforeOverlay = document.activeElement;
  $('gearDrop').classList.remove('on');
  $('gearBtn').setAttribute('aria-expanded', 'false');
  $('adminOv').classList.remove('hidden');
  swAdmin('users');
}
window.showAdmin = showAdmin;

function hideAdmin() {
  $('adminOv').classList.add('hidden');
  if (_lastFocusedBeforeOverlay && _lastFocusedBeforeOverlay.focus) {
    _lastFocusedBeforeOverlay.focus();
  }
}
window.hideAdmin = hideAdmin;

function swAdmin(tab) {
  document.querySelectorAll('.admin-tab').forEach((t) => {
    const on = t.dataset.tab === tab;
    t.classList.toggle('on', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.admin-pane').forEach((p) =>
    p.classList.toggle('on', p.id === 'adm-' + tab));
  if (tab === 'users') loadAdminUsers();
  if (tab === 'overdue') loadOverdue();
  if (tab === 'audit') loadAudit();
}
window.swAdmin = swAdmin;

async function loadAdminUsers() {
  const ul = $('adminUL');
  ul.innerHTML = '<div class="sw"><div class="sp" aria-hidden="true"></div><span>Loading...</span></div>';
  const search = $('userSearch');
  if (search) search.value = '';
  try {
    const { users } = await api('/api/admin/users');
    cacheUsers = users || [];
    renderAdminUsers(cacheUsers);
  } catch (e) {
    ul.innerHTML = `<div class="es es-err"><div class="et">${esc(e.message)}</div></div>`;
  }
}

function renderAdminUsers(users) {
  const ul = $('adminUL');
  if (!users.length) {
    ul.innerHTML = '<div class="es"><div class="et">No matching users.</div></div>';
    return;
  }
  ul.innerHTML = '';
  users.forEach((u) => {
    const row = document.createElement('div');
    row.className = 'user-row';
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `Open details for ${u.username}`);
    row.addEventListener('click', () => showUserDetail(u.id));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showUserDetail(u.id);
      }
    });

    const main = document.createElement('div');
    main.className = 'user-main';
    const nm = document.createElement('div');
    nm.className = 'user-name';
    nm.textContent = u.username;
    const em = document.createElement('div');
    em.className = 'user-email';
    em.textContent = u.email || '';
    main.appendChild(nm);
    main.appendChild(em);

    const meta = document.createElement('div');
    meta.className = 'user-meta';
    if (u.role === 'admin') {
      const b = document.createElement('span');
      b.className = 'user-badge admin';
      b.textContent = 'ADMIN';
      meta.appendChild(b);
    }
    if (u.mfa_enabled) {
      const b = document.createElement('span');
      b.className = 'user-badge mfa';
      b.textContent = 'MFA';
      meta.appendChild(b);
    }
    if (u.locked_until && utc(u.locked_until) > new Date()) {
      const b = document.createElement('span');
      b.className = 'user-badge locked';
      b.textContent = 'LOCKED';
      meta.appendChild(b);
    }

    row.appendChild(main);
    row.appendChild(meta);
    ul.appendChild(row);
  });
}

function filterUsers() {
  const q = ($('userSearch').value || '').trim().toLowerCase();
  if (!q) {
    renderAdminUsers(cacheUsers);
    return;
  }
  const filtered = cacheUsers.filter((u) => {
    const name = (u.username || '').toLowerCase();
    const email = (u.email || '').toLowerCase();
    return name.includes(q) || email.includes(q);
  });
  renderAdminUsers(filtered);
}
window.filterUsers = filterUsers;

async function adminCreateUser() {
  const username = $('nuName').value.trim();
  const email = $('nuEmail').value.trim();
  const role = $('nuRole').value;
  if (!username || !email) {
    $('nuErr').textContent = 'Username and email required';
    return;
  }
  try {
    const res = await api('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ username, email, role }),
    });
    $('nuName').value = '';
    $('nuEmail').value = '';
    $('nuErr').textContent = '';
    if (res.tempPassword) {
      $('nuTempPwVal').textContent = res.tempPassword;
      $('nuTempPw').classList.remove('hidden');
    }
    toast('User created — temp password shown below (also emailed)', 'green');
    loadAdminUsers();
  } catch (err) {
    $('nuErr').textContent = err.message || 'Failed';
  }
}
window.adminCreateUser = adminCreateUser;

async function showUserDetail(id) {
  const card = $('userDetail');
  card.classList.remove('hidden');
  $('udName').textContent = 'Loading...';
  $('udBody').innerHTML = '';
  try {
    const { user, currentCheckouts, history } = await api('/api/admin/users/' + id);
    $('udName').textContent = user.username + (user.role === 'admin' ? ' (admin)' : '');

    const body = $('udBody');
    body.innerHTML = '';

    const actions = document.createElement('div');
    actions.className = 'brow';

    const btnReset = document.createElement('button');
    btnReset.className = 'btn bw bsm';
    btnReset.type = 'button';
    btnReset.textContent = 'Reset PW';
    btnReset.addEventListener('click', () => adminResetPw(user.id, user.username));
    actions.appendChild(btnReset);

    const btnRole = document.createElement('button');
    btnRole.className = 'btn bo bsm';
    btnRole.type = 'button';
    btnRole.textContent = user.role === 'admin' ? 'Revoke Admin' : 'Make Admin';
    btnRole.addEventListener('click', () => adminToggleRole(user.id, user.role));
    actions.appendChild(btnRole);

    if (user.locked_until) {
      const btnUnlock = document.createElement('button');
      btnUnlock.className = 'btn bg bsm';
      btnUnlock.type = 'button';
      btnUnlock.textContent = 'Unlock';
      btnUnlock.addEventListener('click', () => adminUnlock(user.id));
      actions.appendChild(btnUnlock);
    }

    if (ME && user.id !== ME.id) {
      const btnDel = document.createElement('button');
      btnDel.className = 'btn br bsm';
      btnDel.type = 'button';
      btnDel.textContent = '🗑 Delete';
      btnDel.setAttribute('aria-label', `Delete user ${user.username}`);
      btnDel.addEventListener('click', () => {
        if (confirm('Permanently delete ' + user.username + '?')) adminDeleteUser(user.id);
      });
      actions.appendChild(btnDel);
    }
    body.appendChild(actions);

    const h1 = document.createElement('div');
    h1.className = 'ctitle';
    h1.textContent = 'Currently Checked Out';
    body.appendChild(h1);

    if (!currentCheckouts || !currentCheckouts.length) {
      const e = document.createElement('div');
      e.className = 'es';
      e.innerHTML = '<div class="et">No items</div>';
      body.appendChild(e);
    } else {
      currentCheckouts.forEach((e) => {
        const row = document.createElement('div');
        row.className = 'overdue-row';
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        const days = e.checked_out_at
          ? Math.floor((Date.now() - utc(e.checked_out_at).getTime()) / 86400000)
          : 0;
        if (days >= 5) row.classList.add('alert');
        else if (days >= 3) row.classList.add('warn');
        const info = document.createElement('div');
        info.style.flex = '1';
        const nm = document.createElement('div');
        nm.className = 'cname';
        nm.textContent = e.name;
        const meta = document.createElement('div');
        meta.className = 'overdue-days';
        meta.textContent = `${days} day${days === 1 ? '' : 's'} · ${utc(e.checked_out_at).toLocaleDateString()}`;
        info.appendChild(nm);
        info.appendChild(meta);
        row.appendChild(info);
        const ciBtn = document.createElement('button');
        ciBtn.className = 'btn bg bsm';
        ciBtn.type = 'button';
        ciBtn.setAttribute('aria-label', `Check in ${e.name}`);
        ciBtn.textContent = '📥 In';
        ciBtn.addEventListener('click', async () => {
          try {
            await api(`/api/equipment/${e.id}/checkin`, {
              method: 'POST',
              body: JSON.stringify({ source: 'Manual' }),
            });
            toast(`"${e.name}" checked in`, 'green');
            showUserDetail(user.id);
          } catch (err) { toast(err.message, 'red'); }
        });
        row.appendChild(ciBtn);
        body.appendChild(row);
      });
    }

    const h2 = document.createElement('div');
    h2.className = 'ctitle';
    h2.style.marginTop = '1rem';
    h2.textContent = 'Recent Activity';
    body.appendChild(h2);

    if (!history || !history.length) {
      const e = document.createElement('div');
      e.className = 'es';
      e.innerHTML = '<div class="et">No activity</div>';
      body.appendChild(e);
    } else {
      history.slice(0, 20).forEach((h) => {
        const row = document.createElement('div');
        row.className = 'audit-row';
        const left = document.createElement('div');
        left.innerHTML = `<strong>${esc(h.action)}</strong> — ${esc(h.equipment_name || '')}`;
        const right = document.createElement('div');
        right.className = 'audit-when';
        right.textContent = utc(h.created_at).toLocaleString();
        row.appendChild(left);
        row.appendChild(right);
        body.appendChild(row);
      });
    }
  } catch (err) {
    $('udBody').innerHTML = `<div class="es es-err"><div class="et">${esc(err.message)}</div></div>`;
  }
}
window.showUserDetail = showUserDetail;

function hideUserDetail() { $('userDetail').classList.add('hidden'); }
window.hideUserDetail = hideUserDetail;

async function adminResetPw(id, username) {
  if (!confirm('Reset password for ' + username + '? A new temp password will be generated and emailed.')) return;
  try {
    const res = await api('/api/admin/users/' + id, {
      method: 'PUT',
      body: JSON.stringify({ reset_password: true }),
    });
    const msg = res.tempPassword
      ? `Password reset for ${username}. Temp: ${res.tempPassword} (also emailed)`
      : `Password reset for ${username}`;
    toast(msg, 'green');
  } catch (err) {
    toast(err.message, 'red');
  }
}

async function adminToggleRole(id, currentRole) {
  const newRole = currentRole === 'admin' ? 'user' : 'admin';
  try {
    await api('/api/admin/users/' + id, {
      method: 'PUT',
      body: JSON.stringify({ role: newRole }),
    });
    toast('Role → ' + newRole, 'green');
    await loadAdminUsers();
    await showUserDetail(id);
  } catch (err) {
    toast(err.message, 'red');
  }
}

async function adminUnlock(id) {
  try {
    await api('/api/admin/users/' + id, {
      method: 'PUT',
      body: JSON.stringify({ unlock: true }),
    });
    toast('Unlocked', 'green');
    await showUserDetail(id);
  } catch (err) {
    toast(err.message, 'red');
  }
}

async function adminDeleteUser(id) {
  try {
    await api('/api/admin/users/' + id, { method: 'DELETE' });
    toast('User deleted', 'green');
    hideUserDetail();
    await loadAdminUsers();
  } catch (err) {
    toast(err.message, 'red');
  }
}

async function loadOverdue() {
  const el = $('overdueList');
  el.innerHTML = '<div class="sw"><div class="sp" aria-hidden="true"></div><span>Loading...</span></div>';
  try {
    const { items } = await api('/api/admin/overdue?days=1');
    if (!items.length) {
      el.innerHTML = '<div class="es"><div class="ei" aria-hidden="true">✅</div><div class="et">No overdue items!</div></div>';
      return;
    }
    el.innerHTML = '';
    items.forEach((i) => {
      const days = i.checked_out_at
        ? Math.floor((Date.now() - utc(i.checked_out_at).getTime()) / 86400000)
        : 0;
      const row = document.createElement('div');
      row.className = 'overdue-row';
      if (days >= 5) row.classList.add('alert');
      else if (days >= 3) row.classList.add('warn');
      const name = document.createElement('div');
      name.className = 'cname';
      name.textContent = i.name;
      const meta = document.createElement('div');
      meta.className = 'overdue-days';
      meta.textContent = `${days} days · ${i.checked_out_username || ''} · ${utc(i.checked_out_at).toLocaleDateString()}`;
      row.appendChild(name);
      row.appendChild(meta);
      el.appendChild(row);
    });
  } catch (err) {
    el.innerHTML = `<div class="es es-err"><div class="et">${esc(err.message)}</div></div>`;
  }
}

async function loadAudit() {
  const el = $('auditList');
  el.innerHTML = '<div class="sw"><div class="sp" aria-hidden="true"></div><span>Loading...</span></div>';
  try {
    const { entries } = await api('/api/admin/audit?limit=100');
    if (!entries.length) {
      el.innerHTML = '<div class="es"><div class="et">No audit entries.</div></div>';
      return;
    }
    el.innerHTML = '';
    const badgeMap = {
      login_success: ['LOGIN', 'bin'],
      login_failed: ['FAIL', 'bout'],
      logout: ['OUT', 'bwarn'],
      checkout: ['C/O', 'bout'],
      checkin: ['C/I', 'bin'],
      vision_scan: ['SCAN', 'bscan'],
      password_changed: ['PW', 'bwarn'],
      admin_create_user: ['NEW', 'bin'],
      admin_change_role: ['ROLE', 'bwarn'],
      admin_reset_password: ['RESET', 'bwarn'],
      admin_delete_user: ['DEL', 'bout'],
      admin_unlock_user: ['UNLOCK', 'bin'],
      equipment_create: ['ADD', 'bin'],
      equipment_update: ['EDIT', 'bwarn'],
      equipment_delete: ['DEL', 'bout'],
    };
    let html = '<div class="ls"><table><thead><tr><th scope="col">Action</th><th scope="col">User</th><th scope="col">Target</th><th scope="col">When</th></tr></thead><tbody>';
    entries.forEach((e) => {
      const [label, cls] = badgeMap[e.action] || [esc(e.action), 'bwarn'];
      const user = esc(e.username || '');
      const target = esc(e.target || '—');
      const when = esc(utc(e.created_at).toLocaleString());
      html += `<tr>
        <td><span class="badge ${cls}">${label}</span></td>
        <td class="accent bold">${user}</td>
        <td class="mono small">${target}</td>
        <td class="mono small" style="color:var(--muted-strong)">${when}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    el.innerHTML = html;
  } catch (err) {
    el.innerHTML = `<div class="es es-err"><div class="et">${esc(err.message)}</div></div>`;
  }
}

// ═══════════════════════════════════════════════════════════
// QR SCAN: Check Out / Check In
// ═══════════════════════════════════════════════════════════
let _scanReader = null;        // ZXing BrowserMultiFormatReader instance
let _scanControls = null;      // controls returned by decodeFromVideoDevice
let _scanStream = null;        // raw MediaStream (manual fallback)
let _scanMode = null;          // 'checkout' | 'checkin'
let _scanBusy = false;         // guard against double-handling a single decode
let _pendingItem = null;       // matched item awaiting confirmation
let _pendingMode = null;       // 'checkout' | 'checkin' for pending item

function setScanStatus(msg, kind) {
  const el = $('scanStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.remove('err', 'ok');
  if (kind) el.classList.add(kind);
}

function startCheckoutScan() { openScanModal('checkout'); }
window.startCheckoutScan = startCheckoutScan;

function startCheckinScan() { openScanModal('checkin'); }
window.startCheckinScan = startCheckinScan;

function startInventoryScan() {
  if (!ME || ME.role !== 'admin') return;
  openScanModal('inventory');
}
window.startInventoryScan = startInventoryScan;

async function openScanModal(mode) {
  _scanMode = mode;
  _scanBusy = false;
  _lastFocusedBeforeOverlay = document.activeElement;
  const titles = {
    checkout: '📷 Scan to Check Out',
    checkin: '📷 Scan to Check In',
    inventory: '📷 Scan to Look Up Item',
  };
  const subs = {
    checkout: 'Point the camera at the QR label of the item to check out.',
    checkin: 'Point the camera at the QR label of the item to check in.',
    inventory: 'Scan or enter an asset ID to load its details from inventory.',
  };
  $('scanTitle').textContent = titles[mode] || titles.checkout;
  $('scanSub').textContent = subs[mode] || subs.checkout;
  $('scanErr').textContent = '';
  $('scanManualInput').value = '';
  hideScanNotFound();
  setScanStatus('Starting camera...', '');
  $('scanOv').classList.remove('hidden');
  await startScanner();
  setTimeout(() => $('scanManualInput').focus({ preventScroll: true }), 30);
}

function hideScanNotFound() {
  const nf = $('scanNotFound');
  if (nf) nf.classList.add('hidden');
}

function showScanNotFound(code) {
  const nf = $('scanNotFound');
  if (!nf) return;
  $('snfCode').textContent = code;
  // The "Create New Item" path is admin-only — hide the button otherwise.
  const createBtn = $('snfCreateBtn');
  const isAdmin = ME && ME.role === 'admin';
  if (createBtn) createBtn.style.display = isAdmin ? '' : 'none';
  nf.classList.remove('hidden');
}

async function scanRetry() {
  hideScanNotFound();
  $('scanErr').textContent = '';
  const input = $('scanManualInput');
  if (input) { input.value = ''; input.focus(); }
  _scanBusy = false;
  setScanStatus('Restarting camera...', '');
  // Stop any leftover stream first, then re-arm. Safe to call when already
  // stopped — startScanner handles the missing-camera path itself.
  stopScanner();
  await startScanner();
}
window.scanRetry = scanRetry;

// Admin-only: when a scan didn't match anything, pre-fill the Inventory
// "Add Item" form with the scanned asset ID and bounce there.
function scanCreateFromMissing() {
  if (!ME || ME.role !== 'admin') return;
  const code = ($('snfCode').textContent || '').trim();
  closeScanModal();
  swPage('inventory');
  // Defer until the inventory page has rendered + loaded the next-id default.
  setTimeout(() => {
    const aid = $('ai_assetid');
    const name = $('ai_name');
    if (aid) aid.value = code;
    if (name) { name.focus(); }
    toast(`Asset ID ${code} ready — fill in the name and create.`, 'green');
  }, 80);
}
window.scanCreateFromMissing = scanCreateFromMissing;

async function startScanner() {
  // Prefer ZXing if it loaded; fall back to a clear manual-only message.
  const ZX = window.ZXingBrowser || window.ZXing || null;
  if (!ZX || !ZX.BrowserMultiFormatReader) {
    setScanStatus('Camera scanner unavailable — use manual entry below.', 'err');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setScanStatus('Camera not available on this device — use manual entry.', 'err');
    return;
  }
  try {
    _scanReader = new ZX.BrowserMultiFormatReader();
    const video = $('scanVideo');
    // Prefer the rear camera on phones.
    const constraints = { video: { facingMode: { ideal: 'environment' } }, audio: false };
    _scanControls = await _scanReader.decodeFromConstraints(constraints, video, (result, err, controls) => {
      if (result && !_scanBusy) {
        _scanBusy = true;
        const text = (result.getText && result.getText()) || result.text || '';
        handleScannedCode(text);
      }
      // err is a NotFoundException on every frame with no code — ignore it.
    });
    setScanStatus('Looking for a QR code...', '');
  } catch (err) {
    let msg = err && err.message ? err.message : 'Could not start camera';
    if (err && (err.name === 'NotAllowedError' || /permission/i.test(msg))) {
      msg = 'Camera permission denied. Use manual entry below or grant access in your browser.';
    } else if (err && err.name === 'NotFoundError') {
      msg = 'No camera detected on this device. Use manual entry below.';
    }
    setScanStatus(msg, 'err');
  }
}

function stopScanner() {
  try { if (_scanControls && _scanControls.stop) _scanControls.stop(); } catch {}
  _scanControls = null;
  try { if (_scanReader && _scanReader.reset) _scanReader.reset(); } catch {}
  _scanReader = null;
  // Belt-and-braces: stop any tracks still attached to the <video>.
  const video = $('scanVideo');
  if (video) {
    const stream = video.srcObject;
    if (stream && stream.getTracks) stream.getTracks().forEach((t) => { try { t.stop(); } catch {} });
    video.srcObject = null;
  }
  if (_scanStream && _scanStream.getTracks) {
    _scanStream.getTracks().forEach((t) => { try { t.stop(); } catch {} });
  }
  _scanStream = null;
}

function closeScanModal() {
  stopScanner();
  $('scanOv').classList.add('hidden');
  _scanMode = null;
  _scanBusy = false;
  if (_lastFocusedBeforeOverlay && _lastFocusedBeforeOverlay.focus) {
    _lastFocusedBeforeOverlay.focus();
  }
}
window.closeScanModal = closeScanModal;

async function scanLookupManual() {
  const input = $('scanManualInput');
  const code = (input.value || '').trim();
  if (!code) { setScanStatus('Enter an asset ID to look up.', 'err'); input.focus(); return; }
  _scanBusy = true;
  await handleScannedCode(code);
}
window.scanLookupManual = scanLookupManual;

async function handleScannedCode(rawCode) {
  const code = (rawCode || '').trim();
  if (!code) { _scanBusy = false; return; }
  hideScanNotFound();
  setScanStatus(`Looking up "${code}"...`, '');
  try {
    const { item } = await api('/api/equipment/lookup?code=' + encodeURIComponent(code));
    setScanStatus(`Found: ${item.name}`, 'ok');
    // Quickly stop the camera once we have a match — keep modal up briefly
    // so the user sees the "Found" status before the confirm modal opens.
    stopScanner();
    const mode = _scanMode || 'checkout';
    closeScanModal();
    if (mode === 'inventory') {
      // Inventory path: open the existing edit modal, populated entirely
      // from the DB row the asset ID resolved to.
      showEqEdit(item);
      toast(`Loaded ${item.name} from inventory`, 'green');
    } else {
      openConfirmModal(item, mode);
    }
  } catch (err) {
    const status = err && err.status;
    if (status === 404) {
      setScanStatus(`No item matches "${code}".`, 'err');
      showScanNotFound(code);
      stopScanner();
    } else {
      setScanStatus(err.message || 'Lookup failed', 'err');
    }
    // Allow another attempt without closing the modal.
    _scanBusy = false;
  }
}

function openConfirmModal(item, mode) {
  _pendingItem = item;
  _pendingMode = mode;
  const isCheckout = mode === 'checkout';
  const isAvail = item.status === 'available';
  const isOut = item.status === 'checked_out';

  $('confirmTitle').textContent = isCheckout ? '✅ Confirm Check Out' : '✅ Confirm Check In';
  $('confirmErr').textContent = '';

  // Build details block
  const det = $('confirmDetails');
  det.innerHTML = '';
  const nameRow = document.createElement('div');
  nameRow.className = 'cd-name';
  nameRow.textContent = item.name || '(unnamed)';
  const statusBadge = document.createElement('span');
  statusBadge.className = 'cd-status ' + (isAvail ? 'avail' : 'out');
  statusBadge.textContent = isAvail ? 'AVAILABLE' : 'CHECKED OUT';
  nameRow.appendChild(statusBadge);
  det.appendChild(nameRow);

  function row(k, v) {
    if (!v) return;
    const r = document.createElement('div');
    r.className = 'cd-row';
    const kk = document.createElement('span'); kk.className = 'cd-key'; kk.textContent = k;
    const vv = document.createElement('span'); vv.className = 'cd-val'; vv.textContent = v;
    r.appendChild(kk); r.appendChild(vv); det.appendChild(r);
  }
  row('Asset ID', item.barcode);
  row('Type', item.type);
  row('Category', item.category);
  row('Serial #', item.serial_number);
  row('Notes', item.notes);
  if (isOut && item.checked_out_username) row('Checked out by', item.checked_out_username);
  if (isOut && item.checked_out_at) row('Checked out at', utc(item.checked_out_at).toLocaleString());
  if (item.created_at) row('Added', utc(item.created_at).toLocaleDateString());
  // Footer hint that this data came straight from the DB by asset-ID lookup,
  // not typed in by the user.
  const src = document.createElement('div');
  src.className = 'cd-source';
  src.textContent = '🔗 Loaded from inventory by asset ID';
  det.appendChild(src);

  // Show the kiosk borrower-picker only when an admin is checking out an
  // available item. Default it to whatever they have selected on the
  // Check Out page so the choice carries over.
  const kioskWrap = $('confirmKiosk');
  const kioskSel = $('confirmUser');
  const isAdmin = ME && ME.role === 'admin';
  if (kioskWrap && kioskSel) {
    if (isAdmin && isCheckout && isAvail) {
      populateKioskSelect(kioskSel);
      const pageSel = $('kioskUser');
      if (pageSel && pageSel.value) kioskSel.value = pageSel.value;
      kioskWrap.classList.remove('hidden');
    } else {
      kioskWrap.classList.add('hidden');
    }
  }

  // Decide button + sub-text based on (mode, status) combinations.
  const sub = $('confirmSub');
  const yesBtn = $('confirmYesBtn');
  yesBtn.disabled = false;
  yesBtn.classList.remove('br', 'bg');
  if (isCheckout) {
    if (isAvail) {
      sub.textContent = 'This item is available. Confirm checkout?';
      yesBtn.textContent = '✔ Confirm Check Out';
      yesBtn.classList.add('bg');
    } else {
      sub.textContent = 'This item is already checked out — cannot check it out again.';
      yesBtn.textContent = 'Cannot Check Out';
      yesBtn.disabled = true;
    }
  } else {
    if (isOut) {
      const ownsIt = ME && (ME.role === 'admin' || item.checked_out_by === ME.id);
      if (ownsIt) {
        sub.textContent = 'Confirm check-in for this item?';
        yesBtn.textContent = '✔ Confirm Check In';
        yesBtn.classList.add('bg');
      } else {
        sub.textContent = `This item was checked out by ${item.checked_out_username || 'another user'} — only they (or an admin) can check it in.`;
        yesBtn.textContent = 'Cannot Check In';
        yesBtn.disabled = true;
      }
    } else {
      sub.textContent = 'This item is already checked in.';
      yesBtn.textContent = 'Cannot Check In';
      yesBtn.disabled = true;
    }
  }

  $('confirmOv').classList.remove('hidden');
  setTimeout(() => { if (!yesBtn.disabled) yesBtn.focus(); }, 30);
}

function closeConfirmModal() {
  $('confirmOv').classList.add('hidden');
  _pendingItem = null;
  _pendingMode = null;
}
window.closeConfirmModal = closeConfirmModal;

async function doConfirmAction() {
  const item = _pendingItem;
  const mode = _pendingMode;
  if (!item || !mode) { closeConfirmModal(); return; }
  const yesBtn = $('confirmYesBtn');
  const original = yesBtn.textContent;
  yesBtn.disabled = true;
  yesBtn.textContent = 'Working...';
  try {
    if (mode === 'checkout') {
      const body = { source: 'Barcode' };
      // Admin kiosk: pass the selected borrower id (omitted when the admin
      // is checking out for themselves, so the server records it as a
      // normal self-checkout).
      if (ME && ME.role === 'admin') {
        const sel = $('confirmUser');
        const v = sel ? parseInt(sel.value, 10) : NaN;
        if (Number.isFinite(v) && v !== ME.id) body.for_user_id = v;
      }
      await api(`/api/equipment/${item.id}/checkout`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const who = (ME && ME.role === 'admin' && body.for_user_id)
        ? ` (for ${selectedConfirmUsername()})` : '';
      toast(`Checked out: ${item.name}${who}`, 'green');
    } else {
      await api(`/api/equipment/${item.id}/checkin`, {
        method: 'POST',
        body: JSON.stringify({ source: 'Barcode' }),
      });
      toast(`Checked in: ${item.name}`, 'green');
    }
    closeConfirmModal();
    // Refresh whichever tab is visible.
    if ($('pg-checkin').classList.contains('on')) loadCI();
    if ($('pg-inventory') && $('pg-inventory').classList.contains('on')) loadInventory();
  } catch (err) {
    $('confirmErr').textContent = err.message || 'Action failed';
    yesBtn.disabled = false;
    yesBtn.textContent = original;
  }
}
window.doConfirmAction = doConfirmAction;

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
(async function boot() {
  $('lp').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('mc2').addEventListener('keydown', (e) => { if (e.key === 'Enter') doMfaLoginVerify(); });
  $('np2').addEventListener('keydown', (e) => { if (e.key === 'Enter') doForceChg(); });
  $('cpN2').addEventListener('keydown', (e) => { if (e.key === 'Enter') doChgPass(); });
  $('mfaCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') doMfaEnable(); });
  const eqBarcode = $('eqEditBarcode');
  if (eqBarcode) eqBarcode.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveEqEdit(); });

  // Click outside ov-card to dismiss (but only the equipment edit and MFA — keep
  // login/admin/forced-pw modal sticky to avoid accidental dismissal).
  $('eqEditOv').addEventListener('click', (e) => { if (e.target === $('eqEditOv')) hideEqEdit(); });

  // QR scan modal: Enter on manual input runs the lookup; clicking the
  // backdrop cancels (which also stops the camera).
  const scanInput = $('scanManualInput');
  if (scanInput) scanInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') scanLookupManual(); });
  $('scanOv').addEventListener('click', (e) => { if (e.target === $('scanOv')) closeScanModal(); });
  $('confirmOv').addEventListener('click', (e) => { if (e.target === $('confirmOv')) closeConfirmModal(); });

  // Check Out → manual entry: pressing Enter in the barcode/asset-ID field
  // (or in any of the related inputs) triggers the lookup, so a USB/HID
  // barcode scanner that ends the scan with Enter populates the confirm
  // modal directly without any extra clicks.
  const mBarcode = $('m_barcode');
  if (mBarcode) mBarcode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); manualBarcodeLookup(); }
  });

  // Stop the camera if the user navigates away or hides the tab.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !$('scanOv').classList.contains('hidden')) {
      stopScanner();
      setScanStatus('Camera paused — close and re-open to resume.', '');
    }
  });
  window.addEventListener('beforeunload', () => { stopScanner(); });

  try {
    const me = await api('/api/auth/me');
    if (me && me.user) {
      ME = me.user;
      await onAuthed();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
})();
